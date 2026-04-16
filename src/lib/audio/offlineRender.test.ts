import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPiecesToBuffer } from "./offlineRender";
import type { Piece } from "./PieceTable";

// Mock Web Audio API classes
class MockAudioBuffer {
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {}
}

class MockGainNodeGain {
  setValueAtTime() {}
  linearRampToValueAtTime() {}
}

class MockGainNode {
  gain = new MockGainNodeGain();
  connect() {}
}

class MockAudioBufferSourceNode {
  buffer: MockAudioBuffer | null = null;
  connect() {}
  start() {}
}

class MockOfflineAudioContext {
  destination = {};
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {}

  createBuffer() {
    return new MockAudioBuffer(
      this.numberOfChannels,
      this.length,
      this.sampleRate,
    );
  }
  createBufferSource() {
    return new MockAudioBufferSourceNode();
  }
  createGain() {
    return new MockGainNode();
  }
  startRendering() {
    return Promise.resolve(new MockAudioBuffer(2, 44100, 44100));
  }
}

describe("offlineRender (renderPiecesToBuffer)", () => {
  let sourceBuffer: AudioBuffer;
  let startSpy: any;
  let setValueAtTimeSpy: any;
  let linearRampToValueAtTimeSpy: any;

  beforeEach(() => {
    vi.stubGlobal("OfflineAudioContext", MockOfflineAudioContext);
    sourceBuffer = new MockAudioBuffer(1, 441000, 44100) as any as AudioBuffer;

    startSpy = vi.spyOn(MockAudioBufferSourceNode.prototype, "start");
    setValueAtTimeSpy = vi.spyOn(MockGainNodeGain.prototype, "setValueAtTime");
    linearRampToValueAtTimeSpy = vi.spyOn(
      MockGainNodeGain.prototype,
      "linearRampToValueAtTime",
    );
  });

  it("should return a 1-sample empty buffer if pieces array is empty", async () => {
    const result = await renderPiecesToBuffer([], 2, 44100);
    expect(result.length).toBe(1);
    expect(result.numberOfChannels).toBe(2);
  });

  it("should schedule pieces and apply boundary crossfades correctly", async () => {
    const pieces: Piece[] = [
      { sourceBuffer, sourceOffset: 0, length: 3 },
      { sourceBuffer, sourceOffset: 7, length: 3 }, // Represents a jump/deletion from 3s to 7s
    ];

    await renderPiecesToBuffer(pieces, 2, 44100);

    // Should have scheduled two sources
    expect(startSpy).toHaveBeenCalledTimes(2);

    // First piece: start at 0s, offset 0s, duration 3s
    expect(startSpy).toHaveBeenNthCalledWith(1, 0, 0, 3);

    // Second piece: start at 3s, offset 7s, duration 3s
    expect(startSpy).toHaveBeenNthCalledWith(2, 3, 7, 3);

    // Crossfades check
    // The first piece should fade IN at 0s
    expect(setValueAtTimeSpy).toHaveBeenCalledWith(0, 0); // start at 0 volume
    expect(linearRampToValueAtTimeSpy).toHaveBeenCalledWith(1, 0.01); // ramp to 1 over 10ms

    // The first piece should fade OUT at the boundary (time 3s)
    expect(setValueAtTimeSpy).toHaveBeenCalledWith(1, 2.99); // start fade out 10ms early
    expect(linearRampToValueAtTimeSpy).toHaveBeenCalledWith(0, 3); // ramp to 0 exactly at boundary

    // The second piece should fade IN at the boundary (time 3s)
    expect(setValueAtTimeSpy).toHaveBeenCalledWith(0, 3); // start at 0 volume
    expect(linearRampToValueAtTimeSpy).toHaveBeenCalledWith(1, 3.01); // ramp to 1 over 10ms
  });
});
