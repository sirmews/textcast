/**
 * TextCast - Browser-based Audio Editor
 *
 * Edit audio by editing text. A local-first, RxDB-backed audio editor.
 *
 * GETTING STARTED:
 * 1. Run: npm run dev
 * 2. Open: http://localhost:5173
 * 3. Click "Start Recording" to record audio
 * 4. Click "Transcribe" to run Whisper locally
 * 5. Edit text and click "Export"
 *
 * NOTE: The "edit text = edit audio" feature is not yet implemented.
 * See docs/ARCHITECTURE.md for technical details.
 */

// React entry point
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ThemeProvider } from "./components/theme-provider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <App />
    </ThemeProvider>
  </StrictMode>,
);
