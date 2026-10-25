import { beforeEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";

import type {
  VoiceTranscriptionChild,
  VoiceTranscriptionWorkerResponse,
} from "./DesktopVoiceTranscription.ts";
import { makeVoiceTranscriptionManager } from "./DesktopVoiceTranscription.ts";

function fakeChild() {
  const messageListeners: Array<(message: unknown) => void> = [];
  const exitListeners: Array<() => void> = [];
  const send = vi.fn();
  const kill = vi.fn();
  const child: VoiceTranscriptionChild = {
    send,
    onMessage: (listener) => messageListeners.push(listener),
    onExit: (listener) => exitListeners.push(listener),
    kill,
  };
  return {
    child,
    send,
    kill,
    emit: (message: VoiceTranscriptionWorkerResponse) => {
      for (const listener of messageListeners) listener(message);
    },
    exit: () => {
      for (const listener of exitListeners) listener();
    },
  };
}

describe("DesktopVoiceTranscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.effect("handles prepare successfully", () =>
    Effect.gen(function* () {
      const fake = fakeChild();
      const manager = makeVoiceTranscriptionManager({
        fork: () => fake.child,
        cacheDir: "/test/cache",
      });

      const fiber = yield* manager
        .prepare({ requestId: "req-1" })
        .pipe(Effect.forkChild({ startImmediately: true }));

      expect(fake.send).toHaveBeenCalledWith({
        type: "prepare",
        requestId: "req-1",
        cacheDir: "/test/cache",
      });

      fake.emit({
        type: "prepare_result",
        requestId: "req-1",
        success: true,
        modelName: "test-model",
        locale: "en",
      });

      const result = yield* Fiber.join(fiber);
      expect(result).toEqual({
        modelName: "test-model",
        locale: "en",
      });
    }),
  );

  it.effect("handles prepare failure", () =>
    Effect.gen(function* () {
      const fake = fakeChild();
      const manager = makeVoiceTranscriptionManager({
        fork: () => fake.child,
        cacheDir: "/test/cache",
      });

      const fiber = yield* manager
        .prepare({ requestId: "req-2" })
        .pipe(Effect.forkChild({ startImmediately: true }));

      fake.emit({
        type: "prepare_result",
        requestId: "req-2",
        success: false,
        modelName: "test-model",
        locale: "en",
        error: "Download failed",
      });

      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("handles transcribe successfully", () =>
    Effect.gen(function* () {
      const fake = fakeChild();
      const manager = makeVoiceTranscriptionManager({
        fork: () => fake.child,
      });

      const audioData = new Uint8Array([1, 2, 3, 4]);
      const fiber = yield* manager
        .transcribe({
          requestId: "req-3",
          audioData,
          mimeType: "audio/wav",
        })
        .pipe(Effect.forkChild({ startImmediately: true }));

      expect(fake.send).toHaveBeenCalledWith({
        type: "transcribe",
        requestId: "req-3",
        audioData,
        mimeType: "audio/wav",
      });

      fake.emit({
        type: "transcribe_result",
        requestId: "req-3",
        success: true,
        text: "hello world",
      });

      const result = yield* Fiber.join(fiber);
      expect(result).toEqual({ text: "hello world" });
    }),
  );

  it.effect("supports cooperative cancellation during transcription", () =>
    Effect.gen(function* () {
      const fake = fakeChild();
      const manager = makeVoiceTranscriptionManager({
        fork: () => fake.child,
      });

      const fiber = yield* manager
        .transcribe({
          requestId: "req-cancel",
          audioData: new Uint8Array([0]),
        })
        .pipe(Effect.forkChild({ startImmediately: true }));

      // Cancel while active
      yield* manager.cancel({ requestId: "req-cancel" });

      expect(fake.send).toHaveBeenCalledWith({
        type: "cancel",
        requestId: "req-cancel",
      });
      expect(fake.kill).toHaveBeenCalled();

      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );

  it.effect("handles unexpected worker process exit", () =>
    Effect.gen(function* () {
      const fake = fakeChild();
      const manager = makeVoiceTranscriptionManager({
        fork: () => fake.child,
      });

      const fiber = yield* manager
        .transcribe({
          requestId: "req-crash",
          audioData: new Uint8Array([0]),
        })
        .pipe(Effect.forkChild({ startImmediately: true }));

      // Worker crashes
      fake.exit();

      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
    }),
  );
});
