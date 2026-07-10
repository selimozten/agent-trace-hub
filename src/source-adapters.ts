import type { CanonicalTrace, JsonObject, NormalizeOptions, NormalizeSource } from "./types.ts";

export type ConcreteSource = Exclude<NormalizeSource, "auto">;
export type AdapterSupport = "native" | "compatibility" | "fallback";
export type AdapterTier = "v1" | "extended";

export interface SourceAdapterDefinition {
  source: ConcreteSource;
  sourceFormat: string;
  defaultAgent: string;
  support: AdapterSupport;
  tier: AdapterTier;
  autoDetect: boolean;
  description: string;
}

export interface SourceAdapterImplementation {
  detect(records: JsonObject[]): boolean;
  normalize(inputPath: string, records: JsonObject[], options: NormalizeOptions): CanonicalTrace;
}

export interface SourceAdapter extends SourceAdapterDefinition, SourceAdapterImplementation {}

export type SourceAdapterImplementations = Record<ConcreteSource, SourceAdapterImplementation>;

export const SOURCE_ADAPTER_DEFINITIONS: readonly SourceAdapterDefinition[] = [
  {
    source: "pi",
    sourceFormat: "pi-session-jsonl",
    defaultAgent: "pi",
    support: "native",
    tier: "v1",
    autoDetect: true,
    description: "Pi session JSONL",
  },
  {
    source: "claude-code",
    sourceFormat: "claude-code-jsonl",
    defaultAgent: "claude-code",
    support: "native",
    tier: "v1",
    autoDetect: true,
    description: "Claude Code project transcript JSONL",
  },
  {
    source: "codex",
    sourceFormat: "codex-rollout-jsonl",
    defaultAgent: "codex",
    support: "native",
    tier: "v1",
    autoDetect: true,
    description: "Codex rollout JSONL",
  },
  {
    source: "omp",
    sourceFormat: "omp-session-jsonl",
    defaultAgent: "omp",
    support: "native",
    tier: "v1",
    autoDetect: true,
    description: "Oh My Pi append-only session JSONL",
  },
  {
    source: "cursor-agent",
    sourceFormat: "cursor-agent-transcript-jsonl",
    defaultAgent: "cursor-agent",
    support: "native",
    tier: "v1",
    autoDetect: true,
    description: "Cursor Agent CLI transcript JSONL",
  },
  {
    source: "cursor",
    sourceFormat: "cursor-agent-transcript-jsonl",
    defaultAgent: "cursor",
    support: "compatibility",
    tier: "extended",
    autoDetect: false,
    description: "Legacy alias for Cursor Agent CLI transcripts",
  },
  {
    source: "anthropic-messages",
    sourceFormat: "anthropic-messages-jsonl",
    defaultAgent: "anthropic-compatible",
    support: "fallback",
    tier: "extended",
    autoDetect: true,
    description: "Anthropic Messages-compatible JSON or JSONL",
  },
  {
    source: "opencode",
    sourceFormat: "opencode-session-export-json",
    defaultAgent: "opencode",
    support: "native",
    tier: "v1",
    autoDetect: true,
    description: "OpenCode SQLite store or native session export JSON",
  },
  {
    source: "continue",
    sourceFormat: "continue-session-json",
    defaultAgent: "continue",
    support: "native",
    tier: "extended",
    autoDetect: true,
    description: "Continue native session JSON",
  },
  {
    source: "goose",
    sourceFormat: "goose-session-export-json",
    defaultAgent: "goose",
    support: "native",
    tier: "extended",
    autoDetect: true,
    description: "Goose native session export JSON",
  },
  {
    source: "openai-chat",
    sourceFormat: "openai-chat-jsonl",
    defaultAgent: "openai-compatible",
    support: "fallback",
    tier: "extended",
    autoDetect: true,
    description: "OpenAI Chat Completions-compatible JSON or JSONL",
  },
  {
    source: "generic-json",
    sourceFormat: "generic-json-chat",
    defaultAgent: "generic-json",
    support: "fallback",
    tier: "extended",
    autoDetect: true,
    description: "Generic nested role/content JSON or JSONL",
  },
  {
    source: "aider",
    sourceFormat: "aider-markdown-history",
    defaultAgent: "aider",
    support: "native",
    tier: "extended",
    autoDetect: true,
    description: "Aider markdown chat history",
  },
  {
    source: "markdown-transcript",
    sourceFormat: "markdown-transcript",
    defaultAgent: "markdown-transcript",
    support: "fallback",
    tier: "extended",
    autoDetect: true,
    description: "Role-heading markdown transcript",
  },
] as const;

export class SourceAdapterRegistry {
  readonly adapters: readonly SourceAdapter[];
  readonly #bySource: ReadonlyMap<ConcreteSource, SourceAdapter>;

  constructor(implementations: SourceAdapterImplementations) {
    const definitions = validateDefinitions(SOURCE_ADAPTER_DEFINITIONS);
    const adapters = definitions.map((definition) => {
      const implementation = implementations[definition.source];
      if (!implementation) throw new Error(`Missing adapter implementation: ${definition.source}`);
      return Object.freeze({ ...definition, ...implementation });
    });

    const knownSources = new Set(definitions.map((definition) => definition.source));
    for (const source of Object.keys(implementations)) {
      if (!knownSources.has(source as ConcreteSource)) throw new Error(`Adapter implementation has no definition: ${source}`);
    }

    this.adapters = Object.freeze(adapters);
    this.#bySource = new Map(adapters.map((adapter) => [adapter.source, adapter]));
  }

  require(source: ConcreteSource): SourceAdapter {
    const adapter = this.#bySource.get(source);
    if (!adapter) throw new Error(`Unsupported source: ${source}`);
    return adapter;
  }

  resolve(source: NormalizeSource, records: JsonObject[]): SourceAdapter {
    if (source !== "auto") return this.require(source);
    const adapter = this.adapters.find((candidate) => candidate.autoDetect && candidate.detect(records));
    if (!adapter) throw new Error("Could not auto-detect source. Pass --source explicitly.");
    return adapter;
  }
}

export function isNormalizeSource(source: string): source is NormalizeSource {
  return source === "auto" || SOURCE_ADAPTER_DEFINITIONS.some((definition) => definition.source === source);
}

export function isConcreteSource(source: string): source is ConcreteSource {
  return source !== "auto" && isNormalizeSource(source);
}

export function normalizeSourceList(): string {
  return ["auto", ...SOURCE_ADAPTER_DEFINITIONS.map((definition) => definition.source)].join(", ");
}

export function isV1Source(source: ConcreteSource): boolean {
  return SOURCE_ADAPTER_DEFINITIONS.some((definition) => definition.source === source && definition.tier === "v1");
}

function validateDefinitions(definitions: readonly SourceAdapterDefinition[]): readonly SourceAdapterDefinition[] {
  const seen = new Set<string>();
  for (const definition of definitions) {
    if (seen.has(definition.source)) throw new Error(`Duplicate adapter definition: ${definition.source}`);
    seen.add(definition.source);
    if (definition.autoDetect && definition.support === "compatibility") {
      throw new Error(`Compatibility adapter cannot auto-detect: ${definition.source}`);
    }
  }
  return definitions;
}
