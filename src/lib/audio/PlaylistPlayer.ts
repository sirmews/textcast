import type { PieceTable } from "./PieceTable";

export interface PlaylistPlayerOptions {
  context: AudioContext;
  pieceTable: PieceTable;
  onTimeUpdate?: (currentTime: number) => void;
  onEnded?: () => void;
}

/**
 * A non-destructive audio player that schedules playback of multiple segments
 * from a PieceTable using the Web Audio API.
 */
export class PlaylistPlayer {
  private context: AudioContext;
  private pieceTable: PieceTable;
  private onTimeUpdate?: (currentTime: number) => void;
  private onEnded?: () => void;

  private sources: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private analyser: AnalyserNode;
  private isPlaying = false;
  private startTime = 0; // When playback started in context time
  private pausedAt = 0; // Where we are in the logical timeline (seconds)
  private animationFrame: number | null = null;
  private readonly FADE_DURATION = 0.01; // 10ms crossfade
  private volumeDataArray: Uint8Array;

  constructor(options: PlaylistPlayerOptions) {
    this.context = options.context;
    this.pieceTable = options.pieceTable;
    this.onTimeUpdate = options.onTimeUpdate;
    this.onEnded = options.onEnded;

    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 128; // Smaller FFT for faster processing
    this.analyser.connect(this.context.destination);
    this.volumeDataArray = new Uint8Array(this.analyser.frequencyBinCount);
  }

  /**
   * Calculates the current volume for visualization.
   * Performed here to keep the UI loop as lean as possible.
   */
  getVolume(): number {
    if (!this.isPlaying) return 0;

    // @ts-expect-error - Bun DOM types conflict with standard lib.dom.d.ts for ArrayBuffer
    this.analyser.getByteFrequencyData(this.volumeDataArray);
    let sum = 0;
    for (let i = 0; i < this.volumeDataArray.length; i++) {
      sum += this.volumeDataArray[i];
    }
    const vol = sum / this.volumeDataArray.length / 255;
    return Math.min(1, vol * 4); // Apply the boost here
  }

  /**
   * Returns the analyser node for real-time visualization.
   */
  getAnalyser(): AnalyserNode {
    return this.analyser;
  }

  /**
   * Starts playback from the current position.
   */
  play(): void {
    if (this.isPlaying) return;

    if (this.context.state === "suspended") {
      this.context.resume();
    }

    const sequence = this.pieceTable.getSequence();
    const totalLength = this.pieceTable.getTotalLength();

    if (this.pausedAt >= totalLength) {
      this.pausedAt = 0;
    }

    this.isPlaying = true;
    this.startTime = this.context.currentTime;

    let logicalOffset = 0;
    let scheduledTime = this.startTime;

    for (let i = 0; i < sequence.length; i++) {
      const piece = sequence[i];
      const pieceEnd = logicalOffset + piece.length;

      // Skip pieces that are before our current playhead
      if (pieceEnd <= this.pausedAt) {
        logicalOffset += piece.length;
        continue;
      }

      // Calculate where to start within this piece
      const startOffsetInPiece = Math.max(0, this.pausedAt - logicalOffset);
      const durationToPlay = piece.length - startOffsetInPiece;

      const source = this.context.createBufferSource();
      const gainNode = this.context.createGain();
      source.buffer = piece.sourceBuffer;

      source.connect(gainNode);
      gainNode.connect(this.analyser);

      // Apply crossfades
      // 1. Fade in if it's the first piece we play OR if it's a new source segment
      const isFirstPiecePlayed = scheduledTime === this.startTime;
      const prevPiece = i > 0 ? sequence[i - 1] : null;
      const isNewSegment =
        !prevPiece ||
        prevPiece.sourceBuffer !== piece.sourceBuffer ||
        prevPiece.sourceOffset + prevPiece.length !== piece.sourceOffset;

      if (isFirstPiecePlayed || isNewSegment) {
        gainNode.gain.setValueAtTime(0, scheduledTime);
        gainNode.gain.linearRampToValueAtTime(
          1,
          scheduledTime + this.FADE_DURATION,
        );
      } else {
        gainNode.gain.setValueAtTime(1, scheduledTime);
      }

      // 2. Fade out if it's the last piece in sequence OR if the next piece is a new segment
      const nextPiece = i < sequence.length - 1 ? sequence[i + 1] : null;
      const willBeNewSegment =
        !nextPiece ||
        nextPiece.sourceBuffer !== piece.sourceBuffer ||
        piece.sourceOffset + piece.length !== nextPiece.sourceOffset;

      const fadeOutStartTime =
        scheduledTime + durationToPlay - this.FADE_DURATION;
      if (willBeNewSegment) {
        gainNode.gain.setValueAtTime(
          1,
          Math.max(scheduledTime, fadeOutStartTime),
        );
        gainNode.gain.linearRampToValueAtTime(
          0,
          scheduledTime + durationToPlay,
        );
      }

      // Start the source
      source.start(
        scheduledTime,
        piece.sourceOffset + startOffsetInPiece,
        durationToPlay,
      );

      this.sources.push({ source, gain: gainNode });

      scheduledTime += durationToPlay;
      logicalOffset += piece.length;
    }

    // Schedule the end of playback callback
    const lastEntry = this.sources[this.sources.length - 1];
    if (lastEntry) {
      lastEntry.source.onended = () => {
        // If this was the last source and we're still playing, we've reached the end
        if (this.isPlaying && this.context.currentTime >= scheduledTime - 0.1) {
          this.stop();
          this.pausedAt = 0;
          this.onEnded?.();
        }
      };
    }

    this.startUpdateLoop();
  }

  /**
   * Pauses playback and saves the current position.
   */
  pause(): void {
    if (!this.isPlaying) return;

    this.pausedAt = this.getCurrentTime();
    this.stopSources();
    this.isPlaying = false;

    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Seeks to a specific time in the logical timeline.
   */
  seek(time: number): void {
    const wasPlaying = this.isPlaying;
    const totalLength = this.pieceTable.getTotalLength();

    if (wasPlaying) {
      this.pause();
    }

    this.pausedAt = Math.max(0, Math.min(time, totalLength));
    this.onTimeUpdate?.(this.pausedAt);

    if (wasPlaying) {
      this.play();
    }
  }

  /**
   * Completely stops playback and resets state.
   */
  stop(): void {
    this.stopSources();
    this.isPlaying = false;
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Returns the current playback position in seconds.
   */
  getCurrentTime(): number {
    if (!this.isPlaying) return this.pausedAt;
    const elapsed = this.context.currentTime - this.startTime;
    return Math.min(this.pausedAt + elapsed, this.pieceTable.getTotalLength());
  }

  private stopSources(): void {
    for (const { source, gain } of this.sources) {
      try {
        source.stop();
      } catch {
        // Source might have already ended or not started
      }
      source.disconnect();
      gain.disconnect();
    }
    this.sources = [];
  }

  private startUpdateLoop(): void {
    const update = () => {
      if (!this.isPlaying) return;

      this.onTimeUpdate?.(this.getCurrentTime());
      this.animationFrame = requestAnimationFrame(update);
    };
    this.animationFrame = requestAnimationFrame(update);
  }
}
