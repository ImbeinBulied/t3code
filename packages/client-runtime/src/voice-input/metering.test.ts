import { describe, expect, it } from "vite-plus/test";

import { normalizeVoiceInputDecibels, VOICE_WAVEFORM_SAMPLE_COUNT } from "./metering.ts";

describe("normalizeVoiceInputDecibels", () => {
  it("defines standard sample count", () => {
    expect(VOICE_WAVEFORM_SAMPLE_COUNT).toBe(64);
  });

  it("handles undefined and invalid values", () => {
    expect(normalizeVoiceInputDecibels(undefined)).toBe(0);
    expect(normalizeVoiceInputDecibels(Number.NaN)).toBe(0);
    expect(normalizeVoiceInputDecibels(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it("clamps values below noise floor to 0", () => {
    expect(normalizeVoiceInputDecibels(-60)).toBe(0);
    expect(normalizeVoiceInputDecibels(-80)).toBe(0);
  });

  it("clamps values at or above 0 dB to 1", () => {
    expect(normalizeVoiceInputDecibels(0)).toBe(1);
    expect(normalizeVoiceInputDecibels(5)).toBe(1);
  });

  it("normalizes intermediate dB values monotonically", () => {
    const low = normalizeVoiceInputDecibels(-40);
    const mid = normalizeVoiceInputDecibels(-20);
    const high = normalizeVoiceInputDecibels(-5);
    expect(low).toBeGreaterThan(0);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(high).toBeLessThan(1);
  });
});
