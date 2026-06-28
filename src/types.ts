export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type Severity = "low" | "medium" | "high" | "critical";
export type DetectorName = "literal-secret" | "image" | "parse-error";
export type AboutProject = "yes" | "no" | "mixed";
export type Shareable = "yes" | "no" | "manual_review";
export type MissedSensitiveData = "yes" | "no" | "maybe";

export interface WorkspaceConfig {
  cwd: string;
  repo: string;
  noImages?: boolean;
}

export interface InitOptions {
  cwd: string;
  repo: string;
  workspace: string;
  noImages: boolean;
}

export interface CollectOptions {
  workspace: string;
  envFile: string;
  secrets: string[];
  force: boolean;
  contextFiles: string[];
  provider?: string;
  model?: string;
  thinking?: string;
  parallel: number;
  denyPatterns: RegExp[];
  session?: string;
}

export interface ReviewOptions {
  workspace: string;
  contextFiles: string[];
  provider?: string;
  model?: string;
  thinking?: string;
  parallel: number;
  denyPatterns: RegExp[];
  session?: string;
}

export type TruffleHogFindingStatus = "verified" | "unverified" | "unknown";

export interface TruffleHogFinding {
  detector: string;
  decoder?: string;
  status: TruffleHogFindingStatus;
  line?: number;
  raw_sha256?: string;
  masked: string;
  verification_from_cache: boolean;
}

export interface TruffleHogSummary {
  findings: number;
  verified: number;
  unverified: number;
  unknown: number;
  top_detectors: string[];
}

export interface TruffleHogReport {
  file: string;
  redacted_hash: string;
  findings: TruffleHogFinding[];
  summary: TruffleHogSummary;
}

export interface UploadOptions {
  workspace: string;
  dryRun: boolean;
}

export interface RejectOptions {
  workspace: string;
  target: string;
}

export interface ListOptions {
  workspace: string;
  uploadable: boolean;
}

export interface GrepOptions {
  workspace: string;
  pattern: string;
  ignoreCase: boolean;
}

export interface DiscoverOptions {
  root: string;
  output?: string;
  source?: NormalizeSource | "all";
}

export interface DiscoveredTrace {
  source: Exclude<NormalizeSource, "auto">;
  normalize_source: Exclude<NormalizeSource, "auto">;
  path: string;
  kind: "jsonl" | "markdown" | "unknown";
  confidence: "high" | "medium" | "low";
  reason: string;
}

export type NormalizeSource =
  | "auto"
  | "pi"
  | "claude-code"
  | "codex"
  | "cursor"
  | "opencode"
  | "continue"
  | "goose"
  | "openai-chat"
  | "anthropic-messages"
  | "markdown-transcript"
  | "aider";

export interface NormalizeOptions {
  source: NormalizeSource;
  input: string;
  output: string;
  agent?: string;
  model?: string;
}

export interface NormalizeDirOptions {
  source: NormalizeSource;
  inputDir: string;
  output: string;
  agent?: string;
  model?: string;
}

export type RenderFormat = "openai-chat" | "anthropic-messages" | "chatml" | "sharegpt" | "sft-text" | "ornith-qwen-xml";

export interface RenderOptions {
  format: RenderFormat;
  input: string;
  output: string;
}

export interface ValidateOptions {
  input: string;
}

export type CanonicalContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; mime_type?: string; data?: string };

export interface CanonicalToolCall {
  id: string;
  name: string;
  arguments: JsonObject;
}

export interface CanonicalMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool";
  content?: CanonicalContentBlock[];
  reasoning?: CanonicalContentBlock[];
  tool_calls?: CanonicalToolCall[];
  tool_call_id?: string;
  name?: string;
  metadata?: JsonObject;
}

export interface CanonicalTrace {
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

export interface Finding {
  detector: DetectorName;
  severity: Severity;
  jsonPath: string;
  replacement: string;
  count: number;
  detail?: string;
  manual_review?: boolean;
}

export interface RedactionResult {
  redacted: JsonObject;
  findings: Finding[];
}

export interface LocalManifestEntry {
  file: string;
  source_file: string;
  source_hash: string;
  redaction_key: string;
  redacted_hash: string;
  entry_count: number;
  findings: number;
  lines_with_findings: number;
}

export interface RemoteManifestEntry {
  file: string;
  source_hash: string;
  redaction_key?: string;
  redacted_hash: string;
}

export interface ReviewFlaggedPart {
  reason: string;
  evidence: string;
  chunk_index?: number;
}

export interface ChunkReviewResult {
  about_project: AboutProject;
  shareable: Shareable;
  missed_sensitive_data: MissedSensitiveData;
  flagged_parts: ReviewFlaggedPart[];
  summary: string;
}

export interface SessionReviewFile {
  file: string;
  context_files: string[];
  context_hashes: Record<string, string>;
  provider?: string;
  model?: string;
  redacted_hash: string;
  review_key: string;
  prompt_version: number;
  chunk_count: number;
  chunk_char_limit: number;
  chunks: Array<{
    chunk_index: number;
    chunk_file: string;
    chars: number;
    result?: ChunkReviewResult;
    error?: string;
  }>;
  aggregate: ChunkReviewResult;
}

export const CHARS_PER_REVIEW_TOKEN = 5;
export const REVIEW_TOKEN_LIMIT = 100_000;
export const REVIEW_CHUNK_CHAR_LIMIT = CHARS_PER_REVIEW_TOKEN * REVIEW_TOKEN_LIMIT;
export const REVIEW_PROMPT_VERSION = 4;
export const REDACTION_VERSION = 1;
export const REMOTE_MANIFEST_FILE = "manifest.jsonl";
export const WORKSPACE_CONFIG_FILE = "workspace.json";
export const LOCAL_MANIFEST_FILE = "manifest.local.jsonl";
export const REMOTE_MANIFEST_CACHE_FILE = "remote-manifest.jsonl";
export const REJECT_FILE = "reject.txt";
export const REVIEW_TOOL_RESULT_MAX_CHARS = 2000;
export const REVIEW_JSON_VALUE_MAX_CHARS = 4000;
export const TRUFFLEHOG_REPORT_SUFFIX = ".trufflehog.json";
