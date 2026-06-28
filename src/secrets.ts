import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function buildLiteralSecrets(envFile: string, secretInputs: string[]): Array<{ name: string; value: string; replacement: string }> {
  const secrets = new Map<string, string>();
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, "utf-8");
    const pattern = /^export\s+([A-Za-z_][A-Za-z_0-9]*)=["']?([^"'\n#]+)/gm;
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      const value = match[2].trim().replace(/["']$/, "");
      if (looksSensitiveName(name) && value.length > 4) {
        secrets.set(name, value);
      }
    }
  }

  let secretIndex = 1;
  for (const input of secretInputs) {
    const resolved = path.resolve(input);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      const lines = fs.readFileSync(resolved, "utf-8").split("\n");
      for (const line of lines) {
        const value = line.trim();
        if (value.length > 0) {
          secrets.set(`SECRET_${secretIndex++}`, value);
        }
      }
      continue;
    }

    if (input.length > 0) {
      secrets.set(`SECRET_${secretIndex++}`, input);
    }
  }

  return [...secrets.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, value]) => ({
      name,
      value,
      replacement: `[REDACTED_${name}]`,
    }));
}

export function looksSensitiveName(name: string): boolean {
  const upper = name.toUpperCase();
  return ["KEY", "TOKEN", "SECRET", "PASSWORD", "PWD", "COOKIE"].some((part) => upper.includes(part));
}

export function countOccurrences(text: string, value: string): number {
  if (!value) return 0;
  return text.split(value).length - 1;
}

export function computeSecretHash(envFile: string, secretInputs: string[]): string {
  const secrets = buildLiteralSecrets(envFile, secretInputs)
    .map((entry) => entry.value)
    .sort()
    .join("\n");
  return `sha256:${createHash("sha256").update(secrets).digest("hex")}`;
}
