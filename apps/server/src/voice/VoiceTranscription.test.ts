import { describe, expect, it } from "vite-plus/test";

import { transcribeVoice, voiceTranscriptionCacheDir } from "./VoiceTranscription.ts";
import { parseVoiceTranscriptionWorkerOutput } from "./voiceTranscriptionProtocol.ts";

const cacheDir = voiceTranscriptionCacheDir();

describe("transcribeVoice", () => {
  it("rejects an empty recording before starting ffmpeg", async () => {
    const error = await transcribeVoice({
      audioBase64: "",
      mimeType: "audio/mp4",
      cacheDir,
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: "The recording was empty." });
  });

  it("rejects recordings the model cannot read", async () => {
    const error = await transcribeVoice({
      audioBase64: Buffer.from("not audio").toString("base64"),
      mimeType: "text/plain",
      cacheDir,
    }).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: "Unsupported recording format: text/plain" });
  });
});

describe("parseVoiceTranscriptionWorkerOutput", () => {
  it("reads the worker's JSON result", () => {
    expect(parseVoiceTranscriptionWorkerOutput('{"text":"hello","locale":"en"}')).toEqual({
      text: "hello",
      locale: "en",
    });
  });

  it("rejects output the worker never writes", () => {
    expect(() => parseVoiceTranscriptionWorkerOutput("not json")).toThrow();
  });
});
