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
