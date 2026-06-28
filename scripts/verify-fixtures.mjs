import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const nodeArgs = ["--experimental-strip-types", "src/index.ts"];

const fixtures = [
  ["pi", "examples/pi-session.jsonl", "examples/pi-session.agent_trace_v1.jsonl"],
  ["claude-code", "examples/claude-code-session.jsonl", "examples/claude-code-session.agent_trace_v1.jsonl"],
  ["codex", "examples/codex-session.jsonl", "examples/codex-session.agent_trace_v1.jsonl"],
  ["openai-chat", "examples/openai-chat-session.jsonl", "examples/openai-chat-session.agent_trace_v1.jsonl"],
  ["anthropic-messages", "examples/anthropic-messages-session.jsonl", "examples/anthropic-messages-session.agent_trace_v1.jsonl"],
];

for (const [source, input, output] of fixtures) {
  run([...nodeArgs, "normalize", "--source", source, "--input", input, "--output", output]);
  run([...nodeArgs, "validate", "--input", output]);
}

run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/codex-session.jsonl", "--output", "examples/codex-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/codex-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "normalize", "--source", "auto", "--input", "examples/anthropic-messages-session.jsonl", "--output", "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"]);
run([...nodeArgs, "validate", "--input", "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"]);

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

assertJsonl("examples/codex-session.agent_trace_v1.jsonl", (trace) => {
  assert(trace.schema === "agent_trace_v1", "schema mismatch");
  assert(trace.messages.length === 3, "codex fixture should coalesce to 3 messages");
  assert(trace.messages[1].tool_calls?.[0]?.arguments?.cmd === "pytest -q", "codex tool args not parsed");
});

fs.rmSync(path.join(root, "examples/codex-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(path.join(root, "examples/anthropic-messages-session.auto.agent_trace_v1.jsonl"), { force: true });
fs.rmSync(tmpRawDir, { recursive: true, force: true });
console.log("fixture verification passed");

function run(args) {
  execFileSync(process.execPath, args, { cwd: root, stdio: "inherit" });
}

function assertJsonl(file, check) {
  const lines = fs.readFileSync(path.join(root, file), "utf-8").trim().split("\n").filter(Boolean);
  for (const line of lines) check(JSON.parse(line));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
