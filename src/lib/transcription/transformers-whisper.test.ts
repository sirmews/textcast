import { describe, expect, it, vi, beforeEach } from "vitest";
import { transcribeAudio } from "./transformers-whisper";
import { pipeline } from "@huggingface/transformers";

// Mock Web Audio API classes
class MockAudioBuffer {
  duration = 100;
  numberOfChannels = 1;
  length = 44100 * 100;
  sampleRate = 44100;

  getChannelData() {
    return new Float32Array(this.length);
  }
}

class MockOfflineAudioContext {
  destination = {};
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {}

  createBufferSource() {
    return {
      buffer: null,
      connect() {},
      start() {},
    };
  }

  startRendering() {
    const resampledBuffer = {
      duration: 100,
      numberOfChannels: 1,
      length: 16000 * 100,
      sampleRate: 16000,
      getChannelData: () => new Float32Array(16000 * 100),
    };
    return Promise.resolve(resampledBuffer);
  }
}

const mockSpeechSegments = vi.fn();

vi.mock("./vad", () => ({
  getSpeechSegments: (...args: any[]) => mockSpeechSegments(...args),
}));

// Mock HuggingFace Transformers
vi.mock("@huggingface/transformers", () => {
  const transcriberMock = vi.fn().mockResolvedValue({
    text: "Hello this is a test transcription of long audio.",
  });

  const mockProcessorInstance = Object.assign(
    () => Promise.resolve({}),
    {
      post_process_speaker_diarization: vi.fn().mockReturnValue([
        [
          { start: 10, end: 105, id: "SPEAKER_00" },
        ],
      ]),
    }
  );

  return {
    pipeline: vi.fn().mockResolvedValue(transcriberMock),
    AutoModelForCTC: {
      from_pretrained: vi.fn().mockResolvedValue({}),
    },
    AutoModelForAudioFrameClassification: {
      from_pretrained: vi.fn().mockResolvedValue(() => Promise.resolve({ logits: {} })),
    },
    AutoProcessor: {
      from_pretrained: vi.fn().mockResolvedValue(mockProcessorInstance),
    },
    AutoTokenizer: {
      from_pretrained: vi.fn().mockResolvedValue({
        _tokenizerJSON: {
          model: {
            vocab: { hello: 0, test: 1 },
          },
        },
      }),
    },
    env: {
      allowLocalModels: false,
      useBrowserCache: true,
      backends: {
        onnx: {
          wasm: {
            wasmPaths: "",
          },
        },
      },
    },
  };
});

describe("transformers-whisper transcription split testing", () => {
  beforeEach(() => {
    vi.stubGlobal("OfflineAudioContext", MockOfflineAudioContext);
    vi.stubGlobal("AudioContext", class {
      createBuffer() {
        return new MockAudioBuffer();
      }
    });
    vi.clearAllMocks();
  });

  it("should split a speech segment longer than 30 seconds into multiple sub-segments under 30 seconds", async () => {
    // Mock VAD to return one long speech segment of 95 seconds
    const longAudioLength = 16000 * 95;
    const dummyLongAudio = new Float32Array(longAudioLength);
    
    mockSpeechSegments.mockResolvedValue([
      {
        start: 10,
        end: 105,
        audio: dummyLongAudio,
      },
    ]);

    const mockAudioBuffer = new MockAudioBuffer() as any as AudioBuffer;
    
    const result = await transcribeAudio(mockAudioBuffer);

    // Retrieve the transcriber mock function from the pipeline mock
    const transcriberMock = await pipeline("automatic-speech-recognition");
    
    // Total duration is 95 seconds.
    // 95 seconds split into max 29s chunks should yield 4 chunks:
    // Chunk 1: 29s
    // Chunk 2: 29s
    // Chunk 3: 29s
    // Chunk 4: 8s
    expect(transcriberMock).toHaveBeenCalledTimes(4);

    // Verify first chunk starts at 10.0s and ends at 39.0s (29s duration)
    // Verify second chunk starts at 39.0s and ends at 68.0s (29s duration)
    // Verify third chunk starts at 68.0s and ends at 97.0s (29s duration)
    // Verify fourth chunk starts at 97.0s and ends at 105.0s (8s duration)
    
    // Let's assert the length of audio subarrays passed to the transcriber
    const calls = vi.mocked(transcriberMock).mock.calls;
    
    // First chunk sample length should be 29s * 16000 = 464000 samples
    expect((calls[0][0] as Float32Array).length).toBe(464000);
    expect(calls[0][1]).toEqual({
      return_timestamps: false,
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    // Fourth chunk sample length should be 8s * 16000 = 128000 samples
    expect((calls[3][0] as Float32Array).length).toBe(128000);
    expect(calls[3][1]).toEqual({
      return_timestamps: false,
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    // Check that we got the combined transcription output
    expect(result.text).toContain("Hello this is a test transcription of long audio.");
    
    // Verify that the words are properly mapped back to correct relative offsets in the audio timeline
    expect(result.words.length).toBeGreaterThan(0);
    
    // Since the first chunk starts at 10.0s, the words in the first chunk must start >= 10.0s
    const firstWord = result.words[0];
    expect(firstWord.start).toBeGreaterThanOrEqual(10.0);
  });
});
