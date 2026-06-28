import os from "node:os";
import path from "node:path";
import type { CollectOptions, GrepOptions, InitOptions, ListOptions, NormalizeOptions, RejectOptions, ReviewOptions, UploadOptions } from "./types.ts";
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
  agent-trace-hub normalize --source pi --input <file.jsonl> --output <file.jsonl> [options]

Commands:
  init      Create a workspace and store cwd/repo configuration
  collect   Redact new or changed sessions and run LLM review
  review    Rerun LLM review only on existing redacted sessions
  upload    Upload approved redacted sessions and update manifest.jsonl in the dataset repo
  reject    Add a session to workspace/reject.txt so upload always skips it
  list      List sessions matching built-in filters
  grep      Ripgrep only the uploadable session set
  normalize Convert a supported raw/redacted agent trace into agent_trace_v1

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

Normalize options:
  --source <source>       Input source format. Currently: pi
  --input <file>          Source session JSONL
  --output <file>         Output canonical agent_trace_v1 JSONL
  --agent <name>          Source agent label (default: pi)
  --model <id>            Source model id if known
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

export function parseNormalizeArgs(args: string[]): NormalizeOptions {
  let source = "";
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

  if (source !== "pi") throw new Error("normalize requires --source pi");
  if (!input) throw new Error("normalize requires --input");
  if (!output) throw new Error("normalize requires --output");
  return { source, input, output, agent, model };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) throw new Error(`Missing value for ${flag}`);
  return value;
}
