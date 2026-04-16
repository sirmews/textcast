/**
 * Standardized contract for local file storage.
 *
 * This abstraction makes it trivial to mock storage in unit tests
 * or swap implementations (e.g., an IndexedDB fallback) without changing UI code.
 */
export interface LocalFileStorage {
  /** Checks if the storage mechanism is supported in the current environment */
  isSupported(): boolean;
  /** Saves a Blob to storage, overwriting if the file already exists */
  save(filename: string, data: Blob): Promise<void>;
  /** Loads a Blob from storage. Returns null if not found. */
  load(filename: string): Promise<Blob | null>;
  /** Deletes a file from storage. Returns true if successful, false if not found. */
  remove(filename: string): Promise<boolean>;
  /** Gets a writable stream for a file in OPFS. Enables real-time streaming. */
  getWritableStream(filename: string): Promise<FileSystemWritableFileStream>;
}

/**
 * Origin Private File System (OPFS) implementation.
 *
 * Ideal for large binary data (like AudioBlobs) to prevent blocking the main thread.
 * Fails gracefully in test environments (e.g., JSDOM) where OPFS is unavailable.
 */
export const opfsStorage: LocalFileStorage = {
  isSupported(): boolean {
    return (
      typeof navigator !== "undefined" &&
      !!navigator.storage &&
      typeof navigator.storage.getDirectory === "function"
    );
  },

  async save(filename: string, data: Blob): Promise<void> {
    if (!this.isSupported()) {
      throw new Error("OPFS is not supported in this environment.");
    }
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  },

  async load(filename: string): Promise<Blob | null> {
    if (!this.isSupported()) return null;

    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(filename);
      return await fileHandle.getFile();
    } catch (error) {
      // Return null gracefully if the file simply doesn't exist
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return null;
      }
      console.error(`[OPFS] Error loading file ${filename}:`, error);
      throw error;
    }
  },

  async remove(filename: string): Promise<boolean> {
    if (!this.isSupported()) return false;

    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(filename);
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") {
        return false;
      }
      console.error(`[OPFS] Error removing file ${filename}:`, error);
      throw error;
    }
  },

  async getWritableStream(
    filename: string,
  ): Promise<FileSystemWritableFileStream> {
    if (!this.isSupported()) {
      throw new Error("OPFS is not supported in this environment.");
    }
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(filename, { create: true });
    return await fileHandle.createWritable();
  },
};

/**
 * Default exported instance.
 * Consumers should import this directly: `import { storage } from '@/lib/storage';`
 * In unit tests, this object can be easily spied on or mocked.
 */
export const storage = opfsStorage;
