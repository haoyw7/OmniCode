const root = document.documentElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const languageButtons = document.querySelectorAll("[data-language]");
const translatedNodes = [...document.querySelectorAll("[data-en]")].map(
  (element) => ({ element, original: element.innerHTML }),
);
const translatedLabels = [...document.querySelectorAll("[data-en-aria]")].map(
  (element) => ({ element, original: element.getAttribute("aria-label") }),
);
const pageText = {
  "zh-CN": {
    title: "OmniCode — 你的智能体，同一个工作区",
    description:
      "OmniCode 把 Claude Code、Codex、Cursor 等十个智能体放进同一个工作区，并用 Bots 打造会记忆、会定期做事、能彼此协作的长期助手。开源的桌面与移动客户端。",
    copied: "已复制",
    copy: "复制",
    selectHint: "请按 Ctrl+C / ⌘C 复制",
  },
  en: {
    title: "OmniCode — Your agents, one workspace",
    description:
      "OmniCode brings Claude Code, Codex, Cursor and seven more agents into one workspace, with Bots that remember, keep habits, and work together. Open-source desktop and mobile apps.",
    copied: "Copied",
    copy: "Copy",
    selectHint: "Press Ctrl+C / ⌘C to copy",
  },
};
let language = "zh-CN";
const text = () => pageText[language];

/* Language */
function setLanguage(nextLanguage) {
  language = nextLanguage === "en" ? "en" : "zh-CN";
  root.lang = language;
  for (const { element, original } of translatedNodes) {
    if (language === "en") element.textContent = element.dataset.en;
    else element.innerHTML = original;
  }
  for (const { element, original } of translatedLabels) {
    element.setAttribute(
      "aria-label",
      language === "en" ? element.dataset.enAria : original,
    );
  }
  languageButtons.forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.language === language),
    ),
  );
  document.title = text().title;
  document.querySelector('meta[name="description"]').content =
    text().description;
  appWindow.title = language === "en" ? "OmniCode desktop app" : "OmniCode 桌面端界面";
  sendToApp();
  try {
    localStorage.setItem("omnicode.website.language", language);
  } catch {
    /* Language switching also works without storage. */
  }
}

/* Entrance, scroll reveals and the floating header */
requestAnimationFrame(() => root.classList.add("is-ready"));

const revealObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            revealObserver.unobserve(entry.target);
          }
        },
        { rootMargin: "0px 0px -8% 0px" },
      )
    : null;
document.querySelectorAll(".reveal").forEach((element) => {
  if (revealObserver) revealObserver.observe(element);
  else element.classList.add("is-visible");
});

const header = document.querySelector("[data-header]");
const updateHeader = () =>
  header.toggleAttribute("data-floating", scrollY > 24);
addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

/* App window: the snapshot page runs its own loop; scale it to the frame and
   tell it the language and whether it is on screen. */
const appFrame = document.querySelector("[data-app-frame]");
const appWindow = appFrame.querySelector("iframe");
let appVisible = false;
const sendToApp = () =>
  appWindow.contentWindow?.postMessage(
    { type: "omnicode-preview", lang: language, visible: appVisible },
    "*",
  );
new ResizeObserver(([entry]) =>
  appFrame.style.setProperty("--app-scale", String(entry.contentRect.width / 1282)),
).observe(appFrame);
if ("IntersectionObserver" in window) {
  new IntersectionObserver(([entry]) => {
    appVisible = entry.isIntersecting;
    sendToApp();
  }).observe(appFrame);
} else {
  appVisible = true;
}
appWindow.addEventListener("load", sendToApp);

/* Closing: a slowly turning sphere of points. */
(() => {
  const canvas = document.querySelector(".particles");
  const context = canvas.getContext("2d");
  if (!context) return;
  const count = 260;
  const points = Array.from({ length: count }, (_, index) => {
    const y = 1 - (index / (count - 1)) * 2;
    const radius = Math.sqrt(1 - y * y);
    const angle = index * Math.PI * (3 - Math.sqrt(5));
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
  });
  let width = 0;
  let height = 0;
  let rotation = 0;
  let frame = 0;
  let last = 0;
  let color = "#fff";

  function resize() {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    color = getComputedStyle(root).getPropertyValue("--ink").trim() || "#fff";
  }

  function draw() {
    context.clearRect(0, 0, width, height);
    context.fillStyle = color;
    const size = Math.min(width * 0.36, height * 0.55, 360);
    const centerX = width / 2;
    const centerY = height * 0.52;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    for (const [x, y, z] of points) {
      const rotatedX = x * cos - z * sin;
      const rotatedZ = x * sin + z * cos;
      const tiltY = y * 0.94 - rotatedZ * 0.34;
      const depth = (rotatedZ + 1) / 2;
      const scale = 1 / (1.8 - rotatedZ * 0.5);
      context.globalAlpha = 0.08 + depth * 0.42;
      context.beginPath();
      context.arc(
        centerX + rotatedX * size * scale * 1.4,
        centerY + tiltY * size * scale * 1.4,
        0.6 + depth * 1.1,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    context.globalAlpha = 1;
  }

  function tick(time) {
    if (last) rotation += Math.min(time - last, 50) * 0.00012;
    last = time;
    draw();
    frame = requestAnimationFrame(tick);
  }

  function start() {
    if (frame || reducedMotion.matches) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  }
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
  }

  resize();
  draw();
  addEventListener("resize", () => {
    resize();
    draw();
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener?.(
    "change",
    () => {
      resize();
      draw();
    },
  );
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([entry]) =>
      entry.isIntersecting ? start() : stop(),
    ).observe(canvas);
  } else {
    start();
  }
})();

/* Copy */
const copyStatus = document.querySelector("#copy-status");
const copyLabel = document.querySelector("#copy-label");
let copyTimer = 0;
document.querySelector("#copy-command").addEventListener("click", async () => {
  const command = document.querySelector("#install-command");
  clearTimeout(copyTimer);
  try {
    await navigator.clipboard.writeText(command.textContent.trim());
    copyLabel.textContent = text().copied;
    copyStatus.textContent = text().copied;
  } catch {
    const range = document.createRange();
    range.selectNodeContents(command);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    copyStatus.textContent = text().selectHint;
  }
  copyTimer = setTimeout(() => {
    copyLabel.textContent = text().copy;
  }, 1600);
});

languageButtons.forEach((button) =>
  button.addEventListener("click", () => setLanguage(button.dataset.language)),
);
let savedLanguage = null;
try {
  savedLanguage = localStorage.getItem("omnicode.website.language");
} catch {
  /* Chinese remains the default when storage is unavailable. */
}
if (savedLanguage === "en") setLanguage("en");
