import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readCanonicalJsonl } from "./canonical.ts";
import { isRecord } from "./workspace.ts";
import type { AuditReport, CanonicalTrace, ReleaseDatasetInfo, ReleaseManifestEntry, ReleaseOptions } from "./types.ts";

const DEFAULT_DATASET_NAME = "agent-trace-hub canonical traces";
const DEFAULT_LICENSE = "other";

export async function runRelease(options: ReleaseOptions): Promise<void> {
  if (options.auditReport) validateAuditReport(options.auditReport);
  const dataset = await buildReleaseDataset(options);
  writeReleaseDataset(options, dataset);
  console.log(`Wrote canonical dataset release: ${options.outputDir}`);
  console.log(`Shards: ${dataset.info.shard_count}`);
  console.log(`Traces: ${dataset.info.trace_count}`);
  console.log(`Messages: ${dataset.info.message_count}`);
}

function validateAuditReport(reportPath: string): void {
  const parsed = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Invalid audit report: ${reportPath}`);
  const report = parsed as unknown as AuditReport;
  if (report.schema !== "agent_trace_audit_v1") throw new Error(`Invalid audit report schema: ${reportPath}`);
  if (report.status !== "pass" || report.blocking_finding_count !== 0) {
    throw new Error(`Refusing release: audit report did not pass (${report.blocking_finding_count} blocking finding(s))`);
  }
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
  copySchema(options.outputDir);
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

function copySchema(outputDir: string): void {
  const sourceSchema = path.resolve("schema/agent_trace_v1.schema.json");
  if (!fs.existsSync(sourceSchema)) return;
  const targetDir = path.join(outputDir, "schema");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourceSchema, path.join(targetDir, "agent_trace_v1.schema.json"));
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
