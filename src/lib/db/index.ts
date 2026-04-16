import type { Project } from "../../types";

const DB_NAME = "textcast";
const DB_VERSION = 1;

let dbInstance: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains("projects")) {
        const projectStore = db.createObjectStore("projects", {
          keyPath: "id",
        });
        projectStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains("transcripts")) {
        const transcriptStore = db.createObjectStore("transcripts", {
          keyPath: "id",
        });
        transcriptStore.createIndex("projectId", "projectId", {
          unique: false,
        });
      }
    };
  });
}

async function getDb(): Promise<IDBDatabase> {
  if (!dbInstance) {
    dbInstance = await openDatabase();
  }
  return dbInstance;
}

export async function createProject(name: string): Promise<Project> {
  const db = await getDb();
  const now = Date.now();
  const project: Project = {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    const store = tx.objectStore("projects");
    const request = store.add(project);
    request.onsuccess = () => resolve(project);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProject(project: Project): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readwrite");
    const store = tx.objectStore("projects");
    const updatedProject = { ...project, updatedAt: Date.now() };
    const request = store.put(updatedProject);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getProjects(): Promise<Project[]> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readonly");
    const store = tx.objectStore("projects");
    const request = store.getAll();

    request.onsuccess = () => {
      const projects = request.result as Project[];
      projects.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(projects);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(["projects", "transcripts"], "readwrite");
    const projectStore = tx.objectStore("projects");
    const transcriptStore = tx.objectStore("transcripts");

    projectStore.delete(id);

    const index = transcriptStore.index("projectId");
    const range = IDBKeyRange.only(id);
    const cursorRequest = index.openCursor(range);

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getProject(id: string): Promise<Project | null> {
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction("projects", "readonly");
    const store = tx.objectStore("projects");
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
