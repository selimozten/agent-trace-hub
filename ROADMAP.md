# Roadmap

The target is a production-ready trace pipeline that can ingest major coding-agent harnesses, normalize them into `agent_trace_v1`, review/redact them safely, and render them for multiple model families.

## Current Support

| Harness/source | Normalize | Auto-detect | Fixture test | Notes |
| --- | --- | --- | --- | --- |
| Pi | yes | yes | yes | Inherited safety workflow is still Pi-first. |
| Claude Code | yes | yes | yes | Handles nested `message`, thinking, text, tool use, and tool result blocks. |
| Codex | yes | yes | yes | Handles rollout envelopes, response items, reasoning summaries, function calls, and tool outputs. |

## Next Source Adapters

| Harness/source | Priority | Notes |
| --- | --- | --- |
| OpenCode | high | Common OpenAI-compatible coding CLI; likely JSON event logs/config-dependent. |
| Aider | high | Needs parser for chat history plus repository diff/test outcomes. |
| Cursor | medium | Export format varies by local storage and privacy boundaries. |
| Continue | medium | Often stores chat/session data in IDE extension state. |
| Goose | medium | Tool-call/session schema should map cleanly to canonical messages. |
| raw OpenAI chat logs | high | Useful fallback adapter for many harnesses. |
| raw Anthropic messages | high | Useful fallback adapter for Claude-derived traces. |

## Next Renderers

| Format | Priority | Notes |
| --- | --- | --- |
| Anthropic messages | high | Preserve content blocks and tool use/result blocks. |
| ChatML | high | Simple SFT target for many open models. |
| ShareGPT | medium | Needed for common fine-tuning tools. |
| plain SFT text | medium | Helpful for fast experiments. |
| TRL preference pairs | medium | Requires quality/outcome labels. |

## Production Hardening

- Move source adapters into separate modules once more than five are implemented.
- Add JSON Schema export for `agent_trace_v1`.
- Add dataset-level `normalize-dir` and release manifest commands.
- Add configurable redaction profiles for local/private/public release modes.
- Preserve tool schemas when source logs include them.
- Add outcome enrichers for final diff, tests run, exit codes, build status, and user acceptance.
- Add CI with `npm run check`, `npm test`, and `npm run build`.
- Resolve licensing before publishing a public fork based on upstream code.

