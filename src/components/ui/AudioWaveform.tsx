import { useMemo, useRef, useState } from "react";
import { extractPeaks } from "@/lib/audio/peaks";
import type { Piece } from "@/lib/audio/PieceTable";
import type { Word } from "@/types";
import { cn } from "@/lib/utils";

interface AudioWaveformProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number; // Logical time from player
  pieces: Piece[]; // Edit Decision List pieces
  words: Word[]; // Original transcribed words
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

  // Fallback: If clicked in a deleted region, snap to nearest active piece boundary
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
  const [hoverPercent, setHoverPercent] = useState<number | null>(null);

  // Render exactly 250 bars. SVG will scale this responsively to any screen width.
  const NUMBER_OF_PEAKS = 250;
  // SVG internal coordinates: width 1000, height 100.
  const SVG_WIDTH = 1000;
  const SVG_HEIGHT = 100;
  const BAR_SPACING = SVG_WIDTH / NUMBER_OF_PEAKS; // 4 units per bar
  const BAR_WIDTH = BAR_SPACING * 0.65; // 2.6 units width, 1.4 units gap

  // 1. Calculate the peaks once per AudioBuffer load
  const peaks = useMemo(() => {
    if (!audioBuffer) return [];
    // Use shapingFactor of 0.7 to visually boost speaking dynamics slightly
    return extractPeaks(audioBuffer, { numberOfPeaks: NUMBER_OF_PEAKS, shapingFactor: 0.7 });
  }, [audioBuffer]);

  const totalDuration = audioBuffer?.duration || 0;

  // 2. Pre-calculate active/deleted status and geometry for each peak index
  const peakStates = useMemo(() => {
    if (peaks.length === 0 || totalDuration === 0) return [];

    const bucketDuration = totalDuration / NUMBER_OF_PEAKS;
    
    return peaks.map((val, i) => {
      const peakTime = i * bucketDuration;

      // Check if this peak's absolute timestamp falls inside any deleted word
      const isDeleted = words.some(
        (word) => word.deleted && peakTime >= word.start && peakTime <= word.end
      );

      // Center the bar vertically
      const barHeight = Math.max(8, val * SVG_HEIGHT * 0.85); // minimum 8 units height for silence
      const y = (SVG_HEIGHT - barHeight) / 2;
      const x = i * BAR_SPACING;

      return {
        x,
        y,
        width: BAR_WIDTH,
        height: barHeight,
        isDeleted,
        time: peakTime,
      };
    });
  }, [peaks, words, totalDuration, BAR_SPACING, BAR_WIDTH]);

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

    const targetLogicalTime = getLogicalTime(targetAbsoluteTime, pieces);
    onSeek(targetLogicalTime);
  };

  // 5. Handle mouse move for professional hovering effects
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || totalDuration === 0) return;

    const rect = containerRef.current.getBoundingClientRect();
    const hoverX = e.clientX - rect.left;
    const percent = Math.min(1.0, Math.max(0.0, hoverX / rect.width));
    setHoverPercent(percent);
  };

  const handleMouseLeave = () => {
    setHoverPercent(null);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms}`;
  };

  if (!audioBuffer || peaks.length === 0) {
    return (
      <div className={cn("w-full h-24 bg-muted/20 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-muted-foreground", className)}>
        Load an audio buffer to visualize waveform
      </div>
    );
  }

  return (
    <div className={cn("space-y-2 select-none", className)}>
      <div className="flex items-center justify-between text-xs text-muted-foreground font-mono px-1">
        <span>Timeline Overview</span>
        <span className="text-primary/80 font-medium">
          {hoverPercent !== null ? `Seek to: ${formatTime(hoverPercent * totalDuration)}` : `Playhead: ${formatTime(getAbsoluteTime(currentTime, pieces))}`}
        </span>
      </div>

      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="relative w-full h-24 bg-background/40 border border-border/80 rounded-xl cursor-pointer overflow-hidden hover:border-border transition-colors duration-200"
      >
        {/* Wavesurfer Dual-Wave Rendering via SVG */}
        <svg
          className="w-full h-full p-2 overflow-visible"
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          preserveAspectRatio="none"
        >
          {/* Progress Clipping Mask (Clipped to playhead location) */}
          <defs>
            <clipPath id="waveform-progress-clip">
              <rect
                x="0"
                y="-10"
                width={absolutePlayheadPercent * (SVG_WIDTH / 100)}
                height={SVG_HEIGHT + 20}
              />
            </clipPath>
          </defs>

          {/* Group 1: Background Waveform (Unplayed Portion - Muted Violet/Gray) */}
          <g className="text-primary/20 dark:text-primary/15 transition-all duration-75">
            {peakStates.map((state, index) => {
              if (state.isDeleted) {
                return (
                  <rect
                    key={`bg-del-${index}`}
                    x={state.x}
                    y={state.y}
                    width={state.width}
                    height={state.height}
                    rx="1.3"
                    ry="1.3"
                    className="fill-muted-foreground/10 dark:fill-muted-foreground/5"
                  />
                );
              }
              return (
                <rect
                  key={`bg-active-${index}`}
                  x={state.x}
                  y={state.y}
                  width={state.width}
                  height={state.height}
                  rx="1.3"
                  ry="1.3"
                  fill="currentColor"
                />
              );
            })}
          </g>

          {/* Group 2: Foreground Waveform (Played Portion - Clipped to Playhead with vibrant Primary fill) */}
          <g
            className="text-primary transition-all duration-75"
            clipPath="url(#waveform-progress-clip)"
          >
            {peakStates.map((state, index) => {
              // Deleted parts don't light up as played to keep focus on edited state
              if (state.isDeleted) return null;

              return (
                <rect
                  key={`fg-active-${index}`}
                  x={state.x}
                  y={state.y}
                  width={state.width}
                  height={state.height}
                  rx="1.3"
                  ry="1.3"
                  fill="currentColor"
                />
              );
            })}
          </g>

          {/* Group 3: Strike-through decorations for Deleted Blocks */}
          <g className="text-muted-foreground/30 dark:text-muted-foreground/20">
            {peakStates.map((state, index) => {
              if (!state.isDeleted) return null;
              
              // Draw a small cross line in the middle of deleted buckets
              return (
                <line
                  key={`strike-${index}`}
                  x1={state.x - 1}
                  y1={SVG_HEIGHT / 2}
                  x2={state.x + state.width + 1}
                  y2={SVG_HEIGHT / 2}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeDasharray="1 1"
                />
              );
            })}
          </g>
        </svg>

        {/* Wavesurfer Hover Timeline Indicator Line */}
        {hoverPercent !== null && (
          <div
            className="absolute top-0 bottom-0 w-[1.5px] bg-muted-foreground/40 pointer-events-none z-30"
            style={{ left: `${hoverPercent * 100}%` }}
          />
        )}

        {/* Wavesurfer Sliding Playhead Indicator Line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-primary z-40 pointer-events-none transition-all duration-75 ease-linear shadow-[0_0_10px_rgba(var(--primary-color),0.6)]"
          style={{ left: `${absolutePlayheadPercent}%` }}
        />
      </div>
    </div>
  );
}
