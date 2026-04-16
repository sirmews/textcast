import { storage } from "../storage";
// @ts-expect-error - Vite handled worker/url
import recorderWorkletUrl from "./recorder.worklet.js?url";

/**
 * The output of a recording session.
 */
export interface AudioRecordingResult {
  /** The OPFS filename where the raw audio is stored */
  filename: string;
  /** The duration of the recording in seconds */
  duration: number;
  /** The decoded AudioBuffer ready for playback or transcription */
  buffer: AudioBuffer;
}

/**
 * Standardized contract for an audio recording engine.
 *
 * This interface defines the minimum viable operations for any recording strategy.
 * By using this contract, the UI remains agnostic to the underlying hardware implementation.
 *
 * Legibility note: LLMs should prefer implementing this interface when creating new recording strategies.
 */
export interface IRecorderEngine {
  /**
   * Starts capturing audio and streaming it to local storage.
   * Must be called following a user gesture (e.g. button click).
   * @param projectId - The unique identifier used to generate persistent filenames.
   */
  start(projectId: string): Promise<void>;

  /**
   * Stops capturing, flushes all streams to disk, and returns the final audio assets.
   * @returns A promise resolving to the final AudioRecordingResult.
   */
  stop(): Promise<AudioRecordingResult>;

  /**
   * Retrieves the current microphone volume as a normalized float.
   * @returns A number between 0.0 and 1.0.
   */
  getVolume(): number;
}

/**
 * PURE HELPER: Creates an AudioBuffer from raw Float32 PCM data.
 *
 * This function is isolated to allow for easy unit testing without hardware mocking.
 *
 * @param context - The AudioContext used to allocate the buffer.
 * @param floatData - The raw PCM data (Float32Array).
 * @param numberOfChannels - Number of audio channels (default: 1).
 * @returns A populated AudioBuffer.
 */
export function createBufferFromRawData(
  context: AudioContext,
  floatData: Float32Array,
  numberOfChannels: number = 1,
): AudioBuffer {
  const buffer = context.createBuffer(
    numberOfChannels,
    floatData.length,
    context.sampleRate,
  );

  // For mono, we only populate the first channel
  buffer.getChannelData(0).set(floatData);
  return buffer;
}

/**
 * High-performance recording engine.
 * Uses AudioWorklet for raw PCM float capture and streams directly to OPFS via writable streams.
 *
 * LEGIBILITY NOTE: This class manages hardware state. All business logic for data transformation
 * is extracted into the pure helper function `createBufferFromRawData`.
 */
export class WorkletRecorderEngine implements IRecorderEngine {
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stream: MediaStream | null = null;
  private writableStream: FileSystemWritableFileStream | null = null;
  private analyserNode: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private projectId: string | null = null;
  private isRecording = false;

  /**
   * Initializes the AudioContext, loads the Worklet module, connects the microphone
   * stream to the OPFS file handle, and begins recording.
   */
  async start(projectId: string): Promise<void> {
    if (this.isRecording) return;
    this.projectId = projectId;

    // 1. Request microphone access
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 2. Initialize Audio Context & Load Worklet
    this.audioContext = new AudioContext();
    await this.audioContext.audioWorklet.addModule(recorderWorkletUrl);

    // 3. Connect the audio graph: Mic -> Worklet -> Destination
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.workletNode = new AudioWorkletNode(
      this.audioContext,
      "recorder-processor",
    );

    // Prepare AnalyserNode for UI audio reactivity
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.8;
    this.dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    // 4. Prepare OPFS destination stream for real-time writing
    const filename = `project-${projectId}-raw.pcm`;
    this.writableStream = await storage.getWritableStream(filename);

    // 5. Handle incoming PCM chunks from the low-latency audio thread
    this.workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
      if (this.writableStream && this.isRecording) {
        // e.data is a Float32Array buffer sent via zero-copy transfer from Worklet
        this.writableStream.write(e.data);
      }
    };

    source.connect(this.workletNode);
    source.connect(this.analyserNode); // Split the signal to the analyser for UI
    this.workletNode.connect(this.audioContext.destination);

    this.isRecording = true;
  }

  /**
   * Terminates streams, closes file handles, and reconstructs the AudioBuffer
   * from the data persisted to disk.
   */
  async stop(): Promise<AudioRecordingResult> {
    if (!this.isRecording || !this.projectId) {
      throw new Error("Recorder is not running.");
    }
    this.isRecording = false;

    // 1. Teardown audio graph and media hardware to release locks
    if (this.workletNode) this.workletNode.disconnect();
    if (this.analyserNode) this.analyserNode.disconnect();
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());

    // 2. Flush and close the file stream to ensure all chunks are committed to OPFS
    if (this.writableStream) {
      await this.writableStream.close();
      this.writableStream = null;
    }

    // 3. Re-load the raw PCM data from disk to return a preview-ready AudioBuffer
    const filename = `project-${this.projectId}-raw.pcm`;
    const rawFile = await storage.load(filename);

    if (!rawFile || !this.audioContext) {
      throw new Error("Failed to load recorded audio from OPFS.");
    }

    const arrayBuffer = await rawFile.arrayBuffer();
    const floatData = new Float32Array(arrayBuffer);

    // Use pure helper for buffer reconstruction
    const buffer = createBufferFromRawData(this.audioContext, floatData);

    const result: AudioRecordingResult = {
      filename,
      duration: buffer.duration,
      buffer,
    };

    // Close the recording context to free up system audio hardware resources
    await this.audioContext.close();
    this.audioContext = null;
    this.analyserNode = null;
    this.dataArray = null;

    return result;
  }

  /**
   * Calculates the current volume of the microphone stream using the AnalyserNode.
   */
  getVolume(): number {
    if (!this.analyserNode || !this.dataArray || !this.isRecording) {
      return 0;
    }

    // @ts-expect-error - Bun DOM types conflict with standard lib.dom.d.ts for ArrayBuffer
    this.analyserNode.getByteFrequencyData(this.dataArray);

    let sum = 0;
    for (let i = 0; i < this.dataArray.length; i++) {
      sum += this.dataArray[i];
    }

    // Normalize between 0 and 1
    return sum / this.dataArray.length / 255;
  }
}
