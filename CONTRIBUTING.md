# Contributing

## Development

```bash
npm ci
npm run check
npm test
npm run build
```

## Adding A Source Adapter

1. Add the source name to `NormalizeSource` in `src/types.ts`.
2. Add a `SourceAdapter` entry in `src/normalize.ts`.
3. Keep detection conservative. Generic `openai-chat` and `anthropic-messages` should remain fallback adapters.
4. Preserve structured reasoning, tool calls, and tool results.
5. Add a safe fixture in `examples/`.
6. Extend `scripts/verify-fixtures.mjs`.
7. Update `README.md` and `ROADMAP.md`.

## Adding A Renderer

1. Add the format to `RenderFormat` in `src/types.ts`.
2. Add rendering logic in `src/render.ts`.
3. Include metadata with `source` and `outcome`.
4. Add fixture verification for the new format.
5. Update `README.md` and `ROADMAP.md`.

## Safety

Do not commit real private traces, credentials, API keys, cookies, browser profiles, `.env` files, or raw proprietary code dumps. Use synthetic fixtures or heavily redacted examples.
