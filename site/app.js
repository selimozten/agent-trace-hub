const repository = "selimozten/agent-trace-hub";
const releaseBase = `https://github.com/${repository}/releases/latest/download`;
const installCommands = {
  macos: `curl -fsSL https://raw.githubusercontent.com/${repository}/main/install.sh | sh`,
  linux: `curl -fsSL https://raw.githubusercontent.com/${repository}/main/install.sh | sh`,
  windows: `irm https://raw.githubusercontent.com/${repository}/main/install.ps1 | iex`,
};
const assets = {
  "macos-arm64": "agent-trace-hub-darwin-arm64.tar.gz",
  "macos-x64": "agent-trace-hub-darwin-x64.tar.gz",
  "linux-arm64": "agent-trace-hub-linux-arm64.tar.gz",
  "linux-x64": "agent-trace-hub-linux-x64.tar.gz",
  "windows-x64": "agent-trace-hub-windows-x64.zip",
};

const command = document.querySelector("#install-command");
const tabs = [...document.querySelectorAll("[data-platform]")];
const recommendedDownload = document.querySelector("#recommended-download");

initialize();

async function initialize() {
  const detected = await detectPlatform();
  selectPlatform(detected.platform);
  updateRecommendedDownload(detected);
  updateLatestVersion();
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectPlatform(tab.dataset.platform));
}

for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const target = document.querySelector(`#${button.dataset.copyTarget}`);
    try {
      await navigator.clipboard.writeText(target.textContent);
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy"; }, 1400);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(target);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  });
}

function selectPlatform(platform) {
  const selected = installCommands[platform] ? platform : "macos";
  command.textContent = installCommands[selected];
  for (const tab of tabs) {
    const active = tab.dataset.platform === selected;
    tab.setAttribute("aria-pressed", String(active));
  }
}

function updateRecommendedDownload({ platform, architecture }) {
  const key = `${platform}-${architecture}`;
  const asset = assets[key];
  if (!asset) {
    recommendedDownload.href = "#download";
    return;
  }

  const labels = {
    "macos-arm64": "Download for macOS",
    "macos-x64": "Download for macOS",
    "linux-arm64": "Download for Linux",
    "linux-x64": "Download for Linux",
    "windows-x64": "Download for Windows",
  };
  recommendedDownload.href = `${releaseBase}/${asset}`;
  recommendedDownload.querySelector("span:first-child").textContent = labels[key];
}

async function detectPlatform() {
  const userAgent = navigator.userAgent.toLowerCase();
  let platform = userAgent.includes("windows")
    ? "windows"
    : userAgent.includes("linux")
      ? "linux"
      : "macos";
  let architecture = "x64";

  if (/arm64|aarch64/.test(userAgent)) architecture = "arm64";
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      const values = await navigator.userAgentData.getHighEntropyValues(["architecture", "platform"]);
      if (/arm/i.test(values.architecture)) architecture = "arm64";
      if (/win/i.test(values.platform)) platform = "windows";
      if (/linux/i.test(values.platform)) platform = "linux";
      if (/mac/i.test(values.platform)) platform = "macos";
    } catch {
      // User-agent detection remains a best-effort recommendation.
    }
  }

  return { platform, architecture };
}

async function updateLatestVersion() {
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return;
    const release = await response.json();
    if (!/^v\d+\.\d+\.\d+/.test(release.tag_name)) return;
    for (const node of document.querySelectorAll("[data-version]")) {
      node.textContent = release.tag_name;
    }
  } catch {
    // The static version remains usable when GitHub's API is unavailable.
  }
}
