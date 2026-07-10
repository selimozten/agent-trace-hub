import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const nodeArgs = ["--experimental-strip-types", "src/index.ts"];

const fixtures = [
  ["pi", "examples/pi-session.jsonl", "examples/pi-session.agent_trace_v1.jsonl"],
  ["claude-code", "examples/claude-code-session.jsonl", "examples/claude-code-session.agent_trace_v1.jsonl"],
  ["codex", "examples/codex-session.jsonl", "examples/codex-session.agent_trace_v1.jsonl"],
  ["omp", "examples/omp-session.jsonl", "examples/omp-session.agent_trace_v1.jsonl"],
  ["cursor-agent", "examples/cursor-session.jsonl", "examples/cursor-agent-session.agent_trace_v1.jsonl"],
  ["cursor", "examples/cursor-session.jsonl", "examples/cursor-session.agent_trace_v1.jsonl"],
  ["opencode", "examples/opencode-session.json", "examples/opencode-session.agent_trace_v1.jsonl"],
  ["continue", "examples/continue-session.json", "examples/continue-session.agent_trace_v1.jsonl"],
  ["goose", "examples/goose-session.json", "examples/goose-session.agent_trace_v1.jsonl"],
  ["openai-chat", "examples/openai-chat-session.jsonl", "examples/openai-chat-session.agent_trace_v1.jsonl"],
  ["anthropic-messages", "examples/anthropic-messages-session.jsonl", "examples/anthropic-messages-session.agent_trace_v1.jsonl"],
  ["generic-json", "examples/generic-json-session.json", "examples/generic-json-session.agent_trace_v1.jsonl"],
  ["aider", "examples/aider-history.md", "examples/aider-history.agent_trace_v1.jsonl"],
  ["markdown-transcript", "examples/markdown-transcript.md", "examples/markdown-transcript.agent_trace_v1.jsonl"],
];

for (const [source, input, output] of fixtures) {
  run([...nodeArgs, "normalize", "--source", source, "--input", input, "--output", output]);
  run([...nodeArgs, "validate", "--input", output]);
}

const sourceRegistry = JSON.parse(execFileSync(process.execPath, [...nodeArgs, "sources", "--json"], { cwd: root, encoding: "utf-8" }));
assert(sourceRegistry.length === fixtures.length, "source registry and normalization fixtures should stay in sync");
for (const [source] of fixtures) {
  assert(sourceRegistry.some((entry) => entry.source === source), `source registry missing ${source}`);
}
for (const source of ["pi", "claude-code", "codex", "omp", "cursor-agent", "opencode"]) {
  const entry = sourceRegistry.find((candidate) => candidate.source === source);
  assert(entry.tier === "v1", `${source} should be labeled as a v1 adapter`);
  assert(entry.support === "native", `${source} should have native support`);
  assert(entry.autoDetect === true, `${source} should auto-detect native inputs`);
}
assert(sourceRegistry.find((entry) => entry.source === "cursor")?.support === "compatibility", "cursor should remain an explicit compatibility alias");

const nativeOpenCode = readJsonl(path.join(root, "examples/opencode-session.agent_trace_v1.jsonl"))[0];
assert(nativeOpenCode.source.source_format === "opencode-session-export-json", "OpenCode native source format mismatch");
assert(nativeOpenCode.messages.some((message) => message.reasoning?.[0]?.text.includes("unused variable")), "OpenCode reasoning should be preserved");
assert(nativeOpenCode.messages.some((message) => message.tool_calls?.[0]?.name === "shell"), "OpenCode tool call should be preserved");
assert(nativeOpenCode.messages.some((message) => message.role === "tool" && message.tool_call_id === "call_opencode_1"), "OpenCode tool result should be preserved");

const nativeContinue = readJsonl(path.join(root, "examples/continue-session.agent_trace_v1.jsonl"))[0];
assert(nativeContinue.source.source_format === "continue-session-json", "Continue native source format mismatch");
assert(nativeContinue.messages[0].content[0].text.includes("<context name=\"List.tsx\">"), "Continue context items should be preserved");
assert(nativeContinue.messages.some((message) => message.reasoning?.[0]?.text.includes("early return")), "Continue thinking should be preserved");
assert(nativeContinue.messages.some((message) => message.role === "tool" && message.name === "read_file"), "Continue tool result should be preserved");

const nativeGoose = readJsonl(path.join(root, "examples/goose-session.agent_trace_v1.jsonl"))[0];
assert(nativeGoose.source.source_format === "goose-session-export-json", "Goose native source format mismatch");
assert(nativeGoose.messages.some((message) => message.reasoning?.[0]?.text.includes("parser edge case")), "Goose thinking should be preserved");
assert(nativeGoose.messages.some((message) => message.tool_calls?.[0]?.name === "shell"), "Goose tool request should be preserved");
assert(nativeGoose.messages.some((message) => message.role === "tool" && message.tool_call_id === "call_goose_1"), "Goose tool response should be preserved");

const nativeOmp = readJsonl(path.join(root, "examples/omp-session.agent_trace_v1.jsonl"))[0];
assert(nativeOmp.source.source_format === "omp-session-jsonl", "OMP native source format mismatch");
assert(nativeOmp.source.provider === "anthropic" && nativeOmp.source.model === "claude-omp-example", "OMP model route should be split into provider and model");
assert(nativeOmp.messages.some((message) => message.tool_calls?.[0]?.arguments?.command === "npm test -- parser"), "OMP tool arguments should be preserved");

const openCodeDatabase = path.join(root, "examples/.tmp-opencode.db");
const openCodeDatabaseOutput = path.join(root, "examples/.tmp-opencode-db.agent_trace_v1.jsonl");
createOpenCodeDatabase(openCodeDatabase);
run([...nodeArgs, "normalize", "--source", "opencode", "--input", openCodeDatabase, "--output", openCodeDatabaseOutput]);
run([...nodeArgs, "validate", "--input", openCodeDatabaseOutput]);
const databaseTraces = readJsonl(openCodeDatabaseOutput);
assert(databaseTraces.length === 1, "OpenCode SQLite normalization should skip empty sessions");
assert(databaseTraces[0].source.source_format === "opencode-sqlite", "OpenCode SQLite source format mismatch");
assert(databaseTraces[0].messages.some((message) => message.tool_calls?.[0]?.name === "shell"), "OpenCode SQLite tool call should be preserved");

const compatibilityOutputs = [];
for (const source of ["opencode", "continue", "goose"]) {
  const output = path.join(root, `examples/.tmp-${source}-compat.agent_trace_v1.jsonl`);
  compatibilityOutputs.push(output);
  run([...nodeArgs, "normalize", "--source", source, "--input", `examples/${source}-session.jsonl`, "--output", output]);
  run([...nodeArgs, "validate", "--input", output]);
  assert(readJsonl(output)[0].source.source_format === `${source}-openai-compatible-jsonl`, `${source} compatibility source format mismatch`);
}

run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/codex-session.jsonl", "--output", "examples/codex-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/codex-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/anthropic-messages-session.jsonl", "--output", "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/cursor-session.jsonl", "--output", "examples/cursor-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/cursor-session.auto.agent_trace_v1.jsonl"]);
assert(readJsonl(path.join(root, "examples/cursor-session.auto.agent_trace_v1.jsonl"))[0].source.agent === "cursor-agent", "Cursor Agent should be selected by auto-detection");
run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/generic-json-session.json", "--output", "examples/generic-json-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/generic-json-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/aider-history.md", "--output", "examples/aider-history.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/aider-history.auto.agent_trace_v1.jsonl"]);
for (const source of ["opencode", "continue", "goose"]) {
  const output = path.join(root, `examples/.tmp-${source}-auto.agent_trace_v1.jsonl`);
  run([...nodeArgs, "normalize", "--source", "auto", "--input", `examples/${source}-session.json`, "--output", output]);
  run([...nodeArgs, "validate", "--input", output]);
  assert(readJsonl(output)[0].source.agent === source, `auto-detection should select ${source}`);
  compatibilityOutputs.push(output);
}

const malformedJsonl = path.join(root, "examples/.tmp-malformed-codex.jsonl");
const recoveredJsonl = path.join(root, "examples/.tmp-recovered-codex.agent_trace_v1.jsonl");
fs.writeFileSync(malformedJsonl, `not-json\n${fs.readFileSync(path.join(root, "examples/codex-session.jsonl"), "utf-8")}`);
assertCommandFailsWith(
  [...nodeArgs, "normalize", "--source", "auto", "--input", malformedJsonl, "--output", recoveredJsonl],
  /Invalid JSONL record at .*\.tmp-malformed-codex\.jsonl:1:/,
  "normalize should identify malformed JSONL by file and line",
);
run([...nodeArgs, "normalize", "--source", "auto", "--input", malformedJsonl, "--output", recoveredJsonl, "--skip-invalid-lines"]);
run([...nodeArgs, "validate", "--input", recoveredJsonl]);
assert(readJsonl(recoveredJsonl).length === 1, "partial JSONL recovery should retain the valid trace");

const activeJsonl = path.join(root, "examples/.tmp-active-codex.jsonl");
const activeOutput = path.join(root, "examples/.tmp-active-codex.agent_trace_v1.jsonl");
fs.writeFileSync(activeJsonl, `${fs.readFileSync(path.join(root, "examples/codex-session.jsonl"), "utf-8")}{"timestamp":"2026-06-29T12:00:03Z","type":"event_msg","payload":{"type":"token_count"`);
spawn(process.execPath, [
  "-e",
  "const fs = require('node:fs'); setTimeout(() => fs.appendFileSync(process.argv[1], '}}\\n'), 20);",
  activeJsonl,
], { cwd: root, stdio: "ignore" });
run([...nodeArgs, "normalize", "--source", "codex", "--input", activeJsonl, "--output", activeOutput]);
run([...nodeArgs, "validate", "--input", activeOutput]);
assert(readJsonl(activeOutput).length === 1, "normalize should retry a JSONL file that is completed during an active write");

const malformedJson = path.join(root, "examples/.tmp-malformed.json");
fs.writeFileSync(malformedJson, "{not-json");
assertCommandFailsWith(
  [...nodeArgs, "normalize", "--source", "generic-json", "--input", malformedJson, "--output", recoveredJsonl],
  /Invalid JSON document at .*\.tmp-malformed\.json:/,
  "normalize should reject malformed JSON documents instead of treating them as text",
);

const recoveryManifest = path.join(root, "examples/.tmp-recovery-manifest.jsonl");
const recoveryIngestOutput = path.join(root, "examples/.tmp-recovery-ingest.agent_trace_v1.jsonl");
fs.writeFileSync(recoveryManifest, `${JSON.stringify({
  source: "codex",
  normalize_source: "codex",
  path: malformedJsonl,
  kind: "jsonl",
  confidence: "high",
  reason: "fixture",
})}\n`);
run([...nodeArgs, "ingest", "--manifest", recoveryManifest, "--output", recoveryIngestOutput, "--skip-invalid-lines"]);
assert(readJsonl(recoveryIngestOutput).length === 1, "ingest should pass partial-recovery policy to normalization");

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
const enrichedCodex = path.join(root, "examples/codex-session.enriched.agent_trace_v1.jsonl");
run([...nodeArgs, "enrich", "--input", "examples/codex-session.agent_trace_v1.jsonl", "--output", enrichedCodex]);
run([...nodeArgs, "validate", "--input", enrichedCodex]);
const enrichedTrace = readJsonl(enrichedCodex)[0];
assert(enrichedTrace.outcome.signals.tests.run === true, "enrich should mark tests as run");
assert(enrichedTrace.outcome.signals.tests.status === "failed", "enrich should infer failed test status");
assert(enrichedTrace.outcome.signals.commands[0].command === "pytest -q", "enrich should preserve command text");

const discoverRoot = path.join(root, "examples/.tmp-discover");
const discoverOutput = path.join(root, "examples/discovered-traces.jsonl");
fs.rmSync(discoverRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(discoverRoot, ".codex/sessions/2026/06/29"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".claude/projects/example"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".claude/projects/example/subagents/workflows/wf_fixture"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".cursor/projects/example/agent-transcripts/session"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".local/share/opencode"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".continue/sessions"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".config/goose/sessions"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".omp/agent/sessions/project"), { recursive: true });
fs.mkdirSync(path.join(discoverRoot, ".pi/agent/sessions/project"), { recursive: true });
for (const file of [
  ".codex/sessions/2026/06/29/session.jsonl",
  ".claude/projects/example/session.jsonl",
  ".cursor/projects/example/agent-transcripts/session/transcript.jsonl",
  ".continue/sessions/session.json",
  ".config/goose/sessions/session.jsonl",
  ".omp/agent/sessions/project/session.jsonl",
  ".pi/agent/sessions/project/session.jsonl",
]) {
  fs.writeFileSync(path.join(discoverRoot, file), "{}\n");
}
createOpenCodeDatabase(path.join(discoverRoot, ".local/share/opencode/opencode.db"));
fs.writeFileSync(path.join(discoverRoot, ".aider.chat.history.md"), "#### user\n\nhello\n");
fs.writeFileSync(path.join(discoverRoot, ".claude/projects/example/subagents/workflows/wf_fixture/events.jsonl"), `${JSON.stringify({ type: "started", agentId: "fixture", key: "fixture-key" })}\n`);
run([...nodeArgs, "discover", "--root", discoverRoot, "--output", discoverOutput]);
run([...nodeArgs, "validate-artifact", "--kind", "discovery", "--input", discoverOutput]);
assertInvalidArtifact("discovery", [{ source: "codex", path: "missing-normalize-source.jsonl", kind: "jsonl", confidence: "high", reason: "fixture" }]);
const discovered = readJsonl(discoverOutput);
assert(discovered.length === 6, "default discovery should return only the six v1 harnesses");
for (const source of ["claude-code", "codex", "cursor-agent", "omp", "opencode", "pi"]) {
  assert(discovered.some((entry) => entry.source === source && entry.normalize_source === source), `discover missing ${source}`);
}
assert(discovered.some((entry) => entry.source === "opencode" && entry.kind === "sqlite"), "OpenCode database should be discovered as SQLite");
const allDiscovered = execFileSync(process.execPath, [...nodeArgs, "discover", "--root", discoverRoot, "--source", "all"], { cwd: root, encoding: "utf-8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert(allDiscovered.length === 9, "discover --source all should include extended adapters and exclude Claude telemetry");
const cursorOnly = execFileSync(process.execPath, [...nodeArgs, "discover", "--root", discoverRoot, "--source", "cursor-agent"], { cwd: root, encoding: "utf-8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert(cursorOnly.length === 1 && cursorOnly[0].source === "cursor-agent", "discover --source cursor-agent should only return Cursor Agent");
const cursorAlias = execFileSync(process.execPath, [...nodeArgs, "discover", "--root", discoverRoot, "--source", "cursor"], { cwd: root, encoding: "utf-8" })
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
assert(cursorAlias.length === 1 && cursorAlias[0].source === "cursor-agent", "discover --source cursor should resolve the compatibility alias");

const ingestManifest = path.join(root, "examples/.tmp-ingest-manifest.jsonl");
const ingestOutput = path.join(root, "examples/.tmp-ingested.agent_trace_v1.jsonl");
const ingestEntries = [
  ["codex", "examples/codex-session.jsonl"],
  ["cursor-agent", "examples/cursor-session.jsonl"],
  ["opencode", "examples/opencode-session.json"],
  ["aider", "examples/aider-history.md"],
  ["opencode", "examples/.tmp-opencode.db"],
].map(([source, file]) => ({
  source,
  normalize_source: source,
  path: path.relative(path.dirname(ingestManifest), path.join(root, file)),
  kind: file.endsWith(".md") ? "markdown" : file.endsWith(".json") ? "json" : "jsonl",
  confidence: "high",
  reason: "fixture",
}));
fs.writeFileSync(ingestManifest, ingestEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
run([...nodeArgs, "ingest", "--manifest", ingestManifest, "--output", ingestOutput]);
run([...nodeArgs, "validate", "--input", ingestOutput]);
const ingested = readJsonl(ingestOutput);
assert(ingested.length === 5, "ingest should normalize all fixture manifest entries, including SQLite stores");
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
assert(cleanAudit.profile === "private", "audit default profile mismatch");
assert(cleanAudit.status === "pass", "clean audit should pass");
assert(cleanAudit.trace_count === 13, "clean audit trace count mismatch");
const approvalReport = path.join(root, "examples/.tmp-approval.json");
run([...nodeArgs, "approve", "--audit-report", cleanAuditReport, "--output", approvalReport, "--reviewer", "fixture-reviewer", "--notes", "fixture approved"]);
run([...nodeArgs, "validate-artifact", "--kind", "approval", "--input", approvalReport]);
assertInvalidArtifact("approval", { schema: "agent_trace_approval_v1", status: "pending" });
const approval = JSON.parse(fs.readFileSync(approvalReport, "utf-8"));
assert(approval.schema === "agent_trace_approval_v1", "approval schema mismatch");
assert(approval.status === "approved", "approval status mismatch");
assert(approval.reviewer === "fixture-reviewer", "approval reviewer mismatch");
const reviewGateReport = path.join(root, "examples/.tmp-review-gate.json");
run([...nodeArgs, "review-gate", "--input", "examples/all.agent_trace_v1.jsonl", "--output", reviewGateReport, "--reviewer", "fixture-reviewer", "--method", "manual", "--summary", "Fixture dataset reviewed for release", "--audit-report", cleanAuditReport, "--approval-report", approvalReport]);
run([...nodeArgs, "validate-artifact", "--kind", "review-gate", "--input", reviewGateReport]);
assertInvalidArtifact("review-gate", { schema: "agent_trace_review_gate_v1", status: "approved" });
const reviewGate = JSON.parse(fs.readFileSync(reviewGateReport, "utf-8"));
assert(reviewGate.schema === "agent_trace_review_gate_v1", "review gate schema mismatch");
assert(reviewGate.status === "approved", "review gate status mismatch");
assert(reviewGate.input.endsWith("examples/all.agent_trace_v1.jsonl"), "review gate input mismatch");

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

const imageCanonical = path.join(root, "examples/.tmp-image.agent_trace_v1.jsonl");
const imagePrivateAuditReport = path.join(root, "examples/.tmp-audit-image-private.json");
const imagePublicAuditReport = path.join(root, "examples/.tmp-audit-image-public.json");
fs.writeFileSync(imageCanonical, `${JSON.stringify({
  schema: "agent_trace_v1",
  session_id: "image",
  source: { agent: "fixture", source_format: "fixture" },
  metadata: {},
  tools: [],
  messages: [{ role: "user", content: [{ type: "image", mime_type: "image/png", data: "iVBORw0KGgo=" }] }],
  outcome: { quality: "unlabeled" },
})}\n`);
run([...nodeArgs, "audit", "--input", imageCanonical, "--output", imagePrivateAuditReport]);
run([...nodeArgs, "validate-artifact", "--kind", "audit", "--input", imagePrivateAuditReport]);
const imagePrivateAudit = JSON.parse(fs.readFileSync(imagePrivateAuditReport, "utf-8"));
assert(imagePrivateAudit.profile === "private", "image private audit profile mismatch");
assert(imagePrivateAudit.status === "pass", "private profile should allow image findings as nonblocking");
assert(imagePrivateAudit.finding_count === 1 && imagePrivateAudit.blocking_finding_count === 0, "private image audit counts mismatch");
assertCommandFails([...nodeArgs, "audit", "--profile", "public", "--input", imageCanonical, "--output", imagePublicAuditReport], "public audit should fail on image blocks");
run([...nodeArgs, "validate-artifact", "--kind", "audit", "--input", imagePublicAuditReport]);
const imagePublicAudit = JSON.parse(fs.readFileSync(imagePublicAuditReport, "utf-8"));
assert(imagePublicAudit.profile === "public", "image public audit profile mismatch");
assert(imagePublicAudit.status === "fail", "public profile should fail on image findings");
assert(imagePublicAudit.blocking_finding_count === 1, "public image audit should report blocking finding");

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
  "--review-gate",
  reviewGateReport,
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
assert(releaseManifest[0].trace_count === 13, "release manifest trace count mismatch");
assert(releaseManifest[0].message_count > 0, "release manifest should count messages");
assert(releaseManifest[0].sha256.startsWith("sha256:"), "release manifest should include sha256");
assert(fs.existsSync(path.join(releaseDir, releaseManifest[0].file)), "release shard missing");
assert(fs.existsSync(path.join(releaseDir, "schema/agent_trace_v1.schema.json")), "release schema missing");
assert(fs.existsSync(path.join(releaseDir, "schema/agent_trace_audit_v1.schema.json")), "release audit schema missing");
assert(releaseInfo.name === "fixture canonical traces", "release dataset name mismatch");
assert(releaseInfo.trace_count === 13, "release dataset trace count mismatch");
assert(releaseInfo.source_agents.codex === 1, "release source agent counts missing codex");
assertCommandFails([...nodeArgs, "release", "--input", "examples/all.agent_trace_v1.jsonl", "--output-dir", releaseDir], "release should refuse non-empty output without --force");
assertCommandFails([...nodeArgs, "release", "--input", dirtyCanonical, "--output-dir", path.join(root, "examples/.tmp-release-dirty"), "--audit-report", dirtyAuditReport], "release should reject failing audit reports");
assertCommandFails([...nodeArgs, "release", "--input", dirtyCanonical, "--output-dir", path.join(root, "examples/.tmp-release-mismatched-audit"), "--audit-report", cleanAuditReport], "release should reject audit reports for a different input");
assertCommandFails([...nodeArgs, "release", "--input", dirtyCanonical, "--output-dir", path.join(root, "examples/.tmp-release-mismatched-approval"), "--approval-report", approvalReport], "release should reject approval reports for a different input");
assertCommandFails([...nodeArgs, "release", "--input", dirtyCanonical, "--output-dir", path.join(root, "examples/.tmp-release-mismatched-review-gate"), "--review-gate", reviewGateReport], "release should reject review gates for a different input");
const rejectedReviewGate = path.join(root, "examples/.tmp-review-gate-rejected.json");
run([...nodeArgs, "review-gate", "--input", "examples/all.agent_trace_v1.jsonl", "--output", rejectedReviewGate, "--reviewer", "fixture-reviewer", "--status", "rejected", "--summary", "Fixture dataset rejected"]);
run([...nodeArgs, "validate-artifact", "--kind", "review-gate", "--input", rejectedReviewGate]);
assertCommandFails([...nodeArgs, "release", "--input", "examples/all.agent_trace_v1.jsonl", "--output-dir", path.join(root, "examples/.tmp-release-rejected-review-gate"), "--review-gate", rejectedReviewGate], "release should reject rejected review gates");
assertCommandFails([...nodeArgs, "release", "--input", "examples/all.agent_trace_v1.jsonl", "--input", "examples/codex-session.agent_trace_v1.jsonl", "--output-dir", path.join(root, "examples/.tmp-release-multi-gated"), "--audit-report", cleanAuditReport], "release should reject gated multi-input releases");

assertJsonl("examples/codex-session.agent_trace_v1.jsonl", (trace) => {
  assert(trace.schema === "agent_trace_v1", "schema mismatch");
  assert(trace.messages.length === 5, "codex fixture should preserve standard and custom tool turns");
  assert(trace.messages.filter((message) => message.role === "user").length === 1, "codex mirrored user events should be deduplicated");
  assert(trace.messages[1].tool_calls?.[0]?.arguments?.cmd === "pytest -q", "codex tool args not parsed");
  assert(trace.messages.some((message) => message.tool_calls?.[0]?.name === "apply_patch"), "codex custom tool call missing");
});
assertJsonl("examples/claude-code-session.agent_trace_v1.jsonl", (trace) => {
  assert(trace.messages.length === 3, "Claude streamed assistant chunks should be coalesced");
  assert(!JSON.stringify(trace).includes("abandoned branch"), "Claude abandoned branch should be excluded");
  assert(trace.messages[1].reasoning?.[0]?.text.includes("inspect"), "Claude thinking should be preserved");
});
assertJsonl("examples/pi-session.agent_trace_v1.jsonl", (trace) => {
  assert(!JSON.stringify(trace).includes("Abandoned branch"), "Pi abandoned branch should be excluded");
  assert(trace.metadata.active_leaf_id === "tool-1", "Pi active journal leaf should be recorded");
});
assertJsonl("examples/cursor-agent-session.agent_trace_v1.jsonl", (trace) => {
  const calls = trace.messages.flatMap((message) => message.tool_calls ?? []);
  assert(calls[0]?.arguments?.command === "pytest -q", "Cursor Agent input arguments should be preserved");
  assert(new Set(calls.map((call) => call.id)).size === calls.length, "Cursor Agent synthesized tool IDs should be unique");
  assert(trace.metadata.tool_results_available === false, "Cursor Agent source limitation should be explicit");
});
assertJsonl("examples/openai-chat-session.agent_trace_v1.jsonl", (trace) => {
  assert(trace.tools.length === 1, "OpenAI fixture should preserve tool schemas");
  assert(trace.tools[0]?.function?.name === "shell", "OpenAI fixture tool schema name mismatch");
});
assertJsonl("examples/anthropic-messages-session.agent_trace_v1.jsonl", (trace) => {
  assert(trace.tools.length === 1, "Anthropic fixture should preserve tool schemas");
  assert(trace.tools[0]?.input_schema?.properties?.command?.type === "string", "Anthropic fixture tool schema mismatch");
});
assertJsonl("examples/generic-json-session.agent_trace_v1.jsonl", (trace) => {
  assert(trace.source.agent === "example-agent", "generic JSON fixture should preserve source agent");
  assert(trace.tools.length === 1, "generic JSON fixture should preserve tool schemas");
  assert(trace.messages[1].tool_calls?.[0]?.arguments?.path === "src/App.tsx", "generic JSON fixture should parse tool calls");
});
assertInvalidArtifact("agent-trace", [{ schema: "agent_trace_v1", session_id: "bad" }]);

for (const source of ["opencode", "continue", "goose"]) {
  assertJsonl(`examples/${source}-session.agent_trace_v1.jsonl`, (trace) => {
    assert(trace.source.agent === source, `${source} fixture should preserve explicit source agent`);
    assert(trace.source.source_format === sourceRegistry.find((entry) => entry.source === source)?.sourceFormat, `${source} fixture source_format mismatch`);
  });
}

fs.rmSync(path.join(root, "examples/codex-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(enrichedCodex, { force: true });
fs.rmSync(path.join(root, "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(path.join(root, "examples/cursor-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(path.join(root, "examples/generic-json-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(path.join(root, "examples/aider-history.auto.agent_trace_v1.jsonl"), { force: true });
for (const output of compatibilityOutputs) fs.rmSync(output, { force: true });
fs.rmSync(malformedJsonl, { force: true });
fs.rmSync(malformedJson, { force: true });
fs.rmSync(recoveredJsonl, { force: true });
fs.rmSync(activeJsonl, { force: true });
fs.rmSync(activeOutput, { force: true });
fs.rmSync(recoveryManifest, { force: true });
fs.rmSync(recoveryIngestOutput, { force: true });
fs.rmSync(ingestManifest, { force: true });
fs.rmSync(ingestOutput, { force: true });
fs.rmSync(ingestErrorManifest, { force: true });
fs.rmSync(ingestErrorOutput, { force: true });
fs.rmSync(ingestErrors, { force: true });
fs.rmSync(path.join(root, "examples/.tmp-ingest-fail.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(openCodeDatabase, { force: true });
fs.rmSync(openCodeDatabaseOutput, { force: true });
fs.rmSync(cleanAuditReport, { force: true });
fs.rmSync(approvalReport, { force: true });
fs.rmSync(reviewGateReport, { force: true });
fs.rmSync(rejectedReviewGate, { force: true });
fs.rmSync(dirtyAuditReport, { force: true });
fs.rmSync(dirtyCanonical, { force: true });
fs.rmSync(path.join(root, "examples/.tmp-dirty-approval.json"), { force: true });
fs.rmSync(imageCanonical, { force: true });
fs.rmSync(imagePrivateAuditReport, { force: true });
fs.rmSync(imagePublicAuditReport, { force: true });
fs.rmSync(discoverOutput, { force: true });
fs.rmSync(discoverRoot, { recursive: true, force: true });
fs.rmSync(releaseDir, { recursive: true, force: true });
fs.rmSync(path.join(root, "examples/.tmp-release-dirty"), { recursive: true, force: true });
fs.rmSync(path.join(root, "examples/.tmp-release-mismatched-audit"), { recursive: true, force: true });
fs.rmSync(path.join(root, "examples/.tmp-release-mismatched-approval"), { recursive: true, force: true });
fs.rmSync(path.join(root, "examples/.tmp-release-mismatched-review-gate"), { recursive: true, force: true });
fs.rmSync(path.join(root, "examples/.tmp-release-rejected-review-gate"), { recursive: true, force: true });
fs.rmSync(path.join(root, "examples/.tmp-release-multi-gated"), { recursive: true, force: true });
fs.rmSync(tmpRawDir, { recursive: true, force: true });
console.log("fixture verification passed");

function createOpenCodeDatabase(file) {
  fs.rmSync(file, { force: true });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, workspace_id TEXT, parent_id TEXT,
      slug TEXT NOT NULL, directory TEXT NOT NULL, path TEXT, title TEXT NOT NULL,
      agent TEXT, model TEXT, version TEXT NOT NULL, summary_additions INTEGER,
      summary_deletions INTEGER, summary_files INTEGER, summary_diffs TEXT, metadata TEXT,
      cost REAL NOT NULL DEFAULT 0, tokens_input INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0, tokens_reasoning INTEGER NOT NULL DEFAULT 0,
      tokens_cache_read INTEGER NOT NULL DEFAULT 0, tokens_cache_write INTEGER NOT NULL DEFAULT 0,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, time_compacting INTEGER,
      time_archived INTEGER
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL
    );
  `);
  const insertSession = database.prepare(`
    INSERT INTO session (
      id, project_id, workspace_id, parent_id, slug, directory, path, title, agent, model,
      version, summary_additions, summary_deletions, summary_files, summary_diffs, metadata,
      cost, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read,
      tokens_cache_write, time_created, time_updated, time_compacting, time_archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertSession.run(
    "example-opencode-db-session", "example-project", null, null, "db-session",
    "/redacted/opencode-db-project", null, "Database session", "build",
    JSON.stringify({ id: "qwen-coder-example", providerID: "openai" }), "1.17.8",
    1, 0, 1, null, JSON.stringify({ fixture: true }), 0.01, 10, 20, 5, 0, 0,
    1782720000000, 1782720060000, null, null,
  );
  insertSession.run(
    "example-opencode-empty-session", "example-project", null, null, "empty-session",
    "/redacted/opencode-db-project", null, "Empty session", "build", null, "1.17.8",
    null, null, null, null, null, 0, 0, 0, 0, 0, 0,
    1782720100000, 1782720100000, null, null,
  );

  const insertMessage = database.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)");
  insertMessage.run("msg_db_user", "example-opencode-db-session", 1782720001000, 1782720001000, JSON.stringify({
    role: "user",
    time: { created: 1782720001000 },
    model: { id: "qwen-coder-example", providerID: "openai" },
  }));
  insertMessage.run("msg_db_assistant", "example-opencode-db-session", 1782720002000, 1782720005000, JSON.stringify({
    role: "assistant",
    parentID: "msg_db_user",
    modelID: "qwen-coder-example",
    providerID: "openai",
    time: { created: 1782720002000, completed: 1782720005000 },
  }));

  const insertPart = database.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)");
  insertPart.run("prt_db_1", "msg_db_user", "example-opencode-db-session", 1782720001000, 1782720001000, JSON.stringify({ type: "text", text: "Inspect the failing command." }));
  insertPart.run("prt_db_2", "msg_db_assistant", "example-opencode-db-session", 1782720002000, 1782720002000, JSON.stringify({ type: "reasoning", text: "I should run the focused command first." }));
  insertPart.run("prt_db_3", "msg_db_assistant", "example-opencode-db-session", 1782720003000, 1782720003000, JSON.stringify({ type: "text", text: "I will run the focused command." }));
  insertPart.run("prt_db_4", "msg_db_assistant", "example-opencode-db-session", 1782720004000, 1782720005000, JSON.stringify({
    type: "tool",
    callID: "call_db_1",
    tool: "shell",
    state: { status: "completed", input: { cmd: "npm test" }, output: "1 failed" },
  }));
  database.close();
}

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

function assertCommandFailsWith(args, pattern, message) {
  try {
    execFileSync(process.execPath, args, { cwd: root, stdio: "pipe" });
  } catch (error) {
    const output = [error.stdout, error.stderr]
      .filter(Boolean)
      .map((value) => Buffer.isBuffer(value) ? value.toString("utf-8") : String(value))
      .join("\n");
    if (pattern.test(output)) return;
    throw new Error(`${message}: unexpected error output: ${output}`);
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
