import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const expectedAssets = [
  "agent-trace-hub-darwin-arm64.tar.gz",
  "agent-trace-hub-darwin-x64.tar.gz",
  "agent-trace-hub-linux-arm64.tar.gz",
  "agent-trace-hub-linux-x64.tar.gz",
  "agent-trace-hub-windows-x64.zip",
];
const expectedSiteAssets = [
  "site/assets/social-card.png",
  "site/assets/agent-trace-orb.png",
  "site/assets/agent-trace-orb.txt",
  "site/assets/agents/SOURCES.md",
  "site/assets/agents/claude-code.svg",
  "site/assets/agents/codex.png",
  "site/assets/agents/pi.svg",
  "site/assets/agents/opencode.svg",
  "site/assets/agents/omp.svg",
  "site/assets/agents/cursor-agent.svg",
];

const shellCheck = spawnSync("sh", ["-n", path.join(root, "install.sh")], { encoding: "utf8" });
assert.equal(shellCheck.status, 0, shellCheck.stderr);

const shellInstaller = read("install.sh");
const powershellInstaller = read("install.ps1");
const releasePackager = read("scripts/package-release.mjs");
const siteHtml = read("site/index.html");
const siteScript = read("site/app.js");
const pagesWorkflow = read(".github/workflows/pages.yml");

for (const asset of expectedAssets) {
  assert.ok(siteScript.includes(asset), `site is missing ${asset}`);
}

for (const asset of expectedSiteAssets) {
  assert.ok(fs.existsSync(path.join(root, asset)), `site is missing ${asset}`);
}

assert.ok(shellInstaller.includes("agent-trace-hub-${platform}-${architecture}.tar.gz"));
assert.ok(powershellInstaller.includes("agent-trace-hub-windows-x64.zip"));
assert.ok(releasePackager.includes('`agent-trace-hub-${platform}.tar.gz`'));
assert.ok(releasePackager.includes('`agent-trace-hub-${platform}.zip`'));
assert.ok(siteHtml.includes("Agent Trace Hub"));
assert.ok(siteHtml.includes("assets/agent-trace-orb.png"));
assert.ok(siteScript.includes("assets/agent-trace-orb.txt"));
for (const asset of ["claude-code.svg", "codex.png", "pi.svg", "opencode.svg", "omp.svg", "cursor-agent.svg"]) {
  assert.ok(siteHtml.includes(`assets/agents/${asset}`), `site is missing the ${asset} mark`);
}
assert.ok(siteHtml.includes("id=\"download\""));
assert.ok(!siteHtml.includes('href="#"'));
assert.ok(pagesWorkflow.includes("actions/configure-pages@v6"));
assert.ok(pagesWorkflow.includes("actions/upload-pages-artifact@v5"));
assert.ok(pagesWorkflow.includes("actions/deploy-pages@v5"));
assert.ok(read("README.md").includes("curl -fsSL https://raw.githubusercontent.com/selimozten/agent-trace-hub/main/install.sh | sh"));
assert.ok(read("CHANGELOG.md").includes("## [0.1.0]"));

console.log("Public repository assets verified");
