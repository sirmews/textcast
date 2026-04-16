import type { Piece } from "./PieceTable";

/**
 * Renders an Edit Decision List (sequence of Pieces) into a single contiguous AudioBuffer
 * using the OfflineAudioContext. This applies the exact same scheduling and crossfades
 * used during live playback, "baking" them into the final file for export.
 */
export async function renderPiecesToBuffer(
  pieces: Piece[],
  numberOfChannels: number,
  sampleRate: number,
): Promise<AudioBuffer> {
  const totalLength = pieces.reduce((sum, piece) => sum + piece.length, 0);

  if (totalLength <= 0) {
    // Return a 1-sample silent buffer if there's nothing to render
    return new OfflineAudioContext(
      numberOfChannels,
      1,
      sampleRate,
    ).createBuffer(numberOfChannels, 1, sampleRate);
  }

  const lengthInSamples = Math.max(1, Math.ceil(totalLength * sampleRate));
  const offlineCtx = new OfflineAudioContext(
    numberOfChannels,
    lengthInSamples,
    sampleRate,
  );

  const FADE_DURATION = 0.01; // 10ms crossfade (must match PlaylistPlayer)
  let scheduledTime = 0;

  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i];
    const durationToPlay = piece.length;

    const source = offlineCtx.createBufferSource();
    const gainNode = offlineCtx.createGain();
    source.buffer = piece.sourceBuffer;

    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    // 1. Fade in if it's the first piece OR a new source segment
    const isFirstPiecePlayed = scheduledTime === 0;
    const prevPiece = i > 0 ? pieces[i - 1] : null;
    const isNewSegment =
      !prevPiece ||
      prevPiece.sourceBuffer !== piece.sourceBuffer ||
      prevPiece.sourceOffset + prevPiece.length !== piece.sourceOffset;

    if (isFirstPiecePlayed || isNewSegment) {
      gainNode.gain.setValueAtTime(0, scheduledTime);
      gainNode.gain.linearRampToValueAtTime(1, scheduledTime + FADE_DURATION);
    } else {
      gainNode.gain.setValueAtTime(1, scheduledTime);
    }

    // 2. Fade out if it's the last piece OR the next piece is a new segment
    const nextPiece = i < pieces.length - 1 ? pieces[i + 1] : null;
    const willBeNewSegment =
      !nextPiece ||
      nextPiece.sourceBuffer !== piece.sourceBuffer ||
      piece.sourceOffset + piece.length !== nextPiece.sourceOffset;

    const fadeOutStartTime = scheduledTime + durationToPlay - FADE_DURATION;
    if (willBeNewSegment) {
      gainNode.gain.setValueAtTime(
        1,
        Math.max(scheduledTime, fadeOutStartTime),
      );
      gainNode.gain.linearRampToValueAtTime(0, scheduledTime + durationToPlay);
    }

    // Start the source
    source.start(scheduledTime, piece.sourceOffset, durationToPlay);

    scheduledTime += durationToPlay;
  }

  // Render the audio synchronously
  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
}
