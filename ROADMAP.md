# Roadmap

The target is a production-ready trace pipeline that can ingest major coding-agent harnesses, normalize them into `agent_trace_v1`, review/redact them safely, and render them for multiple model families. Private/internal training is the default deployment mode; external publication is a separate policy decision.

## Current Pipeline

| Stage | Status | Notes |
| --- | --- | --- |
| Discover local trace files | yes | `discover` scans known Codex, Claude Code, Cursor, OpenCode, Continue, Goose, Pi, and project-local Aider paths and emits a JSONL manifest. |
| Ingest discovery manifests | yes | `ingest` normalizes mixed-source discovery manifests into a canonical shard with optional error reporting. |
| Normalize raw traces | yes | Converts supported sources into `agent_trace_v1`. |
| Validate canonical shards | yes | Validates required canonical structure and message/tool-call invariants. |
| Validate artifact metadata | yes | `validate-artifact` validates canonical traces, discovery rows, ingest errors, audit reports, approval reports, and release metadata against packaged schemas. |
| Audit canonical shards | yes | `audit` performs deterministic checks for known secrets, deny patterns, common credential patterns, and image blocks with local/private/public profiles. |
| Approve canonical shards | yes | `approve` creates explicit human approval artifacts from passing audit reports. |
| Dataset review gate | yes | `review-gate` records manual or external LLM dataset-level review decisions and `release --review-gate` requires approved matching input. |
| Package canonical dataset | yes | `release` validates canonical inputs and writes `data/`, `manifest.jsonl`, `dataset_info.json`, and a dataset card. |
| Render training targets | yes | Renders multiple model-family formats from canonical data. |
| Enrich outcomes | yes | `enrich` derives command, test, build, final-diff availability, and user-acceptance signals from canonical traces. |
| Review/redact before release | partial | Strong inherited Pi workflow plus deterministic canonical audit, human approval, and dataset-level review gate; running external LLM review remains an integration concern. |

## Current Support

| Harness/source | Normalize | Auto-detect | Fixture test | Notes |
| --- | --- | --- | --- | --- |
| Pi | yes | yes | yes | Inherited safety workflow is still Pi-first. |
| Claude Code | yes | yes | yes | Handles nested `message`, thinking, text, tool use, and tool result blocks. |
| Codex | yes | yes | yes | Handles rollout envelopes, response items, reasoning summaries, function calls, and tool outputs. |
| Cursor | yes | yes | yes | Handles Cursor `agent-transcripts` JSONL with top-level role and nested message content. |
| OpenCode | yes | no | yes | Explicit source alias for OpenAI-compatible exported JSONL; native private store parser still needs real samples. |
| Continue | yes | no | yes | Explicit source alias for OpenAI-compatible exported JSONL; IDE extension state parser still needs real samples. |
| Goose | yes | no | yes | Explicit source alias for OpenAI-compatible exported JSONL; native session parser still needs real samples. |
| Aider markdown history | yes | yes | yes | Handles common markdown role sections and `####` user prompts. |
| Markdown transcript | yes | yes | yes | Generic explicit role-heading transcript fallback. |
| OpenAI-compatible chat | yes | yes | yes | Covers harnesses that persist OpenAI Chat Completions-style `messages`. |
| Anthropic-compatible messages | yes | yes | yes | Covers harnesses that persist Anthropic `messages` content blocks. |
| Generic JSON chat | yes | yes | yes | Conservative fallback for nested `history`, `conversation`, `events`, `transcript`, or similar role/content exports. |

## Adapter Architecture

| Component | Status | Notes |
| --- | --- | --- |
| Source adapter registry | yes | Adapter metadata and registration live in `src/source-adapters.ts` so new harness parsers can be added without changing normalize command flow. |
| Registry introspection | yes | `sources` exposes support level, detection policy, source format, and default agent from the executable registry. |
| Strict input parsing | yes | Active writers are retried briefly; persistent malformed JSON/JSONL fails with source location, and partial recovery is explicit. |
| Per-source implementation files | partial | Parser implementations still share `src/normalize.ts`; split into per-source modules as native OpenCode/Continue/Goose samples become available. |

## Next Source Adapters

| Harness/source | Priority | Notes |
| --- | --- | --- |
| OpenCode native logs | high | Add a verified parser for local/session-store logs if they differ from OpenAI-compatible exports. |
| Continue native logs | medium | Often stores chat/session data in IDE extension state. |
| Goose native logs | medium | Tool-call/session schema should map cleanly to canonical messages once real samples are available. |
| raw OpenAI chat logs | done | Useful fallback adapter for many harnesses. |
| raw Anthropic messages | done | Useful fallback adapter for Claude-derived traces. |

## Current Renderers

| Format | Status | Notes |
| --- | --- | --- |
| OpenAI chat | done | OpenAI-compatible `messages` with tool calls. |
| Anthropic messages | done | Preserves content blocks and tool use/result blocks. |
| ChatML | done | Simple SFT target for many open models. |
| ShareGPT | done | Needed for common fine-tuning tools. |
| plain SFT text | done | Helpful for fast experiments. |
| Ornith/Qwen XML | done | Emits `<think>`, `<tool_call>`, and `<tool_response>` serialization. |

## Next Renderers

| Format | Priority | Notes |
| --- | --- | --- |
| TRL preference pairs | medium | Requires quality/outcome labels. |
| DPO/ORPO pairs | medium | Requires rejected alternatives or outcome-derived pair construction. |

## Production Hardening

- Add native OpenCode, Continue, and Goose parsers once real local-session samples are available.
- Split native parser implementations into source-local modules behind the registry seam.
- Validate discovery candidates against adapter detection before assigning high confidence.
- Add preference-pair renderers when quality labels or rejected alternatives are available.
- Before any external publication, choose explicit project and dataset licenses and run a redistribution review.
