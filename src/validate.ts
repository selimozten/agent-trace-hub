import type { ValidateOptions } from "./types.ts";
import { readCanonicalJsonl } from "./canonical.ts";

export async function runValidate(options: ValidateOptions): Promise<void> {
  const traces = await readCanonicalJsonl(options.input);
  console.log(`Validated ${traces.length} canonical trace(s): ${options.input}`);
}
