import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const args = process.argv.slice(2);
const target = optionValue(args, "--target");
const explicitOutfile = optionValue(args, "--outfile");
const buildAll = args.includes("--all");
const targets = buildAll
  ? [
      "bun-darwin-arm64",
      "bun-darwin-x64",
      "bun-linux-arm64",
      "bun-linux-x64-baseline",
      "bun-windows-x64-baseline",
    ]
  : [target];

if (buildAll && explicitOutfile) throw new Error("--outfile cannot be combined with --all");
fs.mkdirSync(path.join(root, "dist-bin"), { recursive: true });

for (const buildTarget of targets) {
  await buildBinary(buildTarget);
}

async function buildBinary(buildTarget) {
  const outfile = explicitOutfile
    ? path.resolve(explicitOutfile)
    : buildTarget
      ? releasePath(buildTarget)
      : path.join(root, "dist-bin", process.platform === "win32" ? "ath.exe" : "ath");
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  fs.rmSync(outfile, { force: true });
  fs.rmSync(`${outfile}.sha256`, { force: true });

  const compile = {
    outfile,
    autoloadDotenv: false,
    autoloadBunfig: false,
    autoloadPackageJson: false,
    ...(buildTarget ? { target: buildTarget } : {}),
  };
  const result = await Bun.build({
    entrypoints: [path.join(root, "src/index.ts")],
    compile,
    format: "esm",
    minify: true,
    bytecode: true,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`Bun executable build failed${buildTarget ? ` for ${buildTarget}` : ""}`);
  }

  if (!outfile.endsWith(".exe")) fs.chmodSync(outfile, 0o755);
  const bytes = fs.readFileSync(outfile);
  const digest = createHash("sha256").update(bytes).digest("hex");
  fs.writeFileSync(`${outfile}.sha256`, `${digest}  ${path.basename(outfile)}\n`);
  console.log(`Built ${path.relative(root, outfile)} (${formatBytes(bytes.length)})`);
  console.log(`SHA-256 ${digest}`);
}

function releasePath(buildTarget) {
  const platform = buildTarget.replace(/^bun-/, "").replace(/-baseline$|-modern$/, "");
  const extension = buildTarget.includes("windows") ? ".exe" : "";
  return path.join(root, "dist-bin", `agent-trace-hub-v${packageJson.version}-${platform}${extension}`);
}

function optionValue(values, name) {
  const index = values.indexOf(name);
  if (index === -1) return undefined;
  const value = values[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function formatBytes(bytes) {
  const mib = bytes / (1024 * 1024);
  return `${mib.toFixed(1)} MiB`;
}
