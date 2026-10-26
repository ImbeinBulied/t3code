import type { VoiceTranscribeRequest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as Option from "effect/Option";

import type { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import type { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";

// First use downloads the speech model, so the request outlives a normal API call.
const VOICE_TRANSCRIPTION_TIMEOUT_MS = 15 * 60_000;

export const fetchEnvironmentVoiceTranscription = Effect.fn(
  "clientRuntime.state.fetchEnvironmentVoiceTranscription",
)(function* (input: {
  readonly prepared: PreparedConnection;
  readonly request: VoiceTranscribeRequest;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization?: Option.Option<RemoteEnvironmentAuthorization["Service"]>;
}) {
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    ...input,
    group: "orchestration",
    method: "POST",
    url: (urls) => urls.voiceTranscribe(),
    timeoutMs: VOICE_TRANSCRIPTION_TIMEOUT_MS,
    request: ({ client, headers }) =>
      client.voiceTranscribe({
        headers: withOrchestrationProtocolHeader(headers),
        payload: input.request,
      }),
  });
});
