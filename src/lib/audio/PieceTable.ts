/**
 * Represents a contiguous segment of data from a source buffer.
 * In a Piece Table, the timeline is composed of a sequence of these Pieces.
 */
export interface Piece {
  /** The source buffer this piece reads from. */
  sourceBuffer: AudioBuffer;
  /** The starting index (or timestamp) within the source buffer. */
  sourceOffset: number;
  /** The duration (or character count) of this piece. */
  length: number;
}

/**
 * A highly efficient Piece Table data structure for non-destructive editing.
 *
 * Instead of modifying a massive array or AudioBuffer when a user makes an edit,
 * the Piece Table simply updates a list of tiny metadata objects (Pieces).
 *
 * Performance:
 * - Deletions: O(N) where N is the number of existing pieces (extremely fast).
 * - Insertions: O(N).
 * - Memory: O(N) where N is the number of edits, scaling infinitely better than copying audio buffers.
 *
 * @example
 * const table = new PieceTable(originalBuffer); // 100 seconds of original audio
 * table.delete(10, 5); // Delete 5 seconds starting at second 10
 * const edl = table.getSequence(); // Returns the Edit Decision List for playback
 */
export class PieceTable {
  private pieces: Piece[];

  /**
   * Initializes a new Piece Table representing a single contiguous original file.
   * @param originalBuffer The initial source buffer.
   */
  constructor(originalBuffer: AudioBuffer) {
    this.pieces = [
      {
        sourceBuffer: originalBuffer,
        sourceOffset: 0,
        length: originalBuffer.duration,
      },
    ];
  }

  /**
   * Returns the current ordered sequence of pieces.
   * This acts as the Edit Decision List (EDL) for the audio scheduler.
   * @returns An array of Pieces representing the current timeline.
   */
  getSequence(): Piece[] {
    // Return a shallow copy to prevent external mutation
    return [...this.pieces];
  }

  /**
   * Calculates the total logical length of the current timeline.
   */
  getTotalLength(): number {
    return this.pieces.reduce((total, piece) => total + piece.length, 0);
  }

  /**
   * Deletes a segment from the logical timeline.
   *
   * This splits or truncates pieces that intersect with the deletion range,
   * without ever touching the underlying source data.
   *
   * @param offset The logical start position of the deletion in the timeline.
   * @param length The amount of logical time/data to delete.
   */
  delete(offset: number, length: number): void {
    if (length <= 0) return;

    const newPieces: Piece[] = [];
    let currentLogicalPos = 0;
    let remainingDelete = length;

    for (const piece of this.pieces) {
      const pieceStart = currentLogicalPos;
      const pieceEnd = currentLogicalPos + piece.length;

      // Case 1: Deletion is completely finished, or hasn't started yet
      if (
        remainingDelete === 0 ||
        offset >= pieceEnd ||
        offset + remainingDelete <= pieceStart
      ) {
        newPieces.push(piece);
      }
      // Case 2: This piece intersects with the deletion range
      else {
        // Left side to keep
        if (offset > pieceStart) {
          const keepLength = offset - pieceStart;
          newPieces.push({
            sourceBuffer: piece.sourceBuffer,
            sourceOffset: piece.sourceOffset,
            length: keepLength,
          });
        }

        // Calculate how much of the deletion was absorbed by this piece
        const overlapStart = Math.max(offset, pieceStart);
        const overlapEnd = Math.min(offset + remainingDelete, pieceEnd);
        const overlapLength = overlapEnd - overlapStart;

        // Right side to keep
        if (offset + remainingDelete < pieceEnd) {
          const keepLength = pieceEnd - (offset + remainingDelete);
          const rightSourceOffset =
            piece.sourceOffset + (piece.length - keepLength);
          newPieces.push({
            sourceBuffer: piece.sourceBuffer,
            sourceOffset: rightSourceOffset,
            length: keepLength,
          });
        }

        // Update the remaining deletion amount.
        // We only decrement it by the portion that actually fell inside THIS piece.
        remainingDelete -= overlapLength;

        // Also update the 'offset' so that in the next loop iteration,
        // the deletion starts exactly at the beginning of the next piece if needed
        offset = pieceEnd;
      }

      currentLogicalPos += piece.length;
    }

    this.pieces = newPieces;
  }

  /**
   * Inserts a new piece into the logical timeline at the specified offset.
   *
   * @param offset The logical position in the timeline to insert at.
   * @param newPiece The new Piece descriptor to insert.
   */
  insert(offset: number, newPiece: Piece): void {
    if (newPiece.length <= 0) return;

    const newPieces: Piece[] = [];
    let currentOffset = 0;
    let inserted = false;

    // Handle edge case: insert at the very beginning
    if (offset === 0) {
      newPieces.push(newPiece);
      inserted = true;
    }

    for (let i = 0; i < this.pieces.length; i++) {
      const piece = this.pieces[i];
      const pieceStart = currentOffset;
      const pieceEnd = currentOffset + piece.length;

      if (!inserted && offset > pieceStart && offset < pieceEnd) {
        // The insertion point is strictly inside this piece. Split it.
        const leftLength = offset - pieceStart;

        // Left half
        newPieces.push({
          sourceBuffer: piece.sourceBuffer,
          sourceOffset: piece.sourceOffset,
          length: leftLength,
        });

        // The insertion
        newPieces.push(newPiece);

        // Right half
        newPieces.push({
          sourceBuffer: piece.sourceBuffer,
          sourceOffset: piece.sourceOffset + leftLength,
          length: piece.length - leftLength,
        });

        inserted = true;
      } else {
        // Keep the piece
        newPieces.push(piece);

        // If the insertion point is exactly at the end of this piece, insert it now
        if (!inserted && offset === pieceEnd) {
          newPieces.push(newPiece);
          inserted = true;
        }
      }
      currentOffset += piece.length;
    }

    // Fallback: If offset was greater than the total length, append to the end
    if (!inserted) {
      newPieces.push(newPiece);
    }

    this.pieces = newPieces;
  }
}

/**
 * Pure function to build a Piece Table from an array of transcribed words.
 * Handles padding/bleed logic for smoother cuts.
 */
export function createPieceTableFromWords(
  originalBuffer: AudioBuffer,
  words: { start: number; end: number; deleted?: boolean }[],
  padding: number = 0.01,
): PieceTable {
  const table = new PieceTable(originalBuffer);

  if (words.length === 0) return table;

  // 1. Group contiguous deleted words into "Deletion Blocks"
  const deletionBlocks: { start: number; end: number }[] = [];
  let currentBlock: { start: number; end: number } | null = null;

  for (const word of words) {
    if (word.deleted) {
      if (!currentBlock) {
        currentBlock = { start: word.start, end: word.end };
      } else {
        // Extend current block
        currentBlock.end = word.end;
      }
    } else {
      if (currentBlock) {
        deletionBlocks.push(currentBlock);
        currentBlock = null;
      }
    }
  }
  if (currentBlock) deletionBlocks.push(currentBlock);

  // 2. Delete the blocks from back to front
  const sortedBlocks = deletionBlocks.sort((a, b) => b.start - a.start);

  for (const block of sortedBlocks) {
    const deleteStart = block.start + padding;
    const deleteEnd = block.end - padding;
    const lengthToDelete = deleteEnd - deleteStart;

    if (lengthToDelete > 0) {
      table.delete(deleteStart, lengthToDelete);
    }
  }

  return table;
}
