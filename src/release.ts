import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadApprovalReport, loadPassingAuditReport } from "./approve.ts";
import { readCanonicalJsonl } from "./canonical.ts";
import { loadApprovedReviewGate } from "./review-gate.ts";
import type { CanonicalTrace, ReleaseDatasetInfo, ReleaseManifestEntry, ReleaseOptions } from "./types.ts";

const DEFAULT_DATASET_NAME = "agent-trace-hub canonical traces";
const DEFAULT_LICENSE = "other";

export async function runRelease(options: ReleaseOptions): Promise<void> {
  validateReleaseGates(options);
  const dataset = await buildReleaseDataset(options);
  writeReleaseDataset(options, dataset);
  console.log(`Wrote canonical dataset release: ${options.outputDir}`);
  console.log(`Shards: ${dataset.info.shard_count}`);
  console.log(`Traces: ${dataset.info.trace_count}`);
  console.log(`Messages: ${dataset.info.message_count}`);
}

function validateReleaseGates(options: ReleaseOptions): void {
  const releaseInput = singleGatedInput(options);
  if (options.auditReport) {
    const audit = loadPassingAuditReport(options.auditReport);
    if (audit.input !== releaseInput) {
      throw new Error(`Audit report input does not match release input: ${audit.input} !== ${releaseInput}`);
    }
  }

  if (options.approvalReport) {
    const approval = loadApprovalReport(options.approvalReport);
    if (approval.audit_input !== releaseInput) {
      throw new Error(`Approval report audit input does not match release input: ${approval.audit_input} !== ${releaseInput}`);
    }
  }

  if (options.reviewGate) {
    const gate = loadApprovedReviewGate(options.reviewGate);
    if (gate.input !== releaseInput) {
      throw new Error(`Review gate input does not match release input: ${gate.input} !== ${releaseInput}`);
    }
  }
}

function singleGatedInput(options: ReleaseOptions): string {
  if (!options.auditReport && !options.approvalReport && !options.reviewGate) return options.inputs[0] ?? "";
  if (options.inputs.length !== 1) {
    throw new Error("release gates currently require exactly one --input per audit/approval report");
  }
  return options.inputs[0];
}

interface ReleaseDataset {
  info: ReleaseDatasetInfo;
  shards: Array<{ entry: ReleaseManifestEntry; contents: string }>;
}

async function buildReleaseDataset(options: ReleaseOptions): Promise<ReleaseDataset> {
  const shards: ReleaseDataset["shards"] = [];
  const totalSourceAgents: Record<string, number> = {};
  let totalTraceCount = 0;
  let totalMessageCount = 0;

  for (const [index, input] of options.inputs.entries()) {
    const traces = await readCanonicalJsonl(input);
    const contents = canonicalJsonl(traces);
    const sourceAgents = countSourceAgents(traces);
    const messageCount = traces.reduce((sum, trace) => sum + trace.messages.length, 0);
    const file = `data/shard-${String(index).padStart(5, "0")}.agent_trace_v1.jsonl`;

    mergeCounts(totalSourceAgents, sourceAgents);
    totalTraceCount += traces.length;
    totalMessageCount += messageCount;

    shards.push({
      contents,
      entry: {
        file,
        source_file: input,
        schema: "agent_trace_v1",
        sha256: sha256Text(contents),
        trace_count: traces.length,
        message_count: messageCount,
        source_agents: sourceAgents,
      },
    });
  }

  return {
    shards,
    info: {
      name: options.name ?? DEFAULT_DATASET_NAME,
      schema: "agent_trace_v1",
      created_at: new Date().toISOString(),
      license: options.license ?? DEFAULT_LICENSE,
      shard_count: shards.length,
      trace_count: totalTraceCount,
      message_count: totalMessageCount,
      source_agents: sortRecord(totalSourceAgents),
      files: shards.map((shard) => shard.entry),
    },
  };
}

function writeReleaseDataset(options: ReleaseOptions, dataset: ReleaseDataset): void {
  prepareOutputDir(options.outputDir, options.force);
  const dataDir = path.join(options.outputDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });

  for (const shard of dataset.shards) {
    fs.writeFileSync(path.join(options.outputDir, shard.entry.file), shard.contents);
  }

  fs.writeFileSync(path.join(options.outputDir, "manifest.jsonl"), dataset.info.files.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  fs.writeFileSync(path.join(options.outputDir, "dataset_info.json"), `${JSON.stringify(dataset.info, null, 2)}\n`);
  fs.writeFileSync(path.join(options.outputDir, "README.md"), datasetCard(dataset.info));
  copySchemas(options.outputDir);
}

function prepareOutputDir(outputDir: string, force: boolean): void {
  if (fs.existsSync(outputDir)) {
    const entries = fs.readdirSync(outputDir);
    if (entries.length > 0 && !force) {
      throw new Error(`release output directory is not empty: ${outputDir}. Use --force to replace it.`);
    }
    if (force) fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });
}

function canonicalJsonl(traces: CanonicalTrace[]): string {
  return traces.map((trace) => JSON.stringify(trace)).join("\n") + (traces.length > 0 ? "\n" : "");
}

function countSourceAgents(traces: CanonicalTrace[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const trace of traces) {
    const agent = trace.source.agent || "unknown";
    counts[agent] = (counts[agent] ?? 0) + 1;
  }
  return sortRecord(counts);
}

function mergeCounts(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function sha256Text(text: string): string {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

function copySchemas(outputDir: string): void {
  const sourceDir = path.resolve("schema");
  if (!fs.existsSync(sourceDir)) return;
  const targetDir = path.join(outputDir, "schema");
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".schema.json")) {
      fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
    }
  }
}

function datasetCard(info: ReleaseDatasetInfo): string {
  const agents = Object.entries(info.source_agents)
    .map(([agent, count]) => `- ${agent}: ${count}`)
    .join("\n");
  return `---
pretty_name: ${info.name}
task_categories:
- text-generation
tags:
- agent-traces
- coding-agent
- agent-trace-hub
language:
- en
- code
license: ${info.license}
---

# ${info.name}

This dataset contains canonical coding-agent traces in the \`agent_trace_v1\` JSONL format.

## Files

- \`data/*.agent_trace_v1.jsonl\`: canonical trace shards, one complete session per line
- \`manifest.jsonl\`: one entry per shard with source file, trace count, message count, source-agent counts, and SHA-256
- \`dataset_info.json\`: aggregate dataset metadata
- \`schema/agent_trace_v1.schema.json\`: canonical schema

## Summary

- Shards: ${info.shard_count}
- Traces: ${info.trace_count}
- Messages: ${info.message_count}

## Source agents

${agents || "- none"}

## Safety

Only publish traces that have passed your intended redaction and review policy. Canonical export validates structure and creates release metadata; it does not prove that private data has been removed.
`;
}
