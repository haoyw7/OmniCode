// @vitest-environment happy-dom
import { afterEach, expect, it } from "vitest";
import { captureDragPreview } from "./DragPreview";
import { observeDragPreviewStyles } from "./dragPreviewStyles";

const disposers: (() => void)[] = [];
function watchStyles() {
  const stop = observeDragPreviewStyles(document);
  let watching = true;
  const dispose = () => { if (watching) { watching = false; stop(); } };
  disposers.push(dispose);
  return dispose;
}
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); });

it("isolates app identities while keeping independent form values and SVG references", () => {
  const source = document.createElement("div");
  source.innerHTML = '<input data-original="first" aria-label="First"><input data-original="second" aria-label="Second"><svg xmlns="http://www.w3.org/2000/svg"><defs><path id="preview-shape" d="M0 0h10v10z" /></defs><use href="#preview-shape" /></svg>';
  document.body.append(source);
  const inputs = source.querySelectorAll("input");
  inputs[0].value = "First draft";
  inputs[1].value = "Second draft";
  const stop = watchStyles();
  const snapshot = captureDragPreview(source);
  const host = document.createElement("div");
  host.inert = true;
  document.body.append(host);
  const unmount = snapshot.mount(host);
  const copies = snapshot.element.querySelectorAll("input");
  expect([...copies].map(input => input.value)).toEqual(["First draft", "Second draft"]);
  expect(document.querySelectorAll("[data-original]")).toHaveLength(2);
  expect(host.shadowRoot!.querySelectorAll("[data-original]")).toHaveLength(2);
  expect(host.inert).toBe(true);
  const shape = snapshot.element.querySelector("path")!;
  expect(document.querySelectorAll("#preview-shape")).toHaveLength(1);
  expect(snapshot.element.querySelector("use")!.getAttribute("href")).toBe(`#${shape.id}`);
  expect(snapshot.element.querySelector("svg")!.namespaceURI).toBe("http://www.w3.org/2000/svg");
  expect(snapshot.element.querySelector("svg")!.getAttribute("xmlns")).toBe("http://www.w3.org/2000/svg");
  copies[0].style.color = "red";
  expect(copies[1].style.color).not.toBe("red");
  expect(inputs[0].style.color).not.toBe("red");
  inputs[0].value = "Updated draft";
  expect(captureDragPreview(source).element.querySelector("input")!.value).toBe("Updated draft");
  expect(copies[0].value).toBe("First draft");
  unmount();
  expect(host.shadowRoot!.childNodes).toHaveLength(0);
  stop();
});

it("captures current textarea, checkbox and selection values", () => {
  const source = document.createElement("div");
  source.innerHTML = '<textarea>Default</textarea><input type="checkbox"><select><option>First</option><option>Second</option></select>';
  document.body.append(source);
  source.querySelector("textarea")!.value = "Draft";
  source.querySelector("input")!.checked = true;
  source.querySelector("select")!.selectedIndex = 1;
  const stop = watchStyles();
  const snapshot = captureDragPreview(source);
  expect(snapshot.element.querySelector("textarea")!.value).toBe("Draft");
  expect(snapshot.element.querySelector("input")!.checked).toBe(true);
  expect(snapshot.element.querySelector("select")!.selectedIndex).toBe(1);
  stop();
});

it("retains content and input state inside an existing shadow root", () => {
  const source = document.createElement("div");
  const shadow = source.attachShadow({ mode: "open" });
  shadow.innerHTML = '<style>code { color: red; }</style><code>Visible code</code><textarea>Initial</textarea>';
  shadow.querySelector("textarea")!.value = "Edited";
  document.body.append(source);
  const stop = watchStyles();
  const snapshot = captureDragPreview(source);
  expect(snapshot.element.shadowRoot!.querySelector("code")!.textContent).toBe("Visible code");
  expect(snapshot.element.shadowRoot!.querySelector("textarea")!.value).toBe("Edited");
  expect(snapshot.element.shadowRoot!.querySelector("style")!.textContent).toBe("code { color: red; }");
  stop();
});
