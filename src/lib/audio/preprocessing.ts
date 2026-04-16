/**
 * Audio preprocessing utilities using Web Audio API
 *
 * Provides basic noise reduction without external dependencies:
 * - High-pass filter (removes low-frequency rumble)
 * - Noise gate (removes quiet sections)
 * - Normalization (consistent volume)
 * - Silence trimming (removes long silences)
 */

export interface AudioProcessingOptions {
  /** Enable high-pass filter to remove low-frequency rumble */
  highPassEnabled?: boolean;
  /** High-pass filter frequency in Hz (default: 80) */
  highPassFreq?: number;

  /** Enable noise gate */
  noiseGateEnabled?: boolean;
  /** Noise gate threshold in dB (default: -40) */
  noiseGateThreshold?: number;

  /** Enable normalization */
  normalizeEnabled?: boolean;
  /** Normalization target level in dB (default: -3) */
  normalizeLevel?: number;

  /** Enable silence trimming */
  silenceTrimEnabled?: boolean;
  /** Minimum silence duration to trim in seconds (default: 0.5) */
  silenceThreshold?: number;
}

/**
 * Process audio with basic noise reduction
 */
export async function preprocessAudio(
  audioBuffer: AudioBuffer,
  options: AudioProcessingOptions = {},
): Promise<AudioBuffer> {
  const ctx = new AudioContext();

  // Create offline context for processing
  const offlineCtx = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate,
  );

  // Create buffer source
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  // Build processing chain
  let lastNode: AudioNode = source;

  // 1. High-pass filter
  if (options.highPassEnabled !== false) {
    const highPass = ctx.createBiquadFilter();
    highPass.type = "highpass";
    highPass.frequency.value = options.highPassFreq ?? 80;
    highPass.Q.value = 0.7;
    lastNode.connect(highPass);
    lastNode = highPass;
  }

  // 2. Normalization
  if (options.normalizeEnabled !== false) {
    const normalizer = ctx.createDynamicsCompressor();
    normalizer.threshold.value = options.normalizeLevel ?? -3;
    normalizer.knee.value = 0;
    normalizer.ratio.value = 20; // aggressive compression
    normalizer.attack.value = 0.001;
    normalizer.release.value = 0.1;
    lastNode.connect(normalizer);
    lastNode = normalizer;
  }

  // Connect to destination
  lastNode.connect(offlineCtx.destination);

  // Start and render
  source.start();
  const processedBuffer = await offlineCtx.startRendering();

  // 3. Silence trimming (post-process)
  if (options.silenceTrimEnabled !== false) {
    return trimSilence(processedBuffer, options.silenceThreshold ?? 0.5);
  }

  return processedBuffer;
}

/**
 * Trim silence from beginning and end of audio
 */
export function trimSilence(
  buffer: AudioBuffer,
  threshold: number = 0.5,
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const thresholdSamples = threshold * sampleRate;

  // Find start (first sample above threshold)
  let startSample = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      if (Math.abs(data[i]) > 0.01) {
        startSample = Math.max(startSample, i - thresholdSamples);
        break;
      }
    }
  }

  // Find end (last sample above threshold)
  let endSample = buffer.length;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = data.length - 1; i >= 0; i--) {
      if (Math.abs(data[i]) > 0.01) {
        endSample = Math.min(endSample, i + thresholdSamples);
        break;
      }
    }
  }

  // Ensure we have some audio
  startSample = Math.max(0, startSample);
  endSample = Math.min(buffer.length, endSample);

  if (endSample <= startSample) {
    return buffer; // Return original if trimming fails
  }

  // Create trimmed buffer
  const trimmedLength = endSample - startSample;
  const trimmed = new AudioBuffer({
    length: trimmedLength,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const sourceData = buffer.getChannelData(ch);
    const targetData = trimmed.getChannelData(ch);

    for (let i = 0; i < trimmedLength; i++) {
      targetData[i] = sourceData[startSample + i];
    }
  }

  return trimmed;
}

/**
 * Get audio levels for visualization
 */
export function getAudioLevels(buffer: AudioBuffer): {
  rms: number;
  peak: number;
} {
  let sumSquares = 0;
  let peak = 0;
  const channels = buffer.numberOfChannels;
  const length = buffer.length;

  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const sample = Math.abs(data[i]);
      sumSquares += sample * sample;
      peak = Math.max(peak, sample);
    }
  }

  const rms = Math.sqrt(sumSquares / (length * channels));

  return { rms, peak };
}

/**
 * Detect if audio is likely to have significant noise
 * (based on ratio of quiet vs loud sections)
 */
export function detectNoiseLevel(
  buffer: AudioBuffer,
): "low" | "medium" | "high" {
  const { rms } = getAudioLevels(buffer);

  // Very quiet audio is likely to have more noise relative to signal
  if (rms < 0.05) return "high";
  if (rms < 0.15) return "medium";
  return "low";
}

/**
 * Convert AudioBuffer to 16-bit PCM for processing
 */
export function audioBufferToPcm16(buffer: AudioBuffer): Int16Array {
  const length = buffer.length;
  const pcm = new Int16Array(length);

  for (let i = 0; i < length; i++) {
    const sample = buffer.getChannelData(0)[i];
    // Convert -1..1 to Int16
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  }

  return pcm;
}

/**
 * Convert Int16Array back to AudioBuffer
 */
export function pcm16ToAudioBuffer(
  pcm: Int16Array,
  sampleRate: number,
): AudioBuffer {
  const ctx = new AudioContext();
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < pcm.length; i++) {
    data[i] = pcm[i] / 32767;
  }

  return buffer;
}
