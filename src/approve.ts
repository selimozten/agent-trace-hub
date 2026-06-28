import fs from "node:fs";
import path from "node:path";
import { isRecord } from "./workspace.ts";
import type { ApprovalReport, ApproveOptions, AuditReport } from "./types.ts";

export async function runApprove(options: ApproveOptions): Promise<void> {
  const audit = loadPassingAuditReport(options.auditReport);
  const approval: ApprovalReport = {
    schema: "agent_trace_approval_v1",
    created_at: new Date().toISOString(),
    reviewer: options.reviewer,
    audit_report: options.auditReport,
    audit_input: audit.input,
    audit_created_at: audit.created_at,
    trace_count: audit.trace_count,
    message_count: audit.message_count,
    finding_count: audit.finding_count,
    blocking_finding_count: audit.blocking_finding_count,
    status: "approved",
    ...(options.notes ? { notes: options.notes } : {}),
  };

  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(approval, null, 2)}\n`);
  console.log(`Wrote canonical approval report: ${options.output}`);
  console.log(`Reviewer: ${approval.reviewer}`);
  console.log(`Traces: ${approval.trace_count}`);
}

export function loadPassingAuditReport(reportPath: string): AuditReport {
  const parsed = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Invalid audit report: ${reportPath}`);
  const report = parsed as unknown as AuditReport;
  if (report.schema !== "agent_trace_audit_v1") throw new Error(`Invalid audit report schema: ${reportPath}`);
  if (report.status !== "pass" || report.blocking_finding_count !== 0) {
    throw new Error(`Audit report did not pass: ${reportPath}`);
  }
  return report;
}

export function loadApprovalReport(reportPath: string): ApprovalReport {
  const parsed = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Invalid approval report: ${reportPath}`);
  const report = parsed as unknown as ApprovalReport;
  if (report.schema !== "agent_trace_approval_v1") throw new Error(`Invalid approval report schema: ${reportPath}`);
  if (report.status !== "approved") throw new Error(`Approval report is not approved: ${reportPath}`);
  if (!report.reviewer) throw new Error(`Approval report missing reviewer: ${reportPath}`);
  if (report.blocking_finding_count !== 0) {
    throw new Error(`Approval report references blocking finding(s): ${reportPath}`);
  }
  return report;
}
