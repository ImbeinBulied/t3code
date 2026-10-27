import {
  createPromptPolishTarget,
  PromptPolishSession,
  type PromptPolishState,
} from "@t3tools/client-runtime/prompt-polish";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import { useAtomCommand } from "../../state/use-atom-command";
import { orchestrationEnvironment } from "../../state/orchestration";

export type UseComposerPolishInput = {
  readonly ownerKey: string;
  readonly environmentId: EnvironmentId | null;
  readonly threadId: ThreadId | null;
  readonly readPrompt: () => string;
  readonly onPromptChange: (prompt: string) => void;
  readonly subscribeToChanges?: ((onChange: () => void) => () => void) | undefined;
};

export type UseComposerPolishReturn = {
  readonly isBusy: boolean;
  readonly state: PromptPolishState;
  readonly start: () => void;
  readonly apply: () => void;
  readonly cancel: () => void;
  readonly restoreOriginal: () => void;
  readonly dismissError: () => void;
};

const IDLE_STATE: PromptPolishState = {
  phase: "idle",
  ownerKey: null,
  originalDraft: null,
  polishedText: null,
  error: null,
  restorableOriginal: null,
};

export function useComposerPolish(input: UseComposerPolishInput): UseComposerPolishReturn {
  const [state, setState] = useState<PromptPolishState>(IDLE_STATE);
  const polishRpc = useAtomCommand(orchestrationEnvironment.polishPrompt);

  const latestInput = useRef(input);
  // oxlint-disable-next-line t3code/react-effect-budget -- prompt polish session lifecycle and rpc synchronization
  useEffect(() => {
    latestInput.current = input;
  }, [input]);

  const [session] = useState(() => {
    return new PromptPolishSession({
      polishPrompt: () => Promise.reject(new Error("Polish prompt not initialized.")),
      onStateChange: (nextState) => {
        setState(nextState);
      },
    });
  });

  // oxlint-disable-next-line t3code/react-effect-budget -- prompt polish session lifecycle and rpc synchronization
  useEffect(() => {
    session.setPolishPrompt(async ({ draft, signal }) => {
      const { environmentId, threadId } = latestInput.current;
      if (!environmentId) {
        throw new Error("No active environment for prompt polish.");
      }
      const result = await polishRpc(
        {
          environmentId,
          input: {
            threadId: threadId ?? null,
            draft,
          },
        },
        ...(signal !== undefined ? [{ signal }] : []),
      );
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        throw failure instanceof Error ? failure : new Error(String(failure));
      }
      return result.value;
    });
  }, [polishRpc, session]);

  // oxlint-disable-next-line t3code/react-effect-budget -- prompt polish session lifecycle and rpc synchronization
  useEffect(() => {
    return () => {
      session.dispose();
    };
  }, [session]);

  // oxlint-disable-next-line t3code/react-effect-budget -- prompt polish session lifecycle and rpc synchronization
  useEffect(() => {
    if (session.ownerKey !== null && session.ownerKey !== input.ownerKey) {
      session.ownerChanged(input.ownerKey);
    }
  }, [input.ownerKey, session]);

  const environmentId = input.environmentId;
  const prevEnv = useRef(environmentId);
  // oxlint-disable-next-line t3code/react-effect-budget -- prompt polish session lifecycle and rpc synchronization
  useEffect(() => {
    if (prevEnv.current !== environmentId) {
      prevEnv.current = environmentId;
      session.cancel();
    }
  }, [environmentId, session]);

  const start = () => {
    const target = createPromptPolishTarget(
      latestInput.current.ownerKey,
      () => latestInput.current.readPrompt(),
      (text) => {
        latestInput.current.onPromptChange(text);
      },
      (onChange) =>
        latestInput.current.subscribeToChanges
          ? latestInput.current.subscribeToChanges(onChange)
          : () => {},
    );
    void session.start(target);
  };

  const apply = () => {
    session.apply();
  };

  const cancel = () => {
    session.cancel();
  };

  const restoreOriginal = () => {
    session.restoreOriginal();
  };

  const dismissError = () => {
    session.dismissError();
  };

  return {
    isBusy: state.phase === "polishing",
    state,
    start,
    apply,
    cancel,
    restoreOriginal,
    dismissError,
  };
}
