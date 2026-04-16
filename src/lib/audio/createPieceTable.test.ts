import { describe, expect, it } from "vitest";
import { createPieceTableFromWords } from "./PieceTable";

// Mock AudioBuffer
const createMockBuffer = (duration: number) =>
  ({
    duration,
    length: duration * 44100,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(duration * 44100),
  }) as unknown as AudioBuffer;

describe("createPieceTableFromWords", () => {
  const originalBuffer = createMockBuffer(10);

  it("should return a single full piece if no words are deleted", () => {
    const words = [
      { word: "hello", start: 0, end: 1 },
      { word: "world", start: 1, end: 2 },
    ];

    const table = createPieceTableFromWords(originalBuffer, words, 0);
    const seq = table.getSequence();

    expect(seq).toHaveLength(1);
    expect(seq[0].length).toBe(10);
  });

  it("should split the timeline when a word is deleted (without padding)", () => {
    const words = [
      { word: "one", start: 0, end: 1 },
      { word: "two", start: 1, end: 2, deleted: true },
      { word: "three", start: 2, end: 3 },
    ];

    const table = createPieceTableFromWords(originalBuffer, words, 0);
    const seq = table.getSequence();

    expect(seq).toHaveLength(2);
    // Piece 1: 0 -> 1s
    expect(seq[0].sourceOffset).toBe(0);
    expect(seq[0].length).toBe(1);

    // Piece 2: 2s -> 10s (skipped 1s-2s)
    expect(seq[1].sourceOffset).toBe(2);
    expect(seq[1].length).toBe(8);
  });

  it("should preserve padding around deleted words to prevent clipping", () => {
    const words = [
      { word: "one", start: 0, end: 1 },
      { word: "two", start: 1, end: 2, deleted: true },
      { word: "three", start: 2, end: 3 },
    ];

    // 0.1s padding
    const table = createPieceTableFromWords(originalBuffer, words, 0.1);
    const seq = table.getSequence();

    expect(seq).toHaveLength(2);

    // Piece 1 should bleed 0.1s into the deleted word
    // End time = 1s (word end) + 0.1s (padding) = 1.1s
    expect(seq[0].sourceOffset).toBe(0);
    expect(seq[0].length).toBeCloseTo(1.1);

    // Piece 2 should start 0.1s early from the deleted word
    // Start time = 2s (next word start) - 0.1s (padding) = 1.9s
    expect(seq[1].sourceOffset).toBeCloseTo(1.9);
    expect(seq[1].length).toBeCloseTo(8.1); // 10s total - 1.9s
  });

  it("should merge adjacent deleted words into a single deletion block", () => {
    const words = [
      { word: "one", start: 0, end: 1 },
      { word: "two", start: 1, end: 2, deleted: true },
      { word: "three", start: 2, end: 3, deleted: true },
      { word: "four", start: 3, end: 4 },
    ];

    // Without merging, this would leave a piece between 1.99 and 2.01 (if padding is 0.01)
    const table = createPieceTableFromWords(originalBuffer, words, 0.01);
    const seq = table.getSequence();

    // We expect exactly 2 pieces: [0-1.01] and [2.99-10]
    expect(seq).toHaveLength(2);
    expect(seq[0].length).toBeCloseTo(1.01);
    expect(seq[1].sourceOffset).toBeCloseTo(2.99);
  });

  it("should ignore deletions if the word is shorter than the combined padding", () => {
    const words = [{ word: "a", start: 1, end: 1.1, deleted: true }];

    // The word is 0.1s long, but we want 0.1s padding on BOTH sides (0.2s total padding).
    // The deletion is impossible without cutting into the padding, so it should be skipped.
    const table = createPieceTableFromWords(originalBuffer, words, 0.1);
    const seq = table.getSequence();

    expect(seq).toHaveLength(1);
    expect(seq[0].length).toBe(10);
  });
});
