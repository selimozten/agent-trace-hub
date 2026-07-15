document.documentElement.classList.add("js");

const repository = "selimozten/agent-trace-hub";
const releaseBase = `https://github.com/${repository}/releases/latest/download`;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const coarsePointer = window.matchMedia("(pointer: coarse)");
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
const platformSwitch = document.querySelector(".platform-switch");
const platformButtons = [...document.querySelectorAll("[data-install-platform]")];
const sourceTabs = [...document.querySelectorAll("[data-source-agent]")];
const recommendedDownload = document.querySelector("#recommended-download");
const announcement = document.querySelector(".copy-announcement");
const copyTimers = new WeakMap();
let announcementTimer;
let detectedPlatform;
let userSelectedPlatform = false;

initialize();

async function initialize() {
  bindCopyControls();
  bindSourceTabs();
  bindTraceLab();
  bindPlatformSwitch();
  selectHeroSource("codex");
  updateTraceLab();
  initializeAsciiOrb();

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

function bindSourceTabs() {
  sourceTabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectHeroSource(tab.dataset.sourceAgent));
    tab.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % sourceTabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + sourceTabs.length) % sourceTabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = sourceTabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      selectHeroSource(sourceTabs[nextIndex].dataset.sourceAgent, true);
    });
  });
}

function selectHeroSource(key, moveFocus = false) {
  const source = sources[key] ?? sources.codex;
  const activeTab = sourceTabs.find((tab) => tab.dataset.sourceAgent === key) ?? sourceTabs[1];
  for (const tab of sourceTabs) {
    const selected = tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }

  document.querySelector("#hero-source-name").textContent = source.label;
  document.querySelector("#hero-source-path").textContent = source.location;
  document.querySelector("#source-readout").setAttribute("aria-labelledby", activeTab.id);
  activeTab.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "nearest", inline: "nearest" });
  if (moveFocus) activeTab.focus();
}

function bindTraceLab() {
  sourceSelect.addEventListener("change", updateTraceLab);
  formatSelect.addEventListener("change", updateTraceLab);
}

function updateTraceLab() {
  const source = sources[sourceSelect.value];
  const formatLabel = formats[formatSelect.value];
  document.querySelector("#artifact-location").textContent = source.location;
  document.querySelector("#route-source").textContent = source.label;
  document.querySelector("#route-target").textContent = formatLabel;
  document.querySelector("#trace-output").innerHTML = renderTraceExample(source);
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

async function initializeAsciiOrb() {
  if (reducedMotion.matches || coarsePointer.matches) return;

  const hero = document.querySelector(".hero");
  const stage = document.querySelector(".ascii-stage");
  const canvas = document.querySelector("#ascii-orb");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  let text;
  try {
    const response = await fetch("assets/agent-trace-orb.txt");
    if (!response.ok) return;
    text = (await response.text()).trimEnd();
  } catch {
    return;
  }

  const lines = text.split("\n");
  const maxColumns = Math.max(...lines.map((line) => line.length));
  const particles = [];
  const pointer = { x: 0, y: 0, lastX: 0, lastY: 0, active: false };
  let width = 0;
  let height = 0;
  let dpr = 1;
  let fontSize = 12;
  let animationFrame = 0;

  function layout() {
    const bounds = hero.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const mobile = width <= 760;
    const shortMobile = mobile && height <= 650;
    const shortLandscape = width >= 560 && height <= 520;
    const artWidth = shortLandscape
      ? Math.min(300, width * 0.36)
      : mobile
        ? Math.min(width - 44, shortMobile ? 185 : 280)
        : Math.min(width * 0.54, 730);
    fontSize = artWidth / (maxColumns * 0.602);
    const lineHeight = fontSize * 1.08;
    const artHeight = lines.length * lineHeight;
    const originX = shortLandscape
      ? width - artWidth - 24
      : mobile
        ? (width - artWidth) / 2
        : width - artWidth - Math.max(24, (width - 1280) / 2);
    const originY = shortLandscape
      ? 78
      : mobile
        ? (shortMobile ? 62 : 54)
        : Math.max(62, Math.min(104, (height - artHeight) * 0.16));

    context.font = `${fontSize}px "SFMono-Regular", Consolas, "Liberation Mono", monospace`;
    context.textBaseline = "top";
    const characterWidth = context.measureText("M").width;
    particles.length = 0;

    lines.forEach((line, row) => {
      [...line].forEach((character, column) => {
        if (character === " ") return;
        const homeX = originX + column * characterWidth;
        const homeY = originY + row * lineHeight;
        particles.push({ character, homeX, homeY, x: homeX, y: homeY, vx: 0, vy: 0, energy: 0 });
      });
    });

    draw();
    stage.dataset.ready = "true";
  }

  function disturb(event) {
    const bounds = hero.getBoundingClientRect();
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
    const moveX = pointer.active ? pointer.x - pointer.lastX : 0;
    const moveY = pointer.active ? pointer.y - pointer.lastY : 0;
    const speed = Math.min(34, Math.hypot(moveX, moveY));
    const radius = Math.max(78, Math.min(142, Math.min(width, height) * 0.15));

    for (const particle of particles) {
      const offsetX = particle.x - pointer.x;
      const offsetY = particle.y - pointer.y;
      const distance = Math.hypot(offsetX, offsetY);
      if (distance >= radius) continue;

      const falloff = (1 - distance / radius) ** 2;
      const normalX = distance > 0.001 ? offsetX / distance : 0;
      const normalY = distance > 0.001 ? offsetY / distance : -1;
      const push = (3.2 + speed * 0.38) * falloff;
      const flow = 0.32 * falloff;
      const swirl = Math.min(5, speed * 0.12) * falloff;
      particle.vx += normalX * push + moveX * flow - normalY * swirl;
      particle.vy += normalY * push + moveY * flow + normalX * swirl;
      particle.energy = Math.min(1, particle.energy + falloff * 0.95);
    }

    pointer.lastX = pointer.x;
    pointer.lastY = pointer.y;
    pointer.active = true;
    wake();
  }

  function settlePointer() {
    pointer.active = false;
  }

  function wake() {
    if (!animationFrame) animationFrame = window.requestAnimationFrame(tick);
  }

  function tick() {
    let moving = false;
    for (const particle of particles) {
      particle.vx += (particle.homeX - particle.x) * 0.052;
      particle.vy += (particle.homeY - particle.y) * 0.052;
      particle.vx *= 0.835;
      particle.vy *= 0.835;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.energy *= 0.9;

      const displacement = Math.hypot(particle.x - particle.homeX, particle.y - particle.homeY);
      const velocity = Math.hypot(particle.vx, particle.vy);
      if (displacement > 0.04 || velocity > 0.04 || particle.energy > 0.01) {
        moving = true;
      } else {
        particle.x = particle.homeX;
        particle.y = particle.homeY;
        particle.vx = 0;
        particle.vy = 0;
        particle.energy = 0;
      }
    }

    draw();
    animationFrame = moving ? window.requestAnimationFrame(tick) : 0;
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    context.font = `${fontSize}px "SFMono-Regular", Consolas, "Liberation Mono", monospace`;
    context.textBaseline = "top";
    for (const particle of particles) {
      const energy = Math.min(1, particle.energy);
      const red = Math.round(243 + 12 * energy);
      const green = Math.round(247 - 146 * energy);
      const blue = Math.round(239 - 173 * energy);
      context.fillStyle = `rgb(${red} ${green} ${blue})`;
      context.fillText(particle.character, particle.x, particle.y);
    }
  }

  hero.addEventListener("pointermove", disturb, { passive: true });
  hero.addEventListener("pointerleave", settlePointer, { passive: true });
  hero.addEventListener("pointercancel", settlePointer, { passive: true });
  const observer = new ResizeObserver(([entry]) => {
    if (
      Math.round(entry.contentRect.width) === width
      && Math.round(entry.contentRect.height) === height
    ) return;
    window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    layout();
  });
  observer.observe(hero);
  layout();
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
