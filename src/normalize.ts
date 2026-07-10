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
import { readOpenCodeDatabase } from "./opencode-database.ts";
import { SourceAdapterRegistry, type SourceAdapter, type SourceAdapterImplementations } from "./source-adapters.ts";
import { isRecord } from "./workspace.ts";

type BaseTraceOverrides = Partial<CanonicalTrace["source"]> & {
  session_id?: string;
  tools?: JsonObject[];
  metadata?: JsonObject;
};

class JsonlRecordError extends Error {}

const ADAPTER_IMPLEMENTATIONS: SourceAdapterImplementations = {
  pi: { detect: detectPi, normalize: normalizePiSession },
  "claude-code": { detect: detectClaudeCode, normalize: normalizeClaudeCodeSession },
  codex: { detect: detectCodex, normalize: normalizeCodexSession },
  omp: { detect: detectOmp, normalize: normalizeOmpSession },
  "cursor-agent": { detect: detectCursorAgent, normalize: normalizeCursorAgentSession },
  cursor: { detect: detectCursorAgent, normalize: normalizeCursorAgentSession },
  "anthropic-messages": { detect: detectAnthropicMessages, normalize: normalizeAnthropicMessagesSession },
  opencode: { detect: detectOpenCode, normalize: normalizeOpenCodeSession },
  continue: { detect: detectContinue, normalize: normalizeContinueSession },
  goose: { detect: detectGoose, normalize: normalizeGooseSession },
  "openai-chat": { detect: detectOpenAIChat, normalize: normalizeOpenAIChatSession },
  "generic-json": { detect: detectGenericJsonChat, normalize: normalizeGenericJsonSession },
  aider: { detect: detectAider, normalize: normalizeMarkdownTranscriptSession },
  "markdown-transcript": { detect: detectMarkdownTranscript, normalize: normalizeMarkdownTranscriptSession },
};

const ADAPTER_REGISTRY = new SourceAdapterRegistry(ADAPTER_IMPLEMENTATIONS);

export async function runNormalize(options: NormalizeOptions): Promise<void> {
  const { source, traces } = await normalizeFileToTraces(options);
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, traces.map((trace) => JSON.stringify(trace)).join("\n") + "\n");
  console.log(`Wrote canonical traces: ${options.output}`);
  console.log(`Source: ${source}`);
  console.log(`Traces: ${traces.length}`);
  console.log(`Messages: ${traces.reduce((total, trace) => total + trace.messages.length, 0)}`);
}

export async function runNormalizeDir(options: NormalizeDirOptions): Promise<void> {
  const files = findJsonlFiles(options.inputDir);
  if (files.length === 0) throw new Error(`No supported input files found in ${options.inputDir}`);
  const traces: CanonicalTrace[] = [];

  for (const file of files) {
    const { traces: fileTraces } = await normalizeFileToTraces({
      source: options.source,
      input: file,
      output: options.output,
      agent: options.agent,
      model: options.model,
      skipInvalidLines: options.skipInvalidLines,
    });
    traces.push(...fileTraces);
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, traces.map((trace) => JSON.stringify(trace)).join("\n") + "\n");
  console.log(`Wrote canonical traces: ${options.output}`);
  console.log(`Files: ${files.length}`);
  console.log(`Traces: ${traces.length}`);
}

export async function normalizeFileToTrace(options: NormalizeOptions): Promise<{ source: Exclude<NormalizeSource, "auto">; trace: CanonicalTrace }> {
  const result = await normalizeFileToTraces(options);
  if (result.traces.length !== 1) throw new Error(`Expected one trace from ${options.input}, found ${result.traces.length}`);
  return { source: result.source, trace: result.traces[0] };
}

export async function normalizeFileToTraces(options: NormalizeOptions): Promise<{ source: Exclude<NormalizeSource, "auto">; traces: CanonicalTrace[] }> {
  if (isOpenCodeDatabaseInput(options.input, options.source)) {
    if (options.source !== "auto" && options.source !== "opencode") {
      throw new Error(`OpenCode database input requires --source auto or opencode, received ${options.source}`);
    }
    const traces = (await readOpenCodeDatabase(options.input))
      .filter((records) => Array.isArray(records[0]?.messages) && records[0].messages.length > 0)
      .map((records) => normalizeRecords(options.input, records, { ...options, source: "opencode" }, false).trace)
      .filter((trace) => trace.messages.length > 0);
    if (traces.length === 0) throw new Error(`No non-empty OpenCode sessions found in ${options.input}`);
    for (const trace of traces) {
      try {
        validateCanonicalTrace(trace);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid OpenCode session ${trace.session_id} from ${options.input}: ${reason}`);
      }
    }
    return { source: "opencode", traces };
  }

  const records = await readInputRecords(options.input, options.skipInvalidLines);
  const { adapter, trace } = normalizeRecords(options.input, records, options);
  return { source: adapter.source, traces: [trace] };
}

function normalizeRecords(inputPath: string, records: JsonObject[], options: NormalizeOptions, validate = true): { adapter: SourceAdapter; trace: CanonicalTrace } {
  const source = options.source === "auto" ? inferSourceFromPath(inputPath) ?? "auto" : options.source;
  const adapter = ADAPTER_REGISTRY.resolve(source, records);
  const trace = adapter.normalize(inputPath, records, { ...options, source });
  if (validate) validateCanonicalTrace(trace);
  return { adapter, trace };
}

function findJsonlFiles(inputDir: string): string[] {
  const out: string[] = [];
  const entries = fs.readdirSync(inputDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(inputDir, entry.name);
    if (entry.isDirectory()) out.push(...findJsonlFiles(fullPath));
    else if (entry.isFile() && isSupportedInputFile(entry.name)) out.push(fullPath);
  }
  return out.sort();
}

async function readInputRecords(inputPath: string, skipInvalidLines = false): Promise<JsonObject[]> {
  if (!inputPath.endsWith(".jsonl")) {
    const text = fs.readFileSync(inputPath, "utf-8");
    if (inputPath.endsWith(".json")) return parseJsonDocument(text, inputPath);
    return [{ _raw_text: text, _raw_format: path.extname(inputPath).slice(1) || "text" }];
  }

  return readStableJsonlRecords(inputPath, skipInvalidLines);
}

async function readStableJsonlRecords(inputPath: string, skipInvalidLines: boolean): Promise<JsonObject[]> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const before = fileVersion(inputPath);
    let records: JsonObject[] | undefined;
    let readError: unknown;
    try {
      records = await readJsonlRecordsOnce(inputPath, skipInvalidLines);
    } catch (error) {
      readError = error;
    }

    const changed = !sameFileVersion(before, fileVersion(inputPath));
    if (changed && attempt < maxAttempts) {
      await waitForWriter(attempt);
      continue;
    }
    if (changed) throw new Error(`Input changed while reading ${inputPath}; retry after the writer is idle`);
    if (readError instanceof JsonlRecordError && attempt < maxAttempts) {
      await waitForWriter(attempt);
      continue;
    }
    if (readError) throw readError;
    return records as JsonObject[];
  }
  throw new Error(`Could not read stable input: ${inputPath}`);
}

async function readJsonlRecordsOnce(inputPath: string, skipInvalidLines: boolean): Promise<JsonObject[]> {
  const input = fs.createReadStream(inputPath, { encoding: "utf-8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  const records: JsonObject[] = [];
  let lineNumber = 0;

  for await (const line of reader) {
    lineNumber += 1;
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) throw new Error("expected a JSON object");
      records.push(parsed as JsonObject);
    } catch (error) {
      if (skipInvalidLines) continue;
      const reason = error instanceof Error ? error.message : String(error);
      throw new JsonlRecordError(`Invalid JSONL record at ${inputPath}:${lineNumber}: ${reason}`);
    }
  }

  if (records.length === 0) throw new Error(`No JSON object records found in ${inputPath}`);
  return records;
}

function fileVersion(inputPath: string): { size: number; mtimeMs: number } {
  const stats = fs.statSync(inputPath);
  return { size: stats.size, mtimeMs: stats.mtimeMs };
}

function sameFileVersion(left: { size: number; mtimeMs: number }, right: { size: number; mtimeMs: number }): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function waitForWriter(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, attempt * 250));
}

function isSupportedInputFile(name: string): boolean {
  return [".jsonl", ".json", ".db", ".md", ".markdown", ".txt"].some((ext) => name.endsWith(ext));
}

function isOpenCodeDatabaseInput(inputPath: string, source: NormalizeSource): boolean {
  return path.extname(inputPath).toLowerCase() === ".db" && (source === "opencode" || path.basename(inputPath) === "opencode.db");
}

function inferSourceFromPath(inputPath: string): Exclude<NormalizeSource, "auto"> | undefined {
  const normalized = inputPath.split(path.sep).join("/");
  if (normalized.endsWith("/opencode.db")) return "opencode";
  if (normalized.includes("/.omp/") || path.basename(inputPath).startsWith("omp-")) return "omp";
  if (normalized.includes("/.pi/") || path.basename(inputPath).startsWith("pi-")) return "pi";
  if (normalized.includes("/.cursor/projects/") || path.basename(inputPath).startsWith("cursor-")) return "cursor-agent";
  return undefined;
}

function parseJsonDocument(text: string, inputPath: string): JsonObject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON document at ${inputPath}: ${reason}`);
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) throw new Error(`JSON document contains no records: ${inputPath}`);
    const records: JsonObject[] = [];
    for (const [index, item] of parsed.entries()) {
      if (!isRecord(item)) throw new Error(`Invalid JSON record at ${inputPath}[${index}]: expected an object`);
      records.push(item as JsonObject);
    }
    return records;
  }
  if (isRecord(parsed)) return [parsed as JsonObject];
  throw new Error(`Invalid JSON document at ${inputPath}: expected an object or array of objects`);
}

function baseTrace(
  inputPath: string,
  adapter: SourceAdapter,
  options: NormalizeOptions,
  overrides: BaseTraceOverrides,
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
      source_format: overrides.source_format ?? adapter.sourceFormat,
    },
    metadata: {
      source_file: inputPath,
      ...overrides.metadata,
    },
    tools: overrides.tools ?? [],
    messages,
    outcome: {
      quality: "unlabeled",
    },
  };
}

export function detectPi(records: JsonObject[]): boolean {
  return records.some((record) => record.type === "session" && typeof record.version === "number" && typeof record.id === "string")
    && records.some((record) => record.type === "message" && isRecord(record.message))
    && !detectOmp(records);
}

export function normalizePiSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  return normalizePiFamilySession(inputPath, records, options, "pi");
}

export function detectOmp(records: JsonObject[]): boolean {
  const hasSession = records.some((record) => record.type === "session" && typeof record.id === "string");
  const hasMessages = records.some((record) => record.type === "message" && isRecord(record.message));
  const hasOmpMarker = records.some((record) => record.type === "model_change" && typeof record.model === "string")
    || records.some((record) => record.type === "title" || (record.type === "session" && typeof record.titleSource === "string"));
  return hasSession && hasMessages && hasOmpMarker;
}

export function normalizeOmpSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  return normalizePiFamilySession(inputPath, records, options, "omp");
}

function normalizePiFamilySession(
  inputPath: string,
  records: JsonObject[],
  options: NormalizeOptions,
  source: "pi" | "omp",
): CanonicalTrace {
  const adapter = adapterFor(source);
  const messages: CanonicalMessage[] = [];
  let sessionId = path.basename(inputPath, ".jsonl");
  let cwd: string | undefined;
  let exportedAt: string | undefined;
  let model = options.model;
  let provider: string | undefined;
  let title: string | undefined;
  let version: number | undefined;

  for (const entry of records) {
    if (entry.type === "session") {
      if (typeof entry.id === "string") sessionId = entry.id;
      if (typeof entry.cwd === "string") cwd = entry.cwd;
      if (typeof entry.timestamp === "string") exportedAt = entry.timestamp;
      if (typeof entry.title === "string") title = entry.title;
      if (typeof entry.version === "number") version = entry.version;
    }
  }

  const activeEntries = activeJournalBranch(records);
  for (const entry of activeEntries) {
    if (entry.type === "model_change" && (typeof entry.role !== "string" || entry.role === "default")) {
      if (source === "omp" && typeof entry.model === "string") {
        const route = splitModelRoute(entry.model);
        provider = route.provider ?? provider;
        model = options.model ?? route.model ?? model;
      } else {
        if (typeof entry.modelId === "string") model = options.model ?? entry.modelId;
        if (typeof entry.provider === "string") provider = entry.provider;
      }
      continue;
    }
    const message = readWrappedMessage(entry);
    if (!message) continue;
    if (message.role === "assistant") {
      model = options.model ?? firstString(message, ["model"]) ?? model;
      provider = firstString(message, ["provider"]) ?? provider;
    }
    messages.push(...withSourceEntryMetadata(normalizeAgentMessage(message), entry));
  }

  const metadata: JsonObject = {
    session_version: version ?? 1,
    active_leaf_id: typeof activeEntries.at(-1)?.id === "string" ? activeEntries.at(-1)?.id as string : "",
  };
  if (!metadata.active_leaf_id) delete metadata.active_leaf_id;
  if (title) metadata.title = title;
  return baseTrace(inputPath, adapter, { ...options, model }, {
    session_id: sessionId,
    cwd,
    exported_at: exportedAt,
    model,
    provider,
    metadata,
  }, messages);
}

function activeJournalBranch(records: JsonObject[]): JsonObject[] {
  const entries = records.filter((record) => record.type !== "session" && typeof record.id === "string");
  const leaf = entries.at(-1);
  if (!leaf) return records;
  const byId = new Map(entries.map((entry) => [entry.id as string, entry]));
  const branch: JsonObject[] = [];
  const seen = new Set<string>();
  let current: JsonObject | undefined = leaf;
  while (current && typeof current.id === "string" && !seen.has(current.id)) {
    seen.add(current.id);
    branch.push(current);
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : undefined;
  }
  branch.reverse();
  return branch.some((entry) => entry.type === "message") ? branch : entries;
}

function splitModelRoute(value: string): { provider?: string; model?: string } {
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return { model: value };
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}

export function detectClaudeCode(records: JsonObject[]): boolean {
  return records.some((record) => typeof record.sessionId === "string" && ["user", "assistant", "system"].includes(String(record.type)))
    || records.some((record) => isRecord(record.message) && typeof record.sessionId === "string" && typeof record.cwd === "string");
}

export function normalizeClaudeCodeSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = ADAPTER_REGISTRY.require("claude-code");
  const messages: CanonicalMessage[] = [];
  let sessionId = path.basename(inputPath, ".jsonl");
  let cwd: string | undefined;
  let exportedAt: string | undefined;
  let model = options.model;
  let activeAssistantMessageId: string | undefined;
  const activeRecords = activeClaudeBranch(records);

  for (const entry of activeRecords) {
    if (typeof entry.sessionId === "string") sessionId = entry.sessionId;
    if (typeof entry.cwd === "string") cwd = cwd ?? entry.cwd;
    if (typeof entry.timestamp === "string") exportedAt = exportedAt ?? entry.timestamp;
    const message = readWrappedMessage(entry);
    if (!message) continue;
    if (!model && typeof message.model === "string") model = message.model;
    const normalized = withSourceEntryMetadata(normalizeAgentMessage(message), entry);
    const messageId = typeof message.id === "string" ? message.id : undefined;
    if (message.role === "assistant" && messageId && messageId === activeAssistantMessageId && normalized.length === 1 && normalized[0].role === "assistant") {
      const previous = messages.at(-1);
      if (previous?.role === "assistant") mergeAssistantMessage(previous, normalized[0]);
      else messages.push(...normalized);
    } else {
      messages.push(...normalized);
    }
    activeAssistantMessageId = message.role === "assistant" && normalized.at(-1)?.role === "assistant" ? messageId : undefined;
  }

  const subagentId = claudeSubagentId(inputPath);
  const metadata: JsonObject = {};
  if (subagentId) {
    metadata.parent_session_id = sessionId;
    metadata.subagent_id = subagentId;
    sessionId = `${sessionId}:${subagentId}`;
  }
  const activeLeaf = activeRecords.at(-1)?.uuid;
  if (typeof activeLeaf === "string") metadata.active_leaf_uuid = activeLeaf;
  return baseTrace(inputPath, adapter, { ...options, model }, {
    session_id: sessionId,
    cwd,
    exported_at: exportedAt,
    model,
    provider: "anthropic",
    metadata,
  }, messages);
}

function activeClaudeBranch(records: JsonObject[]): JsonObject[] {
  const byUuid = new Map<string, JsonObject>();
  for (const record of records) {
    if (typeof record.uuid === "string") byUuid.set(record.uuid, record);
  }
  if (byUuid.size === 0) return records;

  const explicitLeaf = [...records].reverse().find((record) => record.type === "last-prompt" && typeof record.leafUuid === "string")?.leafUuid;
  const fallbackLeaf = [...records].reverse().find((record) => typeof record.uuid === "string")?.uuid;
  const leaf = typeof explicitLeaf === "string" && byUuid.has(explicitLeaf)
    ? explicitLeaf
    : typeof fallbackLeaf === "string" ? fallbackLeaf : undefined;
  if (!leaf) return records;

  const branch: JsonObject[] = [];
  const seen = new Set<string>();
  let current = byUuid.get(leaf);
  while (current && typeof current.uuid === "string" && !seen.has(current.uuid)) {
    seen.add(current.uuid);
    branch.push(current);
    current = typeof current.parentUuid === "string" ? byUuid.get(current.parentUuid) : undefined;
  }
  branch.reverse();
  return branch.some((record) => isRecord(record.message)) ? branch : records;
}

function claudeSubagentId(inputPath: string): string | undefined {
  const normalized = inputPath.split(path.sep).join("/");
  if (!normalized.includes("/subagents/")) return undefined;
  return path.basename(inputPath, path.extname(inputPath));
}

function mergeAssistantMessage(target: CanonicalMessage, incoming: CanonicalMessage): void {
  if (incoming.content) target.content = [...(target.content ?? []), ...incoming.content];
  if (incoming.reasoning) target.reasoning = [...(target.reasoning ?? []), ...incoming.reasoning];
  if (incoming.tool_calls) target.tool_calls = [...(target.tool_calls ?? []), ...incoming.tool_calls];
  if (incoming.metadata) target.metadata = { ...(target.metadata ?? {}), ...incoming.metadata };
}

export function detectCodex(records: JsonObject[]): boolean {
  return records.some((record) => record.type === "session_meta" && isRecord(record.payload))
    && records.some((record) => record.type === "response_item" && isRecord(record.payload));
}

export function normalizeCodexSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = ADAPTER_REGISTRY.require("codex");
  const messages: CanonicalMessage[] = [];
  const toolNames = new Map<string, string>();
  const persistedUserMessages = new Set(records
    .filter((record) => record.type === "response_item" && isRecord(record.payload) && record.payload.type === "message" && record.payload.role === "user")
    .map((record) => codexMessageText(record.payload as JsonObject))
    .filter(Boolean));
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
      if (typeof payload.message === "string" && persistedUserMessages.has(payload.message)) continue;
      flushPendingAssistant(messages, pendingAssistant);
      pendingAssistant = undefined;
      const text = typeof payload.message === "string" ? payload.message : "";
      if (text) messages.push({ role: "user", content: [{ type: "text", text }] });
      continue;
    }

    if (record.type === "event_msg" && payload.type === "web_search_end") {
      flushPendingAssistant(messages, pendingAssistant);
      pendingAssistant = undefined;
      const callId = firstString(payload, ["call_id"]);
      messages.push({
        role: "tool",
        tool_call_id: callId,
        name: callId ? toolNames.get(callId) ?? "web_search" : "web_search",
        content: normalizeTextLike((payload.action ?? payload.query) as JsonValue | undefined),
      });
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
      toolNames.set(toolCall.id, toolCall.name);
      pendingAssistant = pendingAssistant ?? { role: "assistant" };
      pendingAssistant.tool_calls = [...(pendingAssistant.tool_calls ?? []), toolCall];
      continue;
    }

    if (payload.type === "custom_tool_call") {
      const id = firstString(payload, ["call_id", "id"]) ?? `call_${toolNames.size + 1}`;
      const name = firstString(payload, ["name"]) ?? "custom_tool";
      toolNames.set(id, name);
      pendingAssistant = pendingAssistant ?? { role: "assistant" };
      pendingAssistant.tool_calls = [...(pendingAssistant.tool_calls ?? []), {
        id,
        name,
        arguments: parseArguments(payload.input),
      }];
      continue;
    }

    if (payload.type === "web_search_call") {
      const id = firstString(payload, ["call_id", "id"]) ?? `web_search_${toolNames.size + 1}`;
      toolNames.set(id, "web_search");
      pendingAssistant = pendingAssistant ?? { role: "assistant" };
      pendingAssistant.tool_calls = [...(pendingAssistant.tool_calls ?? []), {
        id,
        name: "web_search",
        arguments: isRecord(payload.action) ? payload.action as JsonObject : {},
      }];
      continue;
    }

    if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      flushPendingAssistant(messages, pendingAssistant);
      pendingAssistant = undefined;
      const callId = firstString(payload, ["call_id"]);
      messages.push({
        role: "tool",
        tool_call_id: callId,
        name: callId ? toolNames.get(callId) ?? "tool" : "tool",
        content: normalizeTextLike(payload.output),
      });
    }
  }

  flushPendingAssistant(messages, pendingAssistant);
  return baseTrace(inputPath, adapter, { ...options, model }, { session_id: sessionId, cwd, exported_at: exportedAt, model, provider }, messages);
}

function codexMessageText(payload: JsonObject): string {
  if (!Array.isArray(payload.content)) return "";
  return payload.content
    .map((block) => isRecord(block) && typeof block.text === "string" ? block.text : "")
    .join("");
}

export function detectCursorAgent(records: JsonObject[]): boolean {
  return records.some((record) => typeof record.role === "string" && isRecord(record.message) && Array.isArray((record.message as JsonObject).content));
}

export function normalizeCursorAgentSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = adapterFor(options.source === "cursor" ? "cursor" : "cursor-agent");
  const messages: CanonicalMessage[] = [];
  let model = options.model;
  let sessionId = path.basename(inputPath, ".jsonl");

  for (const [index, record] of records.entries()) {
    if (typeof record.sessionId === "string") sessionId = record.sessionId;
    const message = isRecord(record.message) ? record.message as JsonObject : record;
    if (!model && typeof message.model === "string") model = message.model;
    messages.push(...normalizeCursorAgentMessage(message, typeof record.role === "string" ? record.role : message.role, index));
  }

  const metadata: JsonObject = { tool_results_available: false };
  const projectKey = cursorProjectKey(inputPath);
  if (projectKey) metadata.project_key = projectKey;
  return baseTrace(inputPath, adapter, { ...options, model }, {
    session_id: sessionId,
    model,
    provider: "cursor",
    metadata,
  }, messages);
}

function normalizeCursorAgentMessage(message: JsonObject, rawRole: JsonValue | undefined, messageIndex: number): CanonicalMessage[] {
  const role = typeof rawRole === "string" ? canonicalRole(rawRole) : undefined;
  if (role === "system" || role === "developer" || role === "user") return splitUserLikeMessage(role, message.content);
  if (role !== "assistant") return [];

  const out: CanonicalMessage = { role: "assistant" };
  const content: CanonicalContentBlock[] = [];
  const reasoning: CanonicalContentBlock[] = [];
  const toolCalls: CanonicalToolCall[] = [];
  const sourceBlocks = Array.isArray(message.content) ? recordsFromArray(message.content as JsonValue[]) : [];
  for (const block of sourceBlocks) {
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      content.push({ type: "text", text: block.text });
    } else if ((block.type === "thinking" || block.type === "reasoning") && typeof (block.thinking ?? block.text) === "string") {
      reasoning.push({ type: "text", text: String(block.thinking ?? block.text) });
    } else if (block.type === "tool_use" || block.type === "toolCall") {
      toolCalls.push({
        id: firstString(block, ["id"]) ?? `call_${messageIndex + 1}_${toolCalls.length + 1}`,
        name: firstString(block, ["name"]) ?? "tool",
        arguments: isRecord(block.input)
          ? block.input as JsonObject
          : isRecord(block.arguments) ? block.arguments as JsonObject : {},
      });
    }
  }
  if (content.length > 0) out.content = content;
  if (reasoning.length > 0) out.reasoning = reasoning;
  if (toolCalls.length > 0) out.tool_calls = toolCalls;
  return Object.keys(out).length > 1 ? [out] : [];
}

function cursorProjectKey(inputPath: string): string | undefined {
  const parts = inputPath.split(path.sep);
  const transcriptIndex = parts.lastIndexOf("agent-transcripts");
  return transcriptIndex > 0 ? parts[transcriptIndex - 1] : undefined;
}

export function detectAider(records: JsonObject[]): boolean {
  const text = rawText(records);
  return text !== undefined && /aider/i.test(text) && (/^####\s+/m.test(text) || /^#\s+aider chat/i.test(text));
}

export function detectMarkdownTranscript(records: JsonObject[]): boolean {
  const text = rawText(records);
  return text !== undefined && parseMarkdownMessages(text).length > 0;
}

export function normalizeMarkdownTranscriptSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = options.source === "aider" ? adapterFor("aider") : adapterFor("markdown-transcript");
  const text = rawText(records) ?? "";
  const messages = parseMarkdownMessages(text);
  return baseTrace(inputPath, adapter, options, { session_id: path.basename(inputPath, path.extname(inputPath)) }, messages);
}

export function detectOpenCode(records: JsonObject[]): boolean {
  if (records.length !== 1) return false;
  const root = records[0];
  if (!isRecord(root.info) || typeof root.info.id !== "string" || !Array.isArray(root.messages)) return false;
  return root.messages.some((message) => isRecord(message) && isRecord(message.info) && Array.isArray(message.parts));
}

export function normalizeOpenCodeSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  if (!detectOpenCode(records)) return normalizeOpenAIChatSession(inputPath, records, options);
  const adapter = adapterFor("opencode");
  const root = records[0];
  const session = root.info as JsonObject;
  const sourceMessages = recordsFromArray(root.messages as JsonValue[]);
  const messages: CanonicalMessage[] = [];
  const seenSystem = new Set<string>();
  let model = options.model;
  let provider: string | undefined;

  const sessionModel = isRecord(session.model) ? session.model : undefined;
  model = model ?? firstString(sessionModel, ["id", "modelID", "modelId"]);
  provider = firstString(sessionModel, ["providerID", "providerId", "provider"]);

  for (const sourceMessage of sourceMessages) {
    if (!isRecord(sourceMessage.info) || !Array.isArray(sourceMessage.parts)) continue;
    const info = sourceMessage.info as JsonObject;
    const infoModel = isRecord(info.model) ? info.model : undefined;
    model = model ?? firstString(infoModel, ["id", "modelID", "modelId"]) ?? firstString(info, ["modelID", "modelId"]);
    provider = provider ?? firstString(infoModel, ["providerID", "providerId", "provider"]) ?? firstString(info, ["providerID", "providerId"]);

    if (typeof info.system === "string" && info.system && !seenSystem.has(info.system)) {
      seenSystem.add(info.system);
      messages.push({ role: "system", content: [{ type: "text", text: info.system }] });
    }
    messages.push(...normalizeOpenCodeMessage(info, recordsFromArray(sourceMessage.parts as JsonValue[])));
  }

  const metadata: JsonObject = {};
  if (typeof session.title === "string") metadata.title = session.title;
  if (typeof session.version === "string") metadata.source_version = session.version;
  if (typeof session.projectID === "string") metadata.project_id = session.projectID;
  if (typeof session.parentID === "string") metadata.parent_session_id = session.parentID;
  if (typeof session.workspaceID === "string") metadata.workspace_id = session.workspaceID;
  if (typeof session.agent === "string") metadata.session_agent = session.agent;
  if (typeof session.cost === "number") metadata.cost = session.cost;
  if (isRecord(session.tokens)) metadata.tokens = session.tokens as JsonObject;
  if (isRecord(session.metadata)) metadata.source_metadata = session.metadata as JsonObject;
  return baseTrace(inputPath, adapter, { ...options, model }, {
    session_id: session.id as string,
    cwd: typeof session.directory === "string" ? session.directory : undefined,
    exported_at: epochToIso(readEpoch(session.time, ["updated", "created"])),
    model,
    provider,
    source_format: firstString(root, ["_source_format"]),
    metadata,
  }, messages);
}

function normalizeOpenCodeMessage(info: JsonObject, parts: JsonObject[]): CanonicalMessage[] {
  const role = info.role;
  if (role !== "user" && role !== "assistant") return [];
  const out: CanonicalMessage = { role };
  const content: CanonicalContentBlock[] = [];
  const reasoning: CanonicalContentBlock[] = [];
  const toolCalls: CanonicalToolCall[] = [];
  const toolResults: CanonicalMessage[] = [];

  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string" && part.text && part.ignored !== true) {
      content.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "reasoning" && typeof part.text === "string" && part.text) {
      reasoning.push({ type: "text", text: part.text });
      continue;
    }
    if (part.type === "file") {
      content.push(...normalizeOpenCodeFilePart(part));
      continue;
    }
    if (part.type !== "tool" || typeof part.callID !== "string" || typeof part.tool !== "string") continue;
    const state = isRecord(part.state) ? part.state : {};
    toolCalls.push({
      id: part.callID,
      name: part.tool,
      arguments: isRecord(state.input) ? state.input as JsonObject : {},
    });
    const status = typeof state.status === "string" ? state.status : "unknown";
    const output = status === "completed"
      ? state.output
      : status === "error"
        ? state.error ?? (isRecord(state.metadata) ? state.metadata.output : undefined)
        : "[Tool execution was interrupted]";
    toolResults.push({
      role: "tool",
      tool_call_id: part.callID,
      name: part.tool,
      content: normalizeOpenCodeToolOutput(output as JsonValue | undefined),
      metadata: { status },
    });
  }

  if (content.length > 0) out.content = content;
  if (reasoning.length > 0 && role === "assistant") out.reasoning = reasoning;
  if (toolCalls.length > 0 && role === "assistant") out.tool_calls = toolCalls;
  const normalized = Object.keys(out).length > 1 ? [out] : [];
  return role === "assistant" ? [...normalized, ...toolResults] : normalized;
}

function normalizeOpenCodeToolOutput(value: JsonValue | undefined): CanonicalContentBlock[] {
  if (!isRecord(value)) return normalizeTextLike(value);
  const blocks: CanonicalContentBlock[] = [];
  if (typeof value.text === "string" && value.text) blocks.push({ type: "text", text: value.text });
  if (Array.isArray(value.attachments)) {
    for (const attachment of recordsFromArray(value.attachments as JsonValue[])) {
      const image = parseDataUrl(firstString(attachment, ["url"]), firstString(attachment, ["mime", "mimeType", "mime_type"]));
      if (image) blocks.push(image);
    }
  }
  return blocks.length > 0 ? blocks : normalizeTextLike(value);
}

function normalizeOpenCodeFilePart(part: JsonObject): CanonicalContentBlock[] {
  const mime = typeof part.mime === "string" ? part.mime : undefined;
  const url = typeof part.url === "string" ? part.url : undefined;
  const image = parseDataUrl(url, mime);
  if (image) return [image];
  const source = isRecord(part.source) ? part.source : undefined;
  const sourceText = isRecord(source?.text) && typeof source.text.value === "string" ? source.text.value : undefined;
  if (sourceText) return [{ type: "text", text: sourceText }];
  const label = firstString(part, ["filename"]) ?? (url && !url.startsWith("data:") ? url : "file");
  return [{ type: "text", text: `[Attached ${mime ?? "file"}: ${label}]` }];
}

export function detectContinue(records: JsonObject[]): boolean {
  if (records.length !== 1) return false;
  const root = records[0];
  return typeof root.sessionId === "string"
    && Array.isArray(root.history)
    && root.history.some((item) => isRecord(item) && isRecord(item.message) && typeof item.message.role === "string");
}

export function normalizeContinueSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  if (!detectContinue(records)) return normalizeOpenAIChatSession(inputPath, records, options);
  const adapter = adapterFor("continue");
  const root = records[0];
  const messages: CanonicalMessage[] = [];
  let pendingReasoning: CanonicalContentBlock[] = [];

  for (const item of recordsFromArray(root.history as JsonValue[])) {
    if (!isRecord(item.message)) continue;
    const message = item.message as JsonObject;
    if (message.role === "thinking") {
      pendingReasoning.push(...normalizeContentBlocks(message.content));
      continue;
    }

    if (message.role === "assistant") {
      const out: CanonicalMessage = { role: "assistant" };
      const content = normalizeContentBlocks(message.content);
      const itemReasoning = isRecord(item.reasoning) && typeof item.reasoning.text === "string"
        ? [{ type: "text" as const, text: item.reasoning.text }]
        : [];
      const toolStates = Array.isArray(item.toolCallStates) ? recordsFromArray(item.toolCallStates as JsonValue[]) : [];
      const calls = normalizeContinueToolCalls(message, toolStates);
      if (content.length > 0) out.content = content;
      const reasoning = [...pendingReasoning, ...itemReasoning];
      if (reasoning.length > 0) out.reasoning = reasoning;
      if (calls.length > 0) out.tool_calls = calls;
      pendingReasoning = [];
      if (Object.keys(out).length > 1) messages.push(out);
      messages.push(...normalizeContinueToolResults(toolStates));
      continue;
    }

    if (pendingReasoning.length > 0) {
      messages.push({ role: "assistant", reasoning: pendingReasoning });
      pendingReasoning = [];
    }
    if (message.role === "user") {
      const context = normalizeContinueContext(item.contextItems);
      const content = [...context, ...normalizeContentBlocks(message.content)];
      if (content.length > 0) messages.push({ role: "user", content });
    } else if (message.role === "system") {
      messages.push(...splitUserLikeMessage("system", message.content));
    } else if (message.role === "tool") {
      messages.push({
        role: "tool",
        tool_call_id: firstString(message, ["toolCallId", "tool_call_id"]),
        name: firstString(message, ["name"]) ?? "tool",
        content: normalizeContentBlocks(message.content),
      });
    }
  }
  if (pendingReasoning.length > 0) messages.push({ role: "assistant", reasoning: pendingReasoning });

  const metadata: JsonObject = {};
  if (typeof root.title === "string") metadata.title = root.title;
  if (typeof root.mode === "string") metadata.mode = root.mode;
  return baseTrace(inputPath, adapter, { ...options, model: options.model ?? firstString(root, ["chatModelTitle"]) }, {
    session_id: root.sessionId as string,
    cwd: typeof root.workspaceDirectory === "string" ? root.workspaceDirectory : undefined,
    model: options.model ?? firstString(root, ["chatModelTitle"]),
    metadata,
  }, messages);
}

function normalizeContinueContext(value: JsonValue | undefined): CanonicalContentBlock[] {
  if (!Array.isArray(value)) return [];
  const text = recordsFromArray(value)
    .filter((item) => typeof item.content === "string")
    .map((item) => `<context name="${typeof item.name === "string" ? item.name : "context"}">\n${item.content}\n</context>`)
    .join("\n\n");
  return text ? [{ type: "text", text }] : [];
}

function normalizeContinueToolCalls(message: JsonObject, states: JsonObject[]): CanonicalToolCall[] {
  if (states.length > 0) {
    return states.map((state, index) => {
      const call = isRecord(state.toolCall) ? state.toolCall : {};
      const fn = isRecord(call.function) ? call.function : {};
      return {
        id: firstString(state, ["toolCallId"]) ?? firstString(call, ["id"]) ?? `call_${index + 1}`,
        name: firstString(fn, ["name"]) ?? "tool",
        arguments: isRecord(state.parsedArgs) ? state.parsedArgs as JsonObject : parseArguments(fn.arguments as JsonValue | undefined),
      };
    });
  }
  const calls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  return calls.map((call, index) => normalizeOpenAIToolCall(call, index)).filter((call): call is CanonicalToolCall => call !== undefined);
}

function normalizeContinueToolResults(states: JsonObject[]): CanonicalMessage[] {
  return states.map((state) => {
    const call = isRecord(state.toolCall) ? state.toolCall : {};
    const fn = isRecord(call.function) ? call.function : {};
    const output = Array.isArray(state.output)
      ? recordsFromArray(state.output as JsonValue[]).map((item) => typeof item.content === "string" ? item.content : "").filter(Boolean).join("\n")
      : "";
    const status = typeof state.status === "string" ? state.status : "unknown";
    return {
      role: "tool" as const,
      tool_call_id: firstString(state, ["toolCallId"]) ?? firstString(call, ["id"]),
      name: firstString(fn, ["name"]) ?? "tool",
      content: [{ type: "text" as const, text: output || (status === "canceled" ? "Tool cancelled" : `[Tool ${status}]`) }],
      metadata: { status },
    };
  });
}

export function detectGoose(records: JsonObject[]): boolean {
  if (records.length !== 1) return false;
  const root = records[0];
  return typeof root.id === "string"
    && typeof root.working_dir === "string"
    && Array.isArray(root.conversation)
    && root.conversation.some((message) => isRecord(message) && typeof message.role === "string" && Array.isArray(message.content));
}

export function normalizeGooseSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  if (!detectGoose(records)) return normalizeOpenAIChatSession(inputPath, records, options);
  const adapter = adapterFor("goose");
  const root = records[0];
  const messages: CanonicalMessage[] = [];
  const toolNames = new Map<string, string>();
  for (const message of recordsFromArray(root.conversation as JsonValue[])) {
    messages.push(...normalizeGooseMessage(message, toolNames));
  }

  const modelConfig = isRecord(root.model_config) ? root.model_config : undefined;
  const model = options.model ?? firstString(modelConfig, ["model", "model_name", "modelName", "name"]);
  const provider = firstString(root, ["provider_name"]) ?? firstString(modelConfig, ["provider", "provider_name", "providerName"]);
  const metadata: JsonObject = {};
  if (typeof root.name === "string") metadata.title = root.name;
  if (typeof root.session_type === "string") metadata.session_type = root.session_type;
  if (typeof root.goose_mode === "string") metadata.mode = root.goose_mode;
  return baseTrace(inputPath, adapter, { ...options, model }, {
    session_id: root.id as string,
    cwd: root.working_dir as string,
    exported_at: firstString(root, ["updated_at", "created_at"]),
    model,
    provider,
    metadata,
  }, messages);
}

function normalizeGooseMessage(message: JsonObject, toolNames: Map<string, string>): CanonicalMessage[] {
  const sourceRole = message.role;
  if (sourceRole !== "user" && sourceRole !== "assistant") return [];
  const out: CanonicalMessage = { role: sourceRole };
  const content: CanonicalContentBlock[] = [];
  const reasoning: CanonicalContentBlock[] = [];
  const toolCalls: CanonicalToolCall[] = [];
  const toolResults: CanonicalMessage[] = [];

  for (const block of recordsFromArray(message.content as JsonValue[])) {
    if (block.type === "text" && typeof block.text === "string" && block.text) {
      content.push({ type: "text", text: block.text });
    } else if ((block.type === "thinking" || block.type === "reasoning") && typeof (block.thinking ?? block.text) === "string") {
      reasoning.push({ type: "text", text: String(block.thinking ?? block.text) });
    } else if (block.type === "image") {
      content.push({
        type: "image",
        mime_type: firstString(block, ["mimeType", "mime_type"]),
        data: typeof block.data === "string" ? block.data : undefined,
      });
    } else if (block.type === "toolRequest" || block.type === "frontendToolRequest") {
      const callResult = isRecord(block.toolCall) ? block.toolCall : undefined;
      const call = callResult?.status === "success" && isRecord(callResult.value) ? callResult.value : undefined;
      if (!call) continue;
      const id = firstString(block, ["id"]) ?? `call_${toolCalls.length + 1}`;
      const name = firstString(call, ["name"]) ?? "tool";
      toolNames.set(id, name);
      toolCalls.push({ id, name, arguments: isRecord(call.arguments) ? call.arguments as JsonObject : {} });
    } else if (block.type === "toolResponse") {
      const id = firstString(block, ["id"]);
      const result = isRecord(block.toolResult) ? block.toolResult : undefined;
      const resultContent = result?.status === "success" ? normalizeGooseToolResult(result.value as JsonValue | undefined) : normalizeTextLike(result?.error as JsonValue | undefined);
      toolResults.push({
        role: "tool",
        tool_call_id: id,
        name: id ? toolNames.get(id) ?? "tool" : "tool",
        content: resultContent,
        metadata: { status: typeof result?.status === "string" ? result.status : "unknown" },
      });
    } else if (block.type === "systemNotification" && typeof block.msg === "string") {
      content.push({ type: "text", text: block.msg });
    } else if (block.type === "actionRequired" && isRecord(block.data)) {
      content.push({ type: "text", text: JSON.stringify(block.data) });
    }
  }

  if (content.length > 0) out.content = content;
  if (sourceRole === "assistant" && reasoning.length > 0) out.reasoning = reasoning;
  if (sourceRole === "assistant" && toolCalls.length > 0) out.tool_calls = toolCalls;
  const normalized = Object.keys(out).length > 1 ? [out] : [];
  return [...normalized, ...toolResults];
}

function normalizeGooseToolResult(value: JsonValue | undefined): CanonicalContentBlock[] {
  const items = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.content)
      ? value.content
      : [];
  const blocks = normalizeContentBlocks(items as JsonValue[]);
  return blocks.length > 0 ? blocks : normalizeTextLike(value);
}

export function detectOpenAIChat(records: JsonObject[]): boolean {
  return records.some((record) => Array.isArray(record.messages))
    || records.some((record) => typeof record.role === "string" && ["system", "developer", "user", "assistant", "tool"].includes(record.role));
}

export function normalizeOpenAIChatSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const compatibilitySource = options.source === "opencode" || options.source === "continue" || options.source === "goose" ? options.source : undefined;
  const adapter = adapterFor(compatibilitySource ?? "openai-chat");
  const root = records.length === 1 && Array.isArray(records[0].messages) ? records[0] : undefined;
  const sourceMessages = root ? recordsFromArray(records[0].messages as JsonValue[]) : records;
  const messages: CanonicalMessage[] = [];
  const sessionId = typeof root?.id === "string" ? root.id : path.basename(inputPath, ".jsonl");
  const model = options.model ?? (typeof root?.model === "string" ? root.model : undefined);
  const tools = extractToolSchemas(root?.tools);

  for (const message of sourceMessages) {
    messages.push(...normalizeOpenAIChatMessage(message));
  }

  return baseTrace(inputPath, adapter, { ...options, model }, {
    session_id: sessionId,
    model,
    provider: "openai",
    source_format: compatibilitySource ? `${compatibilitySource}-openai-compatible-jsonl` : undefined,
    tools,
  }, messages);
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

export function detectAnthropicMessages(records: JsonObject[]): boolean {
  return records.some((record) => Array.isArray(record.messages) && record.messages.some((item) => isRecord(item) && hasAnthropicContent(item)))
    || records.some((record) => typeof record.role === "string" && hasAnthropicContent(record));
}

export function normalizeAnthropicMessagesSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = adapterFor("anthropic-messages");
  const root = records.length === 1 && Array.isArray(records[0].messages) ? records[0] : undefined;
  const sourceMessages = root ? recordsFromArray(records[0].messages as JsonValue[]) : records;
  const messages: CanonicalMessage[] = [];
  const sessionId = typeof root?.id === "string" ? root.id : path.basename(inputPath, ".jsonl");
  const model = options.model ?? (typeof root?.model === "string" ? root.model : undefined);
  const tools = extractToolSchemas(root?.tools);

  if (typeof root?.system === "string" && root.system) {
    messages.push({ role: "system", content: [{ type: "text", text: root.system }] });
  }
  for (const message of sourceMessages) {
    messages.push(...normalizeAgentMessage(message));
  }

  return baseTrace(inputPath, adapter, { ...options, model }, { session_id: sessionId, model, provider: "anthropic", tools }, messages);
}

export function detectGenericJsonChat(records: JsonObject[]): boolean {
  return findGenericJsonMessages(records).some((message) => normalizeGenericJsonMessage(message).length > 0);
}

export function normalizeGenericJsonSession(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace {
  const adapter = adapterFor("generic-json");
  const root = records.length === 1 ? records[0] : undefined;
  const sourceMessages = findGenericJsonMessages(records);
  const messages = sourceMessages.flatMap((message) => normalizeGenericJsonMessage(message));
  const sessionId = firstString(root, ["id", "session_id", "sessionId", "conversation_id", "conversationId", "name"]) ?? path.basename(inputPath, path.extname(inputPath));
  const model = options.model ?? firstString(root, ["model", "model_id", "modelId"]);
  const agent = options.agent ?? firstString(root, ["agent", "client", "source"]);
  const tools = extractToolSchemas(root?.tools);
  return baseTrace(inputPath, adapter, { ...options, agent, model }, { session_id: sessionId, model, tools }, messages);
}

function findGenericJsonMessages(records: JsonObject[]): JsonObject[] {
  if (records.length === 1) {
    const nested = findBestGenericMessageArray(records[0]);
    if (nested.length > 0) return nested;
  }
  return records.map((record) => unwrapGenericMessage(record)).filter((record): record is JsonObject => record !== undefined);
}

function findBestGenericMessageArray(root: JsonObject): JsonObject[] {
  const keys = ["messages", "conversation", "history", "turns", "events", "transcript", "items"];
  for (const key of keys) {
    const value = root[key];
    if (!Array.isArray(value)) continue;
    const messages = recordsFromArray(value).map((record) => unwrapGenericMessage(record)).filter((record): record is JsonObject => record !== undefined);
    if (messages.some((message) => normalizeGenericJsonMessage(message).length > 0)) return messages;
  }
  return [];
}

function unwrapGenericMessage(record: JsonObject): JsonObject | undefined {
  if (hasGenericRole(record)) return record;
  for (const key of ["message", "entry", "event", "turn"]) {
    const nested = record[key];
    if (isRecord(nested) && hasGenericRole(nested)) return nested as JsonObject;
  }
  return undefined;
}

function normalizeGenericJsonMessage(message: JsonObject): CanonicalMessage[] {
  const role = genericRole(message);
  if (!role) return [];
  const content = genericContent(message);

  if (role === "system" || role === "developer" || role === "user") {
    return splitUserLikeMessage(role, content);
  }

  if (role === "assistant") {
    const out: CanonicalMessage = { role: "assistant" };
    const reasoning = firstString(message, ["reasoning", "thinking", "thought"]);
    const contentBlocks = normalizeContentBlocks(content);
    if (reasoning) out.reasoning = [{ type: "text", text: reasoning }];
    if (contentBlocks.length > 0) out.content = contentBlocks;
    const callsValue = Array.isArray(message.tool_calls) ? message.tool_calls : Array.isArray(message.toolCalls) ? message.toolCalls : undefined;
    const calls = callsValue?.map((call, index) => normalizeOpenAIToolCall(call, index)).filter((call): call is CanonicalToolCall => call !== undefined) ?? [];
    if (calls.length > 0) out.tool_calls = calls;
    return Object.keys(out).length > 1 ? [out] : [];
  }

  return [{
    role: "tool",
    tool_call_id: firstString(message, ["tool_call_id", "toolCallId", "call_id", "callId"]),
    name: firstString(message, ["name", "tool_name", "toolName"]) ?? "tool",
    content: normalizeContentBlocks(content),
  }];
}

function hasGenericRole(record: JsonObject): boolean {
  return genericRole(record) !== undefined;
}

function genericRole(record: JsonObject): CanonicalMessage["role"] | undefined {
  const rawRole = firstString(record, ["role", "speaker", "author", "type", "kind"]);
  if (!rawRole) return undefined;
  const role = rawRole.toLowerCase();
  if (role === "system") return "system";
  if (role === "developer") return "developer";
  if (role === "user" || role === "human" || role === "request") return "user";
  if (role === "assistant" || role === "ai" || role === "model" || role === "bot" || role === "response") return "assistant";
  if (role === "tool" || role === "function" || role === "tool_result" || role === "toolresult") return "tool";
  return undefined;
}

function genericContent(record: JsonObject): JsonValue | undefined {
  for (const key of ["content", "message", "text", "value", "output", "response"]) {
    const value = record[key];
    if (typeof value === "string" || Array.isArray(value)) return value;
  }
  return undefined;
}

function firstString(record: JsonObject | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function readEpoch(value: JsonValue | undefined, keys: string[]): number | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function epochToIso(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function parseDataUrl(url: string | undefined, fallbackMime: string | undefined): CanonicalContentBlock | undefined {
  if (!url?.startsWith("data:")) return undefined;
  const comma = url.indexOf(",");
  if (comma < 0) return undefined;
  const header = url.slice(5, comma);
  const mime = header.split(";", 1)[0] || fallbackMime;
  if (!mime?.startsWith("image/")) return undefined;
  const payload = url.slice(comma + 1);
  try {
    return {
      type: "image",
      mime_type: mime,
      data: header.includes(";base64") ? payload : Buffer.from(decodeURIComponent(payload)).toString("base64"),
    };
  } catch {
    return undefined;
  }
}

function recordsFromArray(values: JsonValue[]): JsonObject[] {
  return values.filter((value): value is JsonObject => isRecord(value));
}

function extractToolSchemas(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.filter((tool): tool is JsonObject => isRecord(tool));
}

function rawText(records: JsonObject[]): string | undefined {
  const first = records[0];
  return typeof first?._raw_text === "string" ? first._raw_text : undefined;
}

function parseMarkdownMessages(text: string): CanonicalMessage[] {
  const lines = text.split(/\r?\n/);
  const messages: CanonicalMessage[] = [];
  let currentRole: CanonicalMessage["role"] | undefined;
  let current: string[] = [];

  function flush(): void {
    if (!currentRole) {
      current = [];
      return;
    }
    const body = current.join("\n").trim();
    if (body) messages.push({ role: currentRole, content: [{ type: "text", text: body }] });
    current = [];
  }

  for (const line of lines) {
    const heading = parseMarkdownRoleHeading(line);
    if (heading) {
      flush();
      currentRole = heading;
      const rest = stripMarkdownRoleHeading(line).trim();
      if (rest) current.push(rest);
      continue;
    }

    if (currentRole) current.push(line);
  }

  flush();
  return messages;
}

function parseMarkdownRoleHeading(line: string): CanonicalMessage["role"] | undefined {
  const trimmed = line.trim();
  const match = /^(?:#{1,6}\s*)?(?:\*\*)?(system|developer|user|human|assistant|ai|tool)(?:\*\*)?\s*:?\s*/i.exec(trimmed);
  if (!match) {
    if (/^####\s+/.test(trimmed)) return "user";
    return undefined;
  }
  const role = match[1].toLowerCase();
  if (role === "human") return "user";
  if (role === "ai") return "assistant";
  if (role === "system" || role === "developer" || role === "user" || role === "assistant" || role === "tool") return role;
  return undefined;
}

function stripMarkdownRoleHeading(line: string): string {
  const trimmed = line.trim();
  if (/^####\s+/.test(trimmed)) return trimmed.replace(/^####\s+/, "");
  return trimmed.replace(/^(?:#{1,6}\s*)?(?:\*\*)?(?:system|developer|user|human|assistant|ai|tool)(?:\*\*)?\s*:?\s*/i, "");
}

function hasAnthropicContent(record: JsonObject): boolean {
  return Array.isArray(record.content)
    && record.content.some((block) => isRecord(block) && ["text", "thinking", "tool_use", "tool_result"].includes(String(block.type)));
}

function adapterFor(source: Exclude<NormalizeSource, "auto">): SourceAdapter {
  return ADAPTER_REGISTRY.require(source);
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
        const args = isRecord(block.arguments)
          ? block.arguments as JsonObject
          : isRecord(block.input) ? block.input as JsonObject : {};
        toolCalls.push({ id, name, arguments: args });
      } else if (block.type === "image") {
        textBlocks.push({
          type: "image",
          mime_type: firstString(block, ["mimeType", "mime_type", "mime"]),
          data: typeof block.data === "string" ? block.data : undefined,
        });
      }
    }

    if (typeof message.content === "string" && message.content) textBlocks.push({ type: "text", text: message.content });

    const out: CanonicalMessage = { role: "assistant" };
    if (reasoningBlocks.length > 0) out.reasoning = reasoningBlocks;
    if (textBlocks.length > 0) out.content = textBlocks;
    if (toolCalls.length > 0) out.tool_calls = toolCalls;
    const metadata = agentMessageMetadata(message);
    if (Object.keys(metadata).length > 0) out.metadata = metadata;
    return Object.keys(out).length > 1 ? [out] : [];
  }

  if (role === "toolResult") {
    return [{
      role: "tool",
      tool_call_id: typeof message.toolCallId === "string" ? message.toolCallId : undefined,
      name: typeof message.toolName === "string" ? message.toolName : "tool",
      content: normalizeContentBlocks(message.content),
      metadata: {
        ...(isRecord(message.details) ? message.details as JsonObject : {}),
        ...(typeof message.isError === "boolean" ? { is_error: message.isError } : {}),
        ...(typeof message.timestamp === "number" || typeof message.timestamp === "string" ? { timestamp: message.timestamp } : {}),
      },
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

function agentMessageMetadata(message: JsonObject): JsonObject {
  const metadata: JsonObject = {};
  assignCanonicalMetadata(metadata, "model", message.model);
  assignCanonicalMetadata(metadata, "provider", message.provider);
  assignCanonicalMetadata(metadata, "stop_reason", message.stopReason ?? message.stop_reason);
  assignCanonicalMetadata(metadata, "timestamp", message.timestamp);
  assignCanonicalMetadata(metadata, "usage", message.usage);
  assignCanonicalMetadata(metadata, "attribution", message.attribution);
  assignCanonicalMetadata(metadata, "error", message.errorMessage ?? message.error);
  return metadata;
}

function withSourceEntryMetadata(messages: CanonicalMessage[], entry: JsonObject): CanonicalMessage[] {
  const sourceMetadata: JsonObject = {};
  assignCanonicalMetadata(sourceMetadata, "source_entry_id", entry.id ?? entry.uuid);
  assignCanonicalMetadata(sourceMetadata, "source_parent_id", entry.parentId ?? entry.parentUuid);
  assignCanonicalMetadata(sourceMetadata, "timestamp", entry.timestamp);
  if (Object.keys(sourceMetadata).length === 0) return messages;
  return messages.map((message) => ({
    ...message,
    metadata: { ...sourceMetadata, ...(message.metadata ?? {}) },
  }));
}

function assignCanonicalMetadata(target: JsonObject, key: string, value: JsonValue | undefined): void {
  if (value !== undefined && value !== null) target[key] = value;
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
