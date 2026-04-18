import { Loader2, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Orb } from "@/components/ui/orb";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import {
  type IRecorderEngine,
  WorkletRecorderEngine,
} from "@/lib/audio/RecorderEngine";
import { storage } from "@/lib/storage";
import {
  checkWebGPU,
  getRecommendedModel,
  loadModel,
  type ModelSize,
  transcribeAudio,
} from "@/lib/transcription";
import type { Project } from "@/types";
import { TranscriptEditor } from "../editor/TranscriptEditor";

interface ProgressData {
  status: string;
  progress?: number;
  message?: string;
  file?: string;
  loaded?: number;
  total?: number;
}

interface RecorderProps {
  project: Project;
  onSave: (project: Project) => void;
}

export type RecorderState =
  | "idle"
  | "recording"
  | "processing"
  | "recorded"
  | "transcribing"
  | "done"
  | "error";

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return "0 Bytes";
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(dm))} ${sizes[i]}`;
}

export function Recorder({ project, onSave }: RecorderProps) {
  const [state, setState] = useState<RecorderState>("idle");
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [transcriptText, setTranscriptText] = useState<string>("");
  const [transcriptWords, setTranscriptWords] = useState<
    {
      word: string;
      start: number;
      end: number;
      confidence: number;
      deleted?: boolean;
    }[]
  >([]);
  const [progress, setProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState(
    "Downloading AI Model...",
  );
  const [isModelLoading, setIsModelLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const engineRef = useRef<IRecorderEngine>(new WorkletRecorderEngine());
  const orbRef = useRef<HTMLDivElement>(null);
  const loadAttemptedRef = useRef(false);

  // Unify playback logic using the new hook
  const {
    isPlaying: isPreviewPlaying,
    toggle: togglePreview,
    getVolume: getPreviewVolume,
  } = useAudioPlayer({
    audioBuffer,
    words: transcriptWords,
  });

  // Poll volume for orb animation using the same high-performance strategy as TranscriptEditor.
  // Works for both recording (via engineRef) and playback (via getPreviewVolume).
  useEffect(() => {
    if (state !== "recording" && !isPreviewPlaying) return;

    let animationFrameId: number;
    const updateVolume = () => {
      if (orbRef.current) {
        let vol = 0;
        if (state === "recording") {
          vol = engineRef.current.getVolume();
        } else if (isPreviewPlaying) {
          vol = getPreviewVolume();
        }
        orbRef.current.style.setProperty("--volume-scale", vol.toString());
      }
      animationFrameId = requestAnimationFrame(updateVolume);
    };

    updateVolume();
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [state, isPreviewPlaying, getPreviewVolume]);

  // Load existing audio from OPFS if the project has it saved
  useEffect(() => {
    let isMounted = true;
    async function loadSavedAudio() {
      // Only attempt to load if we know an audio file was recorded
      if (!project.audioFile) return;

      // Due to an old bug, some projects might have lost their opfsFilename reference in the DB
      // but the file is still safely on disk! We can predictably rebuild the filename.
      const filenameToLoad =
        project.audioFile.opfsFilename || `project-${project.id}-raw.pcm`;

      if (
        filenameToLoad &&
        !audioBuffer &&
        state === "idle" &&
        !loadAttemptedRef.current
      ) {
        loadAttemptedRef.current = true;
        setState("processing");
        try {
          const fileBlob = await storage.load(filenameToLoad);
          if (fileBlob && isMounted) {
            const arrayBuffer = await fileBlob.arrayBuffer();
            const audioContext = new AudioContext();

            let buffer: AudioBuffer;
            if (filenameToLoad.endsWith(".pcm")) {
              // Handle raw PCM
              const floatData = new Float32Array(arrayBuffer);
              buffer = audioContext.createBuffer(
                1,
                floatData.length,
                audioContext.sampleRate,
              );
              buffer.getChannelData(0).set(floatData);
            } else {
              // Handle legacy WebM
              buffer = await audioContext.decodeAudioData(arrayBuffer);
            }

            if (isMounted) {
              setAudioBuffer(buffer);

              if (project.transcript) {
                // Flatten words from segments
                const words = project.transcript.segments.flatMap(
                  (s) => s.words,
                );
                setTranscriptWords(words);
                setTranscriptText(words.map((w) => w.word).join(" "));
                setState("done");
              } else {
                setState("recorded");
              }
            }
          } else {
            // File truly isn't there, or they haven't recorded yet
            if (isMounted) setState("idle");
          }
        } catch (err) {
          console.error("[Recorder] Failed to load OPFS audio:", err);
          if (isMounted) {
            setErrorMessage(
              `Could not load audio file "${filenameToLoad}". It may have been deleted from your browser's local storage.`,
            );
            setState("error");
          }
        }
      }
    }
    loadSavedAudio();
    return () => {
      isMounted = false;
    };
  }, [project.id, project.audioFile?.opfsFilename]);

  async function startRecording() {
    try {
      await engineRef.current.start(project.id);
      setState("recording");
    } catch (err) {
      console.error("Failed to start recording:", err);
    }
  }

  async function stopRecording() {
    if (state !== "recording") return;

    setState("processing");

    try {
      const result = await engineRef.current.stop();

      setAudioBuffer(result.buffer);
      setState("recorded");

      // Update project
      onSave({
        ...project,
        audioFile: {
          name: "recording.pcm",
          duration: result.duration,
          opfsFilename: result.filename,
        },
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error("Failed to stop recording:", err);
      setState("idle");
    }
  }

  async function playAudio() {
    togglePreview();
  }

  async function handleTranscribe() {
    if (!audioBuffer) return;

    setIsModelLoading(true);
    setState("transcribing");
    setProgress(0);
    setLoadingMessage("Downloading AI Model...");

    try {
      // Check device capability and load appropriate model
      const webGPU = await checkWebGPU();
      const modelSize = getRecommendedModel(webGPU) as ModelSize;

      console.log(`[TextCast] Using model: ${modelSize}, WebGPU: ${webGPU}`);

      // Load model and capture download progress
      await loadModel(modelSize, (data: ProgressData) => {
        if (data.status === "progress") {
          setProgress(Math.round(data.progress ?? 0));
          if (data.file) {
            if (data.loaded && data.total) {
              setLoadingMessage(
                `Downloading ${data.file} (${formatBytes(data.loaded)} / ${formatBytes(data.total)})`,
              );
            } else {
              setLoadingMessage(`Downloading ${data.file}...`);
            }
          } else if (data.message) {
            setLoadingMessage(data.message);
          }
        } else if (data.status === "ready") {
          setLoadingMessage(`Loaded ${data.file || "model component"}`);
        } else if (data.status === "init" || data.status === "initiate") {
          setLoadingMessage(`Initializing ${data.file || "model"}...`);
        }
      });

      setLoadingMessage("Transcribing audio...");
      setProgress(0);

      const result = await transcribeAudio(
        audioBuffer,
        (progressEvent: ProgressData) => {
          if (progressEvent && progressEvent.status === "progress") {
            setProgress(progressEvent.progress ?? 0);
            if (progressEvent.message) {
              setLoadingMessage(progressEvent.message);
            }
          }
        },
      );

      setTranscriptText(result.text);
      setTranscriptWords(result.words);
      setState("done");

      const updatedProject: Project = {
        ...project,
        audioFile: {
          ...project.audioFile,
          name: "recording.wav",
          duration: audioBuffer.duration,
        },
        transcript: {
          id: crypto.randomUUID(),
          projectId: project.id,
          segments:
            result.segments.length > 0
              ? result.segments.map((s) => ({
                  id: crypto.randomUUID(),
                  start: s.start,
                  end: s.end,
                  text: s.text,
                  words: result.words.filter(
                    (w) => w.start >= s.start && w.start <= s.end,
                  ),
                }))
              : [
                  {
                    id: crypto.randomUUID(),
                    start: 0,
                    end: audioBuffer.duration,
                    text: result.text,
                    words: result.words,
                  },
                ],
          language: "en",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };
      onSave(updatedProject);
    } catch (err) {
      console.error("Transcription failed:", err);
      setState("recorded");
    } finally {
      setIsModelLoading(false);
    }
  }

  function handleTranscriptChange(text: string, words: any[]) {
    setTranscriptText(text);
    setTranscriptWords(words);

    if (project.transcript) {
      const updatedProject: Project = {
        ...project,
        transcript: {
          ...project.transcript,
          // Update the segments to reflect the new deleted flags.
          // We map over the segments and replace the inner word arrays.
          segments: project.transcript.segments.map((segment) => {
            const segmentWords = words.filter(
              (w) => w.start >= segment.start && w.start <= segment.end,
            );
            return {
              ...segment,
              words: segmentWords,
            };
          }),
          updatedAt: Date.now(),
        },
        updatedAt: Date.now(),
      };
      // Auto-save edits
      onSave(updatedProject);
    }
  }

  return (
    <div className="space-y-6">
      {state !== "done" && (
        <div className="bg-card rounded-lg border border-border p-6 text-card-foreground">
          <h2 className="text-lg font-medium mb-4">Audio Recording</h2>

          {state === "idle" && (
            <div className="text-center py-8">
              <div className="w-32 h-32 mx-auto mb-6">
                <Orb isActive={false} />
              </div>
              <p className="text-muted-foreground mb-4">Ready to record</p>
              <Button size="lg" onClick={startRecording}>
                Start Recording
              </Button>
            </div>
          )}

          {state === "recording" && (
            <div className="text-center py-8">
              <div className="w-48 h-48 mx-auto mb-8">
                <Orb ref={orbRef} isActive={true} />
              </div>
              <p className="text-muted-foreground mb-6 flex items-center justify-center gap-2">
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                Recording in progress...
              </p>
              <Button
                variant="destructive"
                size="lg"
                onClick={stopRecording}
                className="flex items-center gap-2 mx-auto"
              >
                <Square className="w-4 h-4" />
                Stop Recording
              </Button>
            </div>
          )}

          {state === "processing" && (
            <div className="text-center py-16 flex flex-col items-center justify-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-muted-foreground font-medium animate-pulse">
                Processing audio file...
              </p>
            </div>
          )}

          {state === "error" && (
            <div className="text-center py-12">
              <div className="w-16 h-16 mx-auto mb-4 bg-destructive/10 text-destructive rounded-full flex items-center justify-center">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">
                Audio File Missing
              </h3>
              <p className="text-muted-foreground text-sm max-w-md mx-auto mb-6">
                {errorMessage}
              </p>
              <Button onClick={() => setState("idle")} variant="outline">
                Record New Audio
              </Button>
            </div>
          )}

          {state === "recorded" && (
            <div className="text-center py-8">
              <div className="w-32 h-32 mx-auto mb-6">
                <Orb
                  ref={orbRef}
                  isActive={isPreviewPlaying}
                  variant="primary"
                />
              </div>
              <p className="text-muted-foreground mb-4">
                {isPreviewPlaying
                  ? "Playing audio..."
                  : project.audioFile?.opfsFilename?.endsWith(".pcm")
                    ? "Recording complete"
                    : "Audio ready"}
              </p>

              <div className="flex gap-3 justify-center">
                <Button
                  variant={isPreviewPlaying ? "default" : "secondary"}
                  onClick={playAudio}
                  className="flex items-center gap-2"
                >
                  {isPreviewPlaying ? (
                    <Square className="w-4 h-4" />
                  ) : (
                    <Play className="w-4 h-4" />
                  )}
                  {isPreviewPlaying ? "Stop" : "Play"}
                </Button>
                <Button
                  onClick={handleTranscribe}
                  disabled={isModelLoading || isPreviewPlaying}
                  className="flex items-center gap-2"
                >
                  {isModelLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading Model...
                    </>
                  ) : (
                    "Transcribe"
                  )}
                </Button>
              </div>
              {isModelLoading && (
                <div className="mt-4">
                  <div className="w-64 h-2 bg-muted rounded-full mx-auto overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto truncate">
                    {loadingMessage}
                  </p>
                </div>
              )}
            </div>
          )}

          {state === "transcribing" && (
            <div className="text-center py-8">
              <div className="w-32 h-32 mx-auto mb-6">
                <Orb isActive={false} />
              </div>
              <p className="text-muted-foreground font-medium">
                {loadingMessage}
              </p>
              <div className="mt-4">
                <div className="w-64 h-2 bg-muted rounded-full mx-auto overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                  {progress > 0 ? `${progress}%` : ""}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {state === "done" && (
        <TranscriptEditor
          audioBuffer={audioBuffer}
          initialText={transcriptText}
          words={transcriptWords}
          projectId={project.id}
          onTranscriptChange={handleTranscriptChange}
        />
      )}
    </div>
  );
}
