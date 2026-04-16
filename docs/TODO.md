# TextCast - Development TODO

## Completed Features

- [x] Transcription with @huggingface/transformers (WebGPU/WASM)
- [x] COOP/COEP headers for SharedArrayBuffer
- [x] Word-level timestamps via CTC Forced Alignment (MMS + Viterbi)
- [x] Voice Activity Detection (Silero v5)
- [x] Web Audio API preprocessing (high-pass filter, normalization, silence trim)
- [x] Piece Table EDL for non-destructive editing
- [x] 10ms linear crossfading for seamless boundaries
- [x] PlaylistPlayer for real-time EDL playback
- [x] Interactive UI: Click-to-seek, Right-click-to-delete
- [x] WAV export via OfflineAudioContext

## Roadmap

- [ ] Interactive waveform visualization reflecting Piece Table EDL
- [ ] Visual indicators for word boundaries on waveform
- [ ] Keyboard shortcuts (J/K/L for playback, Backspace for delete)
- [ ] Undo/Redo support
- [ ] Multi-track support

## Known Issues

- [ ] Mobile Support: OPFS and Web Audio worklets have limited support on iOS/Android browsers

## Testing Checklist

- [x] Record audio via OPFS Worklet
- [x] Click "Clean" to enhance audio
- [x] Play back cleaned recording
- [x] Click Transcribe
- [x] Watch model download progress bar
- [x] See transcription appear
- [x] Edit transcript (Right click words to delete)
- [x] Verify Playhead skips deleted words seamlessly
- [x] Export final edited audio
- [x] Refresh page and verify OPFS auto-recovers old projects
