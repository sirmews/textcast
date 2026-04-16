# AGENTS.md - Textcast Developer Guide

This document provides guidelines and conventions for agents working in this codebase.

## Project Overview

- **Type**: React SPA with Vite
- **Stack**: React 19, TypeScript, Tailwind CSS, Vite
- **Runtime**: Bun/Node.js for development

---

## Build & Development Commands

### Core Commands

```bash
npm run dev          # Start Vite dev server (port 5173)
npm run build       # TypeScript check + production build
npm run preview     # Preview production build locally
npm run lint       # Run ESLint
npm run test       # Run Vitest test suite
```

---

## Architectural Mandates

### 1. "No Lazy Backwards Compatibility"
- **Modern Defaults First:** When instructed to integrate new or modern tooling (e.g., Shadcn-UI, Vite 8, Tailwind v4), you MUST fully embrace the target toolchain's intended architecture. Do not resort to "lazy" backwards-compatibility hacks (like coercing new CSS variables to work with deprecated configurations) just to save time or avoid migrating older dependencies.
- **Root-Cause Modernization:** If an integration reveals that existing project dependencies are outdated and causing conflicts, proactively upgrade the conflicting dependencies or gracefully inform the user of the architectural mismatch rather than applying a patchwork fix that accumulates technical debt.
- **Zero-Config Preference:** Modern toolchains (like Tailwind v4 or Vite) increasingly prefer zero-configuration and native plugin architectures. Actively remove legacy configuration files (e.g., `postcss.config.js`, `tailwind.config.js` if moving to v4) when migrating to ensure the project remains clean.

### 2. Idiomatic Asset Management & Reproducibility
- **No Manual Copying:** Never manually copy binary blobs or static assets (e.g., `.onnx` models, `.wasm` runtimes, `.worklet.js` files) from `node_modules` into the `public/` directory. This is a fragile "anti-pattern" that breaks reproducibility and version syncing.
- **Automated Lifecycle:** Use idiomatic build-tool plugins (e.g., `vite-plugin-static-copy`) to manage the lifecycle of third-party assets. Asset mapping MUST be declared in the configuration file (`vite.config.ts`), allowing the build tool to handle serving during development and bundling during production.
- **100% Reproducibility:** The codebase must remain "fresh-install-ready." A developer should be able to run `npm install && npm run build` and have a fully functional application without any manual file system manipulation.

---

## Code Style Guidelines

### Formatting

- Uses Prettier-compatible formatting via editor configuration
- 2-space indentation in use
- Run `npm run lint` before committing

### TypeScript

- Use explicit types for function parameters and return values
- Avoid `any` - use `unknown` if type is truly unknown
- Use strict mode in tsconfig

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Components | PascalCase | `AudioRecorder`, `ChatBubble` |
| Functions | camelCase | `handleSubmit`, `useAudioRecorder` |
| Custom Hooks | camelCase prefixed with `use` | `useMediaRecorder`, `useTranscription` |
| Variables | camelCase | `isRecording`, `transcriptionText` |
| Types/Interfaces | PascalCase | `RecordingState`, `MessageProps` |
| File Paths | kebab-case | `audio-recorder.tsx`, `lib/utils.ts` |

### Component Structure

- Use folder-per-component pattern when component has multiple files
- Props interfaces named `{ComponentName}Props`

```typescript
interface AudioRecorderProps {
  onTranscription?: (text: string) => void;
  language?: string;
}
```

### File Organization

```
src/
├── components/     # React components
├── hooks/         # Custom React hooks
├── lib/           # Utilities (utils, api, etc)
├── types/         # TypeScript type definitions
├── App.tsx        # Root component
└── main.tsx       # Entry point
```

---

## React Best Practices

### Hooks

- Always include dependency arrays in `useEffect`, `useCallback`
- Custom hooks should start with `use` prefix
- Use functional updates when state depends on previous value

### Event Handlers

```typescript
// Preferred
const handleClick = useCallback((id: string) => {
  setItems(prev => prev.filter(item => item.id !== id));
}, []);

// Avoid inline functions in lists
```

### Conditional Rendering

```typescript
// Use early returns
if (!isRecording) return null;

return <div>...</div>;
```

---

## Tailwind CSS Guidelines

### Class Organization

- Use logical ordering: layout → spacing → sizing → colors → typography → effects
- Use arbitrary values sparingly
- Extract repeated class combinations into components

```typescript
// Instead of repeating
<div className="flex items-center justify-between p-4 bg-white rounded-lg">
<div className="flex items-center justify-between p-4 bg-white rounded-lg">

// Extract to component
const Card = ({ className, ...props }) => (
  <div className={cn("flex items-center justify-between p-4 bg-white rounded-lg", className)} {...props} />
);
```

### Utility Function

Use `clsx` and `tailwind-merge` for conditional classes:

```typescript
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// Usage
<div className={cn("base-class", isActive && "active-class")}>
```

---

## Error Handling

- Use Error Boundaries for component-level errors
- Log errors appropriately (console.error for production)
- Provide graceful fallbacks for audio/MediaRecorder APIs

```typescript
try {
  await startRecording();
} catch (error) {
  console.error("Failed to start recording:", error);
  setError("Microphone access denied");
}
```

---

## State Management

- Use `useState` for local component state
- Consider `useReducer` for complex state machines
- Keep state colocated when possible

---

## Browser APIs

This project uses browser-only APIs (Web Audio, MediaRecorder). Ensure:

- Feature detection before use
- Graceful degradation for unsupported browsers
- Proper cleanup in `useEffect` return functions

```typescript
useEffect(() => {
  const recorder = new MediaRecorder(stream);
  
  return () => {
    recorder.stream.getTracks().forEach(track => track.stop());
  };
}, []);
```

---

## Import Ordering

Organize imports in this order:

1. External libraries (react, react-dom, etc)
2. Internal modules (@/components, @/hooks, @/lib)
3. Relative imports (./, ../)
4. Type imports (import type)

```typescript
import { useState, useCallback } from "react";
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { cn } from "@/lib/utils";
import type { RecordingState } from "@/types";

// Components
import { AudioWaveform } from "./AudioWaveform";
```

---

## Notes

- Project uses Vercel for deployment (vercel.json configured)
- Environment variables in `.env` and `.env.example`
- No test framework configured - recommend adding Vitest