import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const binaryDir = path.join(root, "dist-bin");
const outputDir = path.join(root, "release-assets");
const version = packageJson.version;
const targets = [
  { platform: "darwin-arm64", executable: false },
  { platform: "darwin-x64", executable: false },
  { platform: "linux-arm64", executable: false },
  { platform: "linux-x64", executable: false },
  { platform: "windows-x64", executable: true },
];

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

for (const target of targets) packageTarget(target);

const assets = fs.readdirSync(outputDir).sort();
const checksums = assets.map((name) => {
  const digest = createHash("sha256")
    .update(fs.readFileSync(path.join(outputDir, name)))
    .digest("hex");
  return `${digest}  ${name}`;
});
fs.writeFileSync(path.join(outputDir, "checksums.txt"), `${checksums.join("\n")}\n`);

console.log(`Packaged ${assets.length} release assets in ${path.relative(root, outputDir)}/`);

function packageTarget({ platform, executable }) {
  const extension = executable ? ".exe" : "";
  const source = path.join(binaryDir, `agent-trace-hub-v${version}-${platform}${extension}`);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing release binary: ${path.relative(root, source)}`);
  }

  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-trace-hub-release-"));
  try {
    const binaryName = executable ? "ath.exe" : "ath";
    const stagedBinary = path.join(temporaryDir, binaryName);
    fs.copyFileSync(source, stagedBinary);
    if (!executable) fs.chmodSync(stagedBinary, 0o755);

    if (executable) {
      const output = path.join(outputDir, `agent-trace-hub-${platform}.zip`);
      run("zip", ["-j", "-q", output, stagedBinary]);
    } else {
      const output = path.join(outputDir, `agent-trace-hub-${platform}.tar.gz`);
      run("tar", ["-C", temporaryDir, "-czf", output, binaryName]);
    }
  } finally {
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}
