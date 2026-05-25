import { describe, expect, it } from "vitest";
import { extractPeaks } from "./peaks";

// Mock minimal browser AudioBuffer structure
class MockAudioBuffer {
  duration: number;
  length: number;
  numberOfChannels: number;
  sampleRate: number;
  private channelData: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channelData = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length)
    );
  }

  getChannelData(channel: number): Float32Array {
    if (channel >= this.numberOfChannels) {
      throw new Error("Channel index out of bounds");
    }
    return this.channelData[channel];
  }
}

describe("Audio Peak Extraction Algorithm", () => {
  it("should extract the correct number of peaks", () => {
    // Generate an AudioBuffer of 1000 samples, mono
    const mockBuffer = new MockAudioBuffer(1, 1000, 1000) as any as AudioBuffer;
    const channelData = mockBuffer.getChannelData(0);
    // Fill with sample waves
    for (let i = 0; i < 1000; i++) {
      channelData[i] = Math.sin(i * 0.1);
    }

    const peaks = extractPeaks(mockBuffer, { numberOfPeaks: 10 });
    expect(peaks.length).toBe(10);
    expect(peaks.every((p) => p >= 0 && p <= 1.0)).toBe(true);
  });

  it("should blend multiple channels (stereo) correctly", () => {
    // 2-channel audio (stereo), 10 samples
    const mockBuffer = new MockAudioBuffer(2, 10, 1000) as any as AudioBuffer;
    
    // Speaker A on left channel (index 0) only, Speaker B on right channel (index 1) only
    const leftData = mockBuffer.getChannelData(0);
    const rightData = mockBuffer.getChannelData(1);
    
    leftData[2] = 0.8; // Peak on left channel at index 2
    rightData[7] = 0.6; // Peak on right channel at index 7

    // Extract exactly 2 peaks (should blend both channels)
    const peaks = extractPeaks(mockBuffer, { numberOfPeaks: 2 });
    
    // First peak corresponds to index 0-5 (contains left channel peak)
    // Second peak corresponds to index 5-10 (contains right channel peak)
    expect(peaks[0]).toBeGreaterThan(0);
    expect(peaks[1]).toBeGreaterThan(0);
  });

  it("should handle complete silence gracefully without NaN values", () => {
    const mockBuffer = new MockAudioBuffer(1, 100, 1000) as any as AudioBuffer;
    const peaks = extractPeaks(mockBuffer, { numberOfPeaks: 10 });

    expect(peaks.length).toBe(10);
    expect(peaks.every((p) => p === 0.05)).toBe(true); // fallbacks to flat baseline
    expect(peaks.every((p) => !Number.isNaN(p))).toBe(true);
  });

  it("should apply custom power shaping (shapingFactor)", () => {
    const mockBuffer = new MockAudioBuffer(1, 10, 1000) as any as AudioBuffer;
    const channelData = mockBuffer.getChannelData(0);
    channelData[7] = 0.5; // Max peak in the entire buffer is 0.5 (will normalize to 1.0)
    channelData[0] = 0.25; // This will normalize to 0.5

    // Case 1: Linear scaling (shapingFactor = 1.0)
    const linearPeaks = extractPeaks(mockBuffer, { numberOfPeaks: 2, shapingFactor: 1.0 });
    // First peak is around index 0 (normalized: 0.5)
    expect(linearPeaks[0]).toBeCloseTo(0.5, 2);

    // Case 2: Compression shaping (shapingFactor = 0.5) -> lifts quiet parts
    const boostedPeaks = extractPeaks(mockBuffer, { numberOfPeaks: 2, shapingFactor: 0.5 });
    // Math.pow(0.5, 0.5) = Math.sqrt(0.5) ≈ 0.707
    expect(boostedPeaks[0]).toBeCloseTo(0.707, 2);
  });
});
