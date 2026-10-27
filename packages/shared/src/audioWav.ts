/** Audio reaching the transcription models is 16-bit PCM, optionally wrapped in a RIFF header. */
export function decodeWavToFloat32(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength === 0) {
    return new Float32Array(0);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const isRiff =
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // 'R'
    bytes[1] === 0x49 && // 'I'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x46; // 'F'

  if (isRiff) {
    let offset = 12;
    let dataOffset = -1;
    let dataLength = 0;

    while (offset + 8 <= bytes.length) {
      const chunkId = String.fromCharCode(
        bytes[offset] ?? 0,
        bytes[offset + 1] ?? 0,
        bytes[offset + 2] ?? 0,
        bytes[offset + 3] ?? 0,
      );
      const chunkSize = view.getUint32(offset + 4, true);
      if (chunkId === "data") {
        dataOffset = offset + 8;
        dataLength = Math.min(chunkSize, bytes.length - dataOffset);
        break;
      }
      offset += 8 + chunkSize;
    }

    if (dataOffset !== -1) {
      if (dataLength <= 0) {
        return new Float32Array(0);
      }
      const sampleCount = Math.floor(dataLength / 2);
      const samples = new Float32Array(sampleCount);
      for (let index = 0; index < sampleCount; index++) {
        const sample = view.getInt16(dataOffset + index * 2, true);
        samples[index] = sample / 32768.0;
      }
      return samples;
    }
  }

  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index++) {
    const sample = view.getInt16(index * 2, true);
    samples[index] = sample / 32768.0;
  }
  return samples;
}

interface AudioSegmentBoundary {
  readonly start: number;
  readonly end: number;
}

// Moonshine needs short inputs; all callers supply 16 kHz mono PCM.
export function getAudioSegmentBoundaries(
  audio: Float32Array,
): ReadonlyArray<AudioSegmentBoundary> {
  const minSamples = 12 * 16_000;
  const targetSamples = 20 * 16_000;
  const maxSamples = 24 * 16_000;
  const minTrailingSamples = 3 * 16_000;
  const windowSamples = 800;
  const hopSamples = 400;
  const silenceEnergyThreshold = windowSamples * 0.005 ** 2;
  const boundaries: AudioSegmentBoundary[] = [];
  let start = 0;

  while (start < audio.length) {
    if (audio.length - start <= maxSamples) {
      boundaries.push({ start, end: audio.length });
      break;
    }
    const target = start + targetSamples;
    const searchEnd = Math.min(start + maxSamples, audio.length - minTrailingSamples);
    let quietest = target;
    let lowestEnergy = Infinity;
    let silentSplit: number | undefined;

    for (let pos = start + minSamples; pos <= searchEnd - windowSamples; pos += hopSamples) {
      let energy = 0;
      for (let index = pos; index < pos + windowSamples; index++) {
        energy += audio[index]! ** 2;
      }
      const center = pos + windowSamples / 2;
      if (
        energy < lowestEnergy ||
        (energy === lowestEnergy && Math.abs(center - target) < Math.abs(quietest - target))
      ) {
        lowestEnergy = energy;
        quietest = center;
      }
      if (
        energy <= silenceEnergyThreshold &&
        (silentSplit === undefined || Math.abs(center - target) < Math.abs(silentSplit - target))
      ) {
        silentSplit = center;
      }
    }
    const end = silentSplit ?? quietest;
    boundaries.push({ start, end });
    start = end;
  }
  return boundaries;
}

export function segmentAudioFloat32(audio: Float32Array): ReadonlyArray<Float32Array> {
  return getAudioSegmentBoundaries(audio).map(({ start, end }) => audio.subarray(start, end));
}

// Skip digital silence without discarding low-volume speech.
export function isSilentAudio(audio: Float32Array): boolean {
  return audio.every((sample) => sample === 0);
}

export function joinTranscriptionSegments(segments: readonly string[]): string {
  return segments
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .join(" ");
}
