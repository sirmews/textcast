/**
 * Viterbi CTC Forced Aligner
 *
 * This module implements the Connectionist Temporal Classification (CTC)
 * alignment algorithm (Viterbi decoding) to map a text transcript back to
 * the physical audio frames of a speech model's emission matrix.
 *
 * Architecture based on torchaudio's forced_aligner.
 */

export interface AlignedWord {
  word: string;
  start: number;
  end: number;
}

/**
 * Builds the Dynamic Programming trellis matrix.
 *
 * @param emission 2D array [numFrames][vocabSize] of log-probabilities
 * @param tokens Array of character token IDs representing the target transcript
 * @param blankId The ID of the CTC blank token (usually 0)
 */
function getTrellis(
  emission: Float32Array[],
  tokens: number[],
  blankId: number = 0,
): Float32Array[] {
  const numFrames = emission.length;
  const numTokens = tokens.length;

  // Initialize trellis with -Infinity
  const trellis = Array.from({ length: numFrames + 1 }, () =>
    new Float32Array(numTokens + 1).fill(-Infinity),
  );

  // Starting point
  trellis[0][0] = 0;

  for (let t = 1; t <= numFrames; t++) {
    const e = emission[t - 1];
    for (let j = 1; j <= numTokens; j++) {
      const token = tokens[j - 1];
      const p = e[token];

      const stay = trellis[t - 1][j];
      const transition = trellis[t - 1][j - 1];

      let skip = -Infinity;
      // CTC Rule: Can skip a blank token if the characters on either side are different
      if (token !== blankId && j > 2 && tokens[j - 3] !== token) {
        skip = trellis[t - 1][j - 2];
      }

      trellis[t][j] = Math.max(stay, transition, skip) + p;
    }
  }

  return trellis;
}

/**
 * Backtracks through the trellis to find the most likely path.
 */
function backtrack(
  trellis: Float32Array[],
  tokens: number[],
  blankId: number = 0,
): { token_index: number; time_index: number }[] {
  const numFrames = trellis.length - 1;
  const numTokens = tokens.length;

  let j = numTokens;
  let t = numFrames;
  const path: { token_index: number; time_index: number }[] = [];

  while (j > 0 && t > 0) {
    const stay = trellis[t - 1][j];
    const transition = trellis[t - 1][j - 1];

    let skip = -Infinity;
    if (tokens[j - 1] !== blankId && j > 2 && tokens[j - 3] !== tokens[j - 1]) {
      skip = trellis[t - 1][j - 2];
    }

    const maxPrev = Math.max(stay, transition, skip);

    path.push({ token_index: j - 1, time_index: t - 1 });

    if (maxPrev === stay) {
      // j remains same
    } else if (maxPrev === transition) {
      j = j - 1;
    } else {
      j = j - 2;
    }

    t -= 1;
  }

  return path.reverse();
}

/**
 * Aligns a text transcript to audio emissions using Viterbi CTC decoding.
 *
 * @param emission The probability matrix from the CTC model
 * @param transcriptText The raw text (usually from Whisper)
 * @param vocab The vocabulary mapping from the aligner model
 * @param frameStrideSeconds The duration of one frame in the model (usually 0.02s)
 * @returns Array of words with frame-accurate timestamps
 */
export function align(
  emission: Float32Array[],
  transcriptText: string,
  vocab: Record<string, number>,
  frameStrideSeconds: number = 0.02,
): AlignedWord[] {
  // 1. Sanitize and Tokenize
  const cleanTranscript = transcriptText
    .toLowerCase()
    .replace(/[^a-z']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleanTranscript.split(" ");

  const blankId = vocab["<blank>"] ?? 0;
  const unkId = vocab["<unk>"] ?? 3;

  const targetTokens: number[] = [];
  const wordMapping: number[] = []; // index maps targetTokens[i] to words[wordMapping[i]]

  for (let w = 0; w < words.length; w++) {
    const word = words[w];
    for (let c = 0; c < word.length; c++) {
      // CTC requires blanks between character transitions
      targetTokens.push(blankId);
      wordMapping.push(-1);

      targetTokens.push(vocab[word[c]] ?? unkId);
      wordMapping.push(w);
    }
  }
  targetTokens.push(blankId);
  wordMapping.push(-1);

  // 2. Solve Trellis
  const trellis = getTrellis(emission, targetTokens, blankId);
  const path = backtrack(trellis, targetTokens, blankId);

  // 3. Map path back to words
  const alignedWords: AlignedWord[] = [];
  let currentWordIdx = -1;
  let currentStartFrame = -1;
  let currentEndFrame = -1;

  for (const step of path) {
    const wIdx = wordMapping[step.token_index];
    if (wIdx !== -1) {
      if (wIdx !== currentWordIdx) {
        if (currentWordIdx !== -1) {
          alignedWords.push({
            word: words[currentWordIdx],
            start: currentStartFrame * frameStrideSeconds,
            end: (currentEndFrame + 1) * frameStrideSeconds,
          });
        }
        currentWordIdx = wIdx;
        currentStartFrame = step.time_index;
      }
      currentEndFrame = step.time_index;
    }
  }

  // Push final word
  if (currentWordIdx !== -1) {
    alignedWords.push({
      word: words[currentWordIdx],
      start: currentStartFrame * frameStrideSeconds,
      end: (currentEndFrame + 1) * frameStrideSeconds,
    });
  }

  return alignedWords;
}
