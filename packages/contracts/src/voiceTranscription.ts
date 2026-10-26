import * as Schema from "effect/Schema";

export const VOICE_TRANSCRIPTION_MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export const VoiceTranscribeRequest = Schema.Struct({
  /** Base64-encoded recording; the server converts it to the model's PCM input. */
  audioBase64: Schema.String,
  mimeType: Schema.String,
});
export type VoiceTranscribeRequest = typeof VoiceTranscribeRequest.Type;

export const VoiceTranscribeResult = Schema.Struct({
  text: Schema.String,
  locale: Schema.String,
});
export type VoiceTranscribeResult = typeof VoiceTranscribeResult.Type;

export class VoiceTranscribeError extends Schema.TaggedError<VoiceTranscribeError>()(
  "VoiceTranscribeError",
  {
    message: Schema.String,
  },
) {}
