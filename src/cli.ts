import os from "node:os";
import path from "node:path";
import type { ApproveOptions, ArtifactKind, AuditOptions, CollectOptions, DiscoverOptions, GrepOptions, IngestOptions, InitOptions, ListOptions, NormalizeDirOptions, NormalizeOptions, RejectOptions, ReleaseOptions, RenderOptions, ReviewOptions, UploadOptions, ValidateArtifactOptions, ValidateOptions } from "./types.ts";
import { loadDenyPatterns } from "./review.ts";

export function printUsage(): void {
  console.log(`
agent-trace-hub

Usage:
  agent-trace-hub init --cwd <dir> --repo <hf-dataset-repo> --workspace <dir> [options]
  agent-trace-hub collect [--workspace <dir>] [options] [context-file...]
  agent-trace-hub review [--workspace <dir>] [options] [context-file...]
  agent-trace-hub upload [--workspace <dir>]
  agent-trace-hub reject [--workspace <dir>] <image-or-session>
  agent-trace-hub list [--workspace <dir>] --uploadable
  agent-trace-hub grep [--workspace <dir>] [--ignore-case] <pattern>
  agent-trace-hub discover [--root <dir>] [--source <source>|all] [--output <file.jsonl>]
  agent-trace-hub ingest --manifest <file.jsonl> --output <file.jsonl> [options]
  agent-trace-hub normalize --source <source> --input <file.jsonl> --output <file.jsonl> [options]
  agent-trace-hub normalize-dir --source <source> --input-dir <dir> --output <file.jsonl> [options]
  agent-trace-hub validate --input <file.jsonl>
  agent-trace-hub validate-artifact --kind <kind> --input <file>
  agent-trace-hub audit --input <file.jsonl> [--output <file.json>] [options]
  agent-trace-hub approve --audit-report <file.json> --output <file.json> --reviewer <name> [options]
  agent-trace-hub render --format <format> --input <file.jsonl> --output <file.jsonl>
  agent-trace-hub release --input <file.jsonl>... --output-dir <dir> [options]

Commands:
  init      Create a workspace and store cwd/repo configuration
  collect   Redact new or changed sessions and run LLM review
  review    Rerun LLM review only on existing redacted sessions
  upload    Upload approved redacted sessions and update manifest.jsonl in the dataset repo
  reject    Add a session to workspace/reject.txt so upload always skips it
  list      List sessions matching built-in filters
  grep      Ripgrep only the uploadable session set
  discover  Find local candidate trace files from supported coding-agent harnesses
  ingest    Normalize a mixed-source discovery manifest into one canonical shard
  normalize Convert a supported raw/redacted agent trace into agent_trace_v1
  normalize-dir Convert a directory of JSONL traces into one canonical agent_trace_v1 JSONL
  validate  Validate canonical agent_trace_v1 JSONL
  validate-artifact Validate any agent-trace-hub artifact against its JSON Schema
  audit     Audit canonical traces for deterministic release blockers
  approve   Create a human approval artifact from a passing audit report
  render    Render canonical traces into model-specific training formats
  release   Build a local publishable canonical dataset directory

Init options:
  --cwd <dir>            Working directory whose pi sessions should be collected (default: .)
  --repo <repo>          Hugging Face dataset repo name or repo id
  --organization <name>  Optional HF organization or user namespace
  --workspace <dir>      Workspace directory (default: .pi/hf-sessions)
  --no-images            Strip embedded images from redacted output

Collect options:
  --workspace <dir>      Existing workspace (default: .pi/hf-sessions)
  --env-file <path>      Secret source file (default: ~/.zshrc)
  --secret <file>|<text> Additional literal secret or line-based secret file (repeatable)
  --force                Reprocess all sessions even if source_hash matches remote manifest
  --provider <name>      pi provider override for review
  --model <id>           pi model override for review
  --thinking <level>     Thinking level override (off, minimal, low, medium, high, xhigh)
  --parallel <n>         Number of parallel LLM reviews (default: 1)
  --deny <file>|<regex>  Deny pattern: file with one regex per line, or a regex string (repeatable)
  --session <file>       Process a single session file (for testing)
  [context-file...]      Project context files for the LLM review (default: README.md, AGENTS.md if present)

Review options:
  --workspace <dir>      Existing workspace (default: .pi/hf-sessions)
  --provider <name>      pi provider override for review
  --model <id>           pi model override for review
  --thinking <level>     Thinking level override (off, minimal, low, medium, high, xhigh)
  --parallel <n>         Number of parallel LLM reviews (default: 1)
  --deny <file>|<regex>  Deny pattern: file with one regex per line, or a regex string (repeatable)
  --session <file>       Review a single session file (for testing)
  [context-file...]      Project context files for the LLM review (default: README.md, AGENTS.md if present)

Upload options:
  --workspace <dir>      Existing workspace (default: .pi/hf-sessions)
  --dry-run              Show upload stats without uploading

Reject options:
  --workspace <dir>      Existing workspace (default: .pi/hf-sessions)
  <image-or-session>     Extracted image filename or session filename to reject

List options:
  --workspace <dir>      Existing workspace (default: .pi/hf-sessions)
  --uploadable           List only sessions that would be uploaded

Grep options:
  --workspace <dir>      Existing workspace (default: .pi/hf-sessions)
  --ignore-case, -i      Case-insensitive search
  <pattern>              Ripgrep pattern to run against uploadable sessions

Discover options:
  --root <dir>            Home/root directory to scan (default: ~)
  --source <source>|all   Limit discovery to one source (default: all)
  --output <file.jsonl>   Write JSONL manifest instead of stdout

Ingest options:
  --manifest <file.jsonl> Discovery manifest JSONL from discover
  --output <file.jsonl>   Output canonical agent_trace_v1 JSONL
  --error-output <file>   Write JSONL ingest errors
  --continue-on-error     Keep ingesting remaining manifest entries after failures

Normalize options:
  --source <source>       Input source format: auto, pi, claude-code, codex, cursor, opencode, continue, goose, openai-chat, anthropic-messages, markdown-transcript, aider
  --input <file>          Source session file
  --output <file>         Output canonical agent_trace_v1 JSONL
  --input-dir <dir>       Source directory for normalize-dir
  --agent <name>          Source agent label (default: pi)
  --model <id>            Source model id if known

Validate options:
  --input <file>          Canonical agent_trace_v1 JSONL

Validate artifact options:
  --kind <kind>           agent-trace, audit, approval, discovery, ingest-error, release-manifest, release-info
  --input <file>          JSON or JSONL artifact file

Audit options:
  --input <file>          Canonical agent_trace_v1 JSONL
  --output <file.json>    Write audit report JSON
  --env-file <path>       Secret source file (default: ~/.zshrc)
  --secret <file>|<text>  Additional literal secret or line-based secret file (repeatable)
  --deny <file>|<regex>   Deny pattern: file with one regex per line, or a regex string (repeatable)
  --fail-on <mode>        any, blocking, or never (default: blocking)

Approve options:
  --audit-report <file>   Passing agent_trace_audit_v1 report
  --output <file.json>    Approval report path
  --reviewer <name>       Human reviewer name or handle
  --notes <text>          Optional approval notes

Render options:
  --format <format>       Target format: openai-chat, anthropic-messages, chatml, sharegpt, sft-text, ornith-qwen-xml
  --input <file>          Canonical agent_trace_v1 JSONL
  --output <file>         Rendered JSONL

Release options:
  --input <file>          Canonical agent_trace_v1 JSONL shard (repeatable)
  --output-dir <dir>      Output dataset directory
  --audit-report <file>   Require a passing agent_trace_audit_v1 report
  --approval-report <file> Require an approved agent_trace_approval_v1 report
  --name <name>           Dataset display name (default: agent-trace-hub canonical traces)
  --license <id>          Dataset license id/string (default: other)
  --force                 Replace an existing non-empty output directory
`);
}

export function parseInitArgs(args: string[]): InitOptions {
  let cwd = path.resolve(".");
  let repo = "";
  let organization: string | undefined;
  let workspace = path.resolve(".pi/hf-sessions");
  let noImages = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--cwd") cwd = path.resolve(requireValue(args, ++i, "--cwd"));
    else if (arg === "--repo") repo = requireValue(args, ++i, "--repo");
    else if (arg === "--organization") organization = requireValue(args, ++i, "--organization");
    else if (arg === "--workspace") workspace = path.resolve(requireValue(args, ++i, "--workspace"));
    else if (arg === "--no-images") noImages = true;
    else throw new Error(`Unknown init option: ${arg}`);
  }

  if (!repo) {
    throw new Error("init requires --repo");
  }

  if (organization && repo.includes("/")) {
    throw new Error("init accepts either --repo <name> --organization <name> or --repo <namespace/name>, not both");
  }

  const repoId = organization ? `${organization}/${repo}` : repo;
  return { cwd, repo: repoId, workspace, noImages };
}

export function parseCollectArgs(args: string[]): CollectOptions {
  let workspace = path.resolve(".pi/hf-sessions");
  let envFile = path.join(os.homedir(), ".zshrc");
  const secrets: string[] = [];
  let force = false;
  let provider: string | undefined;
  let model: string | undefined;
  let thinking: string | undefined;
  let parallel = 1;
  let session: string | undefined;
  const denyInputs: string[] = [];
  const contextFiles: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace") workspace = path.resolve(requireValue(args, ++i, "--workspace"));
    else if (arg === "--env-file") envFile = path.resolve(requireValue(args, ++i, "--env-file"));
    else if (arg === "--secret") secrets.push(requireValue(args, ++i, "--secret"));
    else if (arg === "--force") force = true;
    else if (arg === "--provider") provider = requireValue(args, ++i, "--provider");
    else if (arg === "--model") model = requireValue(args, ++i, "--model");
    else if (arg === "--thinking") thinking = requireValue(args, ++i, "--thinking");
    else if (arg === "--parallel") parallel = parseInt(requireValue(args, ++i, "--parallel"), 10);
    else if (arg === "--deny") denyInputs.push(requireValue(args, ++i, "--deny"));
    else if (arg === "--session") session = requireValue(args, ++i, "--session");
    else contextFiles.push(arg);
  }

  if (!workspace) {
    throw new Error("collect requires --workspace");
  }
  if (parallel < 1 || !Number.isFinite(parallel)) parallel = 1;

  return { workspace, envFile, secrets, force, contextFiles, provider, model, thinking, parallel, denyPatterns: loadDenyPatterns(denyInputs), session };
}

export function parseReviewArgs(args: string[]): ReviewOptions {
  let workspace = path.resolve(".pi/hf-sessions");
  let provider: string | undefined;
  let model: string | undefined;
  let thinking: string | undefined;
  let parallel = 1;
  let session: string | undefined;
  const denyInputs: string[] = [];
  const contextFiles: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace") workspace = path.resolve(requireValue(args, ++i, "--workspace"));
    else if (arg === "--provider") provider = requireValue(args, ++i, "--provider");
    else if (arg === "--model") model = requireValue(args, ++i, "--model");
    else if (arg === "--thinking") thinking = requireValue(args, ++i, "--thinking");
    else if (arg === "--parallel") parallel = parseInt(requireValue(args, ++i, "--parallel"), 10);
    else if (arg === "--deny") denyInputs.push(requireValue(args, ++i, "--deny"));
    else if (arg === "--session") session = requireValue(args, ++i, "--session");
    else contextFiles.push(arg);
  }

  if (!workspace) {
    throw new Error("review requires --workspace");
  }

  if (parallel < 1 || !Number.isFinite(parallel)) parallel = 1;

  return { workspace, contextFiles, provider, model, thinking, parallel, denyPatterns: loadDenyPatterns(denyInputs), session };
}

export function parseUploadArgs(args: string[]): UploadOptions {
  let workspace = path.resolve(".pi/hf-sessions");
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace") workspace = path.resolve(requireValue(args, ++i, "--workspace"));
    else if (arg === "--dry-run") dryRun = true;
    else throw new Error(`Unknown upload option: ${arg}`);
  }

  if (!workspace) {
    throw new Error("upload requires --workspace");
  }

  return { workspace, dryRun };
}

export function parseRejectArgs(args: string[]): RejectOptions {
  let workspace = path.resolve(".pi/hf-sessions");
  let target = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace") workspace = path.resolve(requireValue(args, ++i, "--workspace"));
    else if (!target) target = arg;
    else throw new Error(`Unknown reject option: ${arg}`);
  }

  if (!target) {
    throw new Error("reject requires a target filename");
  }

  return { workspace, target };
}

export function parseListArgs(args: string[]): ListOptions {
  let workspace = path.resolve(".pi/hf-sessions");
  let uploadable = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace") workspace = path.resolve(requireValue(args, ++i, "--workspace"));
    else if (arg === "--uploadable") uploadable = true;
    else throw new Error(`Unknown list option: ${arg}`);
  }

  return { workspace, uploadable };
}

export function parseGrepArgs(args: string[]): GrepOptions {
  let workspace = path.resolve(".pi/hf-sessions");
  let pattern = "";
  let ignoreCase = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--workspace") workspace = path.resolve(requireValue(args, ++i, "--workspace"));
    else if (arg === "--ignore-case" || arg === "-i") ignoreCase = true;
    else if (!pattern) pattern = arg;
    else throw new Error(`Unknown grep option: ${arg}`);
  }

  if (!pattern) {
    throw new Error("grep requires a pattern");
  }

  return { workspace, pattern, ignoreCase };
}

export function parseDiscoverArgs(args: string[]): DiscoverOptions {
  let root = os.homedir();
  let source: DiscoverOptions["source"] = "all";
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--root") root = path.resolve(requireValue(args, ++i, "--root"));
    else if (arg === "--source") {
      const value = requireValue(args, ++i, "--source");
      if (value !== "all" && !isNormalizeSource(value)) {
        throw new Error(`discover --source must be all or one of: ${normalizeSourceList()}`);
      }
      source = value as DiscoverOptions["source"];
    } else if (arg === "--output") output = path.resolve(requireValue(args, ++i, "--output"));
    else throw new Error(`Unknown discover option: ${arg}`);
  }

  if (source === "auto") {
    throw new Error("discover --source does not accept auto; use all or a concrete source");
  }

  return { root, source, output };
}

export function parseIngestArgs(args: string[]): IngestOptions {
  let manifest = "";
  let output = "";
  let errorOutput: string | undefined;
  let continueOnError = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--manifest") manifest = path.resolve(requireValue(args, ++i, "--manifest"));
    else if (arg === "--output") output = path.resolve(requireValue(args, ++i, "--output"));
    else if (arg === "--error-output") errorOutput = path.resolve(requireValue(args, ++i, "--error-output"));
    else if (arg === "--continue-on-error") continueOnError = true;
    else throw new Error(`Unknown ingest option: ${arg}`);
  }

  if (!manifest) throw new Error("ingest requires --manifest");
  if (!output) throw new Error("ingest requires --output");
  return { manifest, output, errorOutput, continueOnError };
}

export function parseNormalizeArgs(args: string[]): NormalizeOptions {
  let source = "auto";
  let input = "";
  let output = "";
  let agent: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source") source = requireValue(args, ++i, "--source");
    else if (arg === "--input") input = path.resolve(requireValue(args, ++i, "--input"));
    else if (arg === "--output") output = path.resolve(requireValue(args, ++i, "--output"));
    else if (arg === "--agent") agent = requireValue(args, ++i, "--agent");
    else if (arg === "--model") model = requireValue(args, ++i, "--model");
    else throw new Error(`Unknown normalize option: ${arg}`);
  }

  if (!isNormalizeSource(source)) {
    throw new Error(`normalize --source must be one of: ${normalizeSourceList()}`);
  }
  if (!input) throw new Error("normalize requires --input");
  if (!output) throw new Error("normalize requires --output");
  return { source: source as NormalizeOptions["source"], input, output, agent, model };
}

export function parseNormalizeDirArgs(args: string[]): NormalizeDirOptions {
  let source = "auto";
  let inputDir = "";
  let output = "";
  let agent: string | undefined;
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--source") source = requireValue(args, ++i, "--source");
    else if (arg === "--input-dir") inputDir = path.resolve(requireValue(args, ++i, "--input-dir"));
    else if (arg === "--output") output = path.resolve(requireValue(args, ++i, "--output"));
    else if (arg === "--agent") agent = requireValue(args, ++i, "--agent");
    else if (arg === "--model") model = requireValue(args, ++i, "--model");
    else throw new Error(`Unknown normalize-dir option: ${arg}`);
  }

  if (!isNormalizeSource(source)) {
    throw new Error(`normalize-dir --source must be one of: ${normalizeSourceList()}`);
  }
  if (!inputDir) throw new Error("normalize-dir requires --input-dir");
  if (!output) throw new Error("normalize-dir requires --output");
  return { source: source as NormalizeDirOptions["source"], inputDir, output, agent, model };
}

export function parseValidateArgs(args: string[]): ValidateOptions {
  let input = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input") input = path.resolve(requireValue(args, ++i, "--input"));
    else throw new Error(`Unknown validate option: ${arg}`);
  }
  if (!input) throw new Error("validate requires --input");
  return { input };
}

export function parseValidateArtifactArgs(args: string[]): ValidateArtifactOptions {
  let input = "";
  let kind = "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input") input = path.resolve(requireValue(args, ++i, "--input"));
    else if (arg === "--kind") kind = requireValue(args, ++i, "--kind");
    else throw new Error(`Unknown validate-artifact option: ${arg}`);
  }

  if (!input) throw new Error("validate-artifact requires --input");
  if (!isArtifactKind(kind)) throw new Error(`validate-artifact --kind must be one of: ${artifactKindList()}`);
  return { input, kind };
}

export function parseAuditArgs(args: string[]): AuditOptions {
  let input = "";
  let output: string | undefined;
  let envFile = path.join(os.homedir(), ".zshrc");
  const secrets: string[] = [];
  const denyInputs: string[] = [];
  let failOn: AuditOptions["failOn"] = "blocking";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input") input = path.resolve(requireValue(args, ++i, "--input"));
    else if (arg === "--output") output = path.resolve(requireValue(args, ++i, "--output"));
    else if (arg === "--env-file") envFile = path.resolve(requireValue(args, ++i, "--env-file"));
    else if (arg === "--secret") secrets.push(requireValue(args, ++i, "--secret"));
    else if (arg === "--deny") denyInputs.push(requireValue(args, ++i, "--deny"));
    else if (arg === "--fail-on") {
      const value = requireValue(args, ++i, "--fail-on");
      if (value !== "any" && value !== "blocking" && value !== "never") {
        throw new Error("audit --fail-on must be one of: any, blocking, never");
      }
      failOn = value;
    } else throw new Error(`Unknown audit option: ${arg}`);
  }

  if (!input) throw new Error("audit requires --input");
  return { input, output, envFile, secrets, denyPatterns: loadDenyPatterns(denyInputs), failOn };
}

export function parseApproveArgs(args: string[]): ApproveOptions {
  let auditReport = "";
  let output = "";
  let reviewer = "";
  let notes: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--audit-report") auditReport = path.resolve(requireValue(args, ++i, "--audit-report"));
    else if (arg === "--output") output = path.resolve(requireValue(args, ++i, "--output"));
    else if (arg === "--reviewer") reviewer = requireValue(args, ++i, "--reviewer");
    else if (arg === "--notes") notes = requireValue(args, ++i, "--notes");
    else throw new Error(`Unknown approve option: ${arg}`);
  }

  if (!auditReport) throw new Error("approve requires --audit-report");
  if (!output) throw new Error("approve requires --output");
  if (!reviewer) throw new Error("approve requires --reviewer");
  return { auditReport, output, reviewer, notes };
}

export function parseRenderArgs(args: string[]): RenderOptions {
  let format = "";
  let input = "";
  let output = "";
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--format") format = requireValue(args, ++i, "--format");
    else if (arg === "--input") input = path.resolve(requireValue(args, ++i, "--input"));
    else if (arg === "--output") output = path.resolve(requireValue(args, ++i, "--output"));
    else throw new Error(`Unknown render option: ${arg}`);
  }
  if (!["openai-chat", "anthropic-messages", "chatml", "sharegpt", "sft-text", "ornith-qwen-xml"].includes(format)) {
    throw new Error("render --format must be one of: openai-chat, anthropic-messages, chatml, sharegpt, sft-text, ornith-qwen-xml");
  }
  if (!input) throw new Error("render requires --input");
  if (!output) throw new Error("render requires --output");
  return { format: format as RenderOptions["format"], input, output };
}

export function parseReleaseArgs(args: string[]): ReleaseOptions {
  const inputs: string[] = [];
  let outputDir = "";
  let auditReport: string | undefined;
  let approvalReport: string | undefined;
  let name: string | undefined;
  let license: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--input") inputs.push(path.resolve(requireValue(args, ++i, "--input")));
    else if (arg === "--output-dir") outputDir = path.resolve(requireValue(args, ++i, "--output-dir"));
    else if (arg === "--audit-report") auditReport = path.resolve(requireValue(args, ++i, "--audit-report"));
    else if (arg === "--approval-report") approvalReport = path.resolve(requireValue(args, ++i, "--approval-report"));
    else if (arg === "--name") name = requireValue(args, ++i, "--name");
    else if (arg === "--license") license = requireValue(args, ++i, "--license");
    else if (arg === "--force") force = true;
    else throw new Error(`Unknown release option: ${arg}`);
  }

  if (inputs.length === 0) throw new Error("release requires at least one --input");
  if (!outputDir) throw new Error("release requires --output-dir");
  return { inputs, outputDir, auditReport, approvalReport, name, license, force };
}

function isNormalizeSource(source: string): boolean {
  return ["auto", "pi", "claude-code", "codex", "cursor", "opencode", "continue", "goose", "openai-chat", "anthropic-messages", "markdown-transcript", "aider"].includes(source);
}

function normalizeSourceList(): string {
  return "auto, pi, claude-code, codex, cursor, opencode, continue, goose, openai-chat, anthropic-messages, markdown-transcript, aider";
}

function isArtifactKind(kind: string): kind is ArtifactKind {
  return ["agent-trace", "audit", "approval", "discovery", "ingest-error", "release-manifest", "release-info"].includes(kind);
}

function artifactKindList(): string {
  return "agent-trace, audit, approval, discovery, ingest-error, release-manifest, release-info";
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}
