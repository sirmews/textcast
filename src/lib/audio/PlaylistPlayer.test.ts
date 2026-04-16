import { beforeEach, describe, expect, it, vi } from "vitest";
import { PieceTable } from "./PieceTable";
import { PlaylistPlayer } from "./PlaylistPlayer";

// Mock Web Audio API
class MockAudioBuffer {
  duration = 10;
  length = 10 * 44100;
  sampleRate = 44100;
  numberOfChannels = 1;
  getChannelData = vi.fn().mockReturnValue(new Float32Array(10 * 44100));
}

class MockAudioBufferSourceNode {
  buffer = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn();
  onended = null;
}

class MockGainNode {
  gain = {
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAnalyserNode {
  fftSize = 0;
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockAudioContext {
  currentTime = 0;
  state = "running";
  createBufferSource = vi
    .fn()
    .mockImplementation(() => new MockAudioBufferSourceNode());
  createGain = vi.fn().mockImplementation(() => new MockGainNode());
  createAnalyser = vi.fn().mockImplementation(() => new MockAnalyserNode());
  resume = vi.fn().mockResolvedValue(undefined);
  destination = {};
}

describe("PlaylistPlayer", () => {
  let context: any;
  let pieceTable: PieceTable;
  let player: PlaylistPlayer;
  let originalBuffer: any;

  beforeEach(() => {
    context = new MockAudioContext();
    originalBuffer = new MockAudioBuffer();
    pieceTable = new PieceTable(originalBuffer as any);
    player = new PlaylistPlayer({ context, pieceTable });

    // Polyfill requestAnimationFrame
    vi.stubGlobal("requestAnimationFrame", (cb: any) => setTimeout(cb, 0));
    vi.stubGlobal("cancelAnimationFrame", (id: any) => clearTimeout(id));
  });

  it("should initialize correctly", () => {
    expect(player.getCurrentTime()).toBe(0);
  });

  it("should schedule pieces on play", () => {
    player.play();

    expect(context.createBufferSource).toHaveBeenCalled();
    expect(context.createGain).toHaveBeenCalled();

    const mockSource = (context.createBufferSource as any).mock.results[0]
      .value;
    expect(mockSource.start).toHaveBeenCalledWith(0, 0, 10);
  });

  it("should handle seeking", () => {
    player.seek(5);
    expect(player.getCurrentTime()).toBe(5);

    player.play();
    const mockSource = (context.createBufferSource as any).mock.results[0]
      .value;
    // Should start at scheduledTime 0, with buffer offset 5, for duration 5
    expect(mockSource.start).toHaveBeenCalledWith(0, 5, 5);
  });

  it("should schedule multiple pieces after deletion", () => {
    pieceTable.delete(3, 4); // Keep 0-3, delete 3-7, keep 7-10. Total length = 6.

    player.play();

    expect(context.createBufferSource).toHaveBeenCalledTimes(2);

    const source1 = (context.createBufferSource as any).mock.results[0].value;
    const source2 = (context.createBufferSource as any).mock.results[1].value;

    expect(source1.start).toHaveBeenCalledWith(0, 0, 3);
    expect(source2.start).toHaveBeenCalledWith(3, 7, 3);
  });

  it("should apply crossfades between different segments", () => {
    pieceTable.delete(3, 4); // Splitting into two segments

    player.play();

    const gain1 = (context.createGain as any).mock.results[0].value;
    const gain2 = (context.createGain as any).mock.results[1].value;

    // Segment 1 (start of playback)
    expect(gain1.gain.setValueAtTime).toHaveBeenCalledWith(0, 0);
    expect(gain1.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 0.01);

    // Segment 1 (end of segment)
    expect(gain1.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, 3);

    // Segment 2 (start of segment)
    expect(gain2.gain.setValueAtTime).toHaveBeenCalledWith(0, 3);
    expect(gain2.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 3.01);
  });
});
