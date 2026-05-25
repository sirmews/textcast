# TextCast

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/sirmews/textcast?utm_source=oss&utm_medium=github&utm_campaign=sirmews%2Ftextcast&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

Edit audio by editing text. A local-first, browser-based audio editor for podcasters.

## Features

- 🎙️ **Record** - Capture studio-quality PCM audio directly to disk via AudioWorklet + OPFS streaming
- 🧹 **Clean** - Reduce noise, normalize volume, trim silence with Web Audio API preprocessing
- 📝 **Transcribe** - Local Whisper transcription (WebGPU-accelerated, falls back to WASM)
- 👥 **Diarize & Segment** - On-device voice-profile diarization with PyAnnote to split transcripts into structured paragraph speech blocks and timestamp segments
- ✏️ **Edit** - Non-destructive text-based editing using a Piece Table engine with 10ms crossfades
- 💾 **Save** - Persistent recording to Origin Private File System (OPFS)
- 📦 **Export** - "Bake" your edits into a final WAV file using OfflineAudioContext
- ♿ **Keyboard Accessible** - Semantic keyboard interaction: Tab navigation, Enter/Space seeking, and Backspace/Delete editing shortcuts

## How It Works

### Three-Stage Transcription & Diarization Pipeline

TextCast uses a three-stage pipeline for frame-accurate word timestamps and structured dialogue paragraph splits:

1. **Whisper Transcription** - Uses `@huggingface/transformers` to generate highly accurate text.
2. **CTC Forced Alignment** - Uses the MMS forced aligner with Viterbi decoding to map words to exact audio frames.
3. **PyAnnote Speaker Diarization** - Uses the PyAnnote model to identify speaker turns and split words into beautifully structured speech-turn paragraphs with corresponding timestamps.

This approach eliminates timestamp drift and hallucinations common in seq2seq models. For more on this problem, see [WhisperX](https://github.com/m-bain/whisperX).

### Non-Destructive Editing

Edits don't modify the original audio. Instead, a [Piece Table](https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation) maintains an Edit Decision List (EDL) of which segments to play. The `PlaylistPlayer` schedules Web Audio nodes with microsecond precision and 10ms crossfades for seamless playback.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:4002 in Chrome (WebGPU recommended for faster transcription).

## Deployment

Configured for Vercel with required COOP/COEP headers for SharedArrayBuffer:

```bash
npm run build
vercel --prod
```

## Browser Requirements

- Chrome 113+ (required for OPFS and WebGPU)
- Requires secure context (HTTPS) for MediaRecorder and OPFS

## Known Limitations

- **Mobile Support** - OPFS and Web Audio worklets have limited support on mobile browsers

## Project Structure

```
src/
├── components/
│   ├── editor/           # TranscriptEditor with Piece Table visualization
│   ├── recorder/         # Recording UI with OPFS streaming
│   └── ui/               # Shared UI components
├── hooks/
│   └── useAudioPlayer.ts # Piece Table-backed playback hook
├── lib/
│   ├── audio/
│   │   ├── PieceTable.ts     # Non-destructive EDL engine
│   │   ├── PlaylistPlayer.ts # Web Audio scheduler
│   │   ├── RecorderEngine.ts # AudioWorklet + OPFS streaming
│   │   └── offlineRender.ts  # WAV export renderer
│   ├── db/               # IndexedDB for project metadata
│   └── transcription/
│       ├── transformers-whisper.ts  # Whisper integration
│       ├── aligner.ts               # Viterbi CTC forced alignment
│       └── vad.ts                   # Voice Activity Detection
└── types/
```

## Tech Stack

| Feature | Technology |
|---------|------------|
| Frontend | React 19 + TypeScript + Vite |
| Styling | Tailwind CSS v4 |
| Storage | OPFS (audio) + IndexedDB (metadata) |
| Transcription | [@huggingface/transformers](https://huggingface.co/docs/transformers.js) (WebGPU/WASM) |
| Forced Alignment | [MMS-300M Forced Aligner](https://huggingface.co/onnx-community/mms-300m-1130-forced-aligner-ONNX) |
| Diarization | [PyAnnote Segmentation 3.0](https://huggingface.co/onnx-community/pyannote-segmentation-3.0) (ONNX via WASM) |
| VAD | [@ricky0123/vad-web](https://github.com/ricky0123/vad) (Silero v5) |

## References & Inspiration

- [WhisperX](https://github.com/m-bain/whisperX) - Transcription + alignment + diarization pipeline
- [PyAnnote Audio](https://github.com/pyannote/pyannote-audio) - State-of-the-art speaker diarization
- [VS Code Piece Table](https://code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation) - Non-destructive editing data structure
- [Silero VAD](https://github.com/snakers4/silero-vad) - Voice Activity Detection
- [Transformers.js](https://huggingface.co/docs/transformers.js) - Running ML models in the browser
- [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) - Origin Private File System for high-performance storage
- [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet) - Low-latency audio processing in a separate thread

## License

MIT
