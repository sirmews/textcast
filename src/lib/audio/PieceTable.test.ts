import { describe, expect, it } from "vitest";
import { type Piece, PieceTable } from "./PieceTable";

// Mock AudioBuffer
const createMockBuffer = (duration: number) =>
  ({
    duration,
    length: duration * 44100,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(duration * 44100),
  }) as unknown as AudioBuffer;

const originalBuffer = createMockBuffer(10);

describe("PieceTable", () => {
  it("should initialize with a single piece covering the original length", () => {
    const table = new PieceTable(originalBuffer);
    const seq = table.getSequence();

    expect(seq).toHaveLength(1);
    expect(seq[0]).toEqual({
      sourceBuffer: originalBuffer,
      sourceOffset: 0,
      length: 10,
    });
    expect(table.getTotalLength()).toBe(10);
  });

  describe("delete()", () => {
    it("should delete from the beginning (head deletion)", () => {
      const table = new PieceTable(originalBuffer);
      table.delete(0, 3);
      const seq = table.getSequence();

      expect(seq).toHaveLength(1);
      expect(seq[0]).toEqual({
        sourceBuffer: originalBuffer,
        sourceOffset: 3,
        length: 7,
      });
      expect(table.getTotalLength()).toBe(7);
    });

    it("should delete from the end (tail deletion)", () => {
      const table = new PieceTable(originalBuffer);
      table.delete(7, 3);
      const seq = table.getSequence();

      expect(seq).toHaveLength(1);
      expect(seq[0]).toEqual({
        sourceBuffer: originalBuffer,
        sourceOffset: 0,
        length: 7,
      });
      expect(table.getTotalLength()).toBe(7);
    });

    it("should delete from the middle (split piece)", () => {
      const table = new PieceTable(originalBuffer);
      table.delete(3, 4); // Keep 0-3, delete 3-7, keep 7-10
      const seq = table.getSequence();

      expect(seq).toHaveLength(2);
      expect(seq[0]).toEqual({
        sourceBuffer: originalBuffer,
        sourceOffset: 0,
        length: 3,
      });
      expect(seq[1]).toEqual({
        sourceBuffer: originalBuffer,
        sourceOffset: 7,
        length: 3,
      });
      expect(table.getTotalLength()).toBe(6);
    });
  });

  describe("insert()", () => {
    const addBuffer = createMockBuffer(5);
    const addPiece: Piece = {
      sourceBuffer: addBuffer,
      sourceOffset: 0,
      length: 5,
    };

    it("should insert at the beginning", () => {
      const table = new PieceTable(originalBuffer);
      table.insert(0, addPiece);
      const seq = table.getSequence();

      expect(seq).toHaveLength(2);
      expect(seq[0]).toEqual(addPiece);
      expect(seq[1]).toEqual({
        sourceBuffer: originalBuffer,
        sourceOffset: 0,
        length: 10,
      });
    });

    it("should split a piece when inserting in the middle", () => {
      const table = new PieceTable(originalBuffer);
      table.insert(4, addPiece);
      const seq = table.getSequence();

      expect(seq).toHaveLength(3);
      expect(seq[0]).toEqual({
        sourceBuffer: originalBuffer,
        sourceOffset: 0,
        length: 4,
      });
      expect(seq[1]).toEqual(addPiece);
      expect(seq[2]).toEqual({
        sourceBuffer: originalBuffer,
        sourceOffset: 4,
        length: 6,
      });
      expect(table.getTotalLength()).toBe(15);
    });
  });
});
