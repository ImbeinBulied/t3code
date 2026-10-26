import { runVoiceTranscriptionCli } from "./voice/voiceTranscriptionWorker.ts";

const [audioPath, cacheDir] = process.argv.slice(2);
if (!audioPath || !cacheDir) {
  throw new Error("Voice transcription worker requires an audio path and cache directory.");
}
await runVoiceTranscriptionCli(audioPath, cacheDir);
