// @effect-diagnostics nodeBuiltinImport:off -- the model worker runs outside the Effect runtime.
import * as NodeFSP from "node:fs/promises";

import {
  decodeWavToFloat32,
  joinTranscriptionSegments,
  isSilentAudio,
  segmentAudioFloat32,
} from "@t3tools/shared/audioWav";
import {
  DEFAULT_VOICE_TRANSCRIPTION_LOCALE,
  DEFAULT_VOICE_TRANSCRIPTION_MODEL,
} from "./voiceTranscriptionProtocol.ts";

type VoiceTranscriptionPipeline = (audio: Float32Array) => Promise<unknown>;

let cachedPipeline: VoiceTranscriptionPipeline | null = null;
let cachedModelName: string | null = null;

/** Runs in its own process so model downloads and ONNX inference never stall the server. */
async function runVoiceTranscriptionWorker(input: {
  readonly audioPath: string;
  readonly cacheDir: string;
  readonly modelName?: string | undefined;
  readonly locale?: string | undefined;
}): Promise<{ readonly text: string; readonly locale: string }> {
  const modelName = input.modelName?.trim() || DEFAULT_VOICE_TRANSCRIPTION_MODEL;
  const locale = input.locale?.trim() || DEFAULT_VOICE_TRANSCRIPTION_LOCALE;
  const audio = decodeWavToFloat32(await NodeFSP.readFile(input.audioPath));
  if (audio.length === 0) return { text: "", locale };

  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = input.cacheDir;
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  if (cachedPipeline === null || cachedModelName !== modelName) {
    cachedPipeline = (await pipeline("automatic-speech-recognition", modelName, {
      dtype: "q4",
      device: "cpu",
    })) as unknown as VoiceTranscriptionPipeline;
    cachedModelName = modelName;
  }

  const segments = segmentAudioFloat32(audio);
  const segmentTexts: string[] = [];

  for (const segment of segments) {
    if (isSilentAudio(segment)) continue;
    const result = await cachedPipeline(segment);
    const text = transcriptionText(result).trim();
    if (text.length > 0) {
      segmentTexts.push(text);
    }
  }

  return { text: joinTranscriptionSegments(segmentTexts), locale };
}

function transcriptionText(result: unknown): string {
  if (typeof result === "object" && result !== null && "text" in result) {
    return String(result.text);
  }
  const [first] = Array.isArray(result) ? result : [];
  return typeof first === "object" && first !== null && "text" in first ? String(first.text) : "";
}

export async function runVoiceTranscriptionCli(audioPath: string, cacheDir: string): Promise<void> {
  const result = await runVoiceTranscriptionWorker({ audioPath, cacheDir });
  process.stdout.write(JSON.stringify(result));
}
