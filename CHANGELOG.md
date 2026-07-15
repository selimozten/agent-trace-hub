# Changelog

All notable changes to Agent Trace Hub are documented here. The project follows
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-15

### Added

- Native trace discovery and normalization for Claude Code, Codex, Pi, Oh My
  Pi, OpenCode, and Cursor Agent CLI.
- Extended importers for Continue, Goose, Aider, OpenAI-compatible chat,
  Anthropic Messages, generic JSON, and markdown transcripts.
- One canonical `agent_trace_v1` JSONL format with JSON Schema validation.
- Auditing, human approval, dataset review gates, outcome enrichment, and
  deterministic release packaging.
- Renderers for OpenAI chat, Anthropic Messages, ChatML, ShareGPT, plain SFT
  text, and Ornith/Qwen XML.
- Standalone Bun executables for macOS, Linux, and Windows.
- Verified shell and PowerShell installers plus a GitHub Pages download site.

[0.1.0]: https://github.com/selimozten/agent-trace-hub/releases/tag/v0.1.0
