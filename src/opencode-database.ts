import type { JsonObject, JsonValue } from "./types.ts";
import { isRecord } from "./workspace.ts";

type SqlRow = Record<string, unknown>;
interface SqlStatement {
  all(...params: unknown[]): SqlRow[];
}
interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  close(): void;
}
type SqlDatabaseConstructor = new (path: string, options: Record<string, boolean>) => SqlDatabase;

const REQUIRED_TABLES = ["session", "message", "part"] as const;

export async function readOpenCodeDatabase(inputPath: string): Promise<JsonObject[][]> {
  const database = await openReadOnlyDatabase(inputPath);
  try {
    assertOpenCodeSchema(database);
    database.exec("BEGIN");
    try {
      const sessions = database.prepare(`
        SELECT id, project_id, workspace_id, parent_id, slug, directory, path, title,
          agent, model, version, summary_additions, summary_deletions, summary_files,
          summary_diffs, metadata, cost, tokens_input, tokens_output, tokens_reasoning,
          tokens_cache_read, tokens_cache_write, time_created, time_updated,
          time_compacting, time_archived
        FROM session
        ORDER BY time_created, id
      `).all() as SqlRow[];
      const messages = database.prepare(`
        SELECT id, session_id, data
        FROM message
        ORDER BY session_id, time_created, id
      `).all() as SqlRow[];
      const parts = database.prepare(`
        SELECT id, session_id, message_id, data
        FROM part
        ORDER BY session_id, message_id, id
      `).all() as SqlRow[];

      const partsByMessage = groupParts(parts);
      const messagesBySession = groupMessages(messages, partsByMessage);
      const exports = sessions.map((row) => [{
        info: sessionInfo(row),
        messages: messagesBySession.get(requireString(row, "id", "session")) ?? [],
        _source_format: "opencode-sqlite",
      } satisfies JsonObject]);
      database.exec("COMMIT");
      return exports;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

async function openReadOnlyDatabase(inputPath: string): Promise<SqlDatabase> {
  const isBun = typeof process.versions.bun === "string";
  const specifier = isBun ? "bun:sqlite" : "node:sqlite";
  const sqlite = await import(specifier) as Record<string, unknown>;
  const Constructor = (isBun ? sqlite.Database : sqlite.DatabaseSync) as SqlDatabaseConstructor | undefined;
  if (!Constructor) throw new Error(`SQLite driver is unavailable in ${isBun ? "Bun" : "Node.js"}`);
  return new Constructor(inputPath, isBun ? { readonly: true, strict: true } : { readOnly: true });
}

function assertOpenCodeSchema(database: SqlDatabase): void {
  const rows = database.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN ('session', 'message', 'part')
  `).all() as SqlRow[];
  const tables = new Set(rows.map((row) => row.name).filter((name): name is string => typeof name === "string"));
  const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
  if (missing.length > 0) throw new Error(`Not a supported OpenCode database; missing table(s): ${missing.join(", ")}`);
}

function groupParts(rows: SqlRow[]): Map<string, JsonObject[]> {
  const grouped = new Map<string, JsonObject[]>();
  for (const row of rows) {
    const messageId = requireString(row, "message_id", "part");
    const value = {
      ...parseObject(row.data, `part ${String(row.id)}`),
      id: requireString(row, "id", "part"),
      sessionID: requireString(row, "session_id", "part"),
      messageID: messageId,
    } satisfies JsonObject;
    const current = grouped.get(messageId);
    if (current) current.push(value);
    else grouped.set(messageId, [value]);
  }
  return grouped;
}

function groupMessages(rows: SqlRow[], partsByMessage: Map<string, JsonObject[]>): Map<string, JsonObject[]> {
  const grouped = new Map<string, JsonObject[]>();
  for (const row of rows) {
    const id = requireString(row, "id", "message");
    const sessionId = requireString(row, "session_id", "message");
    const value = {
      info: {
        ...parseObject(row.data, `message ${id}`),
        id,
        sessionID: sessionId,
      },
      parts: partsByMessage.get(id) ?? [],
    } satisfies JsonObject;
    const current = grouped.get(sessionId);
    if (current) current.push(value);
    else grouped.set(sessionId, [value]);
  }
  return grouped;
}

function sessionInfo(row: SqlRow): JsonObject {
  const info: JsonObject = {
    id: requireString(row, "id", "session"),
    projectID: requireString(row, "project_id", "session"),
    slug: requireString(row, "slug", "session"),
    directory: requireString(row, "directory", "session"),
    title: requireString(row, "title", "session"),
    version: requireString(row, "version", "session"),
    time: compact({
      created: row.time_created,
      updated: row.time_updated,
      compacting: row.time_compacting,
      archived: row.time_archived,
    }),
    tokens: {
      input: numberOrZero(row.tokens_input),
      output: numberOrZero(row.tokens_output),
      reasoning: numberOrZero(row.tokens_reasoning),
      cache: {
        read: numberOrZero(row.tokens_cache_read),
        write: numberOrZero(row.tokens_cache_write),
      },
    },
    cost: numberOrZero(row.cost),
  };

  assignString(info, "workspaceID", row.workspace_id);
  assignString(info, "parentID", row.parent_id);
  assignString(info, "path", row.path);
  assignString(info, "agent", row.agent);
  assignJson(info, "model", parseOptionalJson(row.model, "session model"));
  assignJson(info, "metadata", parseOptionalJson(row.metadata, "session metadata"));

  if (row.summary_additions !== null || row.summary_deletions !== null || row.summary_files !== null) {
    info.summary = compact({
      additions: numberOrZero(row.summary_additions),
      deletions: numberOrZero(row.summary_deletions),
      files: numberOrZero(row.summary_files),
      diffs: parseOptionalJson(row.summary_diffs, "session summary diffs"),
    });
  }
  return info;
}

function parseObject(value: unknown, label: string): JsonObject {
  const parsed = parseOptionalJson(value, label);
  if (!isRecord(parsed)) throw new Error(`Invalid OpenCode ${label}: expected a JSON object`);
  return parsed as JsonObject;
}

function parseOptionalJson(value: unknown, label: string): JsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") {
    if (isJsonValue(value)) return value;
    throw new Error(`Invalid OpenCode ${label}: unsupported SQLite value`);
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isJsonValue(parsed)) throw new Error("expected JSON-compatible data");
    return parsed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid OpenCode ${label}: ${reason}`);
  }
}

function compact(values: Record<string, unknown>): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && isJsonValue(value)) output[key] = value;
  }
  return output;
}

function assignString(target: JsonObject, key: string, value: unknown): void {
  if (typeof value === "string" && value) target[key] = value;
}

function assignJson(target: JsonObject, key: string, value: JsonValue | undefined): void {
  if (value !== undefined) target[key] = value;
}

function requireString(row: SqlRow, key: string, table: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error(`Invalid OpenCode ${table}.${key}`);
  return value;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}
