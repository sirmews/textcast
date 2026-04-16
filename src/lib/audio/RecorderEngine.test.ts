import { describe, expect, it, vi } from "vitest";
import { createBufferFromRawData } from "./RecorderEngine";

describe("RecorderEngine Pure Functions", () => {
  describe("createBufferFromRawData", () => {
    it("should correctly create an AudioBuffer from raw float data", () => {
      // Mock AudioContext and AudioBuffer
      const mockChannelData = new Float32Array(100);
      mockChannelData.fill(0.5);

      const mockAudioBuffer = {
        getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
        length: 100,
        duration: 1,
        sampleRate: 44100,
        numberOfChannels: 1,
      } as unknown as AudioBuffer;

      const mockContext = {
        createBuffer: vi.fn().mockReturnValue(mockAudioBuffer),
        sampleRate: 44100,
      } as unknown as AudioContext;

      const result = createBufferFromRawData(mockContext, mockChannelData);

      expect(mockContext.createBuffer).toHaveBeenCalledWith(1, 100, 44100);
      expect(mockAudioBuffer.getChannelData).toHaveBeenCalledWith(0);
      expect(result).toBe(mockAudioBuffer);
    });

    it("should handle stereo buffer creation if requested", () => {
      const mockChannelData = new Float32Array(100);
      const mockAudioBuffer = {
        getChannelData: vi.fn().mockReturnValue(new Float32Array(100)),
        length: 100,
        sampleRate: 44100,
      } as unknown as AudioBuffer;

      const mockContext = {
        createBuffer: vi.fn().mockReturnValue(mockAudioBuffer),
        sampleRate: 44100,
      } as unknown as AudioContext;

      createBufferFromRawData(mockContext, mockChannelData, 2);

      expect(mockContext.createBuffer).toHaveBeenCalledWith(2, 100, 44100);
    });
  });
});
