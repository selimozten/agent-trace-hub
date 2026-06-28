import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { JsonObject, JsonValue, NormalizeOptions } from "./types.ts";
import { isRecord } from "./workspace.ts";

type CanonicalContentBlock = { type: "text"; text: string } | { type: "image"; mime_type?: string; data?: string };

interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

interface CanonicalMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: CanonicalContentBlock[];
  reasoning?: CanonicalContentBlock[];
  tool_calls?: CanonicalToolCall[];
  tool_call_id?: string;
  name?: string;
  metadata?: JsonObject;
}

interface CanonicalTrace {
  schema: "agent_trace_v1";
  session_id: string;
  source: {
    agent: string;
    model?: string;
    provider?: string;
    exported_at?: string;
    cwd?: string;
    source_format: string;
  };
  metadata: JsonObject;
  tools: JsonObject[];
  messages: CanonicalMessage[];
  outcome: {
    quality: "unlabeled";
  };
}

export async function runNormalize(options: NormalizeOptions): Promise<void> {
  if (options.source !== "pi") throw new Error(`Unsupported source: ${options.source}`);
  const trace = await normalizePiSession(options.input, options);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(trace)}\n`);
  console.log(`Wrote canonical trace: ${options.output}`);
  console.log(`Messages: ${trace.messages.length}`);
}

async function normalizePiSession(inputPath: string, options: NormalizeOptions): Promise<CanonicalTrace> {
  const input = fs.createReadStream(inputPath, { encoding: "utf-8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });

  const messages: CanonicalMessage[] = [];
  let sessionId = path.basename(inputPath, ".jsonl");
  let cwd: string | undefined;
  let exportedAt: string | undefined;
  let model = options.model;

  for await (const line of reader) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    const entry = parsed as JsonObject;

    if (entry.type === "session") {
      if (typeof entry.id === "string") sessionId = entry.id;
      if (typeof entry.cwd === "string") cwd = entry.cwd;
      if (typeof entry.timestamp === "string") exportedAt = entry.timestamp;
      continue;
    }

    if (entry.type === "model_change" && typeof entry.modelId === "string") {
      model = entry.modelId;
      continue;
    }

    const message = readMessage(entry);
    if (!message) continue;
    const canonical = normalizePiMessage(message);
    if (canonical) messages.push(canonical);
  }

  return {
    schema: "agent_trace_v1",
    session_id: sessionId,
    source: {
      agent: options.agent ?? "pi",
      model,
      exported_at: exportedAt,
      cwd,
      source_format: "pi-session-jsonl",
    },
    metadata: {
      source_file: inputPath,
    },
    tools: [],
    messages,
    outcome: {
      quality: "unlabeled",
    },
  };
}

function readMessage(entry: JsonObject): JsonObject | undefined {
  if (entry.type === "message" && isRecord(entry.message)) return entry.message as JsonObject;
  if (typeof entry.type === "string" && ["user", "assistant", "system"].includes(entry.type) && isRecord(entry.message)) {
    return entry.message as JsonObject;
  }
  return undefined;
}

function normalizePiMessage(message: JsonObject): CanonicalMessage | undefined {
  const role = typeof message.role === "string" ? message.role : undefined;
  if (!role) return undefined;

  if (role === "system" || role === "developer" || role === "user") {
    return {
      role,
      content: normalizeContentBlocks(message.content),
    };
  }

  if (role === "assistant") {
    const content = Array.isArray(message.content) ? message.content : [];
    const textBlocks: CanonicalContentBlock[] = [];
    const reasoningBlocks: CanonicalContentBlock[] = [];
    const toolCalls: CanonicalToolCall[] = [];

    for (const block of content) {
      if (!isRecord(block) || typeof block.type !== "string") continue;
      if (block.type === "text" && typeof block.text === "string") {
        textBlocks.push({ type: "text", text: block.text });
      } else if (block.type === "thinking" && typeof block.thinking === "string") {
        reasoningBlocks.push({ type: "text", text: block.thinking });
      } else if (block.type === "toolCall" || block.type === "tool_use") {
        const id = typeof block.id === "string" ? block.id : `call_${toolCalls.length + 1}`;
        const name = typeof block.name === "string" ? block.name : "tool";
        const args = isRecord(block.arguments) ? block.arguments as JsonObject : {};
        toolCalls.push({ id, name, arguments: args });
      }
    }

    const out: CanonicalMessage = { role: "assistant" };
    if (reasoningBlocks.length > 0) out.reasoning = reasoningBlocks;
    if (textBlocks.length > 0) out.content = textBlocks;
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    return out;
  }

  if (role === "toolResult") {
    return {
      role: "tool",
      tool_call_id: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
      name: typeof message.toolName === "string" ? message.toolName : "tool",
      content: normalizeContentBlocks(message.content),
      metadata: isRecord(message.details) ? message.details as JsonObject : undefined,
    };
  }

  if (role === "bashExecution") {
    const command = typeof message.command === "string" ? message.command : "";
    const output = typeof message.output === "string" ? message.output : "";
    return {
      role: "tool",
      name: "bash",
      content: [{ type: "text", text: [command ? `$ ${command}` : "", output].filter(Boolean).join("\n") }],
    };
  }

  return undefined;
}

function normalizeContentBlocks(content: JsonValue | undefined): CanonicalContentBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];

  const blocks: CanonicalContentBlock[] = [];
  for (const block of content) {
    if (!isRecord(block) || typeof block.type !== "string") continue;
    if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      blocks.push({
        type: "image",
        mime_type: typeof block.mimeType === "string" ? block.mimeType : undefined,
        data: typeof block.data === "string" ? block.data : undefined,
      });
    }
  }
  return blocks;
}
