# TextCast Architecture

## Overview

TextCast is a browser-based audio editor that allows users to edit audio by editing text — similar to Riverside or Descript. The key insight is that users don't need to understand waveforms to edit audio; they just delete text and the corresponding audio is skipped during playback and export.

## Core Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        React App                             │
├─────────────────────────────────────────────────────────────┤
│  UI Layer                                                   │
│  ├── Recorder (Worklet + OPFS capture)                      │
│  ├── TranscriptEditor (Piece Table visualizer + text)       │
│  └── ProjectList (saved projects)                           │
├─────────────────────────────────────────────────────────────┤
│  State Management                                           │
│  └── IndexedDB (local-first metadata)                       │
│      ├── projects store                                     │
│      └── transcripts store                                  │
├─────────────────────────────────────────────────────────────┤
│  Processing Layer                                          │
│  ├── Audio Processing (Web Audio API)                      │
│  ├── Transcription (@huggingface/transformers + WebGPU)    │
│  ├── Playback Engine (Piece Table + PlaylistPlayer)        │
│  └── Export (OfflineAudioContext WAV rendering)            │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow

### Recording Flow
```
User clicks "Start Recording"
    → AudioWorklet intercepts raw 32-bit PCM float data
    → Chunks streamed directly to Origin Private File System (OPFS)
    → User clicks "Stop"
    → OPFS FileHandle closed
    → File re-opened and decoded into AudioBuffer for playback
```

### Transcription Flow
```
User clicks "Transcribe"
    → Load Whisper model (@huggingface/transformers `whisper-tiny.en`)
    → Process AudioBuffer through WebGPU pipeline (`return_timestamps: 'word'`)
    → Dynamic Time Warping (DTW) calculates exact word boundaries
    → "Punctuation Hack" applied to cap trailing silence on punctuation
    → Display interactive text in editor
```

### Edit & Playback Flow (Non-Destructive)
```
User right-clicks text to delete a word
    → Word is marked `{ deleted: true }`
    → `useAudioPlayer` hook triggers `createPieceTableFromWords`
    → Piece Table (EDL) reconstructs the timeline (merging adjacent deletions)
    → `PlaylistPlayer` recalculates the playback sequence
    → Audio skips the deleted word using 10ms boundary crossfades (GainNodes)
```

### Export Flow
```
User clicks "Export Final Cut"
    → Piece Table (EDL) passed to `offlineRender.ts`
    → `OfflineAudioContext` rapidly schedules the exact same nodes/crossfades
    → Rendered synchronously into a single contiguous `AudioBuffer`
    → Encoded to WAV
    → Download file
```

## Technical Decisions

### 1. Non-Destructive Piece Table (EDL)
Instead of splicing massive arrays or rebuilding `AudioBuffers` on every edit, TextCast uses a **Piece Table**.
- **Performance:** $O(1)$ memory overhead per edit. Rebuilding the timeline is $O(N)$ where N is the number of kept words.
- **Crossfading:** `PlaylistPlayer.ts` dynamically applies a 10ms linear crossfade at the boundaries of scheduled nodes to prevent "clicks" from zero-crossing artifacts when skipping audio.

### 2. Origin Private File System (OPFS)
Standard `MediaRecorder` captures compressed chunks into memory, which crashes browsers on long podcasts. We use OPFS to stream uncompressed, raw PCM data directly to the user's hard drive in real-time.

### 3. @huggingface/transformers (v3)
- Runs entirely in browser (no server needed).
- WebGPU acceleration provides near-realtime inference.
- Provides true word-level timestamps via cross-attention DTW (eliminating the need for a secondary Forced Alignment model like `Wav2Vec2`).

## API Reference

### Audio Engine (`src/lib/audio/`)
- `PieceTable.ts`: Manages the Edit Decision List (EDL) logic.
- `PlaylistPlayer.ts`: Web Audio API scheduler for real-time EDL playback.
- `offlineRender.ts`: OfflineAudioContext renderer for final WAV export.
- `RecorderEngine.ts`: AudioWorklet and OPFS streaming abstraction.

### Database (`src/lib/db/index.ts`)
- Minimal wrapper around `IndexedDB` for storing Project metadata and Transcript arrays.