import {
  DesktopVoiceInputMicrophoneStatusSchema,
  DesktopVoiceTranscriptionCancelInputSchema,
  DesktopVoiceTranscriptionPrepareInputSchema,
  DesktopVoiceTranscriptionPrepareResultSchema,
  DesktopVoiceTranscriptionTranscribeInputSchema,
  DesktopVoiceTranscriptionTranscribeResultSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopVoiceTranscription from "../../voiceInput/DesktopVoiceTranscription.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const getMicrophoneStatus = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VOICE_INPUT_GET_MICROPHONE_STATUS_CHANNEL,
  payload: Schema.Void,
  result: DesktopVoiceInputMicrophoneStatusSchema,
  handler: Effect.fn("desktop.ipc.voiceInput.getMicrophoneStatus")(function* () {
    const voiceTranscription = yield* DesktopVoiceTranscription.DesktopVoiceTranscription;
    return yield* voiceTranscription.getMicrophoneStatus();
  }),
});

export const requestMicrophoneAccess = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VOICE_INPUT_REQUEST_MICROPHONE_ACCESS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.voiceInput.requestMicrophoneAccess")(function* () {
    const voiceTranscription = yield* DesktopVoiceTranscription.DesktopVoiceTranscription;
    return yield* voiceTranscription.requestMicrophoneAccess();
  }),
});

export const prepare = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VOICE_INPUT_PREPARE_CHANNEL,
  payload: DesktopVoiceTranscriptionPrepareInputSchema,
  result: DesktopVoiceTranscriptionPrepareResultSchema,
  handler: Effect.fn("desktop.ipc.voiceInput.prepare")(function* (input) {
    const voiceTranscription = yield* DesktopVoiceTranscription.DesktopVoiceTranscription;
    return yield* voiceTranscription.prepare(input);
  }),
});

export const transcribe = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VOICE_INPUT_TRANSCRIBE_CHANNEL,
  payload: DesktopVoiceTranscriptionTranscribeInputSchema,
  result: DesktopVoiceTranscriptionTranscribeResultSchema,
  handler: Effect.fn("desktop.ipc.voiceInput.transcribe")(function* (input) {
    const voiceTranscription = yield* DesktopVoiceTranscription.DesktopVoiceTranscription;
    return yield* voiceTranscription.transcribe(input);
  }),
});

export const cancel = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.VOICE_INPUT_CANCEL_CHANNEL,
  payload: DesktopVoiceTranscriptionCancelInputSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.voiceInput.cancel")(function* (input) {
    const voiceTranscription = yield* DesktopVoiceTranscription.DesktopVoiceTranscription;
    yield* voiceTranscription.cancel(input);
  }),
});
