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
- native `cursor` transcript adapter
- `aider` and `markdown-transcript` adapters for markdown-style CLI histories
- explicit `opencode`, `continue`, and `goose` aliases for OpenAI-compatible JSONL exports
- generic `openai-chat` and `anthropic-messages` adapters for harnesses that already export API-shaped message logs
- `normalize --source auto` source detection
- `discover` for finding local candidate traces from common coding-agent harnesses
- `normalize-dir` for combining a directory of trace JSONL files into one canonical JSONL shard
- `validate` for canonical `agent_trace_v1` JSONL
- `render` for OpenAI chat, Anthropic messages, ChatML, ShareGPT, plain SFT text, and Ornith/Qwen XML training text
- `release` for packaging validated canonical shards with manifest metadata and a dataset card
- fixture regression test covering normalization, validation, batch normalization, rendering, auto-detection, and Codex assistant-turn coalescing

Planned:

- additional source adapters for OpenCode, Continue, and Goose when their native logs differ from API-shaped logs
- dataset-level review gates for canonical public shards

## Usage

Normalize a trace:

```bash
agent-trace-hub discover \
  --root "$HOME" \
  --output raw/discovered-traces.jsonl

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
- `cursor`
- `opencode`
- `continue`
- `goose`
- `openai-chat`
- `anthropic-messages`
- `aider`
- `markdown-transcript`

`opencode`, `continue`, and `goose` currently expect OpenAI-compatible exported JSONL: either one line with a `messages` array or one message per JSONL line. Native private session-store parsers should be added against real samples when those formats differ.

`discover` emits a JSONL manifest of candidate trace files with `source`, `normalize_source`, `path`, `kind`, `confidence`, and `reason`. It scans known harness locations under `--root`, including Codex, Claude Code, Cursor, OpenCode, Continue, Goose, Pi, and project-local Aider history files.

Normalize a directory into one shard:

```bash
agent-trace-hub normalize-dir \
  --source auto \
  --input-dir raw/ \
  --output canonical/shard-00001.agent_trace_v1.jsonl
```

Validate canonical JSONL:

```bash
agent-trace-hub validate --input canonical/session.agent_trace_v1.jsonl
```

Build a local canonical dataset release directory:

```bash
agent-trace-hub release \
  --input canonical/shard-00001.agent_trace_v1.jsonl \
  --output-dir release/agent-traces \
  --name "my coding agent traces" \
  --license other
```

The release directory contains `data/*.agent_trace_v1.jsonl`, `manifest.jsonl`, `dataset_info.json`, and `README.md`. It validates input structure and records file hashes/counts; it does not replace redaction or human/LLM review.

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
- `anthropic-messages`
- `chatml`
- `sharegpt`
- `sft-text`
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

JSON Schema:

[schema/agent_trace_v1.schema.json](schema/agent_trace_v1.schema.json)

## Development

```bash
npm ci
npm run check
npm test
npm run build
```

`npm test` regenerates the examples and verifies:

- Pi, Claude Code, Codex, Cursor, Aider, Markdown transcript, OpenAI-chat, and Anthropic-message normalization
- local trace discovery for supported harness directories
- canonical schema validation
- canonical release packaging, manifest counts, and overwrite protection
- all supported render formats
- batch `normalize-dir`
- Codex response-item coalescing into a single assistant turn before tool output

## Publishing Note

The upstream repository did not include a license file at the time this local fork was created. Treat this as a private development fork until upstream licensing is clarified, or reimplement the reusable pieces cleanly in a separately licensed repository.
