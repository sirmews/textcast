import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPieceTableFromWords, type Piece } from "@/lib/audio/PieceTable";
import { PlaylistPlayer } from "@/lib/audio/PlaylistPlayer";
import type { Word } from "@/types";

interface UseAudioPlayerOptions {
  audioBuffer: AudioBuffer | null;
  words: Word[];
  onEnded?: () => void;
}

interface UseAudioPlayerReturn {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  pieces: Piece[];
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (time: number) => void;
  rewind: (seconds?: number) => void;
  forward: (seconds?: number) => void;
  getAnalyser: () => AnalyserNode | null;
  getVolume: () => number;
}

/**
 * Audio player hook using PlaylistPlayer for non-destructive editing
 */
export function useAudioPlayer({
  audioBuffer,
  words,
  onEnded,
}: UseAudioPlayerOptions): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const playerRef = useRef<PlaylistPlayer | null>(null);

  // Initialize AudioContext lazily
  const getContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  // Rebuild the PieceTable whenever words change (this is the core of non-destructive editing)
  const pieceTable = useMemo(() => {
    if (!audioBuffer) return null;
    return createPieceTableFromWords(audioBuffer, words, 0.01); // 10ms padding
  }, [audioBuffer, words]);

  const duration = pieceTable?.getTotalLength() ?? 0;

  // Sync player with PieceTable
  useEffect(() => {
    if (pieceTable) {
      const context = getContext();
      if (playerRef.current) {
        playerRef.current.stop();
      }
      playerRef.current = new PlaylistPlayer({
        context,
        pieceTable,
        onTimeUpdate: (time) => setCurrentTime(time),
        onEnded: () => {
          setIsPlaying(false);
          onEnded?.();
        },
      });
    }
  }, [pieceTable, getContext, onEnded]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.stop();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
    };
  }, []);

  const play = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.play();
      setIsPlaying(true);
    }
  }, []);

  const pause = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const toggle = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  const seek = useCallback((time: number) => {
    if (playerRef.current) {
      playerRef.current.seek(time);
      setCurrentTime(time);
    }
  }, []);

  const rewind = useCallback(
    (seconds: number = 5) => {
      seek(Math.max(0, currentTime - seconds));
    },
    [currentTime, seek],
  );

  const forward = useCallback(
    (seconds: number = 5) => {
      seek(Math.min(duration, currentTime + seconds));
    },
    [currentTime, duration, seek],
  );

  const getAnalyser = useCallback(() => {
    return playerRef.current?.getAnalyser() ?? null;
  }, []);

  const getVolume = useCallback(() => {
    return playerRef.current?.getVolume() ?? 0;
  }, []);

  return {
    isPlaying,
    currentTime,
    duration,
    pieces: pieceTable?.getSequence() || [],
    play,
    pause,
    toggle,
    seek,
    rewind,
    forward,
    getAnalyser,
    getVolume,
  };
}
