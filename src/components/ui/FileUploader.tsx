import { FileAudio, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface FileUploaderProps {
  onFileLoaded: (audioBuffer: AudioBuffer, fileName: string) => void;
  accept?: string;
  maxSizeMB?: number;
}

interface FileUploaderState {
  status: "idle" | "loading" | "success" | "error";
  error?: string;
  fileName?: string;
}

/**
 * File upload component for importing audio files
 *
 * Supports: MP3, WAV, OGG, FLAC, M4A, WebM
 * Max default: 100MB
 */
export function FileUploader({
  onFileLoaded,
  accept = "audio/*",
  maxSizeMB = 100,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<FileUploaderState>({ status: "idle" });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size
    const fileSizeMB = file.size / (1024 * 1024);
    if (fileSizeMB > maxSizeMB) {
      setState({
        status: "error",
        error: `File too large. Maximum size is ${maxSizeMB}MB`,
      });
      return;
    }

    setState({ status: "loading", fileName: file.name });

    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioContext = new AudioContext();

      // Decode the audio
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      setState({ status: "success", fileName: file.name });

      // Pass the decoded buffer up
      onFileLoaded(audioBuffer, file.name);

      // Reset after a delay
      setTimeout(() => {
        setState({ status: "idle" });
      }, 2000);
    } catch (err) {
      setState({
        status: "error",
        error: "Failed to decode audio file. Please try a different format.",
      });
      console.error("Audio decode error:", err);
    }

    // Reset input
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-border rounded-lg hover:border-primary transition-colors">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleFileSelect}
        className="hidden"
      />

      {state.status === "idle" && (
        <Button
          variant="ghost"
          onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center gap-2 h-auto py-4 text-muted-foreground hover:text-foreground"
        >
          <Upload className="w-8 h-8" />
          <span className="text-sm">Click to upload audio</span>
          <span className="text-xs text-muted-foreground opacity-70">
            MP3, WAV, OGG, FLAC, M4A, WebM (max {maxSizeMB}MB)
          </span>
        </Button>
      )}

      {state.status === "loading" && (
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="text-sm">Loading {state.fileName}...</span>
        </div>
      )}

      {state.status === "success" && (
        <div className="flex flex-col items-center gap-2 text-primary">
          <FileAudio className="w-8 h-8" />
          <span className="text-sm">Loaded {state.fileName}</span>
        </div>
      )}

      {state.status === "error" && (
        <div className="flex flex-col items-center gap-2 text-destructive">
          <span className="text-sm">{state.error}</span>
          <Button
            variant="link"
            onClick={() => setState({ status: "idle" })}
            className="text-sm"
          >
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}
