# Roadmap

The target is a production-ready trace pipeline that can ingest major coding-agent harnesses, normalize them into `agent_trace_v1`, review/redact them safely, and render them for multiple model families.

## Current Pipeline

| Stage | Status | Notes |
| --- | --- | --- |
| Discover local trace files | yes | `discover` scans known Codex, Claude Code, Cursor, OpenCode, Continue, Goose, Pi, and project-local Aider paths and emits a JSONL manifest. |
| Ingest discovery manifests | yes | `ingest` normalizes mixed-source discovery manifests into a canonical shard with optional error reporting. |
| Normalize raw traces | yes | Converts supported sources into `agent_trace_v1`. |
| Validate canonical shards | yes | Validates required canonical structure and message/tool-call invariants. |
| Validate artifact metadata | yes | `validate-artifact` validates canonical traces, discovery rows, ingest errors, audit reports, approval reports, and release metadata against packaged schemas. |
| Audit canonical shards | yes | `audit` performs deterministic checks for known secrets, deny patterns, common credential patterns, and image blocks. |
| Approve canonical shards | yes | `approve` creates explicit human approval artifacts from passing audit reports. |
| Package canonical release | yes | `release` validates canonical inputs and writes `data/`, `manifest.jsonl`, `dataset_info.json`, and a dataset card. |
| Render training targets | yes | Renders multiple model-family formats from canonical data. |
| Review/redact before release | partial | Strong inherited Pi workflow plus deterministic canonical audit and human approval; deeper LLM-assisted review still needs a dataset-level command. |

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

- Move source adapters into separate modules once more than five are implemented.
- Add LLM-assisted review gates for canonical shards.
- Add configurable redaction profiles for local/private/public release modes.
- Add outcome enrichers for final diff, tests run, exit codes, build status, and user acceptance.
- Add CI with `npm run check`, `npm test`, and `npm run build`.
- Resolve licensing before publishing a public fork based on upstream code.
