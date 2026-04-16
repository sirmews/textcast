import { FrameProcessor, NonRealTimeVAD } from "@ricky0123/vad-web";
import { SileroV5 } from "@ricky0123/vad-web/dist/models/v5.js";
import * as ort from "onnxruntime-web";

export interface SpeechSegment {
  start: number;
  end: number;
  audio: Float32Array;
}

/**
 * Uses Silero VAD (via @ricky0123/vad-web) to identify speech segments.
 * Manually composes the NonRealTimeVAD pipeline to support the modern v5 model,
 * bypassing the hardcoded legacy wrapper.
 */
export async function getSpeechSegments(
  audioData: Float32Array,
  sampleRate: number = 16000,
): Promise<SpeechSegment[]> {
  console.log(
    `[VAD] Initializing Silero VAD (v5) for ${audioData.length} samples...`,
  );

  // Configure ORT Wasm paths explicitly
  ort.env.wasm.wasmPaths = "/ort-wasm/";

  const modelURL = "/silero_vad_v5.onnx";
  const modelFetcher = async () => {
    const response = await fetch(modelURL);
    if (!response.ok) {
      throw new Error(`Failed to fetch VAD model from ${modelURL}`);
    }
    return await response.arrayBuffer();
  };

  // 1. Load the v5 model using its specific factory
  // biome-ignore lint/suspicious/noExplicitAny: ort types don't match vad-web's expected interface
  const model = await SileroV5.new(ort as any, modelFetcher);

  // 2. Setup VAD options (customized thresholds for v5)
  const options = {
    positiveSpeechThreshold: 0.5,
    negativeSpeechThreshold: 0.35,
    preSpeechPadMs: 800,
    redemptionMs: 1400,
    minSpeechMs: 400,
    submitUserSpeechOnPause: false,
    modelURL,
    modelFetcher,
  };

  // 3. Create the FrameProcessor
  // The v5 model expects exactly 512 samples per frame (which equals 32ms at 16000Hz)
  const frameProcessor = new FrameProcessor(
    model.process,
    model.reset_state,
    options,
    32, // msPerFrame = 512 / 16
  );
  frameProcessor.resume();

  // 4. Instantiate the wrapper manually
  const vad = new NonRealTimeVAD(
    modelFetcher,
    // biome-ignore lint/suspicious/noExplicitAny: ort types don't match vad-web's expected interface
    ort as any,
    options,
    frameProcessor,
  );

  // NOTE: The base NonRealTimeVAD constructor hardcodes frameSamples to 1536!
  // We MUST override it here, otherwise it will chunk audio incorrectly for v5.
  vad.frameSamples = 512;

  console.log(`[VAD] Running inference...`);

  const segments: SpeechSegment[] = [];

  for await (const segmentData of vad.run(audioData, sampleRate)) {
    // BUG FIX: @ricky0123/vad-web's NonRealTimeVAD has a known bug where `segmentData.start`
    // does NOT account for `preSpeechPadMs`. It returns the exact moment the threshold
    // was crossed, but the `audio` buffer returned includes the pre-speech padding!
    // This causes a massive desync (e.g. all words shifted late by ~800ms).
    // We calculate the true start time by subtracting the actual audio duration from the end time.
    const trueStartMs =
      segmentData.end - segmentData.audio.length / (sampleRate / 1000);

    segments.push({
      start: trueStartMs / 1000,
      end: segmentData.end / 1000,
      audio: segmentData.audio,
    });
  }

  console.log(`[VAD] Identified ${segments.length} speech segments.`);
  return segments;
}
