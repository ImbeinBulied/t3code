import * as Effect from "effect/Effect";
import { Argument, Command } from "effect/cli";

import { runVoiceTranscriptionCli } from "../voice/voiceTranscriptionWorker.ts";

/** Single-executable builds lack Node, so they use this subcommand instead of the worker file. */
export const voiceTranscriptionCommand = Command.make("__voice-transcribe", {
  audioPath: Argument.String("audio-path"),
  cacheDir: Argument.String("cache-dir"),
}).pipe(
  Command.unlisted,
  Command.withHandler(({ audioPath, cacheDir }) =>
    Effect.promise(() => runVoiceTranscriptionCli(audioPath, cacheDir)),
  ),
);
