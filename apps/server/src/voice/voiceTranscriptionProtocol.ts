import * as Schema from "effect/Schema";

export const DEFAULT_VOICE_TRANSCRIPTION_MODEL = "onnx-community/moonshine-base-ONNX";
export const DEFAULT_VOICE_TRANSCRIPTION_LOCALE = "en";

export const VoiceTranscriptionWorkerResult = Schema.Struct({
  text: Schema.String,
  locale: Schema.String,
});

const decodeVoiceTranscriptionWorkerResult = Schema.decodeSync(
  Schema.fromJsonString(VoiceTranscriptionWorkerResult),
);

export function parseVoiceTranscriptionWorkerOutput(stdout: string) {
  return decodeVoiceTranscriptionWorkerResult(stdout);
}
