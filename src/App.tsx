import { FileAudio, HardDrive, Mic, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { storage } from "@/lib/storage";
import { ModeToggle } from "./components/mode-toggle";
import { Recorder } from "./components/recorder/Recorder";
import { ProjectList } from "./components/ui/ProjectList";
import {
  createProject,
  deleteProject,
  getProject,
  getProjects,
  saveProject,
} from "./lib/db";
import type { Project } from "./types";

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [view, setView] = useState<"list" | "editor">("list");
  const [isClearing, setIsClearing] = useState(false);

  const loadProjects = useCallback(async () => {
    const projectList = await getProjects();
    setProjects(projectList);
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  async function handleNewProject() {
    const name = `Project ${projects.length + 1}`;
    const project = await createProject(name);
    setCurrentProject(project);
    setView("editor");
    loadProjects();
  }

  async function handleSelectProject(id: string) {
    const project = await getProject(id);
    if (project) {
      setCurrentProject(project);
      setView("editor");
    }
  }

  async function handleSaveProject(project: Project) {
    await saveProject(project);
    setCurrentProject(project); // Update local state so Recorder receives new props
    loadProjects();
  }

  async function handleDeleteProject(id: string) {
    const projectToDelete = projects.find((p) => p.id === id);

    // Clean up OPFS storage
    if (projectToDelete?.audioFile) {
      const filename1 = projectToDelete.audioFile.opfsFilename;
      const filename2 = `project-${id}-raw.pcm`;

      if (filename1) await storage.remove(filename1);
      if (filename2 && filename2 !== filename1) await storage.remove(filename2);
    }

    await deleteProject(id);
    loadProjects();
  }

  async function handleBack() {
    setCurrentProject(null);
    setView("list");
    loadProjects();
  }

  async function handleClearModels() {
    if (
      !window.confirm(
        "This will delete the downloaded AI models from your browser cache (~350MB). They will be re-downloaded next time you transcribe. Continue?",
      )
    ) {
      return;
    }

    setIsClearing(true);
    try {
      const cacheNames = await caches.keys();
      for (const name of cacheNames) {
        if (name.includes("transformers-cache")) {
          await caches.delete(name);
        }
      }
      alert("AI Models cleared successfully!");
    } catch (err) {
      console.error("Failed to clear cache:", err);
      alert("Failed to clear models. See console for details.");
    } finally {
      setIsClearing(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Mic className="w-6 h-6 text-primary" />
              <h1 className="text-xl font-semibold">TextCast</h1>
            </div>
            {view === "editor" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="text-muted-foreground hover:text-foreground"
              >
                ← Back to Projects
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearModels}
              disabled={isClearing}
              className="text-muted-foreground hidden sm:flex items-center gap-2"
              title="Clear downloaded AI models from browser cache"
            >
              <HardDrive className="w-4 h-4" />
              {isClearing ? "Clearing..." : "Clear AI Models"}
            </Button>
            <ModeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {view === "list" ? (
          <div>
            <div className="mb-6 p-4 bg-muted/50 border border-border rounded-lg">
              <p className="text-sm text-muted-foreground mb-3">
                <strong className="text-foreground">TextCast</strong>{" "}
                transcribes audio entirely in your browser using AI. Your audio
                never leaves your device — everything is processed locally.{" "}
                <a
                  href="https://perfectlycromulent.dev"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Learn more
                </a>
              </p>
              <div className="text-xs text-muted-foreground">
                <p className="font-medium text-foreground/70 mb-1">
                  Current limitations:
                </p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>English language only</li>
                  <li>Requires ~350MB initial model download</li>
                  <li>
                    Needs a modern browser (Chrome/Edge 86+, Firefox 111+)
                  </li>
                </ul>
              </div>
            </div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-medium">Your Projects</h2>
              <Button
                onClick={handleNewProject}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                New Project
              </Button>
            </div>

            {projects.length === 0 ? (
              <div className="text-center py-12 bg-card rounded-lg border border-border">
                <FileAudio className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground mb-4">No projects yet</p>
                <Button variant="link" onClick={handleNewProject}>
                  Create your first project
                </Button>
              </div>
            ) : (
              <ProjectList
                projects={projects}
                onSelect={handleSelectProject}
                onDelete={handleDeleteProject}
              />
            )}
          </div>
        ) : currentProject ? (
          <Recorder
            key={currentProject.id}
            project={currentProject}
            onSave={handleSaveProject}
          />
        ) : null}
      </main>
    </div>
  );
}

export default App;
