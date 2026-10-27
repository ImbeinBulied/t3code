import { describe, expect, it, vi } from "vite-plus/test";

import { PromptPolishController, type PromptPolishDraftSnapshot } from "./controller.ts";
import { createPromptPolishTarget, PromptPolishSession } from "./session.ts";

describe("PromptPolishController", () => {
  it("transitions through polishing to preview, applies polish, and enables restore", async () => {
    let currentText = "fix the bug in authetication";
    let committedText: string | null = null;
    const states: string[] = [];

    const controller = new PromptPolishController({
      polishPrompt: vi.fn().mockResolvedValue({ polished: "Fix the bug in authentication." }),
      readDraft: () => ({
        ownerKey: "thread-1",
        text: currentText,
        revision: 1,
      }),
      commitDraft: (text) => {
        committedText = text;
        currentText = text;
      },
      onStateChange: (state) => states.push(state.phase),
    });

    expect(controller.currentState.phase).toBe("idle");

    const polishPromise = controller.start();
    expect(controller.currentState.phase).toBe("polishing");

    await polishPromise;
    expect(controller.currentState.phase).toBe("preview");
    expect(controller.currentState.polishedText).toBe("Fix the bug in authentication.");

    // Apply preview
    controller.apply();
    expect(committedText).toBe("Fix the bug in authentication.");
    expect(controller.currentState.phase).toBe("idle");
    expect(controller.currentState.restorableOriginal).toMatchObject({
      ownerKey: "thread-1",
      originalText: "fix the bug in authetication",
      appliedText: "Fix the bug in authentication.",
    });

    // Restore original
    controller.restoreOriginal();
    expect(committedText).toBe("fix the bug in authetication");
    expect(controller.currentState.restorableOriginal).toBeNull();
  });

  it("rechecks snapshot on apply: user editing during preview aborts apply and preserves user edit", async () => {
    let currentDraft: PromptPolishDraftSnapshot = {
      ownerKey: "thread-1",
      text: "original unpolished draft",
      revision: 1,
    };
    let committedText: string | null = null;

    const controller = new PromptPolishController({
      polishPrompt: vi.fn().mockResolvedValue({ polished: "Polished text." }),
      readDraft: () => currentDraft,
      commitDraft: (text) => {
        committedText = text;
        currentDraft = { ...currentDraft, text, revision: currentDraft.revision + 1 };
      },
      onStateChange: () => {},
    });

    await controller.start();
    expect(controller.currentState.phase).toBe("preview");

    // While preview was showing, user typed further edits in the composer
    currentDraft = {
      ownerKey: "thread-1",
      text: "original unpolished draft with additional user edits",
      revision: 2,
    };

    // User or UI invokes apply()
    controller.apply();

    // Verify commitDraft was NOT called, preview was dropped, and text was preserved
    expect(committedText).toBeNull();
    expect(controller.currentState.phase).toBe("idle");
    expect(currentDraft.text).toBe("original unpolished draft with additional user edits");
  });

  it("restoring after user edits: edit after apply invalidates restorable original", async () => {
    let currentDraft: PromptPolishDraftSnapshot = {
      ownerKey: "thread-1",
      text: "initial text",
      revision: 1,
    };
    let committedText: string | null = null;

    const controller = new PromptPolishController({
      polishPrompt: vi.fn().mockResolvedValue({ polished: "Polished initial text." }),
      readDraft: () => currentDraft,
      commitDraft: (text) => {
        committedText = text;
        currentDraft = { ...currentDraft, text, revision: currentDraft.revision + 1 };
      },
      onStateChange: () => {},
    });

    await controller.start();
    controller.apply();
    expect(committedText).toBe("Polished initial text.");
    expect(controller.currentState.restorableOriginal).not.toBeNull();

    // User makes a manual edit after apply
    currentDraft = {
      ownerKey: "thread-1",
      text: "Polished initial text with more manual tweaks.",
      revision: 3,
    };

    // Attempting restoreOriginal must NOT overwrite the new edits
    controller.restoreOriginal();
    expect(currentDraft.text).toBe("Polished initial text with more manual tweaks.");
    expect(controller.currentState.restorableOriginal).toBeNull();
  });

  it("restoring after submit/clear: clearing draft invalidates restorable original", async () => {
    let currentDraft: PromptPolishDraftSnapshot | null = {
      ownerKey: "thread-1",
      text: "draft to send",
      revision: 1,
    };

    const controller = new PromptPolishController({
      polishPrompt: vi.fn().mockResolvedValue({ polished: "Polished send." }),
      readDraft: () => currentDraft,
      commitDraft: (text) => {
        if (currentDraft) {
          currentDraft = { ...currentDraft, text, revision: currentDraft.revision + 1 };
        }
      },
      onStateChange: () => {},
    });

    await controller.start();
    controller.apply();
    expect(currentDraft?.text).toBe("Polished send.");

    // User sends the message; draft is cleared to empty / reset
    currentDraft = {
      ownerKey: "thread-1",
      text: "",
      revision: 3,
    };

    // Attempting restoreOriginal must NOT restore the previous message into the new empty draft
    controller.restoreOriginal();
    expect(currentDraft.text).toBe("");
    expect(controller.currentState.restorableOriginal).toBeNull();
  });

  it("ownerChanged invalidates restorableOriginal so it never restores across threads", async () => {
    let currentDraft: PromptPolishDraftSnapshot = {
      ownerKey: "thread-1",
      text: "thread 1 text",
      revision: 1,
    };

    const controller = new PromptPolishController({
      polishPrompt: vi.fn().mockResolvedValue({ polished: "Polished thread 1." }),
      readDraft: () => currentDraft,
      commitDraft: (text) => {
        currentDraft = { ...currentDraft, text, revision: currentDraft.revision + 1 };
      },
      onStateChange: () => {},
    });

    await controller.start();
    controller.apply();
    expect(controller.currentState.restorableOriginal).not.toBeNull();

    // User switches to thread 2
    controller.ownerChanged();
    expect(controller.currentState.restorableOriginal).toBeNull();

    // In thread 2, restoreOriginal does nothing
    currentDraft = {
      ownerKey: "thread-2",
      text: "thread 2 draft",
      revision: 1,
    };
    controller.restoreOriginal();
    expect(currentDraft.text).toBe("thread 2 draft");
  });

  it("clears recovery on cancellation after apply", async () => {
    let text = "original";
    const controller = new PromptPolishController({
      polishPrompt: async () => ({ polished: "Polished." }),
      readDraft: () => ({ ownerKey: "thread", text, revision: 0 }),
      commitDraft: (value) => {
        text = value;
      },
      onStateChange: () => {},
    });
    await controller.start();
    controller.apply();
    controller.cancel();
    expect(controller.currentState.restorableOriginal).toBeNull();
  });

  it("invalidates recovery on edits even when text returns to the applied text", async () => {
    let text = "original";
    let notify: (() => void) | undefined;
    const session = new PromptPolishSession({
      polishPrompt: async () => ({ polished: "Polished." }),
      onStateChange: () => {},
    });
    const target = createPromptPolishTarget(
      "thread",
      () => text,
      (value) => {
        text = value;
      },
      (listener) => {
        notify = listener;
        return () => {
          notify = undefined;
        };
      },
    );
    await session.start(target);
    session.apply();
    expect(session.currentState.restorableOriginal).not.toBeNull();
    text = "Edited.";
    notify?.();
    expect(session.currentState.restorableOriginal).toBeNull();
    text = "Polished.";
    notify?.();
    session.restoreOriginal();
    expect(text).toBe("Polished.");
    session.dispose();
  });

  it("cancel aborts in-flight AbortSignal", async () => {
    let receivedSignal: AbortSignal | undefined;

    const controller = new PromptPolishController({
      polishPrompt: ({ signal }) => {
        receivedSignal = signal;
        return new Promise(() => {}); // never resolves
      },
      readDraft: () => ({
        ownerKey: "thread-1",
        text: "some draft",
        revision: 1,
      }),
      commitDraft: () => {},
      onStateChange: () => {},
    });

    void controller.start();
    expect(controller.currentState.phase).toBe("polishing");
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal?.aborted).toBe(false);

    controller.cancel();
    expect(controller.currentState.phase).toBe("idle");
    expect(receivedSignal?.aborted).toBe(true);
  });

  it("drops late response when user typed during in-flight polish request", async () => {
    let currentDraft: PromptPolishDraftSnapshot | null = {
      ownerKey: "thread-1",
      text: "initial text",
      revision: 1,
    };
    let resolveRpc: (val: { polished: string }) => void = () => {};

    const controller = new PromptPolishController({
      polishPrompt: () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        }),
      readDraft: () => currentDraft,
      commitDraft: () => {},
      onStateChange: () => {},
    });

    const polishPromise = controller.start();
    expect(controller.currentState.phase).toBe("polishing");

    // User types while request is in-flight: revision increments and text changes
    currentDraft = {
      ownerKey: "thread-1",
      text: "initial text modified",
      revision: 2,
    };

    // RPC resolves late
    resolveRpc({ polished: "Polished text" });
    await polishPromise;

    // Stale result should have been dropped and reverted to idle
    expect(controller.currentState.phase).toBe("idle");
    expect(controller.currentState.polishedText).toBeNull();
  });

  it("drops late response when thread or owner changes during in-flight polish request", async () => {
    let currentDraft: PromptPolishDraftSnapshot | null = {
      ownerKey: "thread-1",
      text: "thread 1 draft",
      revision: 1,
    };
    let resolveRpc: (val: { polished: string }) => void = () => {};

    const controller = new PromptPolishController({
      polishPrompt: () =>
        new Promise((resolve) => {
          resolveRpc = resolve;
        }),
      readDraft: () => currentDraft,
      commitDraft: () => {},
      onStateChange: () => {},
    });

    const polishPromise = controller.start();
    expect(controller.currentState.phase).toBe("polishing");

    // User switches threads
    currentDraft = {
      ownerKey: "thread-2",
      text: "thread 2 draft",
      revision: 1,
    };

    // RPC resolves late
    resolveRpc({ polished: "Polished thread 1" });
    await polishPromise;

    expect(controller.currentState.phase).toBe("idle");
    expect(controller.currentState.polishedText).toBeNull();
  });

  it("does not start if draft is empty or whitespace", async () => {
    const polishFn = vi.fn();
    const controller = new PromptPolishController({
      polishPrompt: polishFn,
      readDraft: () => ({
        ownerKey: "thread-1",
        text: "   \n\t  ",
        revision: 1,
      }),
      commitDraft: () => {},
      onStateChange: () => {},
    });

    await controller.start();
    expect(controller.currentState.phase).toBe("idle");
    expect(polishFn).not.toHaveBeenCalled();
  });

  it("transitions to error phase on RPC failure and allows dismissing", async () => {
    const controller = new PromptPolishController({
      polishPrompt: vi.fn().mockRejectedValue(new Error("API quota exceeded")),
      readDraft: () => ({
        ownerKey: "thread-1",
        text: "fix code",
        revision: 1,
      }),
      commitDraft: () => {},
      onStateChange: () => {},
    });

    await controller.start();
    expect(controller.currentState.phase).toBe("error");
    expect(controller.currentState.error).toBe("API quota exceeded");

    controller.dismissError();
    expect(controller.currentState.phase).toBe("idle");
    expect(controller.currentState.error).toBeNull();
  });
});

describe("PromptPolishSession & createPromptPolishTarget", () => {
  it("tracks revisions automatically on text changes", async () => {
    let currentText = "hello wrld";
    let changeListener: (() => void) | undefined;

    const target = createPromptPolishTarget(
      "composer-main",
      () => currentText,
      (text) => {
        currentText = text;
      },
      (listener) => {
        changeListener = listener;
        return () => {
          changeListener = undefined;
        };
      },
    );

    const snapshot1 = target.readDraft();
    expect(snapshot1?.revision).toBe(0);

    const unsubscribe = target.subscribe();

    currentText = "hello world";
    if (changeListener) {
      changeListener();
    }

    const snapshot2 = target.readDraft();
    expect(snapshot2?.revision).toBe(1);

    unsubscribe();
  });

  it("clears restorable original and cancels when target owner changes", async () => {
    let draft1 = "draft in thread 1";
    let draft2 = "draft in thread 2";

    const session = new PromptPolishSession({
      polishPrompt: vi.fn().mockResolvedValue({ polished: "Polished draft 1" }),
      onStateChange: () => {},
    });

    const target1 = createPromptPolishTarget(
      "thread-1",
      () => draft1,
      (t) => {
        draft1 = t;
      },
      () => () => {},
    );

    await session.start(target1);
    session.apply();
    expect(session.currentState.restorableOriginal).not.toBeNull();

    // Start with target2 (different owner)
    const _target2 = createPromptPolishTarget(
      "thread-2",
      () => draft2,
      (t) => {
        draft2 = t;
      },
      () => () => {},
    );

    session.ownerChanged("thread-2");
    expect(session.currentState.restorableOriginal).toBeNull();

    session.dispose();
  });
});
