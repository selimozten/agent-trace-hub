import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { validateJsonSchema } from "./schema.ts";
import type { ArtifactKind, JsonValue, ValidateArtifactOptions } from "./types.ts";

const ARTIFACTS: Record<ArtifactKind, { schema: string; jsonl: boolean }> = {
  "agent-trace": { schema: "agent_trace_v1.schema.json", jsonl: true },
  "audit": { schema: "agent_trace_audit_v1.schema.json", jsonl: false },
  "approval": { schema: "agent_trace_approval_v1.schema.json", jsonl: false },
  "review-gate": { schema: "agent_trace_review_gate_v1.schema.json", jsonl: false },
  "discovery": { schema: "discovered_trace_v1.schema.json", jsonl: true },
  "ingest-error": { schema: "ingest_error_v1.schema.json", jsonl: true },
  "release-manifest": { schema: "release_manifest_entry_v1.schema.json", jsonl: true },
  "release-info": { schema: "release_dataset_info_v1.schema.json", jsonl: false },
};

export async function runValidateArtifact(options: ValidateArtifactOptions): Promise<void> {
  const artifact = ARTIFACTS[options.kind];
  if (!artifact) throw new Error(`Unsupported artifact kind: ${options.kind}`);
  const schemaPath = path.resolve("schema", artifact.schema);
  const count = artifact.jsonl
    ? await validateJsonl(options.input, schemaPath)
    : validateJson(options.input, schemaPath);
  console.log(`Validated ${count} ${options.kind} artifact${count === 1 ? "" : "s"}: ${options.input}`);
}

async function validateJsonl(inputPath: string, schemaPath: string): Promise<number> {
  const input = fs.createReadStream(inputPath, { encoding: "utf-8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  let count = 0;

  for await (const line of reader) {
    if (line.trim() === "") continue;
    validateJsonSchema(JSON.parse(line) as JsonValue, schemaPath);
    count++;
  }

  return count;
}

function validateJson(inputPath: string, schemaPath: string): number {
  validateJsonSchema(JSON.parse(fs.readFileSync(inputPath, "utf-8")) as JsonValue, schemaPath);
  return 1;
}
