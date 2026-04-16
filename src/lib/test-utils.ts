/**
 * Test utilities for TextCast
 */

import type { Word } from "../types";

/**
 * Sample audio buffer for testing (generates a simple tone)
 */
export function createTestAudioBuffer(
  sampleRate: number = 44100,
  durationSeconds: number = 5,
): AudioBuffer {
  const audioContext = new AudioContext();
  const buffer = audioContext.createBuffer(
    1,
    sampleRate * durationSeconds,
    sampleRate,
  );
  const data = buffer.getChannelData(0);

  // Generate a simple 440Hz sine wave
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    data[i] = Math.sin(2 * Math.PI * 440 * t) * 0.5;
  }

  return buffer;
}

/**
 * Sample words for testing
 */
export function createTestWords(): Word[] {
  return [
    { word: "Hello", start: 0.0, end: 0.5, confidence: 0.95 },
    { word: "this", start: 0.5, end: 0.8, confidence: 0.92 },
    { word: "is", start: 0.8, end: 1.0, confidence: 0.98 },
    { word: "a", start: 1.0, end: 1.2, confidence: 0.99 },
    { word: "test", start: 1.2, end: 1.6, confidence: 0.97 },
    { word: "of", start: 1.6, end: 1.8, confidence: 0.95 },
    { word: "the", start: 1.8, end: 2.0, confidence: 0.96 },
    { word: "transcript", start: 2.0, end: 2.7, confidence: 0.94 },
    { word: "editing", start: 2.7, end: 3.2, confidence: 0.93 },
    { word: "system", start: 3.2, end: 3.8, confidence: 0.91 },
  ];
}

/**
 * Simulate transcription for testing (without actual Whisper)
 */
export function createTestTranscript(): string {
  return "Hello this is a test of the transcript editing system";
}

/**
 * Format time as MM:SS.ms
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
