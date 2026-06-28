import fs from "node:fs";
import readline from "node:readline";
import type { CanonicalMessage, CanonicalTrace, JsonObject } from "./types.ts";
import { isRecord } from "./workspace.ts";

export async function readCanonicalJsonl(inputPath: string): Promise<CanonicalTrace[]> {
  const input = fs.createReadStream(inputPath, { encoding: "utf-8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  const traces: CanonicalTrace[] = [];

  for await (const line of reader) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) throw new Error(`Expected JSON object in ${inputPath}`);
    const trace = parsed as unknown as CanonicalTrace;
    validateCanonicalTrace(trace);
    traces.push(trace);
  }

  return traces;
}

export function validateCanonicalTrace(trace: CanonicalTrace): void {
  if (!isRecord(trace as unknown as JsonObject)) throw new Error("Invalid canonical trace object");
  if (trace.schema !== "agent_trace_v1") throw new Error("Invalid canonical trace schema");
  if (!trace.session_id) throw new Error("Canonical trace missing session_id");
  if (!trace.source || !trace.source.agent) throw new Error("Canonical trace missing source.agent");
  if (!trace.source.source_format) throw new Error("Canonical trace missing source.source_format");
  if (!Array.isArray(trace.messages) || trace.messages.length === 0) throw new Error("Canonical trace has no messages");
  for (const [index, message] of trace.messages.entries()) {
    validateMessage(message, index);
  }
}

function validateMessage(message: CanonicalMessage, index: number): void {
  if (!["system", "developer", "user", "assistant", "tool"].includes(message.role)) {
    throw new Error(`Invalid message role at index ${index}`);
  }
  if (message.role === "assistant" && !message.content && !message.reasoning && !message.tool_calls) {
    throw new Error(`Empty assistant message at index ${index}`);
  }
  if (message.role !== "assistant" && message.role !== "tool" && !message.content) {
    throw new Error(`Message at index ${index} has no content`);
  }
  if (message.role === "tool" && !message.content) {
    throw new Error(`Tool message at index ${index} has no content`);
  }
  if (message.tool_calls) {
    for (const [callIndex, call] of message.tool_calls.entries()) {
      if (!call.id) throw new Error(`Tool call ${callIndex} at message ${index} missing id`);
      if (!call.name) throw new Error(`Tool call ${callIndex} at message ${index} missing name`);
      if (!call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) {
        throw new Error(`Tool call ${callIndex} at message ${index} has invalid arguments`);
      }
    }
  }
}

export function textFromContent(content: CanonicalMessage["content"]): string {
  if (!content) return "";
  return content
    .map((block) => block.type === "text" ? block.text : `[image:${block.mime_type ?? "unknown"}]`)
    .join("\n");
}

