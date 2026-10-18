import { setUiLanguage } from "../../src/shared/i18n/language";
import { Switch } from "../../src/shared/ui/forms/Switch";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { MobileSelect } from "../../src/mobile/MobileSelect";
import { MobileComposer } from "../../src/mobile/MobileComposer";
import { Button } from "../../src/shared/ui/forms/Button";
import { applyMobileSkin } from "../../src/mobile/theme/skin";
import { installKeyboardMotion } from "../../src/mobile/keyboardMotion";
import "../../src/mobile/theme/index.css";
import "../../src/mobile/styles/index.css";
import "../../src/mobile/motion.css";

setUiLanguage("zh-CN");
applyMobileSkin(new URLSearchParams(location.search).has("dark") ? "midnight" : "daylight", "system");
installKeyboardMotion();
const noop = () => {};
const query = new URLSearchParams(location.search);
const running = query.has("running") || query.has("stopping");
function Fixture() {
  const [checked, setChecked] = useState(false);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("one");
  const [text, setText] = useState("");
  return <>
    <div className="mobile-app" style={{ overflow: "auto", padding: 20, gap: 20 }}>
      <h1 style={{ fontSize: 22 }}>移动端控件</h1>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Button variant="primary" className="">继续</Button>
        <Button variant="secondary" className="">取消</Button>
        <Button variant="danger" className="mobile-menu-danger">删除</Button>
        <Button variant="primary" className="" disabled>不可用</Button>
        <Button variant="secondary" className="" size="sm">小按钮</Button>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <input data-ui="input" aria-label="名称" placeholder="输入名称" />
        <input data-ui="input" aria-label="不可用输入" placeholder="不可用输入" disabled />
        <MobileSelect id="select" label="选择模型" value={choice}
          options={[{value:"one",label:"选项一"},{value:"two",label:"选项二"}]}
          open={open} onOpenChange={setOpen} onChange={setChoice} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Switch    aria-label="通知" checked={checked} onCheckedChange={checked =>setChecked(checked)}/>
        <Switch    aria-label="已开启" checked disabled/>
        <input data-ui="radio" type="radio" aria-label="单选" defaultChecked />
        <input data-ui="checkbox" type="checkbox" aria-label="多选" defaultChecked />
      </div>
      <MobileComposer value={text} onChange={setText}
        configuration={{harness:"codex", model:"gpt-5", modelSettings:{}, runtimeMode:"supervised"}}
        onConfigurationChange={noop} lockedAgent={false} disabled={false} running={running}
        canSend={!!text} canStop={running} working={query.has("stopping")} onSend={noop} onStop={noop}
        panel={null} onPanelChange={noop} projects={[]} onProjectChange={noop}
        attachments={[]} onFiles={noop} onRemoveAttachment={noop} planMode={false} onPlanModeChange={noop}/>
    </div>
    {createPortal(<div data-popover-side="bottom" data-testid="portal" style={{position:"fixed",top:450,left:20,right:20,padding:12,background:"var(--color-m-panel)",borderRadius:20,display:"flex",gap:8}}>
      <input data-ui="input" aria-label="弹窗输入" placeholder="弹窗输入" style={{minWidth:0,width:"100%"}}/>
      <Button variant="primary">保存</Button>
    </div>,document.body)}
  </>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
