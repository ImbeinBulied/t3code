import * as Crypto from "effect/Crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import {
  type PolishPromptInput,
  type PolishPromptResult,
  TextGenerationError,
} from "@t3tools/contracts";
import { assistantCitationsToPlainText } from "@t3tools/shared/assistantCitations";
import { collectComposerContextReferences } from "@t3tools/shared/composerContextReferences";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

export class ThreadPromptPolishService extends Context.Service<
  ThreadPromptPolishService,
  {
    readonly polish: (
      input: PolishPromptInput,
    ) => Effect.Effect<PolishPromptResult, TextGenerationError>;
  }
>()("t3/orchestration-v2/ThreadPromptPolishService") {}

const MAX_POLISH_CONTEXT_CHARS = 8_000;
const RECENT_MESSAGE_COUNT = 6;

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const providerRegistry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const fileSystem = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;

  const polish: ThreadPromptPolishService["Service"]["polish"] = Effect.fn(
    "ThreadPromptPolishService.polish",
  )(function* (input) {
    const draft = input.draft.trim();
    if (draft.length === 0) {
      return { polished: input.draft };
    }

    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "generatePromptPolish",
            detail: "Failed to read server settings.",
            cause,
          }),
      ),
    );

    const modelSelection = ServerSettings.resolvePromptPolishModelSelection(settings);
    if (!modelSelection) {
      return yield* new TextGenerationError({
        operation: "generatePromptPolish",
        detail:
          "No preferred model configured for prompt polish in Settings. Please select an authenticated provider model.",
      });
    }

    const providerInstance = yield* providerRegistry.getInstance(modelSelection.instanceId).pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "generatePromptPolish",
            detail: `Failed to inspect provider instance '${modelSelection.instanceId}'.`,
            cause,
          }),
      ),
    );

    if (!providerInstance || !providerInstance.enabled) {
      return yield* new TextGenerationError({
        operation: "generatePromptPolish",
        detail: `Configured prompt polish provider '${modelSelection.instanceId}' is disabled or unavailable. No fallback is configured.`,
      });
    }

    const snapshot = yield* providerInstance.snapshot.getSnapshot.pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "generatePromptPolish",
            detail: `Failed to inspect snapshot for provider instance '${modelSelection.instanceId}'.`,
            cause,
          }),
      ),
    );

    if (snapshot.availability === "unavailable" || !snapshot.enabled) {
      return yield* new TextGenerationError({
        operation: "generatePromptPolish",
        detail: `Configured prompt polish provider '${modelSelection.instanceId}' is disabled or unavailable. No fallback is configured.`,
      });
    }

    if (snapshot.auth.status !== "authenticated") {
      return yield* new TextGenerationError({
        operation: "generatePromptPolish",
        detail: `Configured prompt polish provider '${modelSelection.instanceId}' is not authenticated.`,
      });
    }

    if (snapshot.driver === "codex") {
      if (snapshot.auth.type !== "chatgpt") {
        return yield* new TextGenerationError({
          operation: "generatePromptPolish",
          detail: `Codex prompt polish requires an authenticated ChatGPT subscription (got '${snapshot.auth.type ?? "none"}'). API key authentication is not supported.`,
        });
      }
    } else if (snapshot.driver === "opencode") {
      const selectedModel = snapshot.models.find((m) => m.slug === modelSelection.model);
      const isGo =
        modelSelection.model.startsWith("opencode-go/") ||
        selectedModel?.subProvider === "OpenCode Go" ||
        selectedModel?.slug.startsWith("opencode-go/");
      if (!isGo) {
        return yield* new TextGenerationError({
          operation: "generatePromptPolish",
          detail: `OpenCode prompt polish requires an OpenCode Go subscription model path (got '${modelSelection.model}').`,
        });
      }
    } else {
      return yield* new TextGenerationError({
        operation: "generatePromptPolish",
        detail: `Prompt polish driver '${snapshot.driver}' is not supported. Only verified drivers with tool isolation (codex, opencode) are allowed.`,
      });
    }

    let threadContext: string | undefined = undefined;
    if (input.threadId) {
      const historySnapshot = yield* threads
        .getThreadSnapshotWindow(input.threadId, {
          rowLimit: 30,
          userTurnLimit: RECENT_MESSAGE_COUNT,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: "generatePromptPolish",
                detail: `Failed to read thread records for '${input.threadId}'.`,
                cause,
              }),
          ),
        );

      const recentMessages = historySnapshot.projection.messages
        .filter((msg) => !msg.streaming && (msg.role === "user" || msg.role === "assistant"))
        .slice(-RECENT_MESSAGE_COUNT);

      const budgetParts: string[] = [];
      let totalChars = 0;
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i]!;
        const text = assistantCitationsToPlainText(msg.text).trim();
        if (text.length === 0) continue;
        const entry = `${msg.role.toUpperCase()}: ${text}`;
        const additionalChars = budgetParts.length === 0 ? entry.length : entry.length + 2;
        if (totalChars + additionalChars > MAX_POLISH_CONTEXT_CHARS) {
          const prefix = `${msg.role.toUpperCase()}: [earlier text omitted] `;
          const remaining =
            MAX_POLISH_CONTEXT_CHARS -
            totalChars -
            (budgetParts.length > 0 ? 2 : 0) -
            prefix.length;
          if (remaining > 0) budgetParts.unshift(prefix + text.slice(-remaining));
          break;
        }
        budgetParts.unshift(entry);
        totalChars += additionalChars;
      }

      if (budgetParts.length > 0) {
        threadContext = budgetParts.join("\n\n");
      }
    }

    const occurrences = collectComposerContextReferences(input.draft);
    const nonce = yield* crypto.randomUUIDv4().pipe(
      Effect.mapError(
        (cause) =>
          new TextGenerationError({
            operation: "generatePromptPolish",
            detail: "Failed to prepare composer references.",
            cause,
          }),
      ),
    );
    const markerPrefix = `__T3_REF_${nonce.replaceAll("-", "")}_`;
    let promptDraft = input.draft;
    if (occurrences.length > 0) {
      let masked = "";
      let cursor = 0;
      for (let i = 0; i < occurrences.length; i++) {
        const occ = occurrences[i]!;
        masked += input.draft.slice(cursor, occ.start) + `${markerPrefix}${i}__`;
        cursor = occ.end;
      }
      masked += input.draft.slice(cursor);
      promptDraft = masked;
    }

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-polish-prompt-" }).pipe(
          Effect.mapError(
            (cause) =>
              new TextGenerationError({
                operation: "generatePromptPolish",
                detail: "Failed to allocate temporary working directory for prompt polish.",
                cause,
              }),
          ),
        );

        const result = yield* textGeneration.generatePromptPolish({
          cwd,
          draft: promptDraft,
          threadContext,
          modelSelection,
        });

        let finalPolished = result.polished;
        if (occurrences.length > 0) {
          const markers = result.polished.match(new RegExp(`${markerPrefix}\\d+__`, "g")) ?? [];
          if (markers.length !== occurrences.length) {
            return yield* new TextGenerationError({
              operation: "generatePromptPolish",
              detail: "Prompt polish failed to preserve all composer reference tokens.",
            });
          }

          for (let i = 0; i < occurrences.length; i++) {
            const marker = `${markerPrefix}${i}__`;
            const count = (result.polished.match(new RegExp(marker, "g")) ?? []).length;
            if (count !== 1) {
              return yield* new TextGenerationError({
                operation: "generatePromptPolish",
                detail: `Prompt polish altered or duplicated composer reference token '${marker}'.`,
              });
            }
            finalPolished = finalPolished.replace(marker, () => occurrences[i]!.source);
          }

          const rehydratedOccurrences = collectComposerContextReferences(finalPolished);
          if (rehydratedOccurrences.length !== occurrences.length) {
            return yield* new TextGenerationError({
              operation: "generatePromptPolish",
              detail: "Prompt polish failed to rehydrate composer reference tokens correctly.",
            });
          }
        }

        return {
          polished: finalPolished,
        };
      }),
    );
  });

  return { polish } satisfies ThreadPromptPolishService["Service"];
});

export const layer = Layer.effect(ThreadPromptPolishService, make);
