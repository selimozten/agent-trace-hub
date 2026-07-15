document.documentElement.classList.add("js");

const repository = "selimozten/agent-trace-hub";
const releaseBase = `https://github.com/${repository}/releases/latest/download`;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
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
const sources = {
  "claude-code": {
    label: "Claude Code",
    location: "~/.claude/projects",
    agent: "claude-code",
    reasoning: "Inspect the failing test before editing.",
    tool: "Bash",
  },
  codex: {
    label: "Codex",
    location: "~/.codex/sessions",
    agent: "codex",
    reasoning: "Inspect the failing test first.",
    tool: "exec_command",
  },
  pi: {
    label: "Pi",
    location: "~/.pi/agent/sessions",
    agent: "pi",
    reasoning: "Replay the active branch before export.",
    tool: "bash",
  },
  opencode: {
    label: "OpenCode",
    location: "~/.local/share/opencode/opencode.db",
    agent: "opencode",
    reasoning: "Read the session parts in source order.",
    tool: "bash",
  },
  omp: {
    label: "Oh My Pi",
    location: "~/.omp/agent/sessions",
    agent: "omp",
    reasoning: "Preserve the selected provider route.",
    tool: "bash",
  },
  "cursor-agent": {
    label: "Cursor Agent CLI",
    location: "~/.cursor/projects/agent-transcripts",
    agent: "cursor-agent",
    reasoning: null,
    tool: "Shell",
    toolResultsAvailable: false,
  },
};
const formats = {
  "openai-chat": "OpenAI chat",
  "anthropic-messages": "Anthropic Messages",
  chatml: "ChatML",
  sharegpt: "ShareGPT",
  "sft-text": "Plain SFT text",
  "ornith-qwen-xml": "Ornith / Qwen XML",
};

const sourceSelect = document.querySelector("#source-select");
const formatSelect = document.querySelector("#format-select");
const installCommand = document.querySelector("#install-command");
const heroCommand = document.querySelector("#hero-command");
const platformSwitch = document.querySelector(".platform-switch");
const platformButtons = [...document.querySelectorAll("[data-install-platform]")];
const recommendedDownload = document.querySelector("#recommended-download");
const announcement = document.querySelector(".copy-announcement");
const copyTimers = new WeakMap();
let announcementTimer;
let detectedPlatform;
let userSelectedPlatform = false;

initialize();

async function initialize() {
  bindCopyControls();
  bindTraceLab();
  bindPlatformSwitch();
  initializeReveals();
  updateTraceLab();

  detectedPlatform = await detectPlatform();
  if (!userSelectedPlatform) {
    selectInstallPlatform(detectedPlatform.platform);
    updateDetectedDownload(detectedPlatform);
  }
  updateLatestVersion();
}

function bindCopyControls() {
  for (const button of document.querySelectorAll("[data-copy-target]")) {
    button.addEventListener("click", async () => {
      const target = document.querySelector(`#${button.dataset.copyTarget}`);
      const value = target?.textContent?.trim();
      if (!value) return;

      try {
        await navigator.clipboard.writeText(value);
      } catch {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("copy");
        selection.removeAllRanges();
      }

      const existingTimer = copyTimers.get(button);
      if (existingTimer) window.clearTimeout(existingTimer);
      button.dataset.copied = "true";
      copyTimers.set(button, window.setTimeout(() => {
        delete button.dataset.copied;
      }, 1400));
      announce("Copied to clipboard");
    });
  }
}

function bindTraceLab() {
  sourceSelect.addEventListener("change", updateTraceLab);
  formatSelect.addEventListener("change", updateTraceLab);
}

function updateTraceLab() {
  const source = sources[sourceSelect.value];
  const formatLabel = formats[formatSelect.value];
  document.querySelector("#lab-location").textContent = source.location;
  document.querySelector("#route-source").textContent = source.label;
  document.querySelector("#route-target").textContent = formatLabel;
  document.querySelector("#trace-output").innerHTML = renderTraceExample(source);
  replayRoute();
}

function renderTraceExample(source) {
  const reasoning = source.reasoning
    ? `\n    <span class="json-key">"reasoning"</span>: [<span class="json-string">"${escapeHtml(source.reasoning)}"</span>],`
    : "";
  const metadata = source.toolResultsAvailable === false
    ? `,\n  <span class="json-key">"metadata"</span>: { <span class="json-key">"tool_results_available"</span>: <span class="json-boolean">false</span> }`
    : "";

  return `<code>{
  <span class="json-key">"schema"</span>: <span class="json-string">"agent_trace_v1"</span>,
  <span class="json-key">"source"</span>: { <span class="json-key">"agent"</span>: <span class="json-string">"${escapeHtml(source.agent)}"</span> },
  <span class="json-key">"messages"</span>: [{
    <span class="json-key">"role"</span>: <span class="json-string">"assistant"</span>,${reasoning}
    <span class="json-key">"tool_calls"</span>: [{ <span class="json-key">"name"</span>: <span class="json-string">"${escapeHtml(source.tool)}"</span> }]
  }],
  <span class="json-key">"outcome"</span>: { <span class="json-key">"quality"</span>: <span class="json-string">"unlabeled"</span> }${metadata}
}</code>`;
}

function replayRoute() {
  if (reducedMotion.matches) return;
  for (const path of document.querySelectorAll(".route-line path")) {
    for (const animation of path.getAnimations()) animation.cancel();
    path.animate(
      [
        { strokeDasharray: "1 1", strokeDashoffset: "1" },
        { strokeDasharray: "1 1", strokeDashoffset: "0" },
      ],
      { duration: 340, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }
}

function bindPlatformSwitch() {
  for (const button of platformButtons) {
    button.addEventListener("click", () => {
      userSelectedPlatform = true;
      const platform = button.dataset.installPlatform;
      selectInstallPlatform(platform);
      if (detectedPlatform?.platform === platform) {
        updateDetectedDownload(detectedPlatform);
      } else {
        updateDetectedDownload({ platform, architecture: platform === "macos" ? "arm64" : "x64" });
      }
    });
  }
}

function selectInstallPlatform(platform) {
  const selected = installCommands[platform] ? platform : "macos";
  const index = ["macos", "linux", "windows"].indexOf(selected);
  platformSwitch.style.setProperty("--platform-index", index);
  installCommand.textContent = installCommands[selected];
  heroCommand.textContent = installCommands[selected];
  document.querySelector("#detected-platform").textContent = platformLabel(selected);

  for (const button of platformButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.installPlatform === selected));
  }
}

function updateDetectedDownload({ platform, architecture }) {
  const key = `${platform}-${architecture}`;
  const asset = assets[key];
  const strong = recommendedDownload.querySelector("strong");
  if (!asset) {
    recommendedDownload.href = `https://github.com/${repository}/releases/latest`;
    strong.textContent = "View all release files";
    return;
  }

  recommendedDownload.href = `${releaseBase}/${asset}`;
  const architectureLabel = architecture === "arm64" ? "ARM64" : "x64";
  strong.textContent = `${platformLabel(platform)} ${architectureLabel}`;
}

async function detectPlatform() {
  const userAgent = navigator.userAgent.toLowerCase();
  let platform = userAgent.includes("windows")
    ? "windows"
    : userAgent.includes("linux") && !userAgent.includes("android")
      ? "linux"
      : "macos";
  let architecture = platform === "macos" ? "arm64" : "x64";

  if (/arm64|aarch64/.test(userAgent)) architecture = "arm64";
  if (navigator.userAgentData?.getHighEntropyValues) {
    try {
      const values = await navigator.userAgentData.getHighEntropyValues(["architecture", "platform"]);
      if (/arm/i.test(values.architecture)) architecture = "arm64";
      if (/win/i.test(values.platform)) platform = "windows";
      if (/linux/i.test(values.platform)) platform = "linux";
      if (/mac/i.test(values.platform)) platform = "macos";
    } catch {
      // User-agent detection remains a best-effort download recommendation.
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

function initializeReveals() {
  const elements = [...document.querySelectorAll(".reveal-on-scroll")];
  if (reducedMotion.matches || !("IntersectionObserver" in window)) {
    for (const element of elements) element.dataset.visible = "true";
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.animate([
        { opacity: 0.72, transform: "translateY(12px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], {
        duration: 380,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both",
      });
      entry.target.dataset.visible = "true";
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -70px", threshold: 0.08 });

  for (const element of elements) observer.observe(element);
}

function announce(message) {
  window.clearTimeout(announcementTimer);
  announcement.textContent = message;
  announcement.dataset.visible = "true";
  announcementTimer = window.setTimeout(() => {
    delete announcement.dataset.visible;
  }, 1800);
}

function platformLabel(platform) {
  return { macos: "macOS", linux: "Linux", windows: "Windows" }[platform] ?? "Platform";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
