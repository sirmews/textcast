# TextCast Waveform Visualization Design Document

This document outlines the architectural research, mathematical foundations, and implementation strategy for adding interactive sound waveforms to TextCast. It critically analyzes patterns from industry-standard libraries (`wavesurfer.js`, `peaks.js`, `webaudio-peaks`, `saku-audio-player`) to avoid common browser-performance and audio-accuracy pitfalls.

---

## 1. Core Objectives
1. **High Performance**: Compute peaks exactly once when an `AudioBuffer` is loaded. Keep the UI layer's render time at $O(1)$ by drawing from a pre-computed array of $N$ peaks (e.g., $300$).
2. **Dynamic Piece Table (EDL) Integration**: Unlike linear players, TextCast edits audio non-destructively. The waveform must read the active `pieces` from the Piece Table and dynamically color or dim segments corresponding to deleted words.
3. **Interactive Navigation**: Synchronize a moving vertical playhead and support click-to-seek directly on the waveform.

---

## 2. Critical Analysis of Industry Implementations

We analyzed several open-source libraries to study their peak-extraction and normalization strategies.

### A. WebAudio-Peaks (`webaudio-peaks` / `@waveform-playlist/webaudio-peaks`)
* **Algorithm**: Uses a raw sample-per-pixel ratio to partition the audio buffer and outputs `Int8Array`, `Int16Array`, or `Int32Array` buffers.
* **Key Lesson**: Supports merging multi-channel data into a single mono peak sequence to handle hard-panned stereo audio (e.g., separate microphones in podcast interviews). If we only analyze the left channel, we risk completely blanking out a speaker panned hard-right.

### B. Saku Audio Player (`saku-audio-player` refactors)
* **Algorithm**: Computes a root-mean-square (RMS) squared sum of squares over each bucket to represent perceived audio power, followed by exponential peak shaping.
* **Normalization & Shaping Code**:
  ```javascript
  const max = Math.max(...peaks);
  return Array.from(peaks).map((v) => {
    const normalized = v / max;
    return Math.min(1, Math.max(0, Math.pow(normalized, 1.3)));
  });
  ```
* **Key Lesson**: Linear scaling of audio peaks makes speech waveforms look very "flat" or "spiky" because human ears perceive loudness logarithmically. Applying a power shaping function like $f(x) = x^{\gamma}$ (where $\gamma \approx 1.3$ or $0.7$ depending on boost requirements) produces a visually satisfying, rich waveform that mimics professional DAW displays (Audacity, Audition).

### C. Wavesurfer.js & Peaks.js
* **Algorithm**: Highly optimized HTML5 Canvas renderers.
* **Key Lesson**: Large audio files can crash browser tab decoding. While they recommend pre-computing binary peak files (`.dat`/`.json` via a server-side CLI like `audiowaveform`) for massive files, client-side decoding in Web Audio is extremely reliable for speaking clips under 10–20 minutes. Since TextCast operates local-first, on-demand client-side peak downsampling is our ideal design.

---

## 3. Avoidance of Common Pitfalls

### Pitfall 1: Mono-Channel Blindness
* **Issue**: A simple loop like `Math.abs(channelData0[j])` only scans the left channel. If one microphone is panned right, its waveform bars will be silent.
* **Solution**: Our utility will average or take the max sample across all available channels (`numberOfChannels`) inside the inner loop:
  $$\text{sampleValue} = \frac{1}{C} \sum_{c=0}^{C-1} |x_{c}[j]|$$

### Pitfall 2: Division by Zero on Total Silence
* **Issue**: If an audio recording is completely silent, the `globalMax` peak is $0.0$. Dividing by `globalMax` yields `NaN` values, which will crash React rendering or SVG styling.
* **Solution**: If `globalMax` is $0.0$ or non-finite, we return a flat sequence of small fallback heights (e.g., $0.05$ or $0.1$) to show a clean baseline.

### Pitfall 3: Sub-Segment Off-by-One Offsets
* **Issue**: Due to integer division (`totalSamples / numberOfPeaks`), a tiny remainder is left at the end of the file. If not handled, the last bar will omit the final fraction of a second.
* **Solution**: Set the final block boundary `end` explicitly to the exact length of the audio buffer: `Math.min(start + blockSize, totalSamples)`.

---

## 4. Isolated Peak Extraction API Design

We will implement this in a dedicated, isolated file: `src/lib/audio/peaks.ts`. This design decouples Web Audio UI complexities from peak calculation, making it fully testable using Vitest with mock `AudioBuffer` objects.

### Interface contract:

```typescript
export interface PeakExtractionOptions {
  /** The desired number of visual bars to represent the waveform (default: 300) */
  numberOfPeaks?: number;
  /** Power-shaping factor for visual enhancement (default: 1.0, use < 1.0 to boost quiet parts) */
  shapingFactor?: number;
}

/**
 * Extracts and normalizes audio amplitude peaks from an AudioBuffer.
 * Handles multi-channel blending, boundary protection, and visual shaping.
 */
export function extractPeaks(
  audioBuffer: AudioBuffer,
  options?: PeakExtractionOptions
): number[];
```

---

## 5. Next Steps
1. **Create `src/lib/audio/peaks.ts`**: Implement the isolated downsampling logic.
2. **Write unit tests in `src/lib/audio/peaks.test.ts`**: Run tests against simulated mono and stereo `AudioBuffer` patterns.
3. **Integrate**: Create the interactive SVG waveform component in the UI.
