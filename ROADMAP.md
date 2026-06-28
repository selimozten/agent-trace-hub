# Roadmap

The target is a production-ready trace pipeline that can ingest major coding-agent harnesses, normalize them into `agent_trace_v1`, review/redact them safely, and render them for multiple model families.

## Current Support

| Harness/source | Normalize | Auto-detect | Fixture test | Notes |
| --- | --- | --- | --- | --- |
| Pi | yes | yes | yes | Inherited safety workflow is still Pi-first. |
| Claude Code | yes | yes | yes | Handles nested `message`, thinking, text, tool use, and tool result blocks. |
| Codex | yes | yes | yes | Handles rollout envelopes, response items, reasoning summaries, function calls, and tool outputs. |
| Cursor | yes | yes | yes | Handles Cursor `agent-transcripts` JSONL with top-level role and nested message content. |
| Aider markdown history | yes | yes | yes | Handles common markdown role sections and `####` user prompts. |
| Markdown transcript | yes | yes | yes | Generic explicit role-heading transcript fallback. |
| OpenAI-compatible chat | yes | yes | yes | Covers harnesses that persist OpenAI Chat Completions-style `messages`. |
| Anthropic-compatible messages | yes | yes | yes | Covers harnesses that persist Anthropic `messages` content blocks. |

## Next Source Adapters

| Harness/source | Priority | Notes |
| --- | --- | --- |
| OpenCode | high | Common OpenAI-compatible coding CLI; likely JSON event logs/config-dependent. |
| Continue | medium | Often stores chat/session data in IDE extension state. |
| Goose | medium | Tool-call/session schema should map cleanly to canonical messages. |
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
- Add JSON Schema export for `agent_trace_v1`.
- Add release manifest commands for reviewed canonical shards.
- Add configurable redaction profiles for local/private/public release modes.
- Preserve tool schemas when source logs include them.
- Add outcome enrichers for final diff, tests run, exit codes, build status, and user acceptance.
- Add CI with `npm run check`, `npm test`, and `npm run build`.
- Resolve licensing before publishing a public fork based on upstream code.
