import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type {
  CanonicalContentBlock,
  CanonicalMessage,
  CanonicalToolCall,
  CanonicalTrace,
  JsonObject,
  JsonValue,
  NormalizeOptions,
  NormalizeDirOptions,
  NormalizeSource,
} from "./types.ts";
import { validateCanonicalTrace } from "./canonical.ts";
import { isRecord } from "./workspace.ts";

interface SourceAdapter {
  source: Exclude<NormalizeSource, "auto">;
  sourceFormat: string;
  defaultAgent: string;
  detect(records: JsonObject[]): boolean;
  normalize(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace;
}

const ADAPTERS: SourceAdapter[] = [
  {
    source: "pi",
    sourceFormat: "pi-session-jsonl",
    defaultAgent: "pi",
    detect: detectPi,
    normalize: normalizePiSession,
  },
  {
    source: "claude-code",
    sourceFormat: "claude-code-jsonl",
    defaultAgent: "claude-code",
    detect: detectClaudeCode,
    normalize: normalizeClaudeCodeSession,
  },
  {
    source: "codex",
    sourceFormat: "codex-rollout-jsonl",
    defaultAgent: "codex",
    detect: detectCodex,
    normalize: normalizeCodexSession,
  },
  {
    source: "anthropic-messages",
    sourceFormat: "anthropic-messages-jsonl",
    defaultAgent: "anthropic-compatible",
    detect: detectAnthropicMessages,
    normalize: normalizeAnthropicMessagesSession,
  },
  {
    source: "openai-chat",
    sourceFormat: "openai-chat-jsonl",
    defaultAgent: "openai-compatible",
    detect: detectOpenAIChat,
    normalize: normalizeOpenAIChatSession,
  },
];

export async function runNormalize(options: NormalizeOptions): Promise<void> {
  const records = await readJsonlObjects(options.input);
  const { adapter, trace } = normalizeRecords(options.input, records, options);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(trace)}\n`);
  console.log(`Wrote canonical trace: ${options.output}`);
  console.log(`Source: ${adapter.source}`);
  console.log(`Messages: ${trace.messages.length}`);
}

export async function runNormalizeDir(options: NormalizeDirOptions): Promise<void> {
  const files = findJsonlFiles(options.inputDir);
  if (files.length === 0) throw new Error(`No .jsonl files found in ${options.inputDir}`);
  const traces: CanonicalTrace[] = [];

  for (const file of files) {
    const records = await readJsonlObjects(file);
    const { trace } = normalizeRecords(file, records, {
      source: options.source,
      input: file,
      output: options.output,
      agent: options.agent,
      model: options.model,
    });
    traces.push(trace);
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, traces.map((trace) => JSON.stringify(trace)).join("\n") + "\n");
  console.log(`Wrote canonical traces: ${options.output}`);
  console.log(`Files: ${files.length}`);
  console.log(`Traces: ${traces.length}`);
}

function normalizeRecords(inputPath: string, records: JsonObject[], options: NormalizeOptions): { adapter: SourceAdapter; trace: CanonicalTrace } {
  const adapter = resolveAdapter(options.source, records);
  const trace = adapter.normalize(inputPath, records, options);
  validateCanonicalTrace(trace);
  return { adapter, trace };
}

function findJsonlFiles(inputDir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(inputDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(inputDir, entry.name);
    if (entry.isDirectory()) out.push(...findJsonlFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(fullPath);
  }
  return out.sort();
}

async function readJsonlObjects(inputPath: string): Promise<JsonObject[]> {
  const input = fs.createReadStream(inputPath, { encoding: "utf-8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  const records: JsonObject[] = [];

  for await (const line of reader) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isRecord(parsed)) records.push(parsed as JsonObject);
    } catch {
      // Ignore malformed lines here. Redaction/review already records parse errors.
    }
  }

  return records;
}

function resolveAdapter(source: NormalizeSource, records: JsonObject[]): SourceAdapter {
  if (source !== "auto") {
    const adapter = ADAPTERS.find((candidate) => candidate.source === source);
    if (!adapter) throw new Error(`Unsupported source: ${source}`);
    return adapter;
  }

  const adapter = ADAPTERS.find((candidate) => candidate.detect(records));
  if (!adapter) throw new Error("Could not auto-detect source. Pass --source explicitly.");
  return adapter;
}

function baseTrace(
  inputPath: string,
  adapter: SourceAdapter,
  options: NormalizeOptions,
  overrides: Partial<CanonicalTrace["source"]> & { session_id?: string },
  messages: CanonicalMessage[],
): CanonicalTrace {
  return {
    schema: "agent_trace_v1",
    session_id: overrides.session_id ?? path.basename(inputPath, ".jsonl"),
    source: {
      agent: options.agent ?? adapter.defaultAgent,
      model: options.model ?? overrides.model,
      provider: overrides.provider,
      exported_at: overrides.exported_at,
      cwd: overrides.cwd,
      source_format: adapter.sourceFormat,
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

function detectPi(records: JsonObject[]): boolean {
  return records.some((record) => record.type === "session" && typeof record.version === "number" && typeof record.id === "string")
    && records.some((record) => record.type === "message" && isRecord(record.message));
}

function normalizePiSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = ADAPTERS[0];
  const messages: CanonicalMessage[] = [];
  let sessionId = path.basename(inputPath, ".jsonl");
  let cwd: string | undefined;
  let exportedAt: string | undefined;
  let model = options.model;
  let provider: string | undefined;

  for (const entry of records) {
    if (entry.type === "session") {
      if (typeof entry.id === "string") sessionId = entry.id;
      if (typeof entry.cwd === "string") cwd = entry.cwd;
      if (typeof entry.timestamp === "string") exportedAt = entry.timestamp;
      continue;
    }

    if (entry.type === "model_change") {
      if (typeof entry.modelId === "string") model = model ?? entry.modelId;
      if (typeof entry.provider === "string") provider = entry.provider;
      continue;
    }

    const message = readWrappedMessage(entry);
    if (!message) continue;
    messages.push(...normalizeAgentMessage(message));
  }

  return baseTrace(inputPath, adapter, { ...options, model }, { session_id: sessionId, cwd, exported_at: exportedAt, model, provider }, messages);
}

function detectClaudeCode(records: JsonObject[]): boolean {
  return records.some((record) => typeof record.sessionId === "string" && ["user", "assistant", "system"].includes(String(record.type)))
    || records.some((record) => isRecord(record.message) && typeof record.sessionId === "string" && typeof record.cwd === "string");
}

function normalizeClaudeCodeSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = ADAPTERS[1];
  const messages: CanonicalMessage[] = [];
  let sessionId = path.basename(inputPath, ".jsonl");
  let cwd: string | undefined;
  let exportedAt: string | undefined;
  let model = options.model;

  for (const entry of records) {
    if (typeof entry.sessionId === "string") sessionId = entry.sessionId;
    if (typeof entry.cwd === "string") cwd = cwd ?? entry.cwd;
    if (typeof entry.timestamp === "string") exportedAt = exportedAt ?? entry.timestamp;
    const message = readWrappedMessage(entry);
    if (!message) continue;
    if (!model && typeof message.model === "string") model = message.model;
    messages.push(...normalizeAgentMessage(message));
  }

  return baseTrace(inputPath, adapter, { ...options, model }, { session_id: sessionId, cwd, exported_at: exportedAt, model, provider: "anthropic" }, messages);
}

function detectCodex(records: JsonObject[]): boolean {
  return records.some((record) => record.type === "session_meta" && isRecord(record.payload))
    && records.some((record) => record.type === "response_item" && isRecord(record.payload));
}

function normalizeCodexSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = ADAPTERS[2];
  const messages: CanonicalMessage[] = [];
  let pendingAssistant: CanonicalMessage | undefined;
  let sessionId = path.basename(inputPath, ".jsonl");
  let cwd: string | undefined;
  let exportedAt: string | undefined;
  let model = options.model;
  let provider: string | undefined;

  for (const record of records) {
    const payload = isRecord(record.payload) ? record.payload as JsonObject : undefined;
    if (!payload) continue;

    if (record.type === "session_meta") {
      if (typeof payload.id === "string") sessionId = payload.id;
      if (typeof payload.cwd === "string") cwd = payload.cwd;
      if (typeof payload.timestamp === "string") exportedAt = payload.timestamp;
      if (typeof payload.model_provider === "string") provider = payload.model_provider;
      continue;
    }

    if (record.type === "turn_context") {
      if (!model && typeof payload.model === "string") model = payload.model;
      if (!cwd && typeof payload.cwd === "string") cwd = payload.cwd;
      continue;
    }

    if (record.type === "event_msg" && payload.type === "user_message") {
      flushPendingAssistant(messages, pendingAssistant);
      pendingAssistant = undefined;
      const text = typeof payload.message === "string" ? payload.message : "";
      if (text) messages.push({ role: "user", content: [{ type: "text", text }] });
      continue;
    }

    if (record.type !== "response_item") continue;

    if (payload.type === "message" && typeof payload.role === "string") {
      const role = canonicalRole(payload.role);
      if (role === "assistant") {
        const content = normalizeOpenAIContent(payload.content);
        if (content.length > 0) {
          pendingAssistant = pendingAssistant ?? { role: "assistant" };
          pendingAssistant.content = [...(pendingAssistant.content ?? []), ...content];
        }
      } else if (role && role !== "tool") {
        flushPendingAssistant(messages, pendingAssistant);
        pendingAssistant = undefined;
        const content = normalizeOpenAIContent(payload.content);
        if (content.length > 0) messages.push({ role, content });
      }
      continue;
    }

    if (payload.type === "reasoning") {
      const reasoning = normalizeCodexReasoning(payload);
      if (reasoning.length > 0) {
        pendingAssistant = pendingAssistant ?? { role: "assistant" };
        pendingAssistant.reasoning = [...(pendingAssistant.reasoning ?? []), ...reasoning];
      }
      continue;
    }

    if (payload.type === "function_call") {
      const toolCall = normalizeCodexFunctionCall(payload);
      pendingAssistant = pendingAssistant ?? { role: "assistant" };
      pendingAssistant.tool_calls = [...(pendingAssistant.tool_calls ?? []), toolCall];
      continue;
    }

    if (payload.type === "function_call_output") {
      flushPendingAssistant(messages, pendingAssistant);
      pendingAssistant = undefined;
      messages.push({
        role: "tool",
        tool_call_id: typeof payload.call_id === "string" ? payload.call_id : undefined,
        name: "function_call_output",
        content: normalizeTextLike(payload.output),
      });
    }
  }

  flushPendingAssistant(messages, pendingAssistant);
  return baseTrace(inputPath, adapter, { ...options, model }, { session_id: sessionId, cwd, exported_at: exportedAt, model, provider }, messages);
}

function detectOpenAIChat(records: JsonObject[]): boolean {
  return records.some((record) => Array.isArray(record.messages))
    || records.some((record) => typeof record.role === "string" && ["system", "developer", "user", "assistant", "tool"].includes(record.role));
}

function normalizeOpenAIChatSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = adapterFor("openai-chat");
  const root = records.length === 1 && Array.isArray(records[0].messages) ? records[0] : undefined;
  const sourceMessages = root ? recordsFromArray(records[0].messages as JsonValue[]) : records;
  const messages: CanonicalMessage[] = [];
  const sessionId = typeof root?.id === "string" ? root.id : path.basename(inputPath, ".jsonl");
  const model = options.model ?? (typeof root?.model === "string" ? root.model : undefined);

  for (const message of sourceMessages) {
    messages.push(...normalizeOpenAIChatMessage(message));
  }

  return baseTrace(inputPath, adapter, { ...options, model }, { session_id: sessionId, model, provider: "openai" }, messages);
}

function normalizeOpenAIChatMessage(message: JsonObject): CanonicalMessage[] {
  const role = typeof message.role === "string" ? message.role : undefined;
  if (!role) return [];

  if (role === "system" || role === "developer" || role === "user") {
    return splitUserLikeMessage(role, message.content);
  }

  if (role === "tool") {
    return [{
      role: "tool",
      tool_call_id: typeof message.tool_call_id === "string" ? message.tool_call_id : undefined,
      name: typeof message.name === "string" ? message.name : "tool",
      content: normalizeContentBlocks(message.content),
    }];
  }

  if (role === "assistant") {
    const out: CanonicalMessage = { role: "assistant" };
    const content = normalizeContentBlocks(message.content);
    if (content.length > 0) out.content = content;
    if (typeof message.reasoning_content === "string" && message.reasoning_content) {
      out.reasoning = [{ type: "text", text: message.reasoning_content }];
    }
    if (Array.isArray(message.tool_calls)) {
      const calls = message.tool_calls.map((call, index) => normalizeOpenAIToolCall(call, index)).filter((call): call is CanonicalToolCall => call !== undefined);
      if (calls.length > 0) out.tool_calls = calls;
    }
    return Object.keys(out).length > 1 ? [out] : [];
  }

  return [];
}

function normalizeOpenAIToolCall(value: JsonValue, index: number): CanonicalToolCall | undefined {
  if (!isRecord(value)) return undefined;
  const fn = isRecord(value.function) ? value.function : value;
  const id = typeof value.id === "string" ? value.id : `call_${index + 1}`;
  const name = typeof fn.name === "string" ? fn.name : undefined;
  if (!name) return undefined;
  return {
    id,
    name,
    arguments: parseArguments(fn.arguments as JsonValue | undefined),
  };
}

function detectAnthropicMessages(records: JsonObject[]): boolean {
  return records.some((record) => Array.isArray(record.messages) && record.messages.some((item) => isRecord(item) && hasAnthropicContent(item)))
    || records.some((record) => typeof record.role === "string" && hasAnthropicContent(record));
}

function normalizeAnthropicMessagesSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = adapterFor("anthropic-messages");
  const root = records.length === 1 && Array.isArray(records[0].messages) ? records[0] : undefined;
  const sourceMessages = root ? recordsFromArray(records[0].messages as JsonValue[]) : records;
  const messages: CanonicalMessage[] = [];
  const sessionId = typeof root?.id === "string" ? root.id : path.basename(inputPath, ".jsonl");
  const model = options.model ?? (typeof root?.model === "string" ? root.model : undefined);

  if (typeof root?.system === "string" && root.system) {
    messages.push({ role: "system", content: [{ type: "text", text: root.system }] });
  }
  for (const message of sourceMessages) {
    messages.push(...normalizeAgentMessage(message));
  }

  return baseTrace(inputPath, adapter, { ...options, model }, { session_id: sessionId, model, provider: "anthropic" }, messages);
}

function recordsFromArray(values: JsonValue[]): JsonObject[] {
  return values.filter((value): value is JsonObject => isRecord(value));
}

function hasAnthropicContent(record: JsonObject): boolean {
  return Array.isArray(record.content)
    && record.content.some((block) => isRecord(block) && ["text", "thinking", "tool_use", "tool_result"].includes(String(block.type)));
}

function adapterFor(source: Exclude<NormalizeSource, "auto">): SourceAdapter {
  const adapter = ADAPTERS.find((candidate) => candidate.source === source);
  if (!adapter) throw new Error(`Missing adapter: ${source}`);
  return adapter;
}

function flushPendingAssistant(messages: CanonicalMessage[], pending: CanonicalMessage | undefined): void {
  if (!pending) return;
  if (pending.content || pending.reasoning || pending.tool_calls) messages.push(pending);
}

function readWrappedMessage(entry: JsonObject): JsonObject | undefined {
  if (entry.type === "message" && isRecord(entry.message)) return entry.message as JsonObject;
  if (typeof entry.type === "string" && ["user", "assistant", "system"].includes(entry.type) && isRecord(entry.message)) {
    return entry.message as JsonObject;
  }
  return undefined;
}

function normalizeAgentMessage(message: JsonObject): CanonicalMessage[] {
  const role = typeof message.role === "string" ? message.role : undefined;
  if (!role) return [];

  if (role === "system" || role === "developer" || role === "user") {
    return splitUserLikeMessage(role, message.content);
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

    if (typeof message.content === "string" && message.content) textBlocks.push({ type: "text", text: message.content });

    const out: CanonicalMessage = { role: "assistant" };
    if (reasoningBlocks.length > 0) out.reasoning = reasoningBlocks;
    if (textBlocks.length > 0) out.content = textBlocks;
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    return Object.keys(out).length > 1 ? [out] : [];
  }

  if (role === "toolResult") {
    return [{
      role: "tool",
      tool_call_id: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
      name: typeof message.toolName === "string" ? message.toolName : "tool",
      content: normalizeContentBlocks(message.content),
      metadata: isRecord(message.details) ? message.details as JsonObject : undefined,
    }];
  }

  if (role === "bashExecution") {
    const command = typeof message.command === "string" ? message.command : "";
    const output = typeof message.output === "string" ? message.output : "";
    return [{
      role: "tool",
      name: "bash",
      content: [{ type: "text", text: [command ? `$ ${command}` : "", output].filter(Boolean).join("\n") }],
    }];
  }

  return [];
}

function splitUserLikeMessage(role: "system" | "developer" | "user", content: JsonValue | undefined): CanonicalMessage[] {
  if (!Array.isArray(content)) {
    const blocks = normalizeContentBlocks(content);
    return blocks.length > 0 ? [{ role, content: blocks }] : [];
  }

  const messages: CanonicalMessage[] = [];
  const textBlocks: CanonicalContentBlock[] = [];

  for (const block of content) {
    if (!isRecord(block) || typeof block.type !== "string") continue;
    if (block.type === "tool_result" || block.type === "toolResult") {
      if (textBlocks.length > 0) {
        messages.push({ role, content: [...textBlocks] });
        textBlocks.length = 0;
      }
      messages.push({
        role: "tool",
        tool_call_id: typeof block.tool_use_id === "string" ? block.tool_use_id : typeof block.toolCallId === "string" ? block.toolCallId : undefined,
        name: typeof block.name === "string" ? block.name : "tool",
        content: normalizeContentBlocks(block.content as JsonValue | undefined),
      });
    } else {
      textBlocks.push(...normalizeContentBlocks([block] as JsonValue[]));
    }
  }

  if (textBlocks.length > 0) messages.push({ role, content: textBlocks });
  return messages;
}

function normalizeContentBlocks(content: JsonValue | undefined): CanonicalContentBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];

  const blocks: CanonicalContentBlock[] = [];
  for (const block of content) {
    if (!isRecord(block) || typeof block.type !== "string") continue;
    if ((block.type === "text" || block.type === "input_text" || block.type === "output_text") && typeof block.text === "string") {
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

function normalizeOpenAIContent(content: JsonValue | undefined): CanonicalContentBlock[] {
  return normalizeContentBlocks(content);
}

function normalizeTextLike(value: JsonValue | undefined): CanonicalContentBlock[] {
  if (typeof value === "string") return value ? [{ type: "text", text: value }] : [];
  return [{ type: "text", text: JSON.stringify(value ?? "") }];
}

function normalizeCodexReasoning(payload: JsonObject): CanonicalContentBlock[] {
  if (Array.isArray(payload.summary)) {
    const text = payload.summary
      .map((item) => isRecord(item) && typeof item.text === "string" ? item.text : "")
      .filter(Boolean)
      .join("\n");
    return text ? [{ type: "text", text }] : [];
  }
  return [];
}

function normalizeCodexFunctionCall(payload: JsonObject): CanonicalToolCall {
  const id = typeof payload.call_id === "string" ? payload.call_id : typeof payload.id === "string" ? payload.id : "call_1";
  const name = typeof payload.name === "string" ? payload.name : "function";
  const args = parseArguments(payload.arguments);
  if (typeof payload.namespace === "string") args.namespace = payload.namespace;
  return { id, name, arguments: args };
}

function parseArguments(value: JsonValue | undefined): JsonObject {
  if (isRecord(value)) return value as JsonObject;
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (isRecord(parsed)) return parsed as JsonObject;
  } catch {
    // Fall through to raw preservation.
  }
  return { _raw: value };
}

function canonicalRole(role: string): CanonicalMessage["role"] | undefined {
  if (role === "system" || role === "developer" || role === "user" || role === "assistant" || role === "tool") return role;
  return undefined;
}
