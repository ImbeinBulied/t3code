import { RegistryContext } from "@effect/atom-react";
import {
  type AtomCommand,
  type AtomCommandOptions,
  type AtomCommandResult,
  runAtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import { useContext } from "react";

export function useAtomCommand<A, E, W>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W, callOptions?: AtomCommandOptions) => Promise<AtomCommandResult<A, E>> {
  const registry = useContext(RegistryContext);
  const baseOptions = typeof options === "string" ? { label: options } : (options ?? {});

  return (value: W, callOptions?: AtomCommandOptions) =>
    runAtomCommand(registry, command, value, {
      ...baseOptions,
      ...callOptions,
      label: callOptions?.label ?? baseOptions.label ?? command.label,
      reportFailure: callOptions?.reportFailure ?? baseOptions.reportFailure ?? true,
      reportDefect: callOptions?.reportDefect ?? baseOptions.reportDefect ?? true,
    });
}
