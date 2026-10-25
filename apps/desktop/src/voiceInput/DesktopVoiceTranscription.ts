// @effect-diagnostics nodeBuiltinImport:off -- Owns Node child process for offline speech-to-text.
// @effect-diagnostics globalTimers:off -- Worker lifecycle and timeouts run at child process boundary.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import type {
  DesktopVoiceInputMicrophoneStatus,
  DesktopVoiceTranscriptionCancelInput,
  DesktopVoiceTranscriptionPrepareInput,
  DesktopVoiceTranscriptionPrepareResult,
  DesktopVoiceTranscriptionTranscribeInput,
  DesktopVoiceTranscriptionTranscribeResult,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import type {
  VoiceTranscriptionWorkerRequest,
  VoiceTranscriptionWorkerResponse,
} from "./VoiceTranscriptionWorker.ts";

export type {
  VoiceTranscriptionWorkerRequest,
  VoiceTranscriptionWorkerResponse,
} from "./VoiceTranscriptionWorker.ts";

export class VoiceTranscriptionError extends Schema.TaggedError<VoiceTranscriptionError>()(
  "VoiceTranscriptionError",
  {
    message: Schema.String,
  },
) {}

const isVoiceTranscriptionError = Schema.is(VoiceTranscriptionError);

export type VoiceTranscriptionChild = {
  readonly send: (request: VoiceTranscriptionWorkerRequest) => void;
  readonly onMessage: (listener: (message: unknown) => void) => void;
  readonly onExit: (listener: () => void) => void;
  readonly kill: () => void;
};

export function forkVoiceTranscriptionChild(workerPath: string): VoiceTranscriptionChild {
  const child = NodeChildProcess.fork(workerPath, [], {
    execPath: process.execPath,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    execArgv: [],
    serialization: "advanced",
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
  return {
    send: (request) => child.send(request),
    onMessage: (listener) => child.on("message", listener),
    onExit: (listener) => {
      child.once("exit", listener);
      child.once("error", listener);
    },
    kill: () => child.kill(),
  };
}

export function defaultVoiceTranscriptionCacheDir(): string {
  try {
    const userData = Electron.app.getPath("userData");
    return NodePath.join(userData, "models", "voice-transcription");
  } catch {
    return NodePath.join(process.cwd(), ".cache", "voice-transcription");
  }
}

export function defaultVoiceTranscriptionWorkerPath(): string {
  return NodePath.join(__dirname, "voiceInput", "VoiceTranscriptionWorker.cjs");
}

export class DesktopVoiceTranscription extends Context.Service<
  DesktopVoiceTranscription,
  {
    readonly getMicrophoneStatus: () => Effect.Effect<DesktopVoiceInputMicrophoneStatus>;
    readonly requestMicrophoneAccess: () => Effect.Effect<boolean>;
    readonly prepare: (
      input: DesktopVoiceTranscriptionPrepareInput,
    ) => Effect.Effect<DesktopVoiceTranscriptionPrepareResult, VoiceTranscriptionError>;
    readonly transcribe: (
      input: DesktopVoiceTranscriptionTranscribeInput,
    ) => Effect.Effect<DesktopVoiceTranscriptionTranscribeResult, VoiceTranscriptionError>;
    readonly cancel: (input: DesktopVoiceTranscriptionCancelInput) => Effect.Effect<void>;
  }
>()("@t3tools/desktop/voiceInput/DesktopVoiceTranscription") {}

export interface VoiceTranscriptionManagerOptions {
  readonly workerPath?: string;
  readonly cacheDir?: string;
  readonly fork?: (workerPath: string) => VoiceTranscriptionChild;
}

export function makeVoiceTranscriptionManager(options: VoiceTranscriptionManagerOptions = {}) {
  const workerPath = options.workerPath ?? defaultVoiceTranscriptionWorkerPath();
  const resolveCacheDir = () => options.cacheDir ?? defaultVoiceTranscriptionCacheDir();
  const fork = options.fork ?? forkVoiceTranscriptionChild;

  let activeChild: VoiceTranscriptionChild | null = null;
  let activeRequestId: string | null = null;
  let activeResolve: ((value: any) => void) | null = null;
  let activeReject: ((error: Error) => void) | null = null;

  const ensureChild = (): VoiceTranscriptionChild => {
    if (activeChild) return activeChild;

    const child = fork(workerPath);
    activeChild = child;

    child.onMessage((rawMessage: unknown) => {
      if (typeof rawMessage !== "object" || rawMessage === null) return;
      const message = rawMessage as VoiceTranscriptionWorkerResponse;

      if (message.type === "prepare_result") {
        if (message.requestId === activeRequestId) {
          const resolve = activeResolve;
          const reject = activeReject;
          activeRequestId = null;
          activeResolve = null;
          activeReject = null;

          if (message.success) {
            resolve?.({
              modelName: message.modelName,
              locale: message.locale,
            } satisfies DesktopVoiceTranscriptionPrepareResult);
          } else {
            reject?.(
              new VoiceTranscriptionError({
                message: message.error ?? "Failed to prepare voice transcription model.",
              }),
            );
          }
        }
      } else if (message.type === "transcribe_result") {
        if (message.requestId === activeRequestId) {
          const resolve = activeResolve;
          const reject = activeReject;
          activeRequestId = null;
          activeResolve = null;
          activeReject = null;

          if (message.success && message.text !== undefined) {
            resolve?.({
              text: message.text,
            } satisfies DesktopVoiceTranscriptionTranscribeResult);
          } else {
            reject?.(
              new VoiceTranscriptionError({
                message: message.error ?? "Failed to transcribe audio.",
              }),
            );
          }
        }
      }
    });

    child.onExit(() => {
      if (activeChild === child) {
        activeChild = null;
        if (activeRequestId && activeReject) {
          const reject = activeReject;
          activeRequestId = null;
          activeResolve = null;
          activeReject = null;
          reject(
            new VoiceTranscriptionError({
              message: "Voice transcription worker terminated unexpectedly.",
            }),
          );
        }
      }
    });

    return child;
  };

  const cancelRequest = (requestId: string): void => {
    if (activeRequestId === requestId) {
      if (activeChild) {
        try {
          activeChild.send({ type: "cancel", requestId });
        } catch {
          // Process might already be dead
        }
        try {
          activeChild.kill();
        } catch {
          // Process already dead
        }
        activeChild = null;
      }
      if (activeReject) {
        const reject = activeReject;
        activeRequestId = null;
        activeResolve = null;
        activeReject = null;
        reject(new VoiceTranscriptionError({ message: "Voice transcription was cancelled." }));
      }
    }
  };

  const close = (): void => {
    if (activeChild) {
      try {
        activeChild.kill();
      } catch {
        // Child process already closed
      }
      activeChild = null;
    }
    if (activeReject) {
      const reject = activeReject;
      activeRequestId = null;
      activeResolve = null;
      activeReject = null;
      reject(new VoiceTranscriptionError({ message: "Voice transcription closed." }));
    }
  };

  const getMicrophoneStatus = Effect.fn("DesktopVoiceTranscription.getMicrophoneStatus")(
    function* () {
      const platform = yield* HostProcess.Platform;
      if (platform === "darwin") {
        try {
          const status = Electron.systemPreferences.getMediaAccessStatus("microphone");
          if (
            status === "not-determined" ||
            status === "granted" ||
            status === "denied" ||
            status === "restricted"
          ) {
            return status;
          }
          return "unknown";
        } catch {
          return "unknown";
        }
      }
      return "granted";
    },
  );

  const requestMicrophoneAccess = Effect.fn("DesktopVoiceTranscription.requestMicrophoneAccess")(
    function* () {
      const platform = yield* HostProcess.Platform;
      if (platform === "darwin") {
        try {
          return yield* Effect.promise(() =>
            Electron.systemPreferences.askForMediaAccess("microphone"),
          );
        } catch {
          return false;
        }
      }
      return true;
    },
  );

  const prepare = (
    input: DesktopVoiceTranscriptionPrepareInput,
  ): Effect.Effect<DesktopVoiceTranscriptionPrepareResult, VoiceTranscriptionError> =>
    Effect.tryPromise({
      try: () =>
        new Promise<DesktopVoiceTranscriptionPrepareResult>((resolve, reject) => {
          if (activeRequestId) {
            cancelRequest(activeRequestId);
          }

          const child = ensureChild();
          activeRequestId = input.requestId;
          activeResolve = resolve;
          activeReject = reject;

          try {
            child.send({
              type: "prepare",
              requestId: input.requestId,
              cacheDir: resolveCacheDir(),
            });
          } catch (err: any) {
            cancelRequest(input.requestId);
            reject(
              new VoiceTranscriptionError({
                message:
                  err instanceof Error ? err.message : "Failed to send prepare request to worker.",
              }),
            );
          }
        }),
      catch: (cause) =>
        isVoiceTranscriptionError(cause)
          ? cause
          : new VoiceTranscriptionError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
    });

  const transcribe = (
    input: DesktopVoiceTranscriptionTranscribeInput,
  ): Effect.Effect<DesktopVoiceTranscriptionTranscribeResult, VoiceTranscriptionError> =>
    Effect.tryPromise({
      try: () =>
        new Promise<DesktopVoiceTranscriptionTranscribeResult>((resolve, reject) => {
          if (activeRequestId) {
            cancelRequest(activeRequestId);
          }

          const child = ensureChild();
          activeRequestId = input.requestId;
          activeResolve = resolve;
          activeReject = reject;

          try {
            child.send({
              type: "transcribe",
              requestId: input.requestId,
              audioData: input.audioData,
              ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
            });
          } catch (err: any) {
            cancelRequest(input.requestId);
            reject(
              new VoiceTranscriptionError({
                message:
                  err instanceof Error
                    ? err.message
                    : "Failed to send transcribe request to worker.",
              }),
            );
          }
        }),
      catch: (cause) =>
        isVoiceTranscriptionError(cause)
          ? cause
          : new VoiceTranscriptionError({
              message: cause instanceof Error ? cause.message : String(cause),
            }),
    });

  const cancel = (input: DesktopVoiceTranscriptionCancelInput): Effect.Effect<void> =>
    Effect.sync(() => {
      cancelRequest(input.requestId);
    });

  return {
    getMicrophoneStatus,
    requestMicrophoneAccess,
    prepare,
    transcribe,
    cancel,
    close,
  };
}

export const make = Effect.gen(function* () {
  const manager = makeVoiceTranscriptionManager();
  yield* Effect.addFinalizer(() => Effect.sync(() => manager.close()));

  return {
    getMicrophoneStatus: manager.getMicrophoneStatus,
    requestMicrophoneAccess: manager.requestMicrophoneAccess,
    prepare: manager.prepare,
    transcribe: manager.transcribe,
    cancel: manager.cancel,
  };
});

export const layer = Layer.effect(DesktopVoiceTranscription, make);
