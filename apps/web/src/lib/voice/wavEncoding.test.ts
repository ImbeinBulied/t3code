import { describe, expect, it } from "vite-plus/test";

import { encodeMonoWav, resampleAudioBuffer } from "./wavEncoding.ts";

describe("encodeMonoWav", () => {
  it("encodes Float32Array into a valid WAV blob with 44-byte header", async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeMonoWav(samples, 16000);

    expect(blob.type).toBe("audio/wav");
    expect(blob.size).toBe(44 + samples.length * 2);

    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);

    // RIFF header
    const riff = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3),
    );
    expect(riff).toBe("RIFF");

    // WAVE format
    const wave = String.fromCharCode(
      view.getUint8(8),
      view.getUint8(9),
      view.getUint8(10),
      view.getUint8(11),
    );
    expect(wave).toBe("WAVE");

    // Channels
    expect(view.getUint16(22, true)).toBe(1);
    // Sample Rate
    expect(view.getUint32(24, true)).toBe(16000);
    // Bits per sample
    expect(view.getUint16(34, true)).toBe(16);

    // Data chunk
    const dataHeader = String.fromCharCode(
      view.getUint8(36),
      view.getUint8(37),
      view.getUint8(38),
      view.getUint8(39),
    );
    expect(dataHeader).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it("handles array of chunked buffers", async () => {
    const chunk1 = new Float32Array([0.1, 0.2]);
    const chunk2 = new Float32Array([0.3, 0.4]);
    const blob = encodeMonoWav([chunk1, chunk2], 16000);

    expect(blob.size).toBe(44 + 4 * 2);
  });
});

describe("resampleAudioBuffer", () => {
  it("returns same buffer when sample rates match", () => {
    const input = new Float32Array([1, 2, 3]);
    expect(resampleAudioBuffer(input, 16000, 16000)).toBe(input);
  });

  it("downsamples 48kHz to 16kHz correctly (factor of 3)", () => {
    const input = new Float32Array(4800);
    const output = resampleAudioBuffer(input, 48000, 16000);
    expect(output.length).toBe(1600);
  });
});
