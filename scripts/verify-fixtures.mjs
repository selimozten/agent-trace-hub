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

assertJsonl("examples/codex-session.agent_trace_v1.jsonl", (trace) => {
  assert(trace.schema === "agent_trace_v1", "schema mismatch");
  assert(trace.messages.length === 3, "codex fixture should coalesce to 3 messages");
  assert(trace.messages[1].tool_calls?.[0]?.arguments?.cmd === "pytest -q", "codex tool args not parsed");
});

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
fs.rmSync(discoverOutput, { force: true });
fs.rmSync(discoverRoot, { recursive: true, force: true });
fs.rmSync(tmpRawDir, { recursive: true, force: true });
console.log("fixture verification passed");

function run(args) {
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
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
