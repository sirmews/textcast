import fastDiff from "fast-diff";
import type { Word } from "../../types";

/**
 * Represents a word mapped to its character boundaries within a continuous string.
 * Used to map text diffing results back to chronological audio timestamps.
 */
export interface WordSpan {
  word: Word;
  startIndex: number;
  endIndex: number;
}

/**
 * Maps an array of Word objects to a continuous string and tracks character indices.
 * Pure function.
 *
 * @param words - Array of transcribed words with timestamps
 * @returns A tuple containing the reconstructed string and an array of WordSpans
 */
export function buildWordSpans(words: Word[]): {
  originalText: string;
  spans: WordSpan[];
} {
  let originalText = "";
  const spans: WordSpan[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const startIndex = originalText.length;
    // Append word and a space (except for the last word)
    const textToAppend = word.word + (i < words.length - 1 ? " " : "");
    originalText += textToAppend;

    spans.push({
      word,
      startIndex,
      endIndex: originalText.length, // includes the space
    });
  }
  return { originalText, spans };
}

/**
 * Determines which original words were preserved after user edits using Myers Diff.
 * Pure function.
 *
 * @param spans - The word spans mapped to the original text
 * @param originalText - The complete original transcript text
 * @param editedText - The user's edited transcript text
 * @returns An array of chronological Word objects that are preserved.
 */
export function extractKeptWords(
  spans: WordSpan[],
  originalText: string,
  editedText: string,
): Word[] {
  // We use the Myers Diff algorithm to find the shortest edit script.
  // Reference: Myers, W. (1986). An O(ND) Difference Algorithm and Its Variations.
  const diffs = fastDiff(originalText, editedText);
  const keptWords: Word[] = [];
  let originalPos = 0;

  for (const [operation, text] of diffs) {
    if (operation === fastDiff.EQUAL) {
      const spanEnd = originalPos + text.length;
      for (const span of spans) {
        // If any part of the word falls within the preserved text span, keep it.
        if (span.startIndex >= originalPos && span.startIndex < spanEnd) {
          if (!keptWords.includes(span.word)) {
            keptWords.push(span.word);
          }
        }
      }
      originalPos += text.length;
    } else if (operation === fastDiff.DELETE) {
      originalPos += text.length;
    } else if (operation === fastDiff.INSERT) {
      // Inserts don't advance the originalPos index
    }
  }

  // Ensure chronological order
  return keptWords.sort((a, b) => a.start - b.start);
}

/**
 * Calculates the exact number of audio samples needed for the final buffer.
 * Pure function.
 *
 * @param keptWords - The array of words to include in the audio
 * @param sampleRate - The audio sample rate (e.g., 44100 Hz)
 * @param addSilence - If true, keeps original timing. If false, compresses gaps.
 * @param crossfadeSamples - Number of samples to overlap at non-contiguous boundaries
 * @returns The total duration in samples (minimum 1 to avoid allocation errors).
 */
export function calculateTargetSamples(
  keptWords: Word[],
  sampleRate: number,
  addSilence: boolean,
  crossfadeSamples: number,
): number {
  if (keptWords.length === 0) return 1;

  if (addSilence) {
    // Total duration is just the end of the last kept word
    const lastWord = keptWords[keptWords.length - 1];
    return Math.max(1, Math.ceil(lastWord.end * sampleRate));
  }

  let totalDurationSamples = 0;
  for (let i = 0; i < keptWords.length; i++) {
    const word = keptWords[i];
    const startSample = Math.floor(word.start * sampleRate);
    const endSample = Math.floor(word.end * sampleRate);
    totalDurationSamples += endSample - startSample;

    // Subtract crossfade overlap if this segment is glued to a non-contiguous previous segment
    if (i > 0) {
      const prevWord = keptWords[i - 1];
      // If they were originally separated by more than 50ms, they are considered non-contiguous cuts
      if (word.start > prevWord.end + 0.05) {
        totalDurationSamples -= crossfadeSamples;
      }
    }
  }

  return Math.max(1, totalDurationSamples);
}

/**
 * Orchestrator function: Rebuilds an audio buffer based on a text transcript edit.
 *
 * Process Pipeline:
 * 1. Map Words to text Spans (Pure)
 * 2. Extract Kept Words via Diffing (Pure)
 * 3. Calculate target buffer size (Pure)
 * 4. Allocate and render new AudioBuffer (Side-effect: memory allocation)
 *
 * @param originalBuffer - The source AudioBuffer
 * @param originalWords - Word timestamps from the original transcription
 * @param editedText - The user's modified transcript
 * @param addSilence - If true, replaces deleted words with silence. If false, removes gaps.
 * @returns A new AudioBuffer containing the edited audio
 */
export function rebuildAudioFromTranscript(
  originalBuffer: AudioBuffer,
  originalWords: Word[],
  editedText: string,
  addSilence: boolean = false,
): AudioBuffer {
  const sampleRate = originalBuffer.sampleRate;
  const channelCount = originalBuffer.numberOfChannels;

  // Pipeline Step 1 & 2: Text processing
  const { originalText, spans } = buildWordSpans(originalWords);
  const keptWords = extractKeptWords(spans, originalText, editedText);

  if (keptWords.length === 0) {
    return createSilentBuffer(1, sampleRate, channelCount);
  }

  // Pipeline Step 3: Duration calculation
  const crossfadeDurationSec = 0.01; // 10ms crossfade
  const crossfadeSamples = Math.floor(crossfadeDurationSec * sampleRate);
  const targetSamples = calculateTargetSamples(
    keptWords,
    sampleRate,
    addSilence,
    crossfadeSamples,
  );

  // Pipeline Step 4: Buffer generation
  const newBuffer = new AudioBuffer({
    length: targetSamples,
    numberOfChannels: channelCount,
    sampleRate: sampleRate,
  });

  // Extract original channels for fast access
  const originalChannels: Float32Array[] = [];
  for (let ch = 0; ch < channelCount; ch++) {
    originalChannels.push(originalBuffer.getChannelData(ch));
    newBuffer.getChannelData(ch).fill(0); // initialize with silence
  }

  if (addSilence) {
    renderWithSilence(
      newBuffer,
      originalChannels,
      keptWords,
      sampleRate,
      channelCount,
    );
  } else {
    renderWithCompression(
      newBuffer,
      originalChannels,
      keptWords,
      sampleRate,
      channelCount,
      crossfadeSamples,
    );
  }

  return newBuffer;
}

/**
 * Renders audio maintaining original timestamps (gaps become silence).
 * Mutates targetBuffer in-place.
 */
function renderWithSilence(
  targetBuffer: AudioBuffer,
  originalChannels: Float32Array[],
  keptWords: Word[],
  sampleRate: number,
  channelCount: number,
): void {
  for (const word of keptWords) {
    const startSample = Math.floor(word.start * sampleRate);
    const endSample = Math.floor(word.end * sampleRate);

    for (let ch = 0; ch < channelCount; ch++) {
      const targetData = targetBuffer.getChannelData(ch);
      const sourceData = originalChannels[ch];

      for (let i = startSample; i < endSample && i < targetData.length; i++) {
        targetData[i] = sourceData[i];
      }
    }
  }
}

/**
 * Renders audio by compressing gaps and applying linear crossfades at cut boundaries.
 * Mutates targetBuffer in-place.
 *
 * Reference: MDN Web Audio API Best Practices - Avoiding Audio Glitches.
 */
function renderWithCompression(
  targetBuffer: AudioBuffer,
  originalChannels: Float32Array[],
  keptWords: Word[],
  sampleRate: number,
  channelCount: number,
  crossfadeSamples: number,
): void {
  let writePosition = 0;

  for (let i = 0; i < keptWords.length; i++) {
    const word = keptWords[i];
    const startSample = Math.floor(word.start * sampleRate);
    const endSample = Math.floor(word.end * sampleRate);
    const segmentLength = endSample - startSample;

    // A segment is considered contiguous if it naturally followed the previous segment in the original audio
    const isContiguousWithPrev =
      i > 0 && word.start <= keptWords[i - 1].end + 0.05;

    if (i > 0 && !isContiguousWithPrev) {
      // Non-contiguous cut: Apply crossfade to smooth the transition
      writePosition -= crossfadeSamples;

      for (let ch = 0; ch < channelCount; ch++) {
        const targetData = targetBuffer.getChannelData(ch);
        const sourceData = originalChannels[ch];

        // 1. Crossfade region: fade out previous (targetData), fade in new (sourceData)
        for (let j = 0; j < crossfadeSamples; j++) {
          const targetIdx = writePosition + j;
          const sourceIdx = startSample + j;
          if (targetIdx < targetData.length && sourceIdx < sourceData.length) {
            const fadeRatio = j / crossfadeSamples;
            targetData[targetIdx] =
              targetData[targetIdx] * (1 - fadeRatio) +
              sourceData[sourceIdx] * fadeRatio;
          }
        }

        // 2. Main segment region: straight copy
        for (let j = crossfadeSamples; j < segmentLength; j++) {
          const targetIdx = writePosition + j;
          const sourceIdx = startSample + j;
          if (targetIdx < targetData.length && sourceIdx < sourceData.length) {
            targetData[targetIdx] = sourceData[sourceIdx];
          }
        }
      }
      writePosition += segmentLength;
    } else {
      // Contiguous segment: No crossfade needed, straight copy
      for (let ch = 0; ch < channelCount; ch++) {
        const targetData = targetBuffer.getChannelData(ch);
        const sourceData = originalChannels[ch];

        for (let j = 0; j < segmentLength; j++) {
          const targetIdx = writePosition + j;
          const sourceIdx = startSample + j;
          if (targetIdx < targetData.length && sourceIdx < sourceData.length) {
            targetData[targetIdx] = sourceData[sourceIdx];
          }
        }
      }
      writePosition += segmentLength;
    }
  }
}

/**
 * Utility: Creates an empty AudioBuffer of the specified duration.
 */
function createSilentBuffer(
  duration: number,
  sampleRate: number,
  channels: number,
): AudioBuffer {
  const buffer = new AudioBuffer({
    length: Math.ceil(duration * sampleRate),
    numberOfChannels: channels,
    sampleRate: sampleRate,
  });
  for (let ch = 0; ch < channels; ch++) {
    buffer.getChannelData(ch).fill(0);
  }
  return buffer;
}

/**
 * Legacy export matching original signature.
 * Calculate which words are in the edited text vs original.
 * Returns info about kept and deleted word ranges.
 */
export function diffTranscript(
  originalWords: Word[],
  editedText: string,
): { kept: Word[]; deleted: Word[] } {
  const { originalText, spans } = buildWordSpans(originalWords);
  const kept = extractKeptWords(spans, originalText, editedText);
  const deleted = originalWords.filter((w) => !kept.includes(w));
  return { kept, deleted };
}
