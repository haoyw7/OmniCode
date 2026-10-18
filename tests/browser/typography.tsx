import { createRoot } from "react-dom/client";
import { Button } from "../../src/shared/ui/forms/Button";
import { Input } from "../../src/shared/ui/forms/Input";
import { applyTypographyProfile, defaultAppearanceProfile } from "../../src/features/settings/model/typography";

const query = new URLSearchParams(location.search);
const mobile = query.has("mobile");
const dark = query.has("dark");
if (mobile) {
  await import("../../src/mobile/theme/index.css");
  await import("../../src/mobile/styles/index.css");
  const { applyMobileSkin } = await import("../../src/mobile/theme/skin");
  applyMobileSkin(dark ? "midnight" : "daylight");
} else {
  await import("../../src/styles/index.css");
  document.documentElement.dataset.skin = dark ? "midnight" : "daylight";
  document.documentElement.classList.toggle("theme-light", !dark);
}
applyTypographyProfile(defaultAppearanceProfile());
const styles = ["type-heading-large", "type-heading", "type-body", "type-body-emphasized", "type-body-small", "type-body-small-emphasized", "type-caption", "type-caption-emphasized"];
function Samples() {
  return <main data-typography-gallery style={{ height: "100dvh", overflow: "auto", padding: 24, background: "var(--color-background-base)", color: "var(--color-content)" }}>
    <h1 className="type-heading-large">Typography · 字体排版</h1>
    <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "1fr 1fr", gap: 24, marginTop: 24 }}>
      <section style={{ display: "grid", gap: 16 }}>
        {styles.map(style => <div key={style}>
          <div className="type-caption" style={{ opacity: .6 }}>{style}</div>
          <p className={style} data-style={style}>The quick brown fox · 中文与 English 混排</p>
        </div>)}
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <h2 className="type-heading">JetBrains Mono</h2>
        {[400, 500, 600, 700].map(weight => <div key={weight}>
          <code className="font-mono text-body-sm" data-mono={weight} style={{ fontWeight: weight }}>const value = 123; // 中文</code><br />
          <code className="font-mono text-body-sm" data-italic={weight} style={{ fontWeight: weight, fontStyle: "italic" }}>italic !== normal</code>
        </div>)}
        <p className="font-serif text-body-md">Serif reading · 保留会话正文的阅读字体。</p>
        <Input aria-label="Font sample" placeholder="输入文字 / Enter text" />
        <div style={{ display: "flex", gap: 8 }}><Button>确认 Continue</Button><Button variant="secondary">取消</Button></div>
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Samples />);
