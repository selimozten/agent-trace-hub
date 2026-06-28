import fs from "node:fs";
import path from "node:path";
import { isRecord } from "./workspace.ts";
import type { ReviewGateOptions, ReviewGateReport } from "./types.ts";

export async function runReviewGate(options: ReviewGateOptions): Promise<void> {
  const report: ReviewGateReport = {
    schema: "agent_trace_review_gate_v1",
    created_at: new Date().toISOString(),
    input: options.input,
    reviewer: options.reviewer,
    method: options.method,
    status: options.status,
    summary: options.summary,
    ...(options.auditReport ? { audit_report: options.auditReport } : {}),
    ...(options.approvalReport ? { approval_report: options.approvalReport } : {}),
    ...(options.notes ? { notes: options.notes } : {}),
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Wrote canonical review gate: ${options.output}`);
  console.log(`Reviewer: ${report.reviewer}`);
  console.log(`Method: ${report.method}`);
  console.log(`Status: ${report.status}`);
}

export function loadApprovedReviewGate(reportPath: string): ReviewGateReport {
  const parsed = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Invalid review gate report: ${reportPath}`);
  const report = parsed as unknown as ReviewGateReport;
  if (report.schema !== "agent_trace_review_gate_v1") throw new Error(`Invalid review gate schema: ${reportPath}`);
  if (report.status !== "approved") throw new Error(`Review gate is not approved: ${reportPath}`);
  if (!report.reviewer) throw new Error(`Review gate missing reviewer: ${reportPath}`);
  if (!report.summary) throw new Error(`Review gate missing summary: ${reportPath}`);
  return report;
}
