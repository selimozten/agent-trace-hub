import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { Database } from "bun:sqlite";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const binary = path.join(root, "dist-bin", process.platform === "win32" ? "ath.exe" : "ath");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-trace-hub-binary-"));

try {
  assert(fs.existsSync(binary), `Missing executable: ${binary}`);
  assert(run(["--version"]).stdout.trim() === packageJson.version, "Executable version mismatch");
  const sources = JSON.parse(run(["sources", "--json"]).stdout);
  assert(sources.filter((source) => source.tier === "v1").length === 6, "Executable source registry mismatch");

  const ompOutput = path.join(temp, "omp.jsonl");
  run([
    "normalize",
    "--source", "auto",
    "--input", path.join(root, "examples/omp-session.jsonl"),
    "--output", ompOutput,
  ]);
  run(["validate-artifact", "--kind", "agent-trace", "--input", ompOutput]);

  const databasePath = path.join(temp, "opencode.db");
  createOpenCodeDatabase(databasePath);
  const openCodeOutput = path.join(temp, "opencode.jsonl");
  run(["normalize", "--source", "opencode", "--input", databasePath, "--output", openCodeOutput]);
  const openCodeTrace = JSON.parse(fs.readFileSync(openCodeOutput, "utf-8"));
  assert(openCodeTrace.source.source_format === "opencode-sqlite", "Bun SQLite extraction failed");

  const releaseDir = path.join(temp, "release");
  run(["release", "--input", ompOutput, "--output-dir", releaseDir]);
  assert(fs.existsSync(path.join(releaseDir, "schema/agent_trace_v1.schema.json")), "Embedded release schemas missing");
  run(["validate-artifact", "--kind", "release-info", "--input", path.join(releaseDir, "dataset_info.json")]);
  console.log("standalone executable verification passed");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

function run(args) {
  const result = Bun.spawnSync([binary, ...args], { cwd: temp, stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();
  if (result.exitCode !== 0) throw new Error(`Executable failed (${args.join(" ")}):\n${stdout}\n${stderr}`);
  return { stdout, stderr };
}

function createOpenCodeDatabase(file) {
  const database = new Database(file, { create: true, strict: true });
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
  database.prepare(`
    INSERT INTO session (
      id, project_id, slug, directory, title, version, model, time_created, time_updated
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "binary-opencode-session", "binary-project", "binary-session", "/redacted/project",
    "Binary fixture", "1.0.0", JSON.stringify({ id: "model", providerID: "provider" }), 1, 2,
  );
  database.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?)")
    .run("msg_binary_user", "binary-opencode-session", 1, 1, JSON.stringify({ role: "user" }));
  database.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)")
    .run("prt_binary_text", "msg_binary_user", "binary-opencode-session", 1, 1, JSON.stringify({ type: "text", text: "Hello" }));
  database.close();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
