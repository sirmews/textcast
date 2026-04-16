import { Download, Loader2, Pause, Play, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Orb } from "@/components/ui/orb";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { audioBufferToWav } from "@/lib/audio";
import { renderPiecesToBuffer } from "@/lib/audio/offlineRender";
import { cn } from "@/lib/utils";
import type { Word } from "@/types";

interface TranscriptEditorProps {
  audioBuffer: AudioBuffer | null;
  initialText: string;
  words: Word[];
  projectId: string;
  onTranscriptChange: (text: string, words: Word[]) => void;
}

export function TranscriptEditor({
  audioBuffer,
  words: initialWords,
  onTranscriptChange,
  projectId,
}: TranscriptEditorProps) {
  const [wordList, setWordList] = useState<Word[]>(initialWords);
  const [isExporting, setIsExporting] = useState(false);

  const { isPlaying, currentTime, duration, pieces, toggle, seek, getVolume } =
    useAudioPlayer({
      audioBuffer,
      words: wordList,
    });

  const orbRef = useRef<HTMLDivElement>(null);

  // Poll playback volume for orb animation using direct DOM manipulation for performance.
  // This mirrors the recording implementation to ensure maximum memory/CPU efficiency.
  useEffect(() => {
    if (!isPlaying) return;

    let animationFrameId: number;

    const updateVolume = () => {
      if (orbRef.current) {
        // Pull the pre-calculated, boosted volume directly from the engine
        const vol = getVolume();
        orbRef.current.style.setProperty("--volume-scale", vol.toString());
      }
      animationFrameId = requestAnimationFrame(updateVolume);
    };

    updateVolume();
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, getVolume]);

  // PRE-CALCULATE logical offsets for words to avoid O(N^2) renders in the loop.
  // We map the absolute word.start time to the new EDL timeline by subtracting
  // the duration of all deleted blocks that occurred before this word.
  const wordsWithOffsets = useMemo(() => {
    const PADDING = 0.01; // Must match the padding in createPieceTableFromWords

    // 1. Identify all deletion blocks
    const deletionBlocks: {
      start: number;
      end: number;
      deletedDuration: number;
    }[] = [];
    let currentBlock: { start: number; end: number } | null = null;

    for (const word of wordList) {
      if (word.deleted) {
        if (!currentBlock) currentBlock = { start: word.start, end: word.end };
        else currentBlock.end = word.end; // Extend block
      } else {
        if (currentBlock) {
          const dStart = currentBlock.start + PADDING;
          const dEnd = currentBlock.end - PADDING;
          const deletedDuration = Math.max(0, dEnd - dStart);
          deletionBlocks.push({ ...currentBlock, deletedDuration });
          currentBlock = null;
        }
      }
    }
    if (currentBlock) {
      const dStart = currentBlock.start + PADDING;
      const dEnd = currentBlock.end - PADDING;
      const deletedDuration = Math.max(0, dEnd - dStart);
      deletionBlocks.push({ ...currentBlock, deletedDuration });
    }

    // 2. Map words to their new logical start times
    return wordList.map((word) => {
      let shift = 0;
      // Find how much total time was deleted BEFORE this word started
      for (const block of deletionBlocks) {
        if (block.end <= word.start) {
          shift += block.deletedDuration;
        }
      }

      return {
        ...word,
        logicalStart: Math.max(0, word.start - shift),
        wordDuration: word.end - word.start,
      };
    });
  }, [wordList]);

  // Handle word click (Seek)
  const handleWordClick = (logicalStart: number) => {
    seek(logicalStart);
  };

  // Toggle word deletion
  const toggleWordDeletion = (index: number) => {
    const newWordList = [...wordList];
    newWordList[index] = {
      ...newWordList[index],
      deleted: !newWordList[index].deleted,
    };
    setWordList(newWordList);

    // Notify parent of text change
    const newText = newWordList
      .filter((w) => !w.deleted)
      .map((w) => w.word)
      .join(" ");
    onTranscriptChange(newText, newWordList);
  };

  async function handleExport() {
    if (!audioBuffer || pieces.length === 0) return;

    setIsExporting(true);
    try {
      // Bake the Edit Decision List down into a final audio buffer
      const finalBuffer = await renderPiecesToBuffer(
        pieces,
        audioBuffer.numberOfChannels,
        audioBuffer.sampleRate,
      );

      // Convert to WAV for download
      const wavBlob = await audioBufferToWav(finalBuffer);
      const url = URL.createObjectURL(wavBlob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `project-${projectId}-final-cut.wav`;
      a.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setIsExporting(false);
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border border-border p-6 text-card-foreground">
        {/* Header with Controls */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button
              variant="secondary"
              size="icon"
              onClick={toggle}
              className="w-12 h-12 rounded-full"
            >
              {isPlaying ? (
                <Pause className="w-6 h-6" />
              ) : (
                <Play className="w-6 h-6 ml-1" />
              )}
            </Button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10">
                <Orb ref={orbRef} isActive={isPlaying} variant="primary" />
              </div>
              <div>
                <div className="text-2xl font-mono font-medium">
                  {formatTime(currentTime)}{" "}
                  <span className="text-muted-foreground text-lg">
                    / {formatTime(duration)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled
              className="flex items-center gap-2 opacity-50 cursor-not-allowed"
              title="Coming soon"
            >
              <Wand2 className="w-4 h-4" />
              Studio Sound
            </Button>
            <Button
              onClick={handleExport}
              disabled={isExporting}
              className="flex items-center gap-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export Final Cut
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Progress Bar */}
        <div
          className="relative w-full h-2 bg-muted rounded-full mb-8 cursor-pointer overflow-hidden"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const pct = x / rect.width;
            seek(pct * duration);
          }}
        >
          <div
            className="absolute top-0 left-0 h-full bg-primary transition-all duration-100 ease-linear"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          />
        </div>

        {/* Interactive Transcript */}
        <div className="min-h-[400px] p-6 bg-background border border-border rounded-lg shadow-inner">
          <div className="flex flex-wrap gap-x-1.5 gap-y-2 leading-relaxed">
            {wordsWithOffsets.map((word, index) => {
              const isActive =
                isPlaying &&
                !word.deleted &&
                currentTime >= word.logicalStart &&
                currentTime < word.logicalStart + word.wordDuration;

              return (
                <span
                  key={`${index}-${word.word}`}
                  onClick={() =>
                    !word.deleted && handleWordClick(word.logicalStart)
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleWordDeletion(index);
                  }}
                  className={cn(
                    "px-1 py-0.5 rounded cursor-pointer transition-all duration-200 select-none text-lg",
                    word.deleted
                      ? "text-muted-foreground/30 line-through scale-95"
                      : "text-foreground hover:bg-muted",
                    isActive &&
                      "bg-primary text-primary-foreground shadow-sm scale-110 z-10",
                  )}
                  title={
                    word.deleted
                      ? "Right-click to restore"
                      : "Click to seek, Right-click to delete"
                  }
                >
                  {word.word}
                </span>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-between text-sm text-muted-foreground bg-muted/30 p-4 rounded-lg">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-background border rounded text-xs">
                Click
              </kbd>{" "}
              Seek
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-background border rounded text-xs">
                Right-click
              </kbd>{" "}
              Delete/Restore
            </span>
          </div>
          <p>
            {wordList.filter((w) => w.deleted).length} words removed from
            timeline
          </p>
        </div>

        {/* Piece Table Visualization (EDL) */}
        <div className="mt-8 p-4 bg-muted/20 border border-border rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium">
              Under the Hood: Piece Table (EDL)
            </h3>
            <span className="text-xs text-muted-foreground font-mono">
              Original Buffer: {formatTime(audioBuffer?.duration || 0)}
            </span>
          </div>

          <div className="relative w-full h-10 bg-destructive/20 rounded overflow-hidden shadow-inner">
            {/* The background represents the full original file (red = deleted/omitted) */}
            {pieces.map((piece, i) => {
              const totalOriginalLength = audioBuffer?.duration || 1;
              const leftPercent =
                (piece.sourceOffset / totalOriginalLength) * 100;
              const widthPercent = (piece.length / totalOriginalLength) * 100;

              return (
                <div
                  key={i}
                  className="absolute top-0 h-full bg-emerald-500 border-r border-background/50 last:border-none flex items-center justify-center overflow-hidden hover:brightness-110 transition-all cursor-crosshair"
                  style={{
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                  }}
                  title={`Piece ${i + 1}\nSource Offset: ${piece.sourceOffset.toFixed(2)}s\nLength: ${piece.length.toFixed(2)}s`}
                >
                  {widthPercent > 5 && (
                    <span className="text-[10px] font-mono font-medium text-emerald-950 px-1 truncate">
                      P{i + 1}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-emerald-500 rounded-sm shadow-sm"></span>
              <span>Active Audio Blocks</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 bg-destructive/20 rounded-sm shadow-inner"></span>
              <span>Deleted Regions (Skipped)</span>
            </div>
            <div className="ml-auto">
              <span className="font-mono">Total Pieces: {pieces.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
