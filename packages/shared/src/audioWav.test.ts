import { describe, expect, it } from "vite-plus/test";

import {
  decodeWavToFloat32,
  getAudioSegmentBoundaries,
  joinTranscriptionSegments,
  isSilentAudio,
  segmentAudioFloat32,
} from "./audioWav.ts";

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

describe("getAudioSegmentBoundaries and segmentAudioFloat32", () => {
  const sampleRate = 16_000;

  it("returns empty array for empty audio", () => {
    expect(getAudioSegmentBoundaries(new Float32Array(0))).toEqual([]);
    expect(segmentAudioFloat32(new Float32Array(0))).toEqual([]);
  });

  it("returns single boundary for audio within max duration", () => {
    const audio = new Float32Array(10 * sampleRate);
    const boundaries = getAudioSegmentBoundaries(audio);
    expect(boundaries).toEqual([{ start: 0, end: 10 * sampleRate }]);

    const segments = segmentAudioFloat32(audio);
    expect(segments.length).toBe(1);
    expect(segments[0]?.length).toBe(10 * sampleRate);
  });

  it("preserves 100% full sample coverage with no gaps, overlaps, or silent truncation", () => {
    // 75 seconds of audio
    const totalSamples = 75 * sampleRate;
    const audio = new Float32Array(totalSamples);
    for (let i = 0; i < totalSamples; i++) {
      // Simulate speech bursts with inter-phrase pauses
      const second = i / sampleRate;
      const isPause =
        (second >= 19 && second <= 21) ||
        (second >= 38 && second <= 40) ||
        (second >= 58 && second <= 60);
      audio[i] = isPause ? 0.0001 : 0.2 * Math.sin(2 * Math.PI * 440 * (i / sampleRate));
    }

    const boundaries = getAudioSegmentBoundaries(audio);

    expect(boundaries.length).toBeGreaterThan(1);
    expect(boundaries[0]?.start).toBe(0);
    expect(boundaries[boundaries.length - 1]?.end).toBe(totalSamples);

    let totalSegmentedSamples = 0;
    for (let i = 0; i < boundaries.length; i++) {
      const boundary = boundaries[i]!;
      expect(boundary.end).toBeGreaterThan(boundary.start);
      totalSegmentedSamples += boundary.end - boundary.start;

      if (i < boundaries.length - 1) {
        expect(boundary.end).toBe(boundaries[i + 1]!.start);
      }
    }

    expect(totalSegmentedSamples).toBe(totalSamples);
  });

  it("splits in the center of natural pause/silence intervals", () => {
    const totalSamples = 40 * sampleRate;
    const audio = new Float32Array(totalSamples);
    // Speech everywhere except a silence pause between 19s and 21s (center: 20s)
    const pauseStart = 19 * sampleRate;
    const pauseEnd = 21 * sampleRate;
    for (let i = 0; i < totalSamples; i++) {
      if (i >= pauseStart && i < pauseEnd) {
        audio[i] = 0;
      } else {
        audio[i] = 0.3;
      }
    }

    const boundaries = getAudioSegmentBoundaries(audio);

    expect(boundaries.length).toBe(2);
    // Split point should fall inside the pause interval, very close to 20s
    const splitPoint = boundaries[0]!.end;
    expect(splitPoint).toBeGreaterThanOrEqual(pauseStart);
    expect(splitPoint).toBeLessThanOrEqual(pauseEnd);
    expect(splitPoint / sampleRate).toBeCloseTo(20, 0);
  });

  it("splits at the center of a fully silent window without including resumed speech", () => {
    const audio = new Float32Array(40 * sampleRate).fill(0.3);
    audio.fill(0, Math.round(19.95 * sampleRate), 20 * sampleRate);
    expect(getAudioSegmentBoundaries(audio)[0]?.end).toBe(Math.round(19.975 * sampleRate));
  });

  it("keeps a useful tail when recording ends just after the maximum segment duration", () => {
    const audio = new Float32Array(Math.round(24.1 * sampleRate)).fill(0.2);
    const boundaries = getAudioSegmentBoundaries(audio);
    expect(boundaries.at(-1)!.end - boundaries.at(-1)!.start).toBeGreaterThanOrEqual(
      3 * sampleRate,
    );
    expect(boundaries.at(-1)!.end).toBe(audio.length);
  });

  it("handles continuous audio with no pauses gracefully", () => {
    // 60 seconds of continuous tone (no silence)
    const totalSamples = 60 * sampleRate;
    const audio = new Float32Array(totalSamples).fill(0.2);

    const boundaries = getAudioSegmentBoundaries(audio);

    expect(boundaries.length).toBe(3);
    expect(boundaries[0]?.start).toBe(0);
    expect(boundaries[boundaries.length - 1]?.end).toBe(totalSamples);
    expect(boundaries.every((b) => b.end - b.start <= 24 * sampleRate)).toBe(true);
  });

  it("partitions a 5-minute recording within optimal model limits", () => {
    // 5 minutes = 300 seconds
    const totalSamples = 300 * sampleRate;
    const audio = new Float32Array(totalSamples).fill(0.2);

    // Create pauses every 18-20 seconds
    for (let sec = 18; sec < 300; sec += 20) {
      const pStart = sec * sampleRate;
      const pEnd = (sec + 1) * sampleRate;
      for (let i = pStart; i < Math.min(pEnd, totalSamples); i++) {
        audio[i] = 0;
      }
    }

    const boundaries = getAudioSegmentBoundaries(audio);

    // Each segment should be <= 24s and >= 12s (except possibly the tail)
    expect(boundaries.length).toBeGreaterThanOrEqual(12);
    expect(boundaries.length).toBeLessThanOrEqual(20);
    for (const b of boundaries) {
      const durSec = (b.end - b.start) / sampleRate;
      expect(durSec).toBeLessThanOrEqual(24);
      expect(durSec).toBeGreaterThan(0);
    }
    expect(boundaries[0]?.start).toBe(0);
    expect(boundaries[boundaries.length - 1]?.end).toBe(totalSamples);
  });
});

describe("joinTranscriptionSegments", () => {
  it("joins trimmed non-empty segments with spaces", () => {
    expect(joinTranscriptionSegments([" Hello ", "world.", " How are you? "])).toBe(
      "Hello world. How are you?",
    );
  });

  it("filters out empty and whitespace-only segments", () => {
    expect(joinTranscriptionSegments(["First sentence.", "", "   ", "Second sentence."])).toBe(
      "First sentence. Second sentence.",
    );
  });

  it("preserves legitimate repeated words and phrases faithfully", () => {
    expect(
      joinTranscriptionSegments([
        "We need to verify, verify, and verify every detail.",
        "Very, very important considerations remain.",
      ]),
    ).toBe(
      "We need to verify, verify, and verify every detail. Very, very important considerations remain.",
    );
  });
});

describe("isSilentAudio", () => {
  it("recognizes digital silence", () => {
    expect(isSilentAudio(new Float32Array(20 * 16000))).toBe(true);
  });

  it("keeps quiet speech instead of applying a volume cutoff", () => {
    const audio = new Float32Array(20 * 16000);
    audio[1000] = 1 / 32768;
    expect(isSilentAudio(audio)).toBe(false);
  });
});
