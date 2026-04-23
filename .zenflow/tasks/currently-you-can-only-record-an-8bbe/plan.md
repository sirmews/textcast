# Drag-and-Drop Audio File Upload

## Summary
Add drag-and-drop audio file upload to the home page. Dropped files are streamed into OPFS with a progress bar, a project is auto-created, and the user is taken to the Recorder UI in playback-only mode.

### [x] Step: Update plan.md

### [x] Step: Add drag-and-drop + upload to App.tsx
- Full-page drag overlay when `view === "list"`
- Stream file chunks to OPFS via `getWritableStream`, tracking progress
- Show progress bar + message (mirroring transcription progress UI)
- Create project, save with `audioFile`, navigate to editor

### [x] Step: Recorder playback-only for uploaded files
- Recorder already enters `recorded` state when `project.audioFile` is set (no recording controls shown)
- Update "Recording complete" label to be neutral ("Audio ready") when applicable
- Verify end-to-end: drop → progress → editor → transcribe
