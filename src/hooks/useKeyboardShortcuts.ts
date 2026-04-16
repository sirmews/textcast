import { useCallback, useEffect } from "react";

interface UseKeyboardShortcutsOptions {
  onPlay: () => void;
  onPause: () => void;
  onRewind: () => void;
  onForward: () => void;
  onDelete?: () => void;
  enabled?: boolean;
}

/**
 * Keyboard shortcuts for audio editing (inspired by Descript, Audacity):
 *
 * Space - Play/Pause
 * J - Rewind (back 5 seconds)
 * K - Pause
 * L - Forward (forward 5 seconds)
 *
 * Delete/Backspace - Delete selected (when implemented)
 */
export function useKeyboardShortcuts({
  onPlay,
  onPause,
  onRewind,
  onForward,
  onDelete,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if typing in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case " ":
          e.preventDefault();
          // Toggle play/pause - call both, let caller decide
          onPlay();
          break;

        case "j":
          e.preventDefault();
          onRewind();
          break;

        case "k":
          e.preventDefault();
          onPause();
          break;

        case "l":
          e.preventDefault();
          onForward();
          break;

        case "delete":
        case "backspace":
          if (onDelete) {
            e.preventDefault();
            onDelete();
          }
          break;
      }
    },
    [onPlay, onPause, onRewind, onForward, onDelete],
  );

  useEffect(() => {
    if (!enabled) return;

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown, enabled]);
}

/**
 * Simple play/pause toggle hook
 */
export function usePlaybackControl(isPlaying: boolean) {
  return {
    toggle: () => {
      // This is a placeholder - actual implementation depends on the player
      console.log("Toggle playback:", !isPlaying);
    },
    isPlaying,
  };
}
