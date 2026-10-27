import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import {
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerSettings as ServerSettingsType,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import * as ThreadPromptPolishService from "./ThreadPromptPolishService.ts";

const projectId = ProjectId.make("project:polish-test");
const threadId = ThreadId.make("thread:polish-test");
const codexModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.1-codex",
} as const;

function createTestLayers(options: {
  readonly settings?: Partial<ServerSettingsType>;
  readonly providerInstance?: any;
  readonly threadRecords?: {
    thread?: { projectId: ProjectId; worktreePath: string | null };
    messages?: Array<{
      id: MessageId;
      role: "user" | "assistant" | "system";
      text: string;
      streaming?: boolean;
    }>;
  };
  readonly generatePromptPolish?: TextGeneration.TextGeneration["Service"]["generatePromptPolish"];
}) {
  const layerSettings = Layer.mock(ServerSettings.ServerSettingsService)({
    getSettings: Effect.succeed({
      promptPolishModelSelection: codexModelSelection,
      ...options.settings,
    } as any),
  });

  const layerRegistry = Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
    getInstance: (id) =>
      Effect.succeed(
        options.providerInstance !== undefined
          ? options.providerInstance
          : ({
              instanceId: id,
              enabled: true,
              driverKind: "codex",
              snapshot: {
                getSnapshot: Effect.succeed({
                  instanceId: id,
                  enabled: true,
                  availability: "available",
                  driver: "codex",
                  auth: { status: "authenticated", type: "chatgpt" },
                  models: [{ slug: "gpt-5.1-codex", name: "GPT-5.1 Codex" }],
                }),
              },
            } as any),
      ),
  });

  const layerThreads = Layer.mock(ThreadManagementService.ThreadManagementService)({
    getThreadSnapshotWindow: () =>
      Effect.succeed({
        projection: {
          thread: {
            id: threadId,
            projectId,
            worktreePath: "/some/repo/worktree",
            ...options.threadRecords?.thread,
          },
          messages: options.threadRecords?.messages ?? [],
        },
        snapshotSequence: 1,
      } as any),
  });

  const layerTextGen = Layer.mock(TextGeneration.TextGeneration)({
    generatePromptPolish:
      options.generatePromptPolish ??
      (() =>
        Effect.succeed({
          polished: "Polished prompt text",
        })),
  });

  const layerFs = Layer.succeed(FileSystem.FileSystem, {
    makeTempDirectoryScoped: () => Effect.succeed("/tmp/t3-polish-prompt-isolated"),
  } as any);

  return ThreadPromptPolishService.layer.pipe(
    Layer.provide(layerThreads),
    Layer.provide(layerSettings),
    Layer.provide(layerTextGen),
    Layer.provide(layerRegistry),
    Layer.provide(layerFs),
    Layer.provide(NodeCrypto.layer),
  );
}

describe("ThreadPromptPolishService", () => {
  it.effect("returns unmodified draft when input draft is empty or whitespace", () =>
    Effect.gen(function* () {
      const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      const res1 = yield* polishService.polish({ threadId, draft: "" });
      assert.strictEqual(res1.polished, "");

      const res2 = yield* polishService.polish({ threadId, draft: "   \n  " });
      assert.strictEqual(res2.polished, "   \n  ");
    }).pipe(
      Effect.provide(
        createTestLayers({
          settings: { promptPolishModelSelection: null },
        }),
      ),
    ),
  );

  it.effect("fails safely without fallback when promptPolishModelSelection is not configured", () =>
    Effect.gen(function* () {
      const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      const result = yield* polishService
        .polish({ threadId, draft: "fix this bug" })
        .pipe(Effect.flip);
      assert.strictEqual(result._tag, "TextGenerationError");
      assert.include(result.detail, "No preferred model configured for prompt polish in Settings");
    }).pipe(
      Effect.provide(
        createTestLayers({
          settings: { promptPolishModelSelection: null },
        }),
      ),
    ),
  );

  it.effect("fails safely when provider is disabled or unavailable", () =>
    Effect.gen(function* () {
      const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      const result = yield* polishService
        .polish({ threadId, draft: "fix this bug" })
        .pipe(Effect.flip);
      assert.strictEqual(result._tag, "TextGenerationError");
      assert.include(result.detail, "is disabled or unavailable. No fallback is configured.");
    }).pipe(
      Effect.provide(
        createTestLayers({
          providerInstance: {
            enabled: false,
            snapshot: {
              getSnapshot: Effect.succeed({
                enabled: false,
                availability: "available",
                driver: "codex",
                auth: { status: "authenticated", type: "chatgpt" },
                models: [],
              }),
            },
          },
        }),
      ),
    ),
  );

  it.effect("fails safely when Codex auth is not ChatGPT subscription", () =>
    Effect.gen(function* () {
      const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      const result = yield* polishService
        .polish({ threadId, draft: "fix this bug" })
        .pipe(Effect.flip);
      assert.strictEqual(result._tag, "TextGenerationError");
      assert.include(result.detail, "requires an authenticated ChatGPT subscription");
    }).pipe(
      Effect.provide(
        createTestLayers({
          providerInstance: {
            enabled: true,
            snapshot: {
              getSnapshot: Effect.succeed({
                enabled: true,
                availability: "available",
                driver: "codex",
                auth: { status: "authenticated", type: "api_key" },
                models: [],
              }),
            },
          },
        }),
      ),
    ),
  );

  it.effect("fails safely when OpenCode model is not OpenCode Go subscription path", () =>
    Effect.gen(function* () {
      const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      const result = yield* polishService
        .polish({ threadId, draft: "fix this bug" })
        .pipe(Effect.flip);
      assert.strictEqual(result._tag, "TextGenerationError");
      assert.include(result.detail, "requires an OpenCode Go subscription model path");
    }).pipe(
      Effect.provide(
        createTestLayers({
          settings: {
            promptPolishModelSelection: {
              instanceId: ProviderInstanceId.make("opencode"),
              model: "anthropic/claude-3.5-sonnet",
            },
          },
          providerInstance: {
            enabled: true,
            snapshot: {
              getSnapshot: Effect.succeed({
                enabled: true,
                availability: "available",
                driver: "opencode",
                auth: { status: "authenticated" },
                models: [{ slug: "anthropic/claude-3.5-sonnet", name: "Claude" }],
              }),
            },
          },
        }),
      ),
    ),
  );

  it.effect("polishes new thread draft without threadId and without history", () => {
    let capturedInput: any;

    return Effect.gen(function* () {
      const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      const res = yield* polishService.polish({
        draft: "implement voice polish",
      });

      assert.strictEqual(res.polished, "Polished prompt text");
      assert.isDefined(capturedInput);
      assert.isUndefined(capturedInput.threadContext);
      assert.strictEqual(capturedInput.cwd, "/tmp/t3-polish-prompt-isolated");
      assert.strictEqual(capturedInput.draft, "implement voice polish");
    }).pipe(
      Effect.provide(
        createTestLayers({
          generatePromptPolish: (input) => {
            capturedInput = input;
            return Effect.succeed({ polished: "Polished prompt text" });
          },
        }),
      ),
    );
  });

  it.effect(
    "budgets newest messages backwards within 8,000 chars, preserving roles and isolated cwd",
    () => {
      const messages = [
        { id: MessageId.make("m1"), role: "user" as const, text: "msg 1 older" },
        { id: MessageId.make("m2"), role: "assistant" as const, text: "msg 2 older" },
        { id: MessageId.make("m3"), role: "user" as const, text: "msg 3" },
        { id: MessageId.make("m4"), role: "assistant" as const, text: "msg 4" },
        { id: MessageId.make("m5"), role: "user" as const, text: "msg 5" },
        { id: MessageId.make("m6"), role: "assistant" as const, text: "msg 6" },
        { id: MessageId.make("m7"), role: "user" as const, text: "msg 7" },
        {
          id: MessageId.make("m8"),
          role: "assistant" as const,
          text: "msg 8 streaming",
          streaming: true,
        },
        { id: MessageId.make("m9"), role: "assistant" as const, text: "msg 9 newest" },
      ];

      let capturedInput: any;

      return Effect.gen(function* () {
        const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
        const res = yield* polishService.polish({
          threadId,
          draft: "fix npe in auth",
        });

        assert.strictEqual(res.polished, "Can you fix the null pointer exception in auth service?");
        assert.isDefined(capturedInput);
        assert.strictEqual(capturedInput.draft, "fix npe in auth");
        // Must use isolated temporary directory, not repo worktree path
        assert.strictEqual(capturedInput.cwd, "/tmp/t3-polish-prompt-isolated");
        // Streaming message is filtered out; newest 6 non-streaming messages kept (m3, m4, m5, m6, m7, m9)
        assert.isDefined(capturedInput.threadContext);
        assert.notInclude(capturedInput.threadContext, "msg 1");
        assert.notInclude(capturedInput.threadContext, "msg 2");
        assert.notInclude(capturedInput.threadContext, "msg 8 streaming");
        assert.include(capturedInput.threadContext, "USER: msg 3");
        assert.include(capturedInput.threadContext, "ASSISTANT: msg 9 newest");
      }).pipe(
        Effect.provide(
          createTestLayers({
            threadRecords: { messages },
            generatePromptPolish: (input) => {
              capturedInput = input;
              return Effect.succeed({
                polished: "Can you fix the null pointer exception in auth service?",
              });
            },
          }),
        ),
      );
    },
  );

  it.effect("keeps the newest context when a single message exceeds the budget", () =>
    Effect.gen(function* () {
      const service = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      yield* service.polish({ threadId, draft: "fix this" });
    }).pipe(
      Effect.provide(
        createTestLayers({
          threadRecords: {
            messages: [
              {
                id: MessageId.make("large"),
                role: "user",
                text: "x".repeat(9000) + "latest instruction",
              },
            ],
          },
          generatePromptPolish: (input) => {
            assert.isAtMost(input.threadContext?.length ?? 0, 8000);
            assert.include(input.threadContext, "latest instruction");
            return Effect.succeed({ polished: "Fix this." });
          },
        }),
      ),
    ),
  );

  it.effect("preserves inline composer references via masking and rehydration", () => {
    let capturedInput: any;

    return Effect.gen(function* () {
      const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      const res = yield* polishService.polish({
        draft:
          "Please inspect __T3_REF_0__ [my$&file.ts](t3-context://v1/file/ctx_1) and update [auth.ts](t3-context://v1/file/ctx_2) for me.",
      });

      assert.isDefined(capturedInput);
      // Model received masked tokens
      assert.match(capturedInput.draft, /__T3_REF_[a-f0-9]+_0__/);
      assert.match(capturedInput.draft, /__T3_REF_[a-f0-9]+_1__/);
      assert.notInclude(capturedInput.draft, "t3-context://v1/file/ctx_1");

      // Output was rehydrated with original context links
      assert.strictEqual(
        res.polished,
        "Please review [my$&file.ts](t3-context://v1/file/ctx_1) and revise [auth.ts](t3-context://v1/file/ctx_2).",
      );
    }).pipe(
      Effect.provide(
        createTestLayers({
          generatePromptPolish: (input) => {
            capturedInput = input;
            // Model rearranges text around the preserved mask tokens
            return Effect.succeed({
              polished: `Please review ${input.draft.match(/__T3_REF_[a-f0-9]+_0__/)![0]} and revise ${input.draft.match(/__T3_REF_[a-f0-9]+_1__/)![0]}.`,
            });
          },
        }),
      ),
    );
  });

  it.effect("fails safely when model drops or alters inline composer reference tokens", () =>
    Effect.gen(function* () {
      const polishService = yield* ThreadPromptPolishService.ThreadPromptPolishService;
      const result = yield* polishService
        .polish({
          draft: "Check [main.ts](t3-context://v1/file/ctx_1)",
        })
        .pipe(Effect.flip);

      assert.strictEqual(result._tag, "TextGenerationError");
      assert.include(result.detail, "failed to preserve");
    }).pipe(
      Effect.provide(
        createTestLayers({
          generatePromptPolish: () => {
            // Model hallucinated and omitted the reference token
            return Effect.succeed({
              polished: "Check main.ts directly without token.",
            });
          },
        }),
      ),
    ),
  );
});
