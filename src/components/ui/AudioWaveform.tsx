import { useMemo, useRef } from "react";
import { extractPeaks } from "@/lib/audio/peaks";
import type { Piece } from "@/lib/audio/PieceTable";
import type { Word } from "@/types";
import { cn } from "@/lib/utils";

interface AudioWaveformProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number; // Logical time from player
  pieces: Piece[]; // Edit Decision List pieces
  words: Word[]; // Original transribed words
  onSeek: (logicalTime: number) => void;
  className?: string;
}

/**
 * Maps a logical player time back to the absolute time of the original file
 */
function getAbsoluteTime(logicalTime: number, pieces: Piece[]): number {
  if (pieces.length === 0) return logicalTime;
  
  let accum = 0;
  for (const piece of pieces) {
    if (logicalTime >= accum && logicalTime <= accum + piece.length) {
      const piecePercent = piece.length > 0 ? (logicalTime - accum) / piece.length : 0;
      return piece.sourceOffset + piecePercent * piece.length;
    }
    accum += piece.length;
  }
  
  // Return the logicalTime as fallback if out of bounds
  return logicalTime;
}

/**
 * Maps an absolute original file time to the logical player time
 */
function getLogicalTime(absoluteTime: number, pieces: Piece[]): number {
  if (pieces.length === 0) return absoluteTime;
  
  let accum = 0;
  for (const piece of pieces) {
    if (
      absoluteTime >= piece.sourceOffset &&
      absoluteTime <= piece.sourceOffset + piece.length
    ) {
      return accum + (absoluteTime - piece.sourceOffset);
    }
    accum += piece.length;
  }

  // Fallback: If clicked in a deleted region, snap to the nearest boundary of any active piece
  let closestLogical = 0;
  let minDiff = Infinity;
  let tempAccum = 0;

  for (const piece of pieces) {
    const startDiff = Math.abs(absoluteTime - piece.sourceOffset);
    const endDiff = Math.abs(absoluteTime - (piece.sourceOffset + piece.length));

    if (startDiff < minDiff) {
      minDiff = startDiff;
      closestLogical = tempAccum;
    }
    if (endDiff < minDiff) {
      minDiff = endDiff;
      closestLogical = tempAccum + piece.length;
    }
    tempAccum += piece.length;
  }

  return closestLogical;
}

export function AudioWaveform({
  audioBuffer,
  currentTime,
  pieces,
  words,
  onSeek,
  className,
}: AudioWaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const NUMBER_OF_PEAKS = 350;

  // 1. Calculate the peaks once per AudioBuffer load
  const peaks = useMemo(() => {
    if (!audioBuffer) return [];
    // Use shapingFactor of 0.7 to visually boost speaking dynamics slightly
    return extractPeaks(audioBuffer, { numberOfPeaks: NUMBER_OF_PEAKS, shapingFactor: 0.7 });
  }, [audioBuffer]);

  const totalDuration = audioBuffer?.duration || 0;

  // 2. Pre-calculate active/deleted status for each peak index
  // Each peak index represents a duration bucket = totalDuration / NUMBER_OF_PEAKS
  const peakStates = useMemo(() => {
    if (peaks.length === 0 || totalDuration === 0) return [];

    const bucketDuration = totalDuration / NUMBER_OF_PEAKS;
    
    return peaks.map((val, i) => {
      const peakTime = i * bucketDuration;

      // Find if this peak time is inside any deleted word
      const isDeleted = words.some(
        (word) => word.deleted && peakTime >= word.start && peakTime <= word.end
      );

      return {
        val,
        isDeleted,
        time: peakTime,
      };
    });
  }, [peaks, words, totalDuration]);

  // 3. Map logical playhead time to absolute playhead position (0.0 to 100.0%)
  const absolutePlayheadPercent = useMemo(() => {
    if (totalDuration === 0) return 0;
    const absTime = getAbsoluteTime(currentTime, pieces);
    return Math.min(100, Math.max(0, (absTime / totalDuration) * 100));
  }, [currentTime, pieces, totalDuration]);

  // 4. Handle interactive clicks to seek
  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || totalDuration === 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickPercent = Math.min(1.0, Math.max(0.0, clickX / rect.width));
    const targetAbsoluteTime = clickPercent * totalDuration;

    // Convert absolute clicked position back to logical playhead time and invoke seek callback
    const targetLogicalTime = getLogicalTime(targetAbsoluteTime, pieces);
    onSeek(targetLogicalTime);
  };

  if (!audioBuffer || peaks.length === 0) {
    return (
      <div className={cn("w-full h-24 bg-muted/20 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-muted-foreground", className)}>
        Load an audio buffer to visualize waveform
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground font-mono px-1">
        <span>Waveform (Original Cut)</span>
        <span>Click to seek playhead</span>
      </div>

      <div
        ref={containerRef}
        onClick={handleContainerClick}
        className="relative w-full h-24 bg-background/50 border border-border rounded-xl flex items-center justify-between px-3 cursor-pointer select-none overflow-hidden hover:border-border/80 transition-colors duration-200"
      >
        {/* Playhead Indicator Line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary z-30 pointer-events-none transition-all duration-75 ease-linear shadow-[0_0_8px_rgba(var(--primary-color),0.5)]"
          style={{ left: `calc(${absolutePlayheadPercent}% - 0px)` }}
        />

        {/* Shaded played-portion overlay */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-primary/5 z-10 pointer-events-none transition-all duration-75 ease-linear"
          style={{ width: `${absolutePlayheadPercent}%` }}
        />

        {/* Peak Column Grid */}
        <div className="w-full h-16 flex items-center justify-between gap-0.5 z-20">
          {peakStates.map((state, index) => {
            const peakPercent = (state.time / totalDuration) * 100;
            const isPlayed = peakPercent <= absolutePlayheadPercent;

            return (
              <div
                key={index}
                style={{ height: `${Math.max(10, state.val * 100)}%` }}
                className={cn(
                  "w-[2px] rounded-full transition-colors duration-150",
                  state.isDeleted
                    ? "bg-muted-foreground/15 dark:bg-muted-foreground/10 line-through decoration-destructive/30"
                    : isPlayed
                    ? "bg-primary"
                    : "bg-primary/30 dark:bg-primary/20"
                )}
                title={`Time: ${state.time.toFixed(2)}s`}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
