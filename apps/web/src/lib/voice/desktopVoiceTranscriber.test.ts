import { describe, expect, it, vi, beforeEach } from "vite-plus/test";

import { createDesktopVoiceTranscriber } from "./desktopVoiceTranscriber.ts";

describe("desktopVoiceTranscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (globalThis as any).desktopBridge;
  });

  it("returns null when desktopBridge is not available", () => {
    const transcriber = createDesktopVoiceTranscriber();
    expect(transcriber).toBeNull();
  });

  it("returns null when voiceInput is not on desktopBridge", () => {
    (globalThis as any).desktopBridge = {};
    const transcriber = createDesktopVoiceTranscriber();
    expect(transcriber).toBeNull();
  });

  it("prepares and transcribes audio through desktopBridge.voiceInput", async () => {
    const prepareMock = vi.fn().mockResolvedValue({ locale: "en", modelName: "test-model" });
    const transcribeMock = vi.fn().mockResolvedValue({ text: "transcribed speech" });
    const cancelMock = vi.fn().mockResolvedValue(undefined);

    (globalThis as any).desktopBridge = {
      voiceInput: {
        getMicrophoneStatus: vi.fn(),
        requestMicrophoneAccess: vi.fn(),
        prepare: prepareMock,
        transcribe: transcribeMock,
        cancel: cancelMock,
      },
    };

    // Mock fetch for reading blob URI
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      }),
    );

    const transcriber = createDesktopVoiceTranscriber();
    expect(transcriber).not.toBeNull();

    const controller = new AbortController();
    const prepared = await transcriber!.prepare({ signal: controller.signal });
    expect(prepared.locale).toBe("en");
    expect(prepareMock).toHaveBeenCalled();

    const text = await prepared.transcribe("blob:http://localhost/dummy", {
      signal: controller.signal,
    });
    expect(text).toBe("transcribed speech");
    expect(transcribeMock).toHaveBeenCalled();
  });

  it("cancels when abort signal fires during preparation", async () => {
    const cancelMock = vi.fn().mockResolvedValue(undefined);
    const prepareMock = vi.fn().mockImplementation(() => new Promise<void>(() => {}));

    (globalThis as any).desktopBridge = {
      voiceInput: {
        getMicrophoneStatus: vi.fn(),
        requestMicrophoneAccess: vi.fn(),
        prepare: prepareMock,
        transcribe: vi.fn(),
        cancel: cancelMock,
      },
    };

    const transcriber = createDesktopVoiceTranscriber();
    const controller = new AbortController();

    const preparePromise = transcriber!.prepare({ signal: controller.signal });
    controller.abort();

    await expect(preparePromise).rejects.toThrow();
    expect(cancelMock).toHaveBeenCalled();
  });
});
