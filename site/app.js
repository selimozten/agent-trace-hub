document.documentElement.classList.add("js");

const repository = "selimozten/agent-trace-hub";
const releaseBase = `https://github.com/${repository}/releases/latest/download`;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const monoStack = '"SFMono-Regular", "SF Mono", Menlo, Consolas, monospace';
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
  "claude-code": { location: "~/.claude/projects", kind: "JSONL sessions" },
  codex: { location: "~/.codex/sessions", kind: "JSONL sessions" },
  pi: { location: "~/.pi/agent/sessions", kind: "branching JSONL" },
  opencode: { location: "~/.local/share/opencode/opencode.db", kind: "SQLite parts" },
  omp: { location: "~/.omp/agent/sessions", kind: "branching JSONL" },
  "cursor-agent": { location: "~/.cursor/projects", kind: "agent transcripts" },
};

const sourceTabs = [...document.querySelectorAll("[data-source-agent]")];
const announcement = document.querySelector(".copy-announcement");
const copyTimers = new WeakMap();
let announcementTimer;

initialize();

async function initialize() {
  bindCopyControls();
  bindSourceTabs();
  initializeAsciiScene();
  initializeWordmark();

  const detected = await detectPlatform();
  document.querySelector("#install-command").textContent =
    installCommands[detected.platform] ?? installCommands.macos;
  updateDetectedDownload(detected);
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
    tab.addEventListener("click", () => selectSource(tab.dataset.sourceAgent));
    tab.addEventListener("keydown", (event) => {
      let nextIndex;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % sourceTabs.length;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + sourceTabs.length) % sourceTabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = sourceTabs.length - 1;
      if (nextIndex === undefined) return;
      event.preventDefault();
      selectSource(sourceTabs[nextIndex].dataset.sourceAgent, true);
    });
  });
}

function selectSource(key, moveFocus = false) {
  const source = sources[key] ?? sources.codex;
  const activeTab = sourceTabs.find((tab) => tab.dataset.sourceAgent === key) ?? sourceTabs[1];
  for (const tab of sourceTabs) {
    const selected = tab === activeTab;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }

  const readout = document.querySelector("#source-readout");
  const path = document.querySelector("#source-path");
  const changed = path.textContent !== source.location;
  path.textContent = source.location;
  document.querySelector("#source-kind").textContent = source.kind;
  readout.setAttribute("aria-labelledby", activeTab.id);
  if (changed && !reducedMotion.matches && readout.animate) {
    // A touch of blur masks the text swap so it reads as one element changing.
    readout.animate(
      [
        { opacity: 0.3, filter: "blur(3px)" },
        { opacity: 1, filter: "blur(0px)" },
      ],
      { duration: 200, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }
  if (moveFocus) activeTab.focus();
}

function updateDetectedDownload({ platform, architecture }) {
  const link = document.querySelector("#recommended-download");
  const label = document.querySelector("#recommended-label");
  const asset = assets[`${platform}-${architecture}`];
  if (!asset) {
    link.href = `https://github.com/${repository}/releases/latest`;
    label.textContent = "View release files";
    return;
  }

  link.href = `${releaseBase}/${asset}`;
  const platformName = { macos: "macOS", linux: "Linux", windows: "Windows" }[platform];
  label.textContent = `Download · ${platformName} ${architecture === "arm64" ? "ARM64" : "x64"}`;
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

/* ---- ASCII 3D scene ---------------------------------------------------
 * A spinning torus rendered as text — classic donut math, no dependencies.
 * The tumble follows the pointer; luminance picks both glyph and opacity.
 */
function initializeAsciiScene() {
  const canvas = document.querySelector("#ascii-scene");
  const panel = canvas.parentElement;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return;

  const RAMP = ".,-~:;=!*#%@";
  const R1 = 1;
  const R2 = 2;
  const K2 = 5;
  const fontSize = 13;
  let cellWidth = 8;
  let cellHeight = fontSize * 1.06;
  let columns = 0;
  let rows = 0;
  let width = 0;
  let height = 0;
  let angleA = 1.1;
  let angleB = 0.55;
  let tiltX = 0;
  let tiltY = 0;
  let targetTiltX = 0;
  let targetTiltY = 0;
  let animationFrame = 0;

  let cellLuminance = new Float32Array(0);
  let cellDepth = new Float32Array(0);

  function layout() {
    const bounds = panel.getBoundingClientRect();
    width = Math.max(1, Math.round(bounds.width));
    height = Math.max(1, Math.round(bounds.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.font = `${fontSize}px ${monoStack}`;
    context.textBaseline = "top";
    cellWidth = context.measureText("M").width;
    columns = Math.ceil(width / cellWidth);
    rows = Math.ceil(height / cellHeight);
    cellLuminance = new Float32Array(columns * rows);
    cellDepth = new Float32Array(columns * rows);
    render();
  }

  function render() {
    const A = angleA + tiltY;
    const B = angleB + tiltX;
    const cosA = Math.cos(A);
    const sinA = Math.sin(A);
    const cosB = Math.cos(B);
    const sinB = Math.sin(B);
    // Scale so the torus fills ~72% of the panel's smaller side.
    const K1 = (Math.min(width, height) * 0.72) / (2 * (R1 + R2) / K2);
    const centerX = width / 2;
    const centerY = height / 2 + height * 0.02;

    cellLuminance.fill(0);
    cellDepth.fill(0);

    for (let theta = 0; theta < Math.PI * 2; theta += 0.07) {
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      const circleX = R2 + R1 * cosTheta;
      const circleY = R1 * sinTheta;

      for (let phi = 0; phi < Math.PI * 2; phi += 0.02) {
        const cosPhi = Math.cos(phi);
        const sinPhi = Math.sin(phi);

        const x = circleX * (cosB * cosPhi + sinA * sinB * sinPhi) - circleY * cosA * sinB;
        const y = circleX * (sinB * cosPhi - sinA * cosB * sinPhi) + circleY * cosA * cosB;
        const z = K2 + cosA * circleX * sinPhi + circleY * sinA;
        const ooz = 1 / z;

        const column = Math.floor((centerX + K1 * ooz * x) / cellWidth);
        const row = Math.floor((centerY - K1 * ooz * y) / cellHeight);
        if (column < 0 || column >= columns || row < 0 || row >= rows) continue;

        const luminance =
          cosPhi * cosTheta * sinB
          - cosA * cosTheta * sinPhi
          - sinA * sinTheta
          + cosB * (cosA * sinTheta - cosTheta * sinA * sinPhi);
        const index = row * columns + column;
        if (ooz > cellDepth[index]) {
          cellDepth[index] = ooz;
          cellLuminance[index] = luminance;
        }
      }
    }

    context.clearRect(0, 0, width, height);
    context.font = `${fontSize}px ${monoStack}`;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        if (cellDepth[index] === 0) continue;
        const luminance = Math.max(0, cellLuminance[index]) / Math.SQRT2;
        const glyph = RAMP[Math.min(RAMP.length - 1, Math.floor(luminance * RAMP.length))];
        const alpha = 0.045 + luminance * 0.3;
        // Highlights drift warm so the accent color lives in the light.
        const warmth = luminance * luminance;
        const red = Math.round(240 + 15 * warmth);
        const green = Math.round(244 - 12 * warmth);
        const blue = Math.round(234 - 46 * warmth);
        context.fillStyle = `rgb(${red} ${green} ${blue} / ${alpha.toFixed(3)})`;
        context.fillText(glyph, column * cellWidth, row * cellHeight);
      }
    }
  }

  function tick() {
    angleA += 0.0058;
    angleB += 0.0031;
    tiltX += (targetTiltX - tiltX) * 0.045;
    tiltY += (targetTiltY - tiltY) * 0.045;
    render();
    animationFrame = window.requestAnimationFrame(tick);
  }

  const observer = new ResizeObserver(() => layout());
  observer.observe(panel);
  layout();

  if (reducedMotion.matches) return;

  panel.addEventListener("pointermove", (event) => {
    const bounds = panel.getBoundingClientRect();
    targetTiltX = ((event.clientX - bounds.left) / bounds.width - 0.5) * 1.1;
    targetTiltY = ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.8;
  }, { passive: true });
  panel.addEventListener("pointerleave", () => {
    targetTiltX = 0;
    targetTiltY = 0;
  }, { passive: true });

  // Spin only while the hero can actually be seen.
  let heroVisible = true;

  function syncLoop() {
    const shouldRun = heroVisible && !document.hidden;
    if (shouldRun && !animationFrame) {
      animationFrame = window.requestAnimationFrame(tick);
    } else if (!shouldRun && animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  }

  document.addEventListener("visibilitychange", syncLoop);
  new IntersectionObserver(([entry]) => {
    heroVisible = entry.isIntersecting;
    syncLoop();
  }).observe(panel);

  syncLoop();
}

/* ---- ASCII footer wordmark --------------------------------------------
 * Draws the wordmark into an offscreen canvas, then maps pixel coverage onto a
 * glyph ramp so the wordmark scales with the footer at any width.
 */
function initializeWordmark() {
  const pre = document.querySelector("#ascii-wordmark");
  if (!pre) return;
  const glyphSets = [
    { threshold: 0.82, glyphs: "@@@@#" },
    { threshold: 0.58, glyphs: "@%#o" },
    { threshold: 0.38, glyphs: "*=x&" },
    { threshold: 0.2, glyphs: "+:-o" },
  ];

  function render() {
    const style = window.getComputedStyle(pre);
    const preFontSize = Number.parseFloat(style.fontSize);
    const lineHeight = Number.parseFloat(style.lineHeight) || preFontSize * 1.04;
    const available = pre.parentElement.clientWidth;
    if (!available) return;

    const probe = document.createElement("canvas").getContext("2d");
    probe.font = `${preFontSize}px ${monoStack}`;
    const charWidth = probe.measureText("M").width;
    const columns = Math.floor(available / charWidth);
    // Text pixels map 1:1 onto character cells, so pre-stretch the text
    // horizontally to cancel the cell's tall aspect ratio.
    const stretch = lineHeight / charWidth;

    // The full name spans the width at a footer-friendly height; three
    // giant letters only fit on narrow screens.
    const text = columns < 160 ? "ath" : "agent trace hub";
    probe.font = `800 100px "Bricolage Grotesque", sans-serif`;
    const measured = probe.measureText(text);
    const scale = (columns * 0.97) / (measured.width * stretch);
    const fontPx = 100 * scale;
    const rowCount = Math.ceil(fontPx * 1.1);

    const canvas = document.createElement("canvas");
    canvas.width = columns;
    canvas.height = rowCount;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.setTransform(stretch * scale, 0, 0, scale, (columns - measured.width * stretch * scale) / 2, 0);
    context.font = `800 100px "Bricolage Grotesque", sans-serif`;
    context.textBaseline = "top";
    context.fillStyle = "#ffffff";
    context.fillText(text, 0, 8);

    const pixels = context.getImageData(0, 0, columns, rowCount).data;
    const lines = [];
    for (let row = 0; row < rowCount; row += 1) {
      let line = "";
      for (let column = 0; column < columns; column += 1) {
        const coverage = pixels[(row * columns + column) * 4 + 3] / 255;
        let glyph = " ";
        for (const set of glyphSets) {
          if (coverage >= set.threshold) {
            glyph = set.glyphs[Math.floor(Math.random() * set.glyphs.length)];
            break;
          }
        }
        line += glyph;
      }
      lines.push(line);
    }

    while (lines.length && lines[0].trim() === "") lines.shift();
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    pre.textContent = lines.join("\n");
  }

  const start = () => {
    render();
    let lastWidth = pre.parentElement.clientWidth;
    new ResizeObserver(() => {
      const nextWidth = pre.parentElement.clientWidth;
      if (nextWidth === lastWidth) return;
      lastWidth = nextWidth;
      render();
    }).observe(pre.parentElement);
  };

  if (document.fonts?.load) {
    document.fonts.load('800 100px "Bricolage Grotesque"').then(start, start);
  } else {
    start();
  }
}

function announce(message) {
  window.clearTimeout(announcementTimer);
  announcement.textContent = message;
  announcement.dataset.visible = "true";
  announcementTimer = window.setTimeout(() => {
    delete announcement.dataset.visible;
  }, 1800);
}
