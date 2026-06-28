import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nodeArgs = ["--experimental-strip-types", "src/index.ts"];

const fixtures = [
  ["pi", "examples/pi-session.jsonl", "examples/pi-session.agent_trace_v1.jsonl"],
  ["claude-code", "examples/claude-code-session.jsonl", "examples/claude-code-session.agent_trace_v1.jsonl"],
  ["codex", "examples/codex-session.jsonl", "examples/codex-session.agent_trace_v1.jsonl"],
  ["cursor", "examples/cursor-session.jsonl", "examples/cursor-session.agent_trace_v1.jsonl"],
  ["opencode", "examples/opencode-session.jsonl", "examples/opencode-session.agent_trace_v1.jsonl"],
  ["continue", "examples/continue-session.jsonl", "examples/continue-session.agent_trace_v1.jsonl"],
  ["goose", "examples/goose-session.jsonl", "examples/goose-session.agent_trace_v1.jsonl"],
  ["openai-chat", "examples/openai-chat-session.jsonl", "examples/openai-chat-session.agent_trace_v1.jsonl"],
  ["anthropic-messages", "examples/anthropic-messages-session.jsonl", "examples/anthropic-messages-session.agent_trace_v1.jsonl"],
  ["aider", "examples/aider-history.md", "examples/aider-history.agent_trace_v1.jsonl"],
  ["markdown-transcript", "examples/markdown-transcript.md", "examples/markdown-transcript.agent_trace_v1.jsonl"],
];

for (const [source, input, output] of fixtures) {
  run([...nodeArgs, "normalize", "--source", source, "--input", input, "--output", output]);
  run([...nodeArgs, "validate", "--input", output]);
}

run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/codex-session.jsonl", "--output", "examples/codex-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/codex-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/anthropic-messages-session.jsonl", "--output", "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/cursor-session.jsonl", "--output", "examples/cursor-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/cursor-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/aider-history.md", "--output", "examples/aider-history.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/aider-history.auto.agent_trace_v1.jsonl"]);

const tmpRawDir = path.join(root, "examples/.tmp-raw");
fs.rmSync(tmpRawDir, { recursive: true, force: true });
fs.mkdirSync(tmpRawDir, { recursive: true });
for (const [, input] of fixtures) {
  fs.copyFileSync(path.join(root, input), path.join(tmpRawDir, path.basename(input)));
}
run([...nodeArgs, "normalize-dir", "--source", "auto", "--input-dir", tmpRawDir, "--output", "examples/all.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/all.agent_trace_v1.jsonl"]);

for (const format of ["openai-chat", "anthropic-messages", "chatml", "sharegpt", "sft-text", "ornith-qwen-xml"]) {
  run([...nodeArgs, "render", "--format", format, "--input", "examples/codex-session.agent_trace_v1.jsonl", "--output", `examples/codex-session.${format}.jsonl`]);
}

const discoverRoot = path.join(root, "examples/.tmp-discover");
const discoverOutput = path.join(root, "examples/discovered-traces.jsonl");
fs.rmSync(discoverRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(discoverRoot, ".codex/sessions/2026/06/29"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".claude/projects/example"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".cursor/projects/example/agent-transcripts/session"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".local/share/opencode/sessions"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".continue/sessions"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".config/goose/sessions"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".pi/sessions"), { recursive: true });
for (const file of [
  ".codex/sessions/2026/06/29/session.jsonl",
  ".claude/projects/example/session.jsonl",
  ".cursor/projects/example/agent-transcripts/session/transcript.jsonl",
  ".local/share/opencode/sessions/session.jsonl",
  ".continue/sessions/session.jsonl",
  ".config/goose/sessions/session.jsonl",
  ".pi/sessions/session.jsonl",
]) {
  fs.writeFileSync(path.join(discoverRoot, file), "{}\n");
}
fs.writeFileSync(path.join(discoverRoot, ".aider.chat.history.md"), "#### user\n\nhello\n");
run([...nodeArgs, "discover", "--root", discoverRoot, "--output", discoverOutput]);
run([...nodeArgs, "validate-artifact", "--kind", "discovery", "--input", discoverOutput]);
assertInvalidArtifact("discovery", [{ source: "codex", path: "missing-normalize-source.jsonl", kind: "jsonl", confidence: "high", reason: "fixture" }]);
const discovered = readJsonl(discoverOutput);
for (const source of ["aider", "claude-code", "codex", "continue", "cursor", "goose", "opencode", "pi"]) {
  assert(discovered.some((entry) => entry.source === source && entry.normalize_source === source), `discover missing ${source}`);
}
const cursorOnly = execFileSync(process.execPath, [...nodeArgs, "discover", "--root", discoverRoot, "--source", "cursor"], { cwd: root, encoding: "utf-8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert(cursorOnly.length === 1 && cursorOnly[0].source === "cursor", "discover --source cursor should only return cursor");

const ingestManifest = path.join(root, "examples/.tmp-ingest-manifest.jsonl");
const ingestOutput = path.join(root, "examples/.tmp-ingested.agent_trace_v1.jsonl");
const ingestEntries = [
  ["codex", "examples/codex-session.jsonl"],
  ["cursor", "examples/cursor-session.jsonl"],
  ["opencode", "examples/opencode-session.jsonl"],
  ["aider", "examples/aider-history.md"],
].map(([source, file]) => ({
  source,
  normalize_source: source,
  path: path.relative(path.dirname(ingestManifest), path.join(root, file)),
  kind: file.endsWith(".md") ? "markdown" : "jsonl",
  confidence: "high",
  reason: "fixture",
}));
fs.writeFileSync(ingestManifest, ingestEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
run([...nodeArgs, "ingest", "--manifest", ingestManifest, "--output", ingestOutput]);
run([...nodeArgs, "validate", "--input", ingestOutput]);
const ingested = readJsonl(ingestOutput);
assert(ingested.length === 4, "ingest should normalize all fixture manifest entries");
assert(ingested.some((trace) => trace.source.agent === "opencode"), "ingest should preserve opencode source");

const ingestErrorManifest = path.join(root, "examples/.tmp-ingest-errors-manifest.jsonl");
const ingestErrorOutput = path.join(root, "examples/.tmp-ingest-errors.agent_trace_v1.jsonl");
const ingestErrors = path.join(root, "examples/.tmp-ingest-errors.jsonl");
fs.writeFileSync(ingestErrorManifest, [
  JSON.stringify({ ...ingestEntries[0], path: path.join(root, "examples/missing.jsonl") }),
  JSON.stringify(ingestEntries[1]),
].join("\n") + "\n");
run([...nodeArgs, "ingest", "--manifest", ingestErrorManifest, "--output", ingestErrorOutput, "--error-output", ingestErrors, "--continue-on-error"]);
assert(readJsonl(ingestErrorOutput).length === 1, "ingest should keep successful entries with --continue-on-error");
run([...nodeArgs, "validate-artifact", "--kind", "ingest-error", "--input", ingestErrors]);
assertInvalidArtifact("ingest-error", [{ path: "x.jsonl" }]);
const ingestErrorRows = readJsonl(ingestErrors);
assert(ingestErrorRows.length === 1, "ingest should write one error");
assertCommandFails([...nodeArgs, "ingest", "--manifest", ingestErrorManifest, "--output", path.join(root, "examples/.tmp-ingest-fail.agent_trace_v1.jsonl")], "ingest should fail fast without --continue-on-error");

const cleanAuditReport = path.join(root, "examples/.tmp-audit-clean.json");
run([...nodeArgs, "audit", "--input", "examples/all.agent_trace_v1.jsonl", "--output", cleanAuditReport]);
run([...nodeArgs, "validate-artifact", "--kind", "audit", "--input", cleanAuditReport]);
assertInvalidArtifact("audit", { schema: "agent_trace_audit_v1", input: "x", created_at: "now", trace_count: 1 });
const cleanAudit = JSON.parse(fs.readFileSync(cleanAuditReport, "utf-8"));
assert(cleanAudit.schema === "agent_trace_audit_v1", "audit schema mismatch");
assert(cleanAudit.status === "pass", "clean audit should pass");
assert(cleanAudit.trace_count === 11, "clean audit trace count mismatch");
const approvalReport = path.join(root, "examples/.tmp-approval.json");
run([...nodeArgs, "approve", "--audit-report", cleanAuditReport, "--output", approvalReport, "--reviewer", "fixture-reviewer", "--notes", "fixture approved"]);
run([...nodeArgs, "validate-artifact", "--kind", "approval", "--input", approvalReport]);
assertInvalidArtifact("approval", { schema: "agent_trace_approval_v1", status: "pending" });
const approval = JSON.parse(fs.readFileSync(approvalReport, "utf-8"));
assert(approval.schema === "agent_trace_approval_v1", "approval schema mismatch");
assert(approval.status === "approved", "approval status mismatch");
assert(approval.reviewer === "fixture-reviewer", "approval reviewer mismatch");

const dirtyCanonical = path.join(root, "examples/.tmp-dirty.agent_trace_v1.jsonl");
const dirtyAuditReport = path.join(root, "examples/.tmp-audit-dirty.json");
fs.writeFileSync(dirtyCanonical, `${JSON.stringify({
  schema: "agent_trace_v1",
  session_id: "dirty",
  source: { agent: "fixture", source_format: "fixture" },
  metadata: {},
  tools: [],
  messages: [{ role: "user", content: [{ type: "text", text: "use sk-1234567890abcdefghijklmnopqrstuv for this request" }] }],
  outcome: { quality: "unlabeled" },
})}\n`);
run([...nodeArgs, "audit", "--input", dirtyCanonical, "--output", dirtyAuditReport, "--fail-on", "never"]);
run([...nodeArgs, "validate-artifact", "--kind", "audit", "--input", dirtyAuditReport]);
const dirtyAudit = JSON.parse(fs.readFileSync(dirtyAuditReport, "utf-8"));
assert(dirtyAudit.status === "fail", "dirty audit should fail");
assert(dirtyAudit.blocking_finding_count > 0, "dirty audit should report blocking findings");
assertCommandFails([...nodeArgs, "audit", "--input", dirtyCanonical], "audit should fail by default on blocking findings");
assertCommandFails([...nodeArgs, "approve", "--audit-report", dirtyAuditReport, "--output", path.join(root, "examples/.tmp-dirty-approval.json"), "--reviewer", "fixture-reviewer"], "approve should reject failing audit reports");

const releaseDir = path.join(root, "examples/.tmp-release");
fs.rmSync(releaseDir, { recursive: true, force: true });
run([
  ...nodeArgs,
  "release",
  "--input",
  "examples/all.agent_trace_v1.jsonl",
  "--output-dir",
  releaseDir,
  "--audit-report",
  cleanAuditReport,
  "--approval-report",
  approvalReport,
  "--name",
  "fixture canonical traces",
  "--license",
  "other",
]);
run([...nodeArgs, "validate-artifact", "--kind", "release-manifest", "--input", path.join(releaseDir, "manifest.jsonl")]);
run([...nodeArgs, "validate-artifact", "--kind", "release-info", "--input", path.join(releaseDir, "dataset_info.json")]);
assertInvalidArtifact("release-manifest", [{ file: "data/shard.jsonl", source_file: "x", schema: "agent_trace_v1", sha256: "not-a-sha", trace_count: 1, message_count: 1, source_agents: {} }]);
assertInvalidArtifact("release-info", { name: "x", schema: "agent_trace_v1", created_at: "now", license: "other", shard_count: 1 });
const releaseManifest = readJsonl(path.join(releaseDir, "manifest.jsonl"));
const releaseInfo = JSON.parse(fs.readFileSync(path.join(releaseDir, "dataset_info.json"), "utf-8"));
assert(releaseManifest.length === 1, "release should create one shard manifest entry");
assert(releaseManifest[0].trace_count === 11, "release manifest trace count mismatch");
assert(releaseManifest[0].message_count > 0, "release manifest should count messages");
assert(releaseManifest[0].sha256.startsWith("sha256:"), "release manifest should include sha256");
assert(fs.existsSync(path.join(releaseDir, releaseManifest[0].file)), "release shard missing");
assert(fs.existsSync(path.join(releaseDir, "schema/agent_trace_v1.schema.json")), "release schema missing");
assert(fs.existsSync(path.join(releaseDir, "schema/agent_trace_audit_v1.schema.json")), "release audit schema missing");
assert(releaseInfo.name === "fixture canonical traces", "release dataset name mismatch");
assert(releaseInfo.trace_count === 11, "release dataset trace count mismatch");
assert(releaseInfo.source_agents.codex === 1, "release source agent counts missing codex");
assertCommandFails([...nodeArgs, "release", "--input", "examples/all.agent_trace_v1.jsonl", "--output-dir", releaseDir], "release should refuse non-empty output without --force");
assertCommandFails([...nodeArgs, "release", "--input", dirtyCanonical, "--output-dir", path.join(root, "examples/.tmp-release-dirty"), "--audit-report", dirtyAuditReport], "release should reject failing audit reports");

assertJsonl("examples/codex-session.agent_trace_v1.jsonl", (trace) => {
  assert(trace.schema === "agent_trace_v1", "schema mismatch");
  assert(trace.messages.length === 3, "codex fixture should coalesce to 3 messages");
  assert(trace.messages[1].tool_calls?.[0]?.arguments?.cmd === "pytest -q", "codex tool args not parsed");
});
assertInvalidArtifact("agent-trace", [{ schema: "agent_trace_v1", session_id: "bad" }]);

for (const source of ["opencode", "continue", "goose"]) {
  assertJsonl(`examples/${source}-session.agent_trace_v1.jsonl`, (trace) => {
    assert(trace.source.agent === source, `${source} fixture should preserve explicit source agent`);
    assert(trace.source.source_format === `${source}-openai-compatible-jsonl`, `${source} fixture source_format mismatch`);
  });
}

fs.rmSync(path.join(root, "examples/codex-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(path.join(root, "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(path.join(root, "examples/cursor-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(path.join(root, "examples/aider-history.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(ingestManifest, { force: true });
fs.rmSync(ingestOutput, { force: true });
fs.rmSync(ingestErrorManifest, { force: true });
fs.rmSync(ingestErrorOutput, { force: true });
fs.rmSync(ingestErrors, { force: true });
fs.rmSync(path.join(root, "examples/.tmp-ingest-fail.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(cleanAuditReport, { force: true });
fs.rmSync(approvalReport, { force: true });
fs.rmSync(dirtyAuditReport, { force: true });
fs.rmSync(dirtyCanonical, { force: true });
fs.rmSync(path.join(root, "examples/.tmp-dirty-approval.json"), { force: true });
fs.rmSync(discoverOutput, { force: true });
fs.rmSync(discoverRoot, { recursive: true, force: true });
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.rmSync(path.join(root, "examples/.tmp-release-dirty"), { recursive: true, force: true });
fs.rmSync(tmpRawDir, { recursive: true, force: true });
console.log("fixture verification passed");

function run(args) {
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}

function assertCommandFails(args, message) {
  try {
    execFileSync(process.execPath, args, { cwd: root, stdio: "pipe" });
  } catch {
    return;
  }
  throw new Error(message);
}

function assertInvalidArtifact(kind, value) {
  const file = path.join(root, `examples/.tmp-invalid-${kind}.json${Array.isArray(value) ? "l" : ""}`);
  if (Array.isArray(value)) {
    fs.writeFileSync(file, value.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  } else {
    fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  }
  assertCommandFails([...nodeArgs, "validate-artifact", "--kind", kind, "--input", file], `validate-artifact should reject invalid ${kind}`);
  fs.rmSync(file, { force: true });
}

function assertJsonl(file, check) {
  for (const trace of readJsonl(path.join(root, file))) check(trace);
}

function readJsonl(file) {
  const text = fs.readFileSync(file, "utf-8").trim();
  if (!text) return [];
  return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
