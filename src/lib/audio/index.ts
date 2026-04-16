import type { Word } from "../../types";

export * from "./preprocessing";
export * from "./rebuild";

export async function audioBufferToWav(buffer: AudioBuffer): Promise<Blob> {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1;
  const bitDepth = 16;

  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = buffer.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let i = 0; i < numChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

export function rebuildAudioFromSegments(
  originalBuffer: AudioBuffer,
  words: Word[],
  textSegments: string[],
): AudioBuffer {
  const sampleRate = originalBuffer.sampleRate;
  const channelCount = originalBuffer.numberOfChannels;

  const audioContext = new AudioContext();
  const targetBuffer = audioContext.createBuffer(
    channelCount,
    Math.ceil(words.reduce((acc, w) => Math.max(acc, w.end), 0) * sampleRate),
    sampleRate,
  );

  textSegments.forEach((text) => {
    const segmentWords = text
      .trim()
      .split(/\s+/)
      .filter((w) => w);
    if (segmentWords.length === 0) return;

    const matchingWords = words.filter((w) => segmentWords.includes(w.word));

    if (matchingWords.length > 0) {
      const startSample = Math.floor(matchingWords[0].start * sampleRate);
      const endSample = Math.floor(
        matchingWords[matchingWords.length - 1].end * sampleRate,
      );

      for (let ch = 0; ch < channelCount; ch++) {
        const sourceData = originalBuffer.getChannelData(ch);
        const targetData = targetBuffer.getChannelData(ch);

        for (let i = startSample; i < endSample && i < targetData.length; i++) {
          targetData[i] = sourceData[i];
        }
      }
    }
  });

  return targetBuffer;
}

export function createSilentAudioBuffer(
  context: AudioContext,
  durationSeconds: number,
): AudioBuffer {
  const sampleRate = context.sampleRate;
  const length = Math.floor(durationSeconds * sampleRate);
  const buffer = context.createBuffer(1, length, sampleRate);
  const data = buffer.getChannelData(0);
  data.fill(0);
  return buffer;
}

export async function exportToMp3(audioBuffer: AudioBuffer): Promise<Blob> {
  const wavBlob = await audioBufferToWav(audioBuffer);
  const arrayBuffer = await wavBlob.arrayBuffer();

  const base64 = btoa(
    new Uint8Array(arrayBuffer).reduce(
      (data, byte) => data + String.fromCharCode(byte),
      "",
    ),
  );

  const mp3Blob = new Blob([atob(base64)], { type: "audio/mp3" });
  return mp3Blob;
}
