import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../src-tauri/", import.meta.url);
const template = (await readFile(new URL("installer/installer.nsi", root), "utf8")).replace(/\r\n/g, "\n");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Source contracts captured from the Tauri CLI 2.11.4 upstream template.
// A UI edit must not silently rewrite upgrade, uninstall, or updater semantics.
// Refresh deliberately when adopting a new upstream template, never from a
// failing local template. These guards do not replace Windows runtime tests.
const upstream = {
  "Function PageReinstall": "8f10a312ef6a081a96dc2513c9953c58d55204c6cd1bc29dbe5531729ff2ea7a",
  "Function PageLeaveReinstall": "7342a7d9ccc6cad00744d02dd73aaf83539369a1ef081e6bf124144dcebd8b01",
  "Function RunMainBinary": "cb4d165449ef14b360ee76437fe26e93ac13232939742eced17a4f9c0e5ad8a9",
  "Function RestorePreviousInstallLocation": "29fd643574ab3071c63dda5693c753529b5185b61a9f038349fba5065a91e9fc",
  "Function CreateOrUpdateStartMenuShortcut": "c407107a28f2e0872defb568b16aca0ec38a6d287ffa1379003b7c6b3bd5e948",
  "Function CreateOrUpdateDesktopShortcut": "36c442795c6deff34d523920b9a2766de29975bd4d898d75e4862e05b8d3d70c",
  "Function .onInstSuccess": "43fbf9e6eed7626e110ddffb80fc39e6ad603fc15c31c853dc1692ea9decbfe5",
  "Function un.onInit": "29ab5c9e88e03965426d9f229daa86d15b935a53abdc8ea157f78dedd522ffd6",
  "Section EarlyChecks": "9917999103e2061d5607f58e84f3ec372bc25837df9118246ece08df4c57db7a",
  "Section WebView2": "8e737d76397e7b358644cb20d4287bb50dcb1375873c2437130901f981d3b9f3",
  "Section Uninstall": "740872b8913ed7be8814054d6639acccab2fe8c34e9213622089dded935b249a"
};

// Presentation-only calls inserted into upstream blocks; stripped before hashing.
const presentation = {
  "Function PageReinstall": "    Call MonoReinstallShow\n"
};

for (const [block, digest] of Object.entries(upstream)) {
  test(`OmniCode UI retains upstream ${block}`, () => {
    const end = block.startsWith("Function") ? "FunctionEnd" : "SectionEnd";
    const match = template.match(new RegExp(`^${escape(block)}\\n[\\s\\S]*?^${end}$`, "m"));
    assert.ok(match, `${block} exists`);
    const edit = presentation[block];
    if (edit) assert.equal(match[0].split(edit).length, 2, `${block} has exactly one presentation hook`);
    const source = edit ? match[0].replace(edit, "") : match[0];
    assert.equal(hash(source), digest, "Review engine changes against upstream before updating this contract");
  });
}

test("OmniCode UI retains command-line parsing and default/previous install location", () => {
  const init = template.match(/^Function \.onInit\n[\s\S]*?^FunctionEnd$/m)[0]
    .replace("  StrCpy $MonoDesktopShortcut ${BST_CHECKED}\n", "");
  assert.equal(hash(init), "565efcb6a57d4d96549be82abc8b6ea1fb0d2a855a7a100a1a6b1756a4b08067");
});

test("OmniCode UI retains file deployment, associations, registry and start menu", () => {
  const install = template.match(/^Section Install\n[\s\S]*?!insertmacro MUI_STARTMENU_WRITE_END/m)[0];
  assert.equal(hash(install), "be41b33f8ce0606b71cbb2919999cb0ed540e14858c72f1121888c6bd7274374");
});

test("Windows config resolves self-contained installer resources", async () => {
  const config = JSON.parse(await readFile(new URL("tauri.windows.conf.json", root), "utf8"));
  const nsis = config.bundle.windows.nsis;
  assert.equal(nsis.installMode, "currentUser");
  for (const key of ["template", "installerHooks", "installerIcon", "uninstallerIcon"])
    assert.ok((await readFile(new URL(nsis[key], root))).length, `${key} exists`);
  // A fixed-size header bitmap is stretched and blurred by Windows scaling;
  // pages draw the application icon at its native pixel size instead.
  assert.equal(nsis.headerImage, undefined);
  const ui = await readFile(new URL(nsis.installerHooks, root), "utf8");
  const en = [...ui.matchAll(/LangString (\w+) \$\{LANG_ENGLISH\}/g)].map(m => m[1]).sort();
  const zh = [...ui.matchAll(/LangString (\w+) \$\{LANG_SIMPCHINESE\}/g)].map(m => m[1]).sort();
  assert.ok(en.length);
  assert.deepEqual(zh, en, "Every custom installer string has both supported translations");
  assert.deepEqual(nsis.languages, ["English", "SimpChinese"]);
});
