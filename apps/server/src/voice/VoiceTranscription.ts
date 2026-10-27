// @effect-diagnostics nodeBuiltinImport:off -- ffmpeg and the model worker are child processes.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

import { VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES, VoiceTranscribeError } from "@t3tools/contracts";

import { parseVoiceTranscriptionWorkerOutput } from "./voiceTranscriptionProtocol.ts";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);

const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  "audio/3gpp": "3gp",
  "audio/aac": "aac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "audio/wav": "wav",
  "audio/x-m4a": "m4a",
  "audio/x-wav": "wav",
};

const MAX_TRANSCRIPTION_MILLIS = 15 * 60_000;

export function voiceTranscriptionWorkerPath(moduleUrl: string): string {
  return NodeURL.fileURLToPath(
    new URL(
      moduleUrl.endsWith(".ts")
        ? "../voice-transcription-worker.ts"
        : "./voice-transcription-worker.mjs",
      moduleUrl,
    ),
  );
}

/** Model weights outlive a server update, so they live in the user's cache directory. */
export function voiceTranscriptionCacheDir(): string {
  return (
    process.env.T3CODE_VOICE_TRANSCRIPTION_CACHE_DIR?.trim() ||
    NodePath.join(
      process.env.XDG_CACHE_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".cache"),
      "t3code",
      "voice",
    )
  );
}

/** Converts the recording to the model's PCM input, then transcribes it in a child process. */
export async function transcribeVoice(input: {
  readonly audioBase64: string;
  readonly mimeType: string;
  readonly cacheDir: string;
}): Promise<{ readonly text: string; readonly locale: string }> {
  const audio = Buffer.from(input.audioBase64, "base64");
  if (audio.byteLength === 0) {
    throw new VoiceTranscribeError({ message: "The recording was empty." });
  }
  if (audio.byteLength > VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES) {
    throw new VoiceTranscribeError({ message: "The recording is too long to transcribe." });
  }
  const extension = AUDIO_EXTENSIONS[input.mimeType];
  if (extension === undefined) {
    throw new VoiceTranscribeError({
      message: `Unsupported recording format: ${input.mimeType}`,
    });
  }

  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-voice-"));
  try {
    const sourcePath = NodePath.join(directory, `recording.${extension}`);
    const wavPath = NodePath.join(directory, "recording.wav");
    await NodeFSP.writeFile(sourcePath, audio);
    await convertToWav(sourcePath, wavPath);
    return await runModelWorker(wavPath, input.cacheDir);
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function convertToWav(sourcePath: string, wavPath: string): Promise<void> {
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        sourcePath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-f",
        "wav",
        wavPath,
      ],
      { timeout: 30_000 },
    );
  } catch (error) {
    const reason =
      typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
        ? "Voice transcription needs ffmpeg installed on the server."
        : error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "The recording could not be converted.";
    throw new VoiceTranscribeError({ message: reason });
  }
}

async function runModelWorker(
  wavPath: string,
  cacheDir: string,
): Promise<{ readonly text: string; readonly locale: string }> {
  const fromSource = import.meta.url.endsWith(".ts");
  const workerPath = voiceTranscriptionWorkerPath(import.meta.url);
  const executablePath = process.execPath;
  const workerArguments = NodeFS.existsSync(workerPath)
    ? [...(fromSource ? ["--experimental-strip-types"] : []), workerPath, wavPath, cacheDir]
    : ["__voice-transcribe", wavPath, cacheDir];

  try {
    const { stdout } = await execFileAsync(executablePath, workerArguments, {
      timeout: MAX_TRANSCRIPTION_MILLIS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    return parseVoiceTranscriptionWorkerOutput(stdout);
  } catch (error) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new VoiceTranscribeError({
      message: stderr || "The transcription model failed.",
    });
  }
}
