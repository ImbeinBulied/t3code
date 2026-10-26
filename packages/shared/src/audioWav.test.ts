import { describe, expect, it } from "vite-plus/test";

import { decodeWavToFloat32 } from "./audioWav.ts";

function pcm16(samples: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, sample, true));
  return bytes;
}

function riffWav(data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(data.length + 44);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, data.length + 36, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, data.length, true);
  bytes.set(data, 44);
  return bytes;
}

describe("decodeWavToFloat32", () => {
  it("decodes the data chunk after a RIFF header", () => {
    const samples = Float32Array.from(decodeWavToFloat32(riffWav(pcm16([0, 16_384, -32_768]))));
    expect(samples.length).toBe(3);
    expect(samples[0]).toBe(0);
    expect(samples[1]).toBeCloseTo(0.5);
    expect(samples[2]).toBeCloseTo(-1);
  });

  it("treats a headerless buffer as raw PCM", () => {
    const samples = Float32Array.from(decodeWavToFloat32(pcm16([-16_384, 8_192])));
    expect(samples.length).toBe(2);
    expect(samples[0]).toBeCloseTo(-0.5);
    expect(samples[1]).toBeCloseTo(0.25);
  });

  it("returns no samples for empty or truncated input", () => {
    expect(decodeWavToFloat32(new Uint8Array()).length).toBe(0);
    expect(decodeWavToFloat32(new Uint8Array([1])).length).toBe(0);
  });
});
