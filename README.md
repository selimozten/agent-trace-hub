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
- `normalize` adapters for Pi, Claude Code, and Codex JSONL traces
- `normalize --source auto` source detection
- `validate` for canonical `agent_trace_v1` JSONL
- `render` for OpenAI chat JSONL and Ornith/Qwen XML training text
- fixture regression test covering normalization, validation, rendering, and Codex assistant-turn coalescing

Planned:

- dataset-level canonical export after review
- additional source adapters for OpenCode, Aider, Cursor, Continue, Goose, and raw OpenAI/Anthropic logs
- additional renderers for Anthropic messages, ChatML, ShareGPT, and plain SFT text
- release reports and dataset cards for canonical public shards

## Usage

Normalize a trace:

```bash
agent-trace-hub normalize \
  --source auto \
  --input raw/session.jsonl \
  --output canonical/session.agent_trace_v1.jsonl
```

Supported source values:

- `auto`
- `pi`
- `claude-code`
- `codex`

Validate canonical JSONL:

```bash
agent-trace-hub validate --input canonical/session.agent_trace_v1.jsonl
```

Render for training:

```bash
agent-trace-hub render \
  --format openai-chat \
  --input canonical/session.agent_trace_v1.jsonl \
  --output rendered/session.openai-chat.jsonl

agent-trace-hub render \
  --format ornith-qwen-xml \
  --input canonical/session.agent_trace_v1.jsonl \
  --output rendered/session.ornith-qwen-xml.jsonl
```

Supported render values:

- `openai-chat`
- `ornith-qwen-xml`

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

## Development

```bash
npm install
npm run check
npm test
npm run build
```

`npm test` regenerates the examples and verifies:

- Pi, Claude Code, and Codex normalization
- canonical schema validation
- OpenAI chat rendering
- Ornith/Qwen XML rendering
- Codex response-item coalescing into a single assistant turn before tool output

## Publishing Note

The upstream repository did not include a license file at the time this local fork was created. Treat this as a private development fork until upstream licensing is clarified, or reimplement the reusable pieces cleanly in a separately licensed repository.
