import fs from "node:fs";
import path from "node:path";
import { readCanonicalJsonl, textFromContent } from "./canonical.ts";
import type { CanonicalMessage, CanonicalToolCall, CanonicalTrace, EnrichOptions, JsonObject } from "./types.ts";

type SignalStatus = "passed" | "failed" | "unknown";
type SignalCategory = "test" | "build" | "other";

interface CommandSignal {
  id?: string;
  name: string;
  command?: string;
  category: SignalCategory;
  status: SignalStatus;
  exit_code?: number;
}

export async function runEnrich(options: EnrichOptions): Promise<void> {
  const traces = await readCanonicalJsonl(options.input);
  const enriched = traces.map(enrichTrace);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, enriched.map((trace) => JSON.stringify(trace)).join("\n") + (enriched.length > 0 ? "\n" : ""));
  console.log(`Enriched ${enriched.length} trace(s): ${options.output}`);
}

export function enrichTrace(trace: CanonicalTrace): CanonicalTrace {
  const commands = extractCommandSignals(trace.messages);
  const tests = summarizeCategory(commands, "test");
  const build = summarizeCategory(commands, "build");
  return {
    ...trace,
    outcome: {
      ...trace.outcome,
      signals: {
        commands: commands.map((command) => toJsonObject(command)),
        tests: toJsonObject(tests),
        build: toJsonObject(build),
        final_diff: { available: false },
        user_acceptance: "unknown",
      },
    },
  };
}

function extractCommandSignals(messages: CanonicalMessage[]): CommandSignal[] {
  const commands: CommandSignal[] = [];
  const pendingById = new Map<string, CommandSignal>();
  const pendingQueue: CommandSignal[] = [];

  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.tool_calls ?? []) {
        const signal = commandSignalFromCall(call);
        if (!signal) continue;
        commands.push(signal);
        pendingById.set(call.id, signal);
        pendingQueue.push(signal);
      }
      continue;
    }

    if (message.role !== "tool") continue;
    const signal = message.tool_call_id ? pendingById.get(message.tool_call_id) : pendingQueue.shift();
    if (!signal) continue;
    const output = textFromContent(message.content);
    const exitCode = readExitCode(message.metadata);
    if (exitCode !== undefined) signal.exit_code = exitCode;
    signal.status = inferStatus(output, exitCode);
  }

  return commands;
}

function commandSignalFromCall(call: CanonicalToolCall): CommandSignal | undefined {
  const command = firstString(call.arguments, ["cmd", "command", "script", "task"]);
  const name = call.name;
  if (!command && !isCommandTool(name)) return undefined;
  const text = command ?? name;
  return {
    id: call.id,
    name,
    command,
    category: categorizeCommand(text),
    status: "unknown",
  };
}

function isCommandTool(name: string): boolean {
  return /\b(?:bash|shell|terminal|run|exec|command)\b/i.test(name);
}

function categorizeCommand(command: string): SignalCategory {
  if (/\b(?:test|pytest|jest|vitest|mocha|rspec|cargo test|go test|npm test|pnpm test|yarn test)\b/i.test(command)) return "test";
  if (/\b(?:build|compile|tsc|cargo build|go build|npm run build|pnpm build|yarn build)\b/i.test(command)) return "build";
  return "other";
}

function inferStatus(output: string, exitCode: number | undefined): SignalStatus {
  if (exitCode !== undefined) return exitCode === 0 ? "passed" : "failed";
  if (/\b(?:failed|failure|error|panic|exception|exited with code [1-9])\b/i.test(output)) return "failed";
  if (/\b(?:passed|passing|success|succeeded|0 failed)\b/i.test(output)) return "passed";
  return "unknown";
}

function summarizeCategory(commands: CommandSignal[], category: SignalCategory): JsonObject {
  const filtered = commands.filter((command) => command.category === category);
  return {
    run: filtered.length > 0,
    status: summarizeStatus(filtered),
    command_count: filtered.length,
    commands: filtered.map((command) => command.command ?? command.name),
  };
}

function summarizeStatus(commands: CommandSignal[]): SignalStatus {
  if (commands.length === 0) return "unknown";
  if (commands.some((command) => command.status === "failed")) return "failed";
  if (commands.every((command) => command.status === "passed")) return "passed";
  return "unknown";
}

function readExitCode(metadata: JsonObject | undefined): number | undefined {
  const value = metadata?.exit_code;
  return typeof value === "number" ? value : undefined;
}

function firstString(record: JsonObject, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function toJsonObject(value: unknown): JsonObject {
  return value as JsonObject;
}
