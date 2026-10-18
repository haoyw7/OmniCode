const languageButtons = document.querySelectorAll("[data-language]");
const translatedNodes = [...document.querySelectorAll("[data-en]")].map(
  (element) => ({ element, original: element.innerHTML }),
);
const translatedAttributes = ["aria-label", "alt"].flatMap((attribute) => {
  const dataAttribute =
    attribute === "aria-label" ? "data-en-aria" : "data-en-alt";
  return [...document.querySelectorAll(`[${dataAttribute}]`)].map(
    (element) => ({
      element,
      attribute,
      dataAttribute,
      original: element.getAttribute(attribute),
    }),
  );
});
const status = document.querySelector("#copy-status");
let language = "zh-CN";

function setLanguage(nextLanguage) {
  language = nextLanguage === "en" ? "en" : "zh-CN";
  document.documentElement.lang = language;
  for (const { element, original } of translatedNodes) {
    if (language === "en") element.textContent = element.dataset.en;
    else element.innerHTML = original;
  }
  for (const {
    element,
    attribute,
    dataAttribute,
    original,
  } of translatedAttributes) {
    element.setAttribute(
      attribute,
      language === "en" ? element.getAttribute(dataAttribute) : original,
    );
  }
  languageButtons.forEach((button) =>
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.language === language),
    ),
  );
  document.title =
    language === "en"
      ? "OmniCode — Your agents. Your workspace."
      : "OmniCode — 你的智能体，你的工作区";
  document.querySelector('meta[name="description"]').content =
    language === "en"
      ? "OmniCode brings coding agents, projects, and everyday work together. An open-source desktop and mobile workspace for Claude Code, Codex, OpenCode, Pi, and omp."
      : "OmniCode，把编程智能体、项目和日常工作放在一起。开源的桌面与移动工作区，支持 Claude Code、Codex、OpenCode、Pi 与 omp。";
  status.textContent = "";
  try {
    localStorage.setItem("omnicode.website.language", language);
  } catch {
    /* Language switching also works without storage. */
  }
}

languageButtons.forEach((button) =>
  button.addEventListener("click", () => setLanguage(button.dataset.language)),
);
try {
  const savedLanguage = localStorage.getItem("omnicode.website.language");
  if (savedLanguage === "en") setLanguage("en");
} catch {
  /* Chinese remains the default when storage is unavailable. */
}

document.querySelector("#copy-command").addEventListener("click", async () => {
  const command = document.querySelector("#install-command");
  try {
    await navigator.clipboard.writeText(command.textContent.trim());
    status.textContent =
      language === "en" ? "Commands copied." : "已复制安装命令。";
  } catch {
    const range = document.createRange();
    range.selectNodeContents(command);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    status.textContent =
      language === "en"
        ? "Select and copy the commands with Ctrl+C / ⌘C."
        : "请使用 Ctrl+C / ⌘C 复制已选中的命令。";
  }
});
