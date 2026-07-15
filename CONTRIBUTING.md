# Contributing

Contributions should preserve the canonical-first design: source adapters
capture provider detail, `agent_trace_v1` remains portable, and renderers own
trainer-specific formatting.

Open an issue before a large adapter, schema, or CLI contract change. Small
bug fixes and fixture improvements can go directly to a pull request.

## Development

```bash
npm ci
npm run check
npm test
npm run build
npm run build:binary
npm run test:binary
npm run test:public
```

Use `npm run build:binaries` only when preparing cross-platform release artifacts; it downloads the target Bun runtimes and produces substantially larger build output.

## Adding A Source Adapter

1. Add the source name to `NormalizeSource` in `src/types.ts`.
2. Add its metadata to `SOURCE_ADAPTER_DEFINITIONS` in `src/source-adapters.ts`, including an honest `native`, `compatibility`, or `fallback` support label.
3. Add its detector and normalizer to `ADAPTER_IMPLEMENTATIONS` in `src/normalize.ts`. The registry rejects missing, duplicate, or unknown entries at startup.
4. Keep detection conservative. Compatibility adapters cannot auto-detect, and generic `openai-chat`, `anthropic-messages`, and `generic-json` should remain fallback adapters.
5. Preserve structured reasoning, tool calls, tool results, tool schemas, source metadata, and ordering.
6. Add a safe fixture in `examples/` and extend `scripts/verify-fixtures.mjs`. Every registry entry must have a fixture.
7. Run `agent-trace-hub sources --json` and update `README.md` and `ROADMAP.md`.

## Adding A Renderer

1. Add the format to `RenderFormat` in `src/types.ts`.
2. Add rendering logic in `src/render.ts`.
3. Include metadata with `source` and `outcome`.
4. Add fixture verification for the new format.
5. Update `README.md` and `ROADMAP.md`.

## Safety

Do not commit real private traces, credentials, API keys, cookies, browser profiles, `.env` files, or raw proprietary code dumps. Use synthetic fixtures or heavily redacted examples.

Pull requests that add a source must document its local storage contract and
state which fields the adapter cannot recover. Never make partial support look
native by silently dropping reasoning, tool calls, or tool results.

## Pull Requests

- Keep changes scoped and include tests proportional to the parser or schema risk.
- Update `CHANGELOG.md` under an unreleased section for user-facing behavior.
- Run `npm run check`, `npm test`, and `npm run test:public`.
- Do not commit generated `dist/`, `dist-bin/`, `release-assets/`, or trace data.
