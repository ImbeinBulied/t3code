import { describe, expect, it } from "vite-plus/test";

import { resolveVoiceComposerPresentation } from "./presentation.ts";

describe("resolveVoiceComposerPresentation", () => {
  it("resolves idle state", () => {
    expect(
      resolveVoiceComposerPresentation({ phase: "idle", error: null, errorAction: null }, 0),
    ).toEqual({
      leadingAction: null,
      trailingAction: "mic",
      showsSend: true,
      statusKind: null,
      statusLabel: null,
      confirmationEnabled: false,
    });
  });

  it("resolves preparing state", () => {
    expect(
      resolveVoiceComposerPresentation({ phase: "preparing", error: null, errorAction: null }, 0),
    ).toEqual({
      leadingAction: "cancel",
      trailingAction: "confirm",
      showsSend: false,
      statusKind: "active",
      statusLabel: "Preparing",
      confirmationEnabled: false,
    });
  });

  it("resolves recording state with formatted elapsed time", () => {
    expect(
      resolveVoiceComposerPresentation({ phase: "recording", error: null, errorAction: null }, 75),
    ).toEqual({
      leadingAction: "cancel",
      trailingAction: "confirm",
      showsSend: false,
      statusKind: "active",
      statusLabel: "Recording 1:15",
      confirmationEnabled: true,
    });
  });

  it("resolves transcribing state", () => {
    expect(
      resolveVoiceComposerPresentation(
        { phase: "transcribing", error: null, errorAction: null },
        30,
      ),
    ).toEqual({
      leadingAction: "cancel",
      trailingAction: "confirm",
      showsSend: false,
      statusKind: "active",
      statusLabel: "Transcribing",
      confirmationEnabled: false,
    });
  });

  it("resolves error state", () => {
    expect(
      resolveVoiceComposerPresentation(
        { phase: "error", error: "Permission denied", errorAction: "settings" },
        0,
      ),
    ).toEqual({
      leadingAction: null,
      trailingAction: "mic",
      showsSend: true,
      statusKind: "error",
      statusLabel: "Permission denied",
      confirmationEnabled: false,
    });
  });
});
