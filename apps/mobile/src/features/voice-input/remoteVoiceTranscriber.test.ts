import { VoiceTranscriptionError } from "@t3tools/client-runtime/voice-input";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  base64: vi.fn<() => Promise<string>>(),
  transcribe: vi.fn<
    (
      audioBase64: string,
      mimeType: string,
      locale: string,
    ) => Promise<{
      readonly text: string;
      readonly locale: string;
    }>
  >(),
}));

vi.mock("expo-file-system", () => ({
  File: class {
    base64 = mocks.base64;
  },
}));

import { createRemoteVoiceTranscriber, mimeTypeForRecording } from "./remoteVoiceTranscriber";

const controller = new AbortController();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.base64.mockResolvedValue("AQID");
  mocks.transcribe.mockResolvedValue({ text: "hello", locale: "en-US" });
});

describe("mimeTypeForRecording", () => {
  it.each([
    ["file:///voice.m4a", "audio/mp4"],
    ["file:///voice.wav", "audio/wav"],
    ["file:///voice.webm", "audio/webm"],
    ["file:///voice.3gp", "audio/3gpp"],
    ["file:///voice.unknown", "audio/mp4"],
  ])("maps %s to %s", (uri, mimeType) => {
    expect(mimeTypeForRecording(uri)).toBe(mimeType);
  });
});

describe("createRemoteVoiceTranscriber", () => {
  it("uploads the recording to the environment and returns its transcript", async () => {
    const transcriber = createRemoteVoiceTranscriber(mocks.transcribe);
    const prepared = await transcriber.prepare({ signal: controller.signal });

    await expect(
      prepared.transcribe("file:///voice.m4a", { signal: controller.signal }),
    ).resolves.toBe("hello");
    expect(mocks.transcribe).toHaveBeenCalledWith("AQID", "audio/mp4", prepared.locale);
  });

  it("reports a failed environment request as a transcription failure", async () => {
    mocks.transcribe.mockRejectedValue(new Error("offline"));
    const transcriber = createRemoteVoiceTranscriber(mocks.transcribe);
    const prepared = await transcriber.prepare({ signal: controller.signal });

    const error = await prepared
      .transcribe("file:///voice.m4a", { signal: controller.signal })
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(VoiceTranscriptionError);
    expect(error).toMatchObject({ code: "transcription-failed" });
  });

  it("does not upload after cancellation", async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const transcriber = createRemoteVoiceTranscriber(mocks.transcribe);
    const prepared = await transcriber.prepare({ signal: controller.signal });

    await expect(
      prepared.transcribe("file:///voice.m4a", { signal: cancelled.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(mocks.base64).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});
