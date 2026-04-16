export interface Word {
  word: string;
  start: number;
  end: number;
  confidence: number;
  deleted?: boolean;
  playbackBuffer?: AudioBuffer; // Reference to the source buffer for this word
}

export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
  words: Word[];
  speaker?: string;
}

export interface Transcript {
  id: string;
  projectId: string;
  segments: Segment[];
  language: string;
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  audioFile?: {
    name: string;
    duration: number;
    opfsFilename?: string; // Pointer to the file in Origin Private File System
  };
  transcript?: Transcript;
  createdAt: number;
  updatedAt: number;
}
