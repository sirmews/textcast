import { FileAudio, Mic, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project } from "@/types";

interface ProjectListProps {
  projects: Project[];
  onSelect: (id: string) => void;
  onDelete?: (id: string) => void;
}

function formatDuration(seconds?: number) {
  if (!seconds) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ProjectList({
  projects,
  onSelect,
  onDelete,
}: ProjectListProps) {
  return (
    <div className="space-y-2">
      {projects.map((project) => (
        <div key={project.id} className="relative group">
          <Button
            variant="outline"
            onClick={() => onSelect(project.id)}
            className="w-full h-auto text-left p-4 flex flex-col items-stretch justify-start hover:border-primary hover:shadow-sm transition-all pr-12"
          >
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center ${project.audioFile ? "bg-primary/10" : "bg-muted"}`}
                >
                  {project.audioFile ? (
                    <FileAudio className="w-5 h-5 text-primary" />
                  ) : (
                    <Mic className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
                <div className="text-left">
                  <h3 className="font-medium text-foreground">
                    {project.name}
                  </h3>
                  <p className="text-sm text-muted-foreground font-normal">
                    {new Date(project.updatedAt).toLocaleDateString()}
                  </p>
                </div>
              </div>

              {project.audioFile && (
                <div className="text-sm text-muted-foreground font-medium px-3 py-1 bg-muted rounded-full">
                  {formatDuration(project.audioFile.duration)}
                </div>
              )}
            </div>
          </Button>

          {onDelete && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(project.id);
              }}
              title="Delete Project"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
