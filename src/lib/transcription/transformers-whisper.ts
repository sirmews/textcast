import {
  AutoModelForCTC,
  AutoProcessor,
  AutoTokenizer,
  env,
  type ProgressCallback,
  pipeline,
  AutoModelForAudioFrameClassification,
} from "@huggingface/transformers";
import type { Word } from "@/types";
import { align } from "./aligner";
import { getSpeechSegments } from "./vad";

interface TranscriberOutput {
  text: string;
}

type Transcriber = (
  audio: Float32Array,
  options: {
    return_timestamps: boolean;
    chunk_length_s?: number;
    stride_length_s?: number;
  },
) => Promise<TranscriberOutput | TranscriberOutput[]>;

type AlignerModel = (
  inputs: unknown,
) => Promise<{ logits: { dims: number[]; data: Float32Array } }>;

type AlignerProcessor = (audio: Float32Array) => Promise<unknown>;

interface AlignerTokenizer {
  _tokenizerJSON: {
    model: {
      vocab: Record<string, number>;
    };
  };
}

// Configuration for Transformers.js
env.allowLocalModels = false;
env.useBrowserCache = true;

// Configure ONNX Runtime WASM paths
// @ts-expect-error
env.backends.onnx.wasm.wasmPaths = "/ort-wasm/";

/**
 * Singleton to hold model instances
 */
let transcriber: Transcriber | null = null;
let alignerModel: AlignerModel | null = null;
let alignerProcessor: AlignerProcessor | null = null;
let alignerTokenizer: AlignerTokenizer | null = null;
let diarizationModel: any = null;
let diarizationProcessor: any = null;

export type ModelSize =
  | "Xenova/whisper-tiny.en"
  | "Xenova/whisper-base.en"
  | "onnx-community/whisper-large-v3-turbo";

const ALIGNER_MODEL_ID = "onnx-community/mms-300m-1130-forced-aligner-ONNX";
const DIARIZATION_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";

/**
 * Check if WebGPU is available
 */
export async function checkWebGPU(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

/**
 * Get recommended model based on device capability
 */
export function getRecommendedModel(_webGPU: boolean): ModelSize {
  return "Xenova/whisper-tiny.en";
}

/**
 * Pre-loads the required AI models
 */
export async function loadModel(
  modelId: ModelSize = "Xenova/whisper-tiny.en",
  onProgress?: ProgressCallback,
) {
  const hasWebGPU = await checkWebGPU();

  if (!transcriber) {
    console.log(
      `[TextCast] Loading Transcriber: ${modelId} (WebGPU: ${hasWebGPU})`,
    );
    transcriber = await pipeline("automatic-speech-recognition", modelId, {
      device: hasWebGPU ? "webgpu" : "wasm",
      dtype: {
        encoder_model: "fp32",
        decoder_model_merged: "q4",
      },
      progress_callback: onProgress,
    });
  }

  if (!alignerModel) {
    console.log(`[TextCast] Loading Aligner: ${ALIGNER_MODEL_ID}`);
    // MMS aligner is ~300MB, we use q4 quantization to save memory/bandwidth
    alignerModel = await AutoModelForCTC.from_pretrained(ALIGNER_MODEL_ID, {
      device: hasWebGPU ? "webgpu" : "wasm",
      dtype: "q4",
      progress_callback: onProgress,
    });
    alignerProcessor = await AutoProcessor.from_pretrained(ALIGNER_MODEL_ID, {
      progress_callback: onProgress,
    });
    alignerTokenizer = await AutoTokenizer.from_pretrained(ALIGNER_MODEL_ID, {
      progress_callback: onProgress,
    });
  }

  if (!diarizationModel) {
    console.log(`[TextCast] Loading Diarization: ${DIARIZATION_MODEL_ID}`);
    // NOTE: WebGPU is not currently supported for pyannote in ORT Web
    diarizationModel = await AutoModelForAudioFrameClassification.from_pretrained(DIARIZATION_MODEL_ID, {
      device: "wasm",
      dtype: "fp32",
      progress_callback: onProgress,
    });
    diarizationProcessor = await AutoProcessor.from_pretrained(DIARIZATION_MODEL_ID, {
      progress_callback: onProgress,
    });
  }

  return {
    transcriber,
    alignerModel,
    alignerProcessor,
    alignerTokenizer,
    diarizationModel,
    diarizationProcessor,
  };
}

/**
 * Resample an AudioBuffer to 16kHz mono (required for Whisper and MMS)
 */
export async function resampleAudio(
  buffer: AudioBuffer,
): Promise<Float32Array> {
  const TARGET_SAMPLE_RATE = 16000;
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(buffer.duration * TARGET_SAMPLE_RATE),
    TARGET_SAMPLE_RATE,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start();
  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer.getChannelData(0);
}

export interface TranscriptionResult {
  text: string;
  segments: { id: string; start: number; end: number; text: string }[];
  words: Word[];
}

/**
 * Transcribes an AudioBuffer into text with word-level timestamps.
 */
export async function transcribeAudio(
  audioBuffer: AudioBuffer,
  onProgress?: ProgressCallback,
): Promise<TranscriptionResult> {
  // Ensure models are loaded
  await loadModel(undefined, onProgress);

  if (onProgress) {
    onProgress({
      status: "progress",
      progress: 0,
      message: "Resampling audio to 16kHz...",
      // biome-ignore lint/suspicious/noExplicitAny: ProgressCallback type is incomplete in library
    } as any);
  }

  // Convert AudioBuffer to Float32Array at 16kHz
  console.log("[Transformers.js] Resampling audio to 16kHz...");
  const audioData = await resampleAudio(audioBuffer);

  if (onProgress) {
    onProgress({
      status: "progress",
      progress: 5,
      message: "Running Voice Activity Detection (VAD)...",
      // biome-ignore lint/suspicious/noExplicitAny: ProgressCallback type is incomplete in library
    } as any);
  }

  // STEP 1: Run VAD to identify speech segments and strip silence
  console.log("[Transformers.js] Running Voice Activity Detection...");
  let speechSegments = await getSpeechSegments(audioData, 16000);

  // FALLBACK: If VAD found nothing, process the entire buffer as one segment
  if (speechSegments.length === 0) {
    console.log(
      "[Transformers.js] VAD found no segments. Falling back to full buffer.",
    );
    speechSegments = [
      {
        start: 0,
        end: audioBuffer.duration,
        audio: audioData,
      },
    ];
  }

  // --- SUB-SEGMENTATION OF LONG SPEECH SESSIONS ---
  // RATIONALE: Whisper and MMS forced-aligner models are architecturally optimized for
  // audio sequences under 30 seconds. In browser-based ONNX Runtime (WASM/WebGPU),
  // executing inference on very long Float32Arrays (e.g., several minutes) causes
  // tensor dimensions (specifically the sequence length dimension in the output logits)
  // to grow extremely large. This results in out-of-memory or dimensional out-of-bound
  // failures like "failed to call OrtRun(). ERROR_CODE: 1 ... Tensor shape is too large".
  //
  // To avoid this, we split any speech segment longer than 29 seconds into smaller
  // sub-segments. We use 29.0s instead of 30.0s to provide a 1-second safety padding
  // against rounding discrepancies, float inaccuracies, or model padding bounds.
  // Using Float32Array.subarray is highly efficient as it references slices of the
  // existing memory view without copy overhead. Word timestamps are automatically
  // reconstructed correctly since sub-segment offsets are relative to the original timeline.
  const MAX_SEGMENT_DURATION = 29; // seconds
  const processedSegments: typeof speechSegments = [];
  const sampleRate = 16000;

  for (const segment of speechSegments) {
    const segmentDuration = segment.end - segment.start;
    if (segmentDuration <= MAX_SEGMENT_DURATION) {
      processedSegments.push(segment);
    } else {
      console.log(
        `[TextCast] Splitting long segment (${segmentDuration.toFixed(2)}s) into sub-segments of max ${MAX_SEGMENT_DURATION}s`,
      );
      let offset = 0;
      while (offset < segmentDuration) {
        const chunkDuration = Math.min(MAX_SEGMENT_DURATION, segmentDuration - offset);
        const startSample = Math.round(offset * sampleRate);
        const endSample = Math.min(
          segment.audio.length,
          Math.round((offset + chunkDuration) * sampleRate),
        );
        const chunkAudio = segment.audio.subarray(startSample, endSample);
        if (chunkAudio.length > 0) {
          processedSegments.push({
            start: segment.start + offset,
            end: segment.start + offset + chunkDuration,
            audio: chunkAudio,
          });
        }
        offset += chunkDuration;
      }
    }
  }

  const allWords: Word[] = [];
  let fullText = "";
  const resultSegments: { id: string; start: number; end: number; text: string; speaker?: string }[] = [];

  // STEP 2: Process each speech segment
  for (let i = 0; i < processedSegments.length; i++) {
    const segment = processedSegments[i];
    const segmentDuration = segment.end - segment.start;
    const segmentStartIdx = allWords.length;
    console.log(
      `[TextCast] Processing segment ${i + 1}/${processedSegments.length} (${segment.start.toFixed(2)}s - ${segment.end.toFixed(2)}s)`,
    );

    const baseProgress = 10 + Math.round((i / processedSegments.length) * 90);
    const midProgress =
      10 + Math.round(((i + 0.5) / processedSegments.length) * 90);

    if (onProgress) {
      onProgress({
        status: "progress",
        progress: baseProgress,
        message: `Transcribing segment ${i + 1}/${processedSegments.length}...`,
        // biome-ignore lint/suspicious/noExplicitAny: ProgressCallback type is incomplete in library
      } as any);
    }

    // --- STAGE 1: TRANSCRIPTION (Whisper) ---
    if (!transcriber) continue;
    const whisperResult = await transcriber(segment.audio, {
      return_timestamps: false,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    const output = Array.isArray(whisperResult)
      ? whisperResult[0]
      : whisperResult;
    const transcriptText = output.text.trim();

    if (!transcriptText) continue;
    fullText += `${transcriptText} `;

    if (onProgress) {
      onProgress({
        status: "progress",
        progress: midProgress,
        message: `Aligning segment ${i + 1}/${processedSegments.length}...`,
      } as any);
    }

    // --- STAGE 2: FORCED ALIGNMENT (MMS) ---
    try {
      if (!alignerProcessor || !alignerModel || !alignerTokenizer) continue;
      const inputs = await alignerProcessor(segment.audio);
      const { logits } = await alignerModel(inputs);

      const seqLen = logits.dims[1];
      const vocabSize = logits.dims[2];
      const logitsData = logits.data;

      const emission: Float32Array[] = [];
      for (let t = 0; t < seqLen; t++) {
        emission.push(logitsData.subarray(t * vocabSize, (t + 1) * vocabSize));
      }

      const vocab = alignerTokenizer._tokenizerJSON.model.vocab;
      const alignedWords = align(emission, transcriptText, vocab, 0.02);

      for (const aligned of alignedWords) {
        allWords.push({
          word: aligned.word,
          start: segment.start + Math.min(aligned.start, segmentDuration),
          end: segment.start + Math.min(aligned.end, segmentDuration),
          confidence: 1,
        });
      }
    } catch (err) {
      console.error(
        "[TextCast] Forced alignment failed, using fallback linear mapping:",
        err,
      );
      const words = transcriptText.split(" ");
      const wordDur = segmentDuration / words.length;
      words.forEach((w: string, idx: number) => {
        allWords.push({
          word: w,
          start: segment.start + idx * wordDur,
          end: segment.start + (idx + 1) * wordDur,
          confidence: 0.5,
        });
      });
    }

    const segmentWords = allWords.slice(segmentStartIdx);
    if (segmentWords.length > 0) {
      resultSegments.push({
        id: `seg-${i}-${Date.now()}`,
        start: segment.start,
        end: segment.end,
        text: segmentWords.map((w) => w.word).join(" "),
      });
    }

    if (onProgress) {
      onProgress({
        status: "progress",
        progress: Math.round(((i + 1) / processedSegments.length) * 100),
        // biome-ignore lint/suspicious/noExplicitAny: ProgressCallback type is incomplete in library
      } as any);
    }
  }

  // --- STAGE 3: SPEAKER DIARIZATION (PyAnnote) ---
  let finalSegments = resultSegments;
  try {
    if (diarizationModel && diarizationProcessor) {
      console.log("[TextCast] Running PyAnnote Speaker Diarization on full audio...");
      if (onProgress) {
        onProgress({
          status: "progress",
          progress: 98,
          message: "Performing Speaker Diarization...",
          // biome-ignore lint/suspicious/noExplicitAny: library types
        } as any);
      }

      const inputs = await diarizationProcessor(audioData);
      const { logits } = await diarizationModel(inputs);
      const speakerSegmentsRaw = diarizationProcessor.post_process_speaker_diarization(logits, audioData.length);
      const speakerSegments = speakerSegmentsRaw[0] || [];

      console.log(`[TextCast] Diarization finished. Found ${speakerSegments.length} speaker chunks.`);

      if (speakerSegments.length > 0 && allWords.length > 0) {
        // Map speaker names (e.g. SPEAKER_00 -> Speaker A)
        const speakerNames: Record<string, string> = {};
        let speakerCount = 0;
        const getSpeakerLabel = (id: string): string => {
          if (!speakerNames[id]) {
            const label = String.fromCharCode(65 + speakerCount); // 'A', 'B', 'C', ...
            speakerNames[id] = `Speaker ${label}`;
            speakerCount++;
          }
          return speakerNames[id];
        };

        // Assign speaker to each word
        for (const word of allWords) {
          let bestSpeaker = "SPEAKER_00";
          let maxOverlap = 0;
          for (const seg of speakerSegments) {
            const overlapStart = Math.max(word.start, seg.start);
            const overlapEnd = Math.min(word.end, seg.end);
            const overlap = overlapEnd - overlapStart;
            if (overlap > maxOverlap) {
              maxOverlap = overlap;
              bestSpeaker = seg.id;
            }
          }
          // Fallback if no overlap: find closest segment
          if (maxOverlap === 0 && speakerSegments.length > 0) {
            let minDistance = Infinity;
            for (const seg of speakerSegments) {
              const dist = Math.min(Math.abs(word.start - seg.end), Math.abs(seg.start - word.end));
              if (dist < minDistance) {
                minDistance = dist;
                bestSpeaker = seg.id;
              }
            }
          }
          word.speaker = getSpeakerLabel(bestSpeaker);
        }

        // Re-construct contiguous segments based on speaker changes or long pauses
        const diarizedSegments: typeof resultSegments = [];
        let currentSegmentWords: Word[] = [allWords[0]];
        let currentSpeaker = allWords[0].speaker || "Speaker A";
        let segmentStart = allWords[0].start;

        for (let i = 1; i < allWords.length; i++) {
          const word = allWords[i];
          const wordSpeaker = word.speaker || "Speaker A";
          const prevWord = allWords[i - 1];

          const speakerChanged = wordSpeaker !== currentSpeaker;
          const isLongPause = word.start - prevWord.end > 2.0;

          if (speakerChanged || isLongPause) {
            diarizedSegments.push({
              id: `seg-${diarizedSegments.length}-${Date.now()}`,
              start: segmentStart,
              end: prevWord.end,
              text: currentSegmentWords.map((w) => w.word).join(" "),
              speaker: currentSpeaker,
            });
            currentSegmentWords = [word];
            currentSpeaker = wordSpeaker;
            segmentStart = word.start;
          } else {
            currentSegmentWords.push(word);
          }
        }

        if (currentSegmentWords.length > 0) {
          diarizedSegments.push({
            id: `seg-${diarizedSegments.length}-${Date.now()}`,
            start: segmentStart,
            end: currentSegmentWords[currentSegmentWords.length - 1].end,
            text: currentSegmentWords.map((w) => w.word).join(" "),
            speaker: currentSpeaker,
          });
        }

        finalSegments = diarizedSegments;
      }
    }
  } catch (err) {
    console.error("[TextCast] Diarization failed, falling back to basic VAD segments:", err);
  }

  return {
    text: fullText.trim(),
    segments: finalSegments,
    words: allWords,
  };
}
