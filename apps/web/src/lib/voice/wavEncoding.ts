/**
 * Encodes 16 kHz mono Float32 audio samples into a 16-bit PCM WAV Blob.
 */
export function encodeMonoWav(
  samples: ReadonlyArray<Float32Array> | Float32Array,
  sampleRate = 16_000,
): Blob {
  const totalSamples = Array.isArray(samples)
    ? samples.reduce((acc, curr) => acc + curr.length, 0)
    : samples.length;

  const dataLength = totalSamples * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  // RIFF identifier
  writeString(view, 0, "RIFF");
  // File length minus RIFF header
  view.setUint32(4, 36 + dataLength, true);
  // RIFF type
  writeString(view, 8, "WAVE");
  // format chunk identifier
  writeString(view, 12, "fmt ");
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 = PCM)
  view.setUint16(20, 1, true);
  // channel count (1 = mono)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * channels * bytesPerSample)
  view.setUint32(28, sampleRate * 2, true);
  // block align (channels * bytesPerSample)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeString(view, 36, "data");
  // data chunk length
  view.setUint32(40, dataLength, true);

  // Write PCM samples (clamped Float32 -> Int16)
  let offset = 44;
  if (Array.isArray(samples)) {
    for (const chunk of samples) {
      for (let i = 0; i < chunk.length; i++) {
        const sample = Math.max(-1, Math.min(1, chunk[i] ?? 0));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
    }
  } else {
    const flatSamples = samples as Float32Array;
    for (let i = 0; i < flatSamples.length; i++) {
      const sample = Math.max(-1, Math.min(1, flatSamples[i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, string: string): void {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Resamples a Float32Array from inputSampleRate to targetSampleRate using linear interpolation.
 */
export function resampleAudioBuffer(
  input: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number,
): Float32Array {
  if (inputSampleRate === targetSampleRate) return input;
  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const originalIndex = i * ratio;
    const lower = Math.floor(originalIndex);
    const upper = Math.min(lower + 1, input.length - 1);
    const fraction = originalIndex - lower;
    const lowerVal = input[lower] ?? 0;
    const upperVal = input[upper] ?? 0;
    result[i] = lowerVal * (1 - fraction) + upperVal * fraction;
  }

  return result;
}
