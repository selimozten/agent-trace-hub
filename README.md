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
- `generic-json` fallback adapter for nested role/content exports such as `history`, `conversation`, `events`, or `transcript`
- preservation of source tool schemas when API-shaped exports include them
- `normalize --source auto` source detection
- `discover` for finding local candidate traces from common coding-agent harnesses
- `ingest` for normalizing mixed-source discovery manifests into one canonical shard
- `normalize-dir` for combining a directory of trace JSONL files into one canonical JSONL shard
- `validate` for canonical `agent_trace_v1` JSONL
- `audit` for deterministic canonical release blockers, including known secrets, deny patterns, and common credential patterns
- audit profiles for local, private, and public release policies
- `approve` for explicit human approval artifacts tied to passing audit reports
- `render` for OpenAI chat, Anthropic messages, ChatML, ShareGPT, plain SFT text, and Ornith/Qwen XML training text
- `enrich` for deterministic outcome signals such as commands, tests, build status, final diff availability, and user acceptance placeholders
- `release` for packaging validated canonical shards with manifest metadata and a dataset card
- GitHub Actions CI for check, test, and build
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

Normalize every supported file from a discovery manifest:

```bash
agent-trace-hub ingest \
  --manifest raw/discovered-traces.jsonl \
  --output canonical/shard-00001.agent_trace_v1.jsonl \
  --error-output canonical/ingest-errors.jsonl \
  --continue-on-error
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
- `generic-json`
- `aider`
- `markdown-transcript`

`opencode`, `continue`, and `goose` currently expect OpenAI-compatible exported JSONL: either one line with a `messages` array or one message per JSONL line. Native private session-store parsers should be added against real samples when those formats differ.

`generic-json` is a conservative fallback for JSON/JSONL exports that are not provider-shaped but still contain role/content messages. It recognizes common nested arrays such as `messages`, `conversation`, `history`, `turns`, `events`, `transcript`, and `items`, plus role aliases like `human`, `ai`, `model`, and `tool_result`.

`discover` emits a JSONL manifest of candidate trace files with `source`, `normalize_source`, `path`, `kind`, `confidence`, and `reason`. It scans known harness locations under `--root`, including Codex, Claude Code, Cursor, OpenCode, Continue, Goose, Pi, and project-local Aider history files.

`ingest` reads that manifest and uses each row's `normalize_source`, so one shard can contain mixed Codex, Claude Code, Cursor, Aider, OpenAI-compatible, Anthropic-compatible, generic JSON, Pi, OpenCode, Continue, and Goose exports.

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
agent-trace-hub validate-artifact --kind audit --input canonical/shard-00001.audit.json
```

`validate-artifact` supports `agent-trace`, `audit`, `approval`, `discovery`, `ingest-error`, `release-manifest`, and `release-info`.

Audit a canonical shard before release:

```bash
agent-trace-hub audit \
  --input canonical/shard-00001.agent_trace_v1.jsonl \
  --output canonical/shard-00001.audit.json \
  --profile public \
  --secret secrets.txt \
  --deny private-company-name
```

The audit command validates the canonical shard, checks known literal secrets, deny regexes, common credential patterns, and preserved image blocks, then writes an `agent_trace_audit_v1` report. It exits non-zero by default when blocking findings exist. `--profile private` is the default; `--profile public` treats preserved image blocks as blocking release findings.

Create a human approval artifact:

```bash
agent-trace-hub approve \
  --audit-report canonical/shard-00001.audit.json \
  --output canonical/shard-00001.approval.json \
  --reviewer "@reviewer"
```

Approval requires a passing audit report and records reviewer, counts, audit input, and optional notes.

Build a local canonical dataset release directory:

```bash
agent-trace-hub release \
  --input canonical/shard-00001.agent_trace_v1.jsonl \
  --output-dir release/agent-traces \
  --audit-report canonical/shard-00001.audit.json \
  --approval-report canonical/shard-00001.approval.json \
  --name "my coding agent traces" \
  --license other
```

The release directory contains `data/*.agent_trace_v1.jsonl`, `manifest.jsonl`, `dataset_info.json`, `README.md`, and the canonical schema. It validates input structure and records file hashes/counts. Deterministic audit and human approval become release gates when `--audit-report` and `--approval-report` are supplied.

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

Enrich canonical traces with deterministic outcome signals:

```bash
agent-trace-hub enrich \
  --input canonical/session.agent_trace_v1.jsonl \
  --output canonical/session.enriched.agent_trace_v1.jsonl
```

`enrich` derives command, test, and build signals from assistant tool calls and tool outputs. It preserves existing canonical content and writes the signals under `outcome.signals`.

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

Additional artifact schemas live in `schema/` for discovery rows, ingest errors, audit reports, approval reports, release manifest entries, and release dataset info.

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
- mixed-source manifest ingest and error reporting
- canonical schema validation
- artifact schema validation for discovery, ingest errors, audit, approval, and release metadata
- user-facing `validate-artifact` coverage for every packaged schema
- malformed artifact rejection coverage for every `validate-artifact` kind
- deterministic canonical audit pass/fail behavior and release gating
- human approval artifact generation and release gating
- canonical release packaging, manifest counts, and overwrite protection
- all supported render formats
- deterministic outcome enrichment
- batch `normalize-dir`
- Codex response-item coalescing into a single assistant turn before tool output

## Publishing Note

The upstream repository did not include a license file at the time this local fork was created. Treat this as a private development fork until upstream licensing is clarified, or reimplement the reusable pieces cleanly in a separately licensed repository.
