// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { syncLiveFooterClip } from "./liveFooterClip";

afterEach(() => document.body.replaceChildren());

function fixture() {
  const scroller = document.createElement("div");
  scroller.dataset.followLatest = "true";
  scroller.innerHTML = `<div><div id="history"></div><div id="reply"></div><div id="tool"></div><div class="transcript-live-footer-collapse" style="position:sticky"><span data-live-footer>Replying</span></div></div>`;
  document.body.append(scroller);
  const [history, reply, tool, footer] = [...scroller.firstElementChild!.children] as HTMLElement[];
  history.getBoundingClientRect = () => ({ bottom: 300 }) as DOMRect;
  reply.getBoundingClientRect = () => ({ bottom: 550 }) as DOMRect;
  tool.getBoundingClientRect = () => ({ bottom: 700 }) as DOMRect;
  footer.getBoundingClientRect = () => ({ top: 420 }) as DOMRect;
  return { scroller, history, reply, tool, footer };
}

it("keeps all rows ahead of the scroll curve above the plain status text", () => {
  const { scroller, history, reply, tool } = fixture();
  syncLiveFooterClip(scroller);
  expect(history.hasAttribute("data-live-footer-clipped")).toBe(false);
  expect(reply.style.getPropertyValue("--live-footer-clip-bottom")).toBe("130px");
  expect(tool.style.getPropertyValue("--live-footer-clip-bottom")).toBe("280px");
  // As scrolling catches up, earlier prose is revealed without changing layout.
  reply.getBoundingClientRect = () => ({ bottom: 400 }) as DOMRect;
  tool.getBoundingClientRect = () => ({ bottom: 550 }) as DOMRect;
  syncLiveFooterClip(scroller);
  expect(reply.hasAttribute("data-live-footer-clipped")).toBe(false);
  expect(reply.style.getPropertyValue("--live-footer-clip-bottom")).toBe("");
  expect(tool.style.getPropertyValue("--live-footer-clip-bottom")).toBe("130px");
});

it.each(["manual scroll", "ordinary footer", "completed reply"])("releases the content boundary on %s", reason => {
  const { scroller, footer } = fixture();
  syncLiveFooterClip(scroller);
  expect(scroller.querySelectorAll("[data-live-footer-clipped]")).toHaveLength(2);
  if (reason === "manual scroll") scroller.dataset.followLatest = "false";
  if (reason === "ordinary footer") footer.style.position = "static";
  if (reason === "completed reply") footer.replaceChildren();
  syncLiveFooterClip(scroller);
  expect(scroller.querySelectorAll("[data-live-footer-clipped]")).toHaveLength(0);
});
