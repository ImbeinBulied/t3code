# Voice input

Transcription edits a composer draft. It does not submit an agent turn. Audio is
temporary client input, and only normal message submission sends the resulting
text. iPhone transcribes locally with Apple's speech model. Android records locally
and sends the audio to its connected environment, which transcribes it with the
server's speech model.

The [shared controller](../../packages/client-runtime/src/voice-input/controller.ts)
owns the operation while the client supplies capture and transcription. Preparation
binds the transcriber and resolved locale for the whole recording. Draft ownership,
text, and revision are captured before recording and checked before insertion, so
a late transcript cannot overwrite a draft that was edited or replaced.

Cancellation invalidates a result immediately, but resources stay owned until the
underlying work settles. Apple's native transcription call cannot be interrupted
once started. Releasing the session or deleting its recording when the abort signal
fires would race that work. The [transcription contract](../../packages/client-runtime/src/voice-input/transcription.ts)
therefore requires implementations to settle only after their work has stopped;
the [Apple binding](../../apps/mobile/src/native/voiceTranscription.ios.ts) checks
cancellation between native calls and discards late results.

## Environment transcription

A composer can supply its own transcriber, which overrides the client's local one
for that recording. Android uses this to call
`POST /api/orchestration/voice/transcribe` on its environment rather than keeping a
model on the phone.

The [server entry](../../apps/server/src/voice/VoiceTranscription.ts) writes the
upload to a temporary file, converts it to 16 kHz mono PCM with `ffmpeg`, then runs
`onnx-community/moonshine-base-ONNX` in a child process
([worker](../../apps/server/src/voice/voiceTranscriptionWorker.ts)). Keeping the
model out of process matters: the first request downloads the weights and inference
is CPU-heavy, and neither may stall the websocket server. Weight files live under
`~/.cache/t3code/voice` (or `XDG_CACHE_HOME`), so they survive server updates.
`ffmpeg` is a runtime requirement with no bundled fallback.
