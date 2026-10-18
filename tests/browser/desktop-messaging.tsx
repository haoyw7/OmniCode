import { useState } from "react";
import { createRoot } from "react-dom/client";
import { NavigationItem } from "../../src/shared/ui/messaging/NavigationItem";
import { MessageInput } from "../../src/shared/ui/messaging/MessageInput";
import { AppSurface, AppHeader, AppName } from "../../src/shared/ui/messaging/AppSurface";
import { AppSkeleton } from "../../src/shared/ui/messaging/AppSkeleton";
import { AssistantStatus } from "../../src/shared/ui/messaging/AssistantStatus";
import { IconButton } from "../../src/shared/ui/forms/IconButton";
import { Plus, Folder, ArrowUp, X, CodeXml, Maximize2, Sparkles } from "../../src/shared/ui/icons";
import "../../src/styles/index.css";
const dark = new URLSearchParams(location.search).has("dark");
document.documentElement.dataset.skin = dark ? "midnight" : "daylight";
document.documentElement.dataset.desktopMode = "chat";
document.documentElement.classList.toggle("theme-light", !dark);
function Samples() {
  const [active, setActive] = useState(false);
  const [closed, setClosed] = useState(false);
  const [full, setFull] = useState(false);
  const send = <IconButton label="Send" className="ml-auto"><ArrowUp /></IconButton>;
  return <main style={{ padding: 24, minHeight: "100vh", background: "var(--color-app)", color: "var(--color-ink)" }}>
    <h1 className="mb-6 text-xl">Messaging & navigation</h1>
    <div className="flex flex-wrap items-start gap-6">
      <nav className="desktop-navigation w-60" aria-label="Sample navigation">
        <NavigationItem icon={<Plus />} onClick={() => setActive(false)}>New chat</NavigationItem>
        <NavigationItem icon={<Folder />} aria-current={active ? "page" : undefined} onClick={() => setActive(true)}>Projects</NavigationItem>
        <NavigationItem icon={<Folder />} disabled>Unavailable</NavigationItem>
        <NavigationItem icon={<Folder />} compact>Compact projects</NavigationItem>
      </nav>
      <section className="flex min-w-0 flex-1 flex-col gap-6" style={{ minWidth: "min(100%, 280px)" }}>
        <MessageInput layout="inline">
          <IconButton label="Attach"><Plus /></IconButton>
          <textarea rows={1} data-ui="message-input-field" aria-label="Single-line draft" placeholder="Ask anything…" />
          {send}
        </MessageInput>
        <MessageInput>
          <textarea rows={1} data-ui="message-input-field" aria-label="Multi-line draft" placeholder="How can I help you today?" />
          <div data-ui="message-input-actions"><IconButton label="Attach file"><Plus /></IconButton>{send}</div>
        </MessageInput>
        <AssistantStatus data-live-footer icon={<Sparkles />}><span className="transcript-live-status">Thinking deeply, stand by…</span></AssistantStatus>
        {!closed && <AppSurface style={{ width: full ? "100%" : "min(440px, 100%)" }}>
          <AppHeader size={full ? "fullscreen" : "inline"} metadata="Preview" actions={<>
            <IconButton label="Expand preview" onClick={() => setFull(value => !value)}><Maximize2 /></IconButton>
            <IconButton label="Close preview" onClick={() => setClosed(true)}><X /></IconButton>
          </>}><AppName icon={<CodeXml />}>Application</AppName></AppHeader>
          <AppSkeleton size={full ? "fullscreen" : "inline"} rows={4} label="Loading application…" />
        </AppSurface>}
        <AppHeader size="fullscreen" actions={<IconButton label="Close header"><X /></IconButton>}><AppName icon={<CodeXml />}>Fullscreen header</AppName></AppHeader>
        <AppSkeleton size="fullscreen" rows={1} label="Loading fullscreen…" />
        <div data-question-card data-isolation>Unrelated question card</div>
      </section>
    </div>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Samples />);
