import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

if (process.platform === "win32") throw new Error("install:local currently supports macOS and Linux");

const root = path.resolve(import.meta.dirname, "..");
const installDir = path.resolve(process.env.ATH_INSTALL_DIR ?? path.join(os.homedir(), ".local", "bin"));
const build = Bun.spawnSync([process.execPath, path.join(root, "scripts/build-binary.mjs")], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) process.exit(build.exitCode);

fs.mkdirSync(installDir, { recursive: true });
const source = path.join(root, "dist-bin", "ath");
const destination = path.join(installDir, "ath");
const temporary = `${destination}.tmp-${process.pid}`;
fs.copyFileSync(source, temporary);
fs.chmodSync(temporary, 0o755);
fs.renameSync(temporary, destination);

const alias = path.join(installDir, "agent-trace-hub");
fs.rmSync(alias, { force: true });
fs.symlinkSync("ath", alias);

console.log(`Installed ${destination}`);
console.log(`Installed ${alias} -> ath`);
if (!(process.env.PATH ?? "").split(path.delimiter).includes(installDir)) {
  console.log(`Add this directory to PATH: ${installDir}`);
}
