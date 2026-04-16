/**
 * High-Quality PCM Recorder Processor (AudioWorklet thread)
 *
 * Captures raw Float32 PCM data from the microphone and sends it
 * to the main thread in chunks using zero-copy transfers.
 *
 * LEGIBILITY NOTE: This class runs in a separate Web Audio thread.
 * It is kept extremely lean to prevent dropping audio frames.
 *
 * IMPORTANT: This file must remain as plain JavaScript as it is loaded directly
 * into the AudioWorkletGlobalScope which does not support TypeScript natively.
 */
class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** Adjust buffer size for latency vs performance (4096 samples ≈ 92ms at 44.1kHz) */
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.offset = 0;
  }

  /**
   * Called by the Web Audio API for each block of audio (usually 128 samples).
   * @param {Float32Array[][]} inputs - Array of inputs (each an array of channel data)
   * @returns {boolean} true to keep the processor alive.
   */
  process(inputs) {
    const input = inputs[0]; // Primary input stream

    if (input && input.length > 0) {
      const channelData = input[0]; // Capture only the first channel (Mono)

      for (let i = 0; i < channelData.length; i++) {
        this.buffer[this.offset++] = channelData[i];

        // When the internal buffer is full, emit it to the main thread
        if (this.offset >= this.bufferSize) {
          /**
           * PERFORMANCE NOTE: We slice the buffer to create a unique ArrayBuffer
           * for zero-copy transfer. This prevents the Worklet from having to
           * re-allocate its internal capture buffer constantly.
           */
          const chunk = this.buffer.slice();
          this.port.postMessage(chunk.buffer, [chunk.buffer]);

          this.offset = 0;
        }
      }
    }

    // Returning true is critical; it keeps the processor registered in the audio thread.
    return true;
  }
}

// Global registration in the Worklet context
registerProcessor("recorder-processor", RecorderProcessor);
