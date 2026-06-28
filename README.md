# agent-trace-hub

Collect, review, normalize, and publish coding-agent traces.

This project started as a local fork of `badlogic/pi-share-hf`. The original tool has a strong safety pipeline for Pi sessions: deterministic redaction, TruffleHog scanning, deny rules, LLM review, manual rejection, and Hugging Face upload.

`agent-trace-hub` keeps that safety workflow and extends the goal: store traces in one canonical format first, then render them into model-specific training formats.

## Goals

- ingest traces from Pi, Codex, Claude Code, OpenCode, Aider, Cursor, Continue, and similar coding agents
- redact and review traces before release
- normalize provider-specific logs into `agent_trace_v1`
- publish canonical dataset shards
- render canonical traces into Ornith/Qwen XML, OpenAI chat, Anthropic messages, ChatML, ShareGPT, and SFT text

## Current Status

Implemented:

- inherited Pi collection/review/upload workflow
- `normalize --source pi` for converting one Pi session JSONL into canonical `agent_trace_v1`

Planned:

- Codex importer
- Claude Code importer
- dataset-level canonical export after review
- model-family renderers
- schema validation and release reports

## Usage

Normalize a redacted Pi session:

```bash
agent-trace-hub normalize \
  --source pi \
  --input .pi/hf-sessions/redacted/session.jsonl \
  --output canonical/session.agent_trace_v1.jsonl
```

The existing Pi safety workflow remains available:

```bash
agent-trace-hub init --repo myuser/my-project-sessions
agent-trace-hub collect --secret secrets.txt --deny deny.txt README.md AGENTS.md
agent-trace-hub list --uploadable
agent-trace-hub upload --dry-run
```

## Canonical Format

Each output JSONL line is one complete session:

```json
{
  "schema": "agent_trace_v1",
  "session_id": "example",
  "source": {
    "agent": "pi",
    "model": "model-id",
    "cwd": "/redacted/project",
    "source_format": "pi-session-jsonl"
  },
  "metadata": {},
  "tools": [],
  "messages": [
    {
      "role": "user",
      "content": [{"type": "text", "text": "Fix the failing tests."}]
    },
    {
      "role": "assistant",
      "reasoning": [{"type": "text", "text": "I should inspect the test output."}],
      "content": [{"type": "text", "text": "I will run the tests."}],
      "tool_calls": [
        {"id": "call_1", "name": "bash", "arguments": {"command": "pytest"}}
      ]
    }
  ],
  "outcome": {"quality": "unlabeled"}
}
```

## Publishing Note

The upstream repository did not include a license file at the time this local fork was created. Treat this as a private development fork until upstream licensing is clarified, or reimplement the reusable pieces cleanly in a separately licensed repository.
