export interface PeakExtractionOptions {
  /** The desired number of visual bars to represent the waveform (default: 300) */
  numberOfPeaks?: number;
  /** Power-shaping factor for visual enhancement (default: 1.0, e.g. 0.7 to boost quiet parts) */
  shapingFactor?: number;
}

/**
 * Extracts and normalizes audio amplitude peaks from an AudioBuffer.
 * Handles multi-channel blending, boundary protection, and visual shaping.
 * 
 * @param audioBuffer The source Web Audio buffer
 * @param options Styling and downsampling parameters
 * @returns Array of normalized amplitude values between 0.0 and 1.0
 */
export function extractPeaks(
  audioBuffer: AudioBuffer,
  options: PeakExtractionOptions = {}
): number[] {
  const numberOfPeaks = options.numberOfPeaks ?? 300;
  const shapingFactor = options.shapingFactor ?? 1.0;

  if (!audioBuffer || audioBuffer.length === 0 || numberOfPeaks <= 0) {
    return Array(Math.max(0, numberOfPeaks)).fill(0);
  }

  const numChannels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;
  const blockSize = Math.floor(totalSamples / numberOfPeaks);

  // If the audio buffer is shorter than the desired number of peaks,
  // we default to a safe sampleSize of 1 to avoid Division by Zero.
  const sampleSize = Math.max(1, blockSize);
  const peaks: number[] = [];

  // Extract raw channel data references for high-speed indexing
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(audioBuffer.getChannelData(c));
  }

  // Loop through each partition bucket
  for (let i = 0; i < numberOfPeaks; i++) {
    const start = i * sampleSize;
    const end = Math.min(start + sampleSize, totalSamples);

    if (start >= totalSamples) {
      peaks.push(0);
      continue;
    }

    let maxVal = 0;

    // Inner loop calculates absolute maximum peak merged across all stereo/mono channels
    for (let j = start; j < end; j++) {
      let combinedSample = 0;
      for (let c = 0; c < numChannels; c++) {
        combinedSample += Math.abs(channelData[c][j]);
      }
      // Calculate average across channels
      const averagedSample = combinedSample / numChannels;
      if (averagedSample > maxVal) {
        maxVal = averagedSample;
      }
    }

    peaks.push(maxVal);
  }

  // Normalize and apply visual power shaping
  const globalMax = Math.max(...peaks);

  if (!Number.isFinite(globalMax) || globalMax === 0) {
    // If entire file is silent, return a flat fallback baseline
    return Array(numberOfPeaks).fill(0.05);
  }

  return peaks.map((p) => {
    const normalized = p / globalMax;
    // Apply power shaping (e.g. Math.pow(x, 0.7) lifts quiet audio visual levels)
    const shaped = Math.pow(normalized, shapingFactor);
    return Math.min(1.0, Math.max(0.0, shaped));
  });
}
