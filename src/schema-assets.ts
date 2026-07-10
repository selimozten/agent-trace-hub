import agentTrace from "../schema/agent_trace_v1.schema.json" with { type: "json" };
import approval from "../schema/agent_trace_approval_v1.schema.json" with { type: "json" };
import audit from "../schema/agent_trace_audit_v1.schema.json" with { type: "json" };
import reviewGate from "../schema/agent_trace_review_gate_v1.schema.json" with { type: "json" };
import discovery from "../schema/discovered_trace_v1.schema.json" with { type: "json" };
import ingestError from "../schema/ingest_error_v1.schema.json" with { type: "json" };
import releaseInfo from "../schema/release_dataset_info_v1.schema.json" with { type: "json" };
import releaseManifest from "../schema/release_manifest_entry_v1.schema.json" with { type: "json" };
import type { JsonValue } from "./types.ts";

export const EMBEDDED_SCHEMAS: Readonly<Record<string, JsonValue>> = Object.freeze({
  "agent_trace_v1.schema.json": asJson(agentTrace),
  "agent_trace_approval_v1.schema.json": asJson(approval),
  "agent_trace_audit_v1.schema.json": asJson(audit),
  "agent_trace_review_gate_v1.schema.json": asJson(reviewGate),
  "discovered_trace_v1.schema.json": asJson(discovery),
  "ingest_error_v1.schema.json": asJson(ingestError),
  "release_dataset_info_v1.schema.json": asJson(releaseInfo),
  "release_manifest_entry_v1.schema.json": asJson(releaseManifest),
});

export function embeddedSchema(name: string): JsonValue | undefined {
  return EMBEDDED_SCHEMAS[name];
}

function asJson(value: unknown): JsonValue {
  return value as JsonValue;
}
