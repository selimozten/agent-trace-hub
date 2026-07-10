# agent-trace-hub

Collect, review, normalize, and package coding-agent traces.

This project started as a local fork of `badlogic/pi-share-hf`. The original tool has a strong safety pipeline for Pi sessions: deterministic redaction, TruffleHog scanning, deny rules, LLM review, manual rejection, and Hugging Face upload.

`agent-trace-hub` keeps that safety workflow and extends the goal: store traces in one canonical format first, then render them into model-specific training formats.

## Goals

- provide production-grade v1 ingestion for Claude Code, Codex, Pi, Oh My Pi (`omp`), OpenCode, and Cursor Agent CLI
- redact and review traces before training or release
- normalize provider-specific logs into `agent_trace_v1`
- package canonical dataset shards for private training or optional publication
- render canonical traces into Ornith/Qwen XML, OpenAI chat, Anthropic messages, ChatML, ShareGPT, and SFT text

## Current Status

Implemented:

- inherited Pi collection/review/upload workflow
- branch-aware native Pi and Oh My Pi JSONL adapters
- branch-aware Claude Code JSONL with streamed assistant-part coalescing and unique subagent session IDs
- Codex rollout JSONL with mirrored-user deduplication, reasoning, function/custom tool calls, web search, and tool output
- native `cursor-agent` transcript adapter with stable synthesized call IDs and preserved `input` arguments
- direct read-only, multi-session extraction from the OpenCode SQLite store
- `aider` and `markdown-transcript` adapters for markdown-style CLI histories
- native OpenCode session-export JSON with typed message parts, reasoning, files, tools, and tool results
- native Continue session JSON with context items, thinking, tool states, and tool output
- native Goose session-export JSON with typed conversation content, thinking, tool requests, and tool responses
- backward-compatible OpenAI-shaped import for older OpenCode, Continue, and Goose exports
- generic `openai-chat` and `anthropic-messages` adapters for harnesses that already export API-shaped message logs
- `generic-json` fallback adapter for nested role/content exports such as `history`, `conversation`, `events`, or `transcript`
- preservation of source tool schemas when API-shaped exports include them
- `normalize --source auto` source detection
- `sources` for machine-readable adapter support and auto-detection metadata
- `discover` for finding local candidate traces from common coding-agent harnesses
- `ingest` for normalizing mixed-source discovery manifests into one canonical shard
- `normalize-dir` for combining a directory of trace JSONL files into one canonical JSONL shard
- `validate` for canonical `agent_trace_v1` JSONL
- `audit` for deterministic canonical release blockers, including known secrets, deny patterns, and common credential patterns
- audit profiles for local, private, and public release policies
- `approve` for explicit human approval artifacts tied to passing audit reports
- `review-gate` for dataset-level manual or LLM review decisions before release
- `render` for OpenAI chat, Anthropic messages, ChatML, ShareGPT, plain SFT text, and Ornith/Qwen XML training text
- `enrich` for deterministic outcome signals such as commands, tests, build status, final diff availability, and user acceptance placeholders
- `release` for packaging validated canonical shards with manifest metadata and a dataset card
- GitHub Actions CI for check, test, and build
- fixture regression test covering normalization, validation, batch normalization, rendering, auto-detection, and Codex assistant-turn coalescing

Planned:

- additional harnesses after the v1 source contract is stable
- direct extraction from the Goose local store
- additional training-target renderers such as TRL preference pairs and DPO/ORPO pairs

## Usage

Normalize a trace:

```bash
agent-trace-hub sources

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

V1 source values:

- `auto`
- `pi`
- `omp`
- `claude-code`
- `codex`
- `cursor-agent`
- `opencode`

Extended and compatibility importers remain available:

- `cursor` (legacy alias for `cursor-agent`)
- `continue`
- `goose`
- `openai-chat`
- `anthropic-messages`
- `generic-json`
- `aider`
- `markdown-transcript`

OpenCode needs no manual export. `discover` finds `~/.local/share/opencode/opencode.db`, and `ingest` reads all non-empty sessions in one read-only SQLite transaction. A single database manifest row can therefore produce many canonical traces.

The upstream JSON export remains supported for portable snapshots:

```bash
opencode export <session-id> > raw/opencode-session.json
```

The default `discover` scope is `--source v1`. Use `--source all` to include extended importers, or select one source explicitly.

| V1 harness | Native location under `--root` |
| --- | --- |
| Claude Code | `.claude/projects/**/*.jsonl` |
| Codex | `.codex/sessions/**/*.jsonl`, `.codex/rollouts/**/*.jsonl` |
| Pi | `.pi/agent/sessions/**/*.jsonl` |
| Oh My Pi | `.omp/agent/sessions/**/*.jsonl` |
| OpenCode | `.local/share/opencode/opencode.db` |
| Cursor Agent CLI | `.cursor/projects/**/agent-transcripts/**/*.jsonl` |

Cursor Agent transcripts preserve prompts, assistant text, and tool requests but do not currently contain tool results. Canonical Cursor traces make this explicit with `metadata.tool_results_available: false`.

Run `agent-trace-hub sources --json` to inspect the executable adapter registry. Each source is labeled `native`, `compatibility`, or `fallback`, and reports whether auto-detection is enabled.

`generic-json` is a conservative fallback for JSON/JSONL exports that are not provider-shaped but still contain role/content messages. It recognizes common nested arrays such as `messages`, `conversation`, `history`, `turns`, `events`, `transcript`, and `items`, plus role aliases like `human`, `ai`, `model`, and `tool_result`.

JSON and JSONL parsing is strict by default so corrupt rows cannot disappear silently. Active JSONL files are retried briefly when a writer is finishing a line, and persistent failures report the file and line number. `normalize`, `normalize-dir`, and `ingest` accept `--skip-invalid-lines` when partial recovery is intentional; the command still fails if no valid object records remain.

`discover` emits a JSONL manifest of candidate trace files and stores with `source`, `normalize_source`, `path`, `kind`, `confidence`, and `reason`. `kind` includes `sqlite` for multi-session stores.

`ingest` reads that manifest and uses each row's `normalize_source`, so one shard can combine all six v1 harnesses. Extended importers can be mixed into the same canonical shard when explicitly discovered.

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

Create a dataset-level review gate:

```bash
agent-trace-hub review-gate \
  --input canonical/shard-00001.agent_trace_v1.jsonl \
  --output canonical/shard-00001.review-gate.json \
  --reviewer "@reviewer-or-llm" \
  --method manual \
  --summary "Reviewed for private training."
```

Use `--method llm` when the summary comes from an external LLM review workflow. Release accepts only approved review gates whose input matches the released shard.

Build a local canonical dataset directory:

```bash
agent-trace-hub release \
  --input canonical/shard-00001.agent_trace_v1.jsonl \
  --output-dir release/agent-traces \
  --audit-report canonical/shard-00001.audit.json \
  --approval-report canonical/shard-00001.approval.json \
  --review-gate canonical/shard-00001.review-gate.json \
  --name "my coding agent traces" \
  --license other
```

The release directory contains `data/*.agent_trace_v1.jsonl`, `manifest.jsonl`, `dataset_info.json`, `README.md`, and the canonical schema. It validates input structure and records file hashes/counts. Deterministic audit, human approval, and dataset-level review become release gates when supplied; gated releases currently require the report input to match the single released shard exactly. The `--license` value is dataset metadata for packaging systems such as Hugging Face; for private/internal training, `other` is acceptable until you choose a more specific policy.

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

Additional artifact schemas live in `schema/` for discovery rows, ingest errors, audit reports, approval reports, review gate reports, release manifest entries, and release dataset info.

## Development

```bash
npm ci
npm run check
npm test
npm run build
```

`npm test` regenerates the examples and verifies:

- v1 Pi, OMP, Claude Code, Codex, Cursor Agent, and OpenCode normalization
- branch replay, Codex mirror deduplication, Cursor tool-input preservation, and direct OpenCode SQLite extraction
- extended OpenCode/Continue/Goose reasoning, context, tool-call, and tool-result preservation
- OpenCode/Continue/Goose compatibility import and native auto-detection
- adapter registry coverage, support labels, and compatibility auto-detection invariants
- active-writer retry, strict malformed JSON/JSONL rejection, and explicit partial JSONL recovery
- local trace discovery for supported harness directories
- mixed-source manifest ingest and error reporting
- canonical schema validation
- artifact schema validation for discovery, ingest errors, audit, approval, and release metadata
- user-facing `validate-artifact` coverage for every packaged schema
- malformed artifact rejection coverage for every `validate-artifact` kind
- deterministic canonical audit pass/fail behavior and release gating
- human approval artifact generation and release gating
- dataset-level review gate artifacts and release gating
- canonical release packaging, manifest counts, and overwrite protection
- all supported render formats
- deterministic outcome enrichment
- batch `normalize-dir`
- Codex response-item coalescing plus custom-tool preservation

## Private Use

This repository is set up for private/internal trace collection and model training first. Keep raw traces, canonical shards, audit reports, approvals, and rendered training data private by default.

If you later decide to publish the tool or a dataset externally, do a separate redistribution review and choose explicit project and dataset licenses at that point.
