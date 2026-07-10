import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { normalizeFileToTraces } from "./normalize.ts";
import { isConcreteSource, type ConcreteSource } from "./source-adapters.ts";
import type { CanonicalTrace, DiscoveredTrace, IngestError, IngestOptions } from "./types.ts";
import { isRecord } from "./workspace.ts";

export async function runIngest(options: IngestOptions): Promise<void> {
  const entries = await readDiscoveryManifest(options.manifest);
  const traces: CanonicalTrace[] = [];
  const errors: IngestError[] = [];

  for (const entry of entries) {
    const inputPath = resolveManifestPath(options.manifest, entry.path);
    try {
      const source = coerceNormalizeSource(entry.normalize_source);
      const result = await normalizeFileToTraces({
        source,
        input: inputPath,
        output: options.output,
        skipInvalidLines: options.skipInvalidLines,
      });
      traces.push(...result.traces);
    } catch (error) {
      const ingestError = {
        path: inputPath,
        source: String(entry.normalize_source ?? entry.source ?? ""),
        reason: error instanceof Error ? error.message : String(error),
      };
      errors.push(ingestError);
      if (!options.continueOnError) {
        writeErrors(options.errorOutput, errors);
        throw new Error(`Failed to ingest ${inputPath}: ${ingestError.reason}`);
      }
    }
  }

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, traces.map((trace) => JSON.stringify(trace)).join("\n") + (traces.length > 0 ? "\n" : ""));
  writeErrors(options.errorOutput, errors);

  console.log(`Wrote canonical traces: ${options.output}`);
  console.log(`Manifest entries: ${entries.length}`);
  console.log(`Traces: ${traces.length}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0 && !options.continueOnError) {
    throw new Error(`Ingest failed with ${errors.length} error(s)`);
  }
}

async function readDiscoveryManifest(manifestPath: string): Promise<DiscoveredTrace[]> {
  const input = fs.createReadStream(manifestPath, { encoding: "utf-8" });
  const reader = readline.createInterface({ input, crlfDelay: Infinity });
  const entries: DiscoveredTrace[] = [];

  for await (const line of reader) {
    if (line.trim() === "") continue;
    const parsed = JSON.parse(line) as unknown;
    if (!isRecord(parsed)) throw new Error(`Invalid discovery manifest entry in ${manifestPath}`);
    const entry = parsed as unknown as DiscoveredTrace;
    if (typeof entry.path !== "string" || !entry.path) throw new Error(`Discovery manifest entry missing path in ${manifestPath}`);
    if (typeof entry.normalize_source !== "string" || !entry.normalize_source) {
      throw new Error(`Discovery manifest entry missing normalize_source for ${entry.path}`);
    }
    entries.push(entry);
  }

  return entries;
}

function coerceNormalizeSource(source: string): ConcreteSource {
  if (!isConcreteSource(source)) throw new Error(`Unsupported normalize_source: ${source}`);
  return source;
}

function resolveManifestPath(manifestPath: string, entryPath: string): string {
  if (path.isAbsolute(entryPath)) return entryPath;
  return path.resolve(path.dirname(manifestPath), entryPath);
}

function writeErrors(output: string | undefined, errors: IngestError[]): void {
  if (!output) return;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, errors.map((error) => JSON.stringify(error)).join("\n") + (errors.length > 0 ? "\n" : ""));
}
