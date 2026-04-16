import {
  AutoModelForCTC,
  AutoProcessor,
  AutoTokenizer,
  env,
  type ProgressCallback,
  pipeline,
} from "@huggingface/transformers";
import type { Word } from "@/types";
import { align } from "./aligner";
import { getSpeechSegments } from "./vad";

interface TranscriberOutput {
  text: string;
}

type Transcriber = (
  audio: Float32Array,
  options: { return_timestamps: boolean },
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

export type ModelSize =
  | "Xenova/whisper-tiny.en"
  | "Xenova/whisper-base.en"
  | "onnx-community/whisper-large-v3-turbo";

const ALIGNER_MODEL_ID = "onnx-community/mms-300m-1130-forced-aligner-ONNX";

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

  return { transcriber, alignerModel, alignerProcessor, alignerTokenizer };
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

  const allWords: Word[] = [];
  let fullText = "";

  // STEP 2: Process each speech segment
  for (let i = 0; i < speechSegments.length; i++) {
    const segment = speechSegments[i];
    const segmentDuration = segment.end - segment.start;
    console.log(
      `[TextCast] Processing segment ${i + 1}/${speechSegments.length} (${segment.start.toFixed(2)}s - ${segment.end.toFixed(2)}s)`,
    );

    const baseProgress = 10 + Math.round((i / speechSegments.length) * 90);
    const midProgress =
      10 + Math.round(((i + 0.5) / speechSegments.length) * 90);

    if (onProgress) {
      onProgress({
        status: "progress",
        progress: baseProgress,
        message: `Transcribing segment ${i + 1}/${speechSegments.length}...`,
        // biome-ignore lint/suspicious/noExplicitAny: ProgressCallback type is incomplete in library
      } as any);
    }

    // --- STAGE 1: TRANSCRIPTION (Whisper) ---
    if (!transcriber) continue;
    const whisperResult = await transcriber(segment.audio, {
      return_timestamps: false,
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
        message: `Aligning segment ${i + 1}/${speechSegments.length}...`,
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

    if (onProgress) {
      onProgress({
        status: "progress",
        progress: Math.round(((i + 1) / speechSegments.length) * 100),
        // biome-ignore lint/suspicious/noExplicitAny: ProgressCallback type is incomplete in library
      } as any);
    }
  }

  return {
    text: fullText.trim(),
    segments: [],
    words: allWords,
  };
}
