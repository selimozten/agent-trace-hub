import fs from "node:fs";
import path from "node:path";
import { isV1Source } from "./source-adapters.ts";
import type { DiscoverOptions, DiscoveredTrace, NormalizeSource } from "./types.ts";
import { isRecord } from "./workspace.ts";

type ConcreteSource = Exclude<NormalizeSource, "auto">;

interface DiscoveryPattern {
  source: ConcreteSource;
  normalizeSource: ConcreteSource;
  roots?: string[];
  exactFiles?: string[];
  extensions: string[];
  kind: DiscoveredTrace["kind"];
  confidence: DiscoveredTrace["confidence"];
  reason: string;
  requirePathPart?: string;
  exclude?: (file: string) => boolean;
  maxDepth?: number;
}

const DISCOVERY_PATTERNS: DiscoveryPattern[] = [
  {
    source: "codex",
    normalizeSource: "codex",
    roots: [".codex/sessions", ".codex/rollouts"],
    extensions: [".jsonl"],
    kind: "jsonl",
    confidence: "high",
    reason: "Codex session/rollout JSONL directory",
  },
  {
    source: "claude-code",
    normalizeSource: "claude-code",
    roots: [".claude/projects"],
    extensions: [".jsonl"],
    kind: "jsonl",
    confidence: "high",
    reason: "Claude Code project transcript JSONL directory",
    exclude: isClaudeWorkflowTelemetry,
  },
  {
    source: "cursor-agent",
    normalizeSource: "cursor-agent",
    roots: [".cursor/projects"],
    extensions: [".jsonl"],
    kind: "jsonl",
    confidence: "high",
    reason: "Cursor Agent CLI transcript JSONL directory",
    requirePathPart: "agent-transcripts",
  },
  {
    source: "opencode",
    normalizeSource: "opencode",
    exactFiles: [".local/share/opencode/opencode.db"],
    extensions: [".db"],
    kind: "sqlite",
    confidence: "high",
    reason: "OpenCode native SQLite session store",
  },
  {
    source: "continue",
    normalizeSource: "continue",
    roots: [".continue/sessions"],
    extensions: [".json"],
    kind: "json",
    confidence: "high",
    reason: "Continue native CLI session JSON directory",
  },
  {
    source: "continue",
    normalizeSource: "continue",
    roots: [".config/continue"],
    extensions: [".jsonl"],
    kind: "jsonl",
    confidence: "medium",
    reason: "Continue OpenAI-compatible JSONL candidate",
  },
  {
    source: "goose",
    normalizeSource: "goose",
    roots: [".config/goose", ".local/share/goose"],
    extensions: [".jsonl"],
    kind: "jsonl",
    confidence: "medium",
    reason: "Goose local/export JSONL candidate",
  },
  {
    source: "omp",
    normalizeSource: "omp",
    roots: [".omp/agent/sessions", ".omp/sessions"],
    extensions: [".jsonl"],
    kind: "jsonl",
    confidence: "high",
    reason: "Oh My Pi native session JSONL directory",
  },
  {
    source: "pi",
    normalizeSource: "pi",
    roots: [".pi/agent/sessions", ".pi/sessions"],
    extensions: [".jsonl"],
    kind: "jsonl",
    confidence: "high",
    reason: "Pi native session JSONL directory",
  },
  {
    source: "aider",
    normalizeSource: "aider",
    exactFiles: [".aider.chat.history.md", "aider-history.md"],
    extensions: [".md"],
    kind: "markdown",
    confidence: "high",
    reason: "Aider markdown chat history file at scan root",
  },
];

const EXCLUDED_DIRS = new Set([
  ".git",
  "Cache",
  "cache",
  "Caches",
  "node_modules",
  "tmp",
]);

const DEFAULT_MAX_DEPTH = 8;
const MAX_FILES_PER_PATTERN = 20_000;

export async function runDiscover(options: DiscoverOptions): Promise<void> {
  const traces = discoverTraces(options);
  const jsonl = traces.map((trace) => JSON.stringify(trace)).join("\n") + (traces.length > 0 ? "\n" : "");

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, jsonl);
    console.log(`Wrote discovered trace manifest: ${options.output}`);
    console.log(`Candidates: ${traces.length}`);
    return;
  }

  process.stdout.write(jsonl);
}

export function discoverTraces(options: DiscoverOptions): DiscoveredTrace[] {
  const root = path.resolve(options.root);
  const requestedSource = options.source ?? "v1";
  const sourceFilter = requestedSource === "cursor"
    ? "cursor-agent"
    : requestedSource !== "all" && requestedSource !== "v1" ? requestedSource : undefined;
  const discovered: DiscoveredTrace[] = [];

  for (const pattern of DISCOVERY_PATTERNS) {
    if (requestedSource === "v1" && !isV1Source(pattern.source)) continue;
    if (sourceFilter && pattern.source !== sourceFilter) continue;
    for (const file of exactFiles(root, pattern)) {
      discovered.push(toDiscoveredTrace(file, pattern));
    }
    for (const file of rootedFiles(root, pattern)) {
      discovered.push(toDiscoveredTrace(file, pattern));
    }
  }

  return dedupe(discovered).sort((left, right) => left.path.localeCompare(right.path) || left.source.localeCompare(right.source));
}

function exactFiles(root: string, pattern: DiscoveryPattern): string[] {
  const exactFiles = pattern.exactFiles ?? [];
  return exactFiles
    .map((file) => path.join(root, file))
    .filter((file) => isFile(file) && hasAllowedExtension(file, pattern));
}

function rootedFiles(root: string, pattern: DiscoveryPattern): string[] {
  const roots = pattern.roots ?? [];
  const matches: string[] = [];
  for (const relativeRoot of roots) {
    const scanRoot = path.join(root, relativeRoot);
    if (!isDirectory(scanRoot)) continue;
    walk(scanRoot, pattern, 0, matches);
  }
  return matches;
}

function walk(current: string, pattern: DiscoveryPattern, depth: number, matches: string[]): void {
  if (matches.length >= MAX_FILES_PER_PATTERN) return;
  if (depth > (pattern.maxDepth ?? DEFAULT_MAX_DEPTH)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (matches.length >= MAX_FILES_PER_PATTERN) return;
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walk(fullPath, pattern, depth + 1, matches);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!hasAllowedExtension(fullPath, pattern)) continue;
    const pathParts = fullPath.split(path.sep);
    if (pattern.requirePathPart && !pathParts.includes(pattern.requirePathPart)) continue;
    if (pattern.exclude?.(fullPath)) continue;
    matches.push(fullPath);
  }
}

function toDiscoveredTrace(file: string, pattern: DiscoveryPattern): DiscoveredTrace {
  return {
    source: pattern.source,
    normalize_source: pattern.normalizeSource,
    path: file,
    kind: pattern.kind,
    confidence: pattern.confidence,
    reason: pattern.reason,
  };
}

function hasAllowedExtension(file: string, pattern: DiscoveryPattern): boolean {
  const extension = path.extname(file).toLowerCase();
  return pattern.extensions.includes(extension);
}

function isFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isClaudeWorkflowTelemetry(file: string): boolean {
  const record = readFirstJsonlRecord(file);
  if (!record || (record.type !== "started" && record.type !== "result")) return false;
  return typeof record.agentId === "string"
    && typeof record.key === "string"
    && typeof record.sessionId !== "string"
    && !isRecord(record.message);
}

function readFirstJsonlRecord(file: string): Record<string, unknown> | undefined {
  const maxBytes = 64 * 1024;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(file, "r");
    const buffer = Buffer.allocUnsafe(maxBytes);
    const bytesRead = fs.readSync(descriptor, buffer, 0, maxBytes, 0);
    const text = buffer.toString("utf-8", 0, bytesRead);
    const line = text.split(/\r?\n/).find((candidate) => candidate.trim() !== "");
    if (!line) return undefined;
    const parsed = JSON.parse(line) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function dedupe(traces: DiscoveredTrace[]): DiscoveredTrace[] {
  const seen = new Set<string>();
  const unique: DiscoveredTrace[] = [];
  for (const trace of traces) {
    const key = `${trace.source}\0${trace.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(trace);
  }
  return unique;
}
