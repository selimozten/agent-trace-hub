import fs from "node:fs";
import path from "node:path";
import type { RejectOptions } from "./types.ts";
import { REJECT_FILE } from "./types.ts";
import { workspacePath } from "./workspace.ts";

export async function runReject(options: RejectOptions): Promise<void> {
  const sessionFile = normalizeRejectTarget(options.target);
  const rejectPath = workspacePath(options.workspace, REJECT_FILE);
  const existing = fs.existsSync(rejectPath)
    ? new Set(fs.readFileSync(rejectPath, "utf-8").split("\n").map((line) => line.trim()).filter(Boolean))
    : new Set<string>();

  existing.add(sessionFile);
  const content = [...existing].sort().join("\n");
  fs.writeFileSync(rejectPath, content.length > 0 ? `${content}\n` : "");

  console.log(`Rejected session: ${sessionFile}`);
  console.log(`Updated: ${rejectPath}`);
}

function normalizeRejectTarget(target: string): string {
  const base = path.basename(target);

  if (base.endsWith(".jsonl")) return base;
  if (base.endsWith(".review.json")) return base.slice(0, -".review.json".length);

  const marker = base.indexOf("_L");
  if (marker !== -1) {
    return `${base.slice(0, marker)}.jsonl`;
  }

  throw new Error(`Cannot derive session filename from target: ${target}`);
}
