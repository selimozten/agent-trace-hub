import { SOURCE_ADAPTER_DEFINITIONS } from "./source-adapters.ts";
import type { SourcesOptions } from "./types.ts";

export function runSources(options: SourcesOptions): void {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(SOURCE_ADAPTER_DEFINITIONS, null, 2)}\n`);
    return;
  }

  console.log("SOURCE\tSUPPORT\tDETECTION\tDESCRIPTION");
  for (const adapter of SOURCE_ADAPTER_DEFINITIONS) {
    console.log(`${adapter.source}\t${adapter.support}\t${adapter.autoDetect ? "auto" : "explicit"}\t${adapter.description}`);
  }
}
