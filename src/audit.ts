import fs from "node:fs";
import path from "node:path";
import { readCanonicalJsonl } from "./canonical.ts";
import { buildLiteralSecrets, countOccurrences } from "./secrets.ts";
import type { AuditFinding, AuditOptions, AuditReport, CanonicalTrace, JsonObject, JsonValue, Severity } from "./types.ts";

interface CredentialPattern {
  name: string;
  regex: RegExp;
  severity: Severity;
}

const CREDENTIAL_PATTERNS: CredentialPattern[] = [
  { name: "aws-access-key-id", regex: /\bA[SK]IA[0-9A-Z]{16}\b/g, severity: "critical" },
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, severity: "critical" },
  { name: "openai-api-key", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g, severity: "critical" },
  { name: "anthropic-api-key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, severity: "critical" },
  { name: "huggingface-token", regex: /\bhf_[A-Za-z0-9]{20,}\b/g, severity: "critical" },
  { name: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, severity: "critical" },
  { name: "private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/g, severity: "critical" },
  { name: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, severity: "high" },
  { name: "credential-url", regex: /\bhttps?:\/\/[^/\s:@]{2,}:[^/\s:@]{2,}@/g, severity: "high" },
];

const EVIDENCE_LIMIT = 120;

export async function runAudit(options: AuditOptions): Promise<void> {
  const report = await auditCanonical(options);
  const contents = `${JSON.stringify(report, null, 2)}\n`;

  if (options.output) {
    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, contents);
    console.log(`Wrote canonical audit report: ${options.output}`);
  } else {
    process.stdout.write(contents);
  }

  const log = (message: string) => options.output ? console.log(message) : console.error(message);
  log(`Audit status: ${report.status}`);
  log(`Findings: ${report.finding_count}`);
  log(`Blocking findings: ${report.blocking_finding_count}`);

  if (shouldFail(options.failOn, report)) {
    throw new Error(`Canonical audit failed: ${report.blocking_finding_count} blocking finding(s), ${report.finding_count} total finding(s)`);
  }
}

export async function auditCanonical(options: AuditOptions): Promise<AuditReport> {
  const traces = await readCanonicalJsonl(options.input);
  const literalSecrets = buildLiteralSecrets(options.envFile, options.secrets);
  const findings: AuditFinding[] = [];

  for (const [traceIndex, trace] of traces.entries()) {
    findings.push(...auditTrace(trace, traceIndex, literalSecrets, options.denyPatterns, options.profile));
  }

  const blockingFindingCount = findings.filter((finding) => finding.blocking).length;
  return {
    input: options.input,
    schema: "agent_trace_audit_v1",
    created_at: new Date().toISOString(),
    profile: options.profile,
    trace_count: traces.length,
    message_count: traces.reduce((sum, trace) => sum + trace.messages.length, 0),
    finding_count: findings.length,
    blocking_finding_count: blockingFindingCount,
    findings,
    status: blockingFindingCount > 0 ? "fail" : "pass",
  };
}

function auditTrace(
  trace: CanonicalTrace,
  traceIndex: number,
  literalSecrets: Array<{ name: string; value: string; replacement: string }>,
  denyPatterns: RegExp[],
  profile: AuditOptions["profile"],
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  visitJson(trace as unknown as JsonObject, `$[${traceIndex}]`, (value, jsonPath) => {
    if (typeof value !== "string") return;
    findings.push(...auditString(value, jsonPath, literalSecrets, denyPatterns));
  });

  for (const [messageIndex, message] of trace.messages.entries()) {
    for (const [blockIndex, block] of (message.content ?? []).entries()) {
      if (block.type === "image") {
        const blocking = profile === "public";
        findings.push({
          severity: blocking ? "high" : "medium",
          detector: "image",
          jsonPath: `$[${traceIndex}].messages[${messageIndex}].content[${blockIndex}]`,
          detail: blocking ? "image block disallowed by public audit profile" : block.mime_type ?? "image",
          evidence: "[image block]",
          blocking,
        });
      }
    }
  }

  return findings;
}

function auditString(
  value: string,
  jsonPath: string,
  literalSecrets: Array<{ name: string; value: string; replacement: string }>,
  denyPatterns: RegExp[],
): AuditFinding[] {
  const findings: AuditFinding[] = [];

  for (const secret of literalSecrets) {
    const count = countOccurrences(value, secret.value);
    if (count === 0) continue;
    findings.push({
      severity: "critical",
      detector: "literal-secret",
      jsonPath,
      detail: `${secret.name} (${count} occurrence${count === 1 ? "" : "s"})`,
      evidence: secret.replacement,
      blocking: true,
    });
  }

  for (const pattern of denyPatterns) {
    pattern.lastIndex = 0;
    if (!pattern.test(value)) continue;
    findings.push({
      severity: "high",
      detector: "deny-pattern",
      jsonPath,
      detail: pattern.source,
      evidence: truncate(value),
      blocking: true,
    });
  }

  for (const pattern of CREDENTIAL_PATTERNS) {
    pattern.regex.lastIndex = 0;
    const match = pattern.regex.exec(value);
    if (!match) continue;
    findings.push({
      severity: pattern.severity,
      detector: "credential-pattern",
      jsonPath,
      detail: pattern.name,
      evidence: maskEvidence(match[0]),
      blocking: true,
    });
  }

  return findings;
}

function visitJson(value: JsonValue, jsonPath: string, onValue: (value: JsonValue, jsonPath: string) => void): void {
  onValue(value, jsonPath);
  if (value === null) return;
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) visitJson(child, `${jsonPath}[${index}]`, onValue);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitJson(child, `${jsonPath}${formatObjectKey(key)}`, onValue);
  }
}

function formatObjectKey(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `.${key}`;
  return `[${JSON.stringify(key)}]`;
}

function maskEvidence(value: string): string {
  if (value.length <= 12) return "[masked]";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function truncate(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= EVIDENCE_LIMIT) return compact;
  return `${compact.slice(0, EVIDENCE_LIMIT)}...`;
}

function shouldFail(failOn: AuditOptions["failOn"], report: AuditReport): boolean {
  if (failOn === "never") return false;
  if (failOn === "any") return report.finding_count > 0;
  return report.blocking_finding_count > 0;
}
