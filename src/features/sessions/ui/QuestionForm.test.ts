// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuestionForm } from "./QuestionForm";
import { setUiLanguage } from "../../../shared/i18n/language";
import type {
  UserQuestionPrompt,
  UserQuestionReply,
} from "../model/userQuestion";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  setUiLanguage("en");
  container.remove();
  vi.unstubAllGlobals();
});

function prompt(multiSelect = false): UserQuestionPrompt {
  return {
    requestId: 7,
    questions: [
      {
        id: "colour",
        prompt: "Pick a colour",
        multiSelect,
        allowCustom: false,
        options: [
          { id: "red", label: "Red" },
          { id: "green", label: "Green" },
          { id: "blue", label: "Blue" },
        ],
      },
    ],
  };
}

function renderQuestion(
  onReply: (requestId: number, reply: UserQuestionReply) => void = vi.fn(),
  multiSelect = false,
) {
  act(() =>
    root.render(
      createElement(QuestionForm, {
        prompt: prompt(multiSelect),
        onReply,
      }),
    ),
  );
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"),
  );
}

function keyDown(target: Element, key: string) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

it("shows an extension editor's multiline prefill and submits it verbatim", () => {
  const onReply = vi.fn();
  const value = "  first\nsecond  ";
  act(() => root.render(createElement(QuestionForm, {
    prompt: { requestId: 8, questions: [{ id: "editor", prompt: "Edit text",
      allowCustom: true, multiSelect: false, options: [],
      input: { kind: "multiline", initialValue: value, placeholder: "Enter text",
        preserveWhitespace: true, allowEmpty: true, maxLength: 10_000 },
    }] }, onReply,
  })));
  const editor = container.querySelector<HTMLTextAreaElement>("textarea")!;
  expect(editor).not.toBeNull();
  expect(editor.value).toBe(value);
  expect(editor.placeholder).toBe("Enter text");
  act(() => container.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
  expect(onReply).toHaveBeenCalledWith(8, { kind: "answered", answers: {}, custom: { editor: value } });
});

describe("QuestionForm keyboard navigation", () => {
  it("moves the highlighted option with arrow keys and selects it with Enter", () => {
    const onReply = vi.fn();
    const options = renderQuestion(onReply);

    expect(container.querySelector("[data-question-navigation]")).toBeNull();
    expect(options[0].tabIndex).toBe(0);
    expect(options[1].tabIndex).toBe(-1);
    act(() => options[0].focus());

    keyDown(options[0], "ArrowDown");
    expect(document.activeElement).toBe(options[1]);
    expect(options[1].dataset.highlighted).toBe("true");
    expect(options[1].tabIndex).toBe(0);

    keyDown(options[1], "Enter");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')!
        .click(),
    );
    expect(onReply).toHaveBeenCalledWith(7, {
      kind: "answered",
      answers: { colour: ["green"] },
    });
  });

  it("wraps arrow navigation and supports Home and End", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "ArrowUp");
    expect(document.activeElement).toBe(options[2]);

    keyDown(options[2], "Home");
    expect(document.activeElement).toBe(options[0]);

    keyDown(options[0], "End");
    expect(document.activeElement).toBe(options[2]);
  });

  it("uses number keys to focus and select the matching option", () => {
    const options = renderQuestion();
    act(() => options[0].focus());

    keyDown(options[0], "3");

    expect(document.activeElement).toBe(options[2]);
    expect(options[2].getAttribute("aria-pressed")).toBe("true");
    expect(options[2].getAttribute("aria-keyshortcuts")).toBe("3");
  });

  it("toggles highlighted options for multi-select questions", () => {
    const options = renderQuestion(vi.fn(), true);
    act(() => options[0].focus());

    keyDown(options[0], "Enter");
    keyDown(options[0], "ArrowDown");
    keyDown(options[1], " ");

    expect(options[0].getAttribute("aria-pressed")).toBe("true");
    expect(options[1].getAttribute("aria-pressed")).toBe("true");

    keyDown(options[1], " ");
    expect(options[1].getAttribute("aria-pressed")).toBe("false");
  });
});

describe("QuestionForm steps", () => {
  function twoQuestions(): UserQuestionPrompt {
    return {
      requestId: 9,
      questions: [
        {
          id: "colour",
          prompt: "Pick a colour",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "red", label: "Red" },
            { id: "green", label: "Green" },
          ],
        },
        {
          id: "size",
          prompt: "Pick a size",
          multiSelect: false,
          allowCustom: false,
          options: [
            { id: "small", label: "Small" },
            { id: "large", label: "Large" },
          ],
        },
      ],
    };
  }

  function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === label,
    );
    if (!match) throw new Error(`No button labelled ${label}`);
    return match;
  }

  function navigationButton(label: string): HTMLButtonElement {
    const match = container.querySelector<HTMLButtonElement>(
      `[data-question-navigation] button[aria-label="${label}"]`,
    );
    if (!match) throw new Error(`No navigation button labelled ${label}`);
    return match;
  }

  it("browses unanswered questions without submitting and preserves answers at both boundaries", () => {
    const onReply = vi.fn();
    const onInteraction = vi.fn();
    const prompt = { ...twoQuestions(), autoResolveAt: Date.now() + 60_000 };
    act(() =>
      root.render(
        createElement(QuestionForm, { prompt, onReply, onInteraction }),
      ),
    );

    expect(button("Continue").disabled).toBe(true);
    expect(button("Continue").getAttribute("data-size") === "md").toBe(true);
    expect(button("Continue").getAttribute("data-variant") === "primary").toBe(true);
    expect(navigationButton("Previous question").disabled).toBe(true);
    expect(navigationButton("Next question").disabled).toBe(false);
    act(() => navigationButton("Previous question").click());
    expect(container.textContent).toContain("Pick a colour");

    act(() => navigationButton("Next question").click());
    expect(container.textContent).toContain("Pick a size");
    expect(
      container.querySelector("[data-question-navigation]")!.textContent,
    ).toBe("2 of 2");
    expect(navigationButton("Previous question").disabled).toBe(false);
    expect(navigationButton("Next question").disabled).toBe(true);
    expect(onInteraction).toHaveBeenCalledWith(9);
    act(() => button("Large").click());
    act(() => navigationButton("Next question").click());
    expect(container.textContent).toContain("Pick a size");

    act(() => navigationButton("Previous question").click());
    expect(button("Continue").disabled).toBe(true);
    act(() => button("Red").click());
    act(() => navigationButton("Next question").click());
    expect(button("Large").getAttribute("aria-pressed")).toBe("true");
    act(() => navigationButton("Previous question").click());
    expect(button("Red").getAttribute("aria-pressed")).toBe("true");
    act(() => navigationButton("Next question").click());
    expect(onReply).not.toHaveBeenCalled();

    act(() => button("Continue").click());
    expect(onReply).toHaveBeenCalledExactlyOnceWith(9, {
      kind: "answered",
      answers: { colour: ["red"], size: ["large"] },
    });
  });

  it("returns to the previous question with its answer and submits the change", () => {
    const onReply = vi.fn();
    act(() =>
      root.render(
        createElement(QuestionForm, { prompt: twoQuestions(), onReply }),
      ),
    );
    expect(container.textContent).not.toContain("Back");

    act(() => button("Red").click());
    act(() => button("Continue").click());
    expect(container.textContent).toContain("Pick a size");

    act(() => button("Back").click());
    expect(container.textContent).toContain("Pick a colour");
    expect(button("Red").getAttribute("aria-pressed")).toBe("true");

    act(() => button("Green").click());
    act(() => button("Continue").click());
    act(() => button("Large").click());
    act(() => button("Continue").click());

    expect(onReply).toHaveBeenCalledWith(9, {
      kind: "answered",
      answers: { colour: ["green"], size: ["large"] },
    });
  });

  it("localizes navigation and preserves multiline native input while revisiting answers", () => {
    setUiLanguage("zh-CN");
    const onReply = vi.fn();
    const value = "  first\nsecond  ";
    const revised = "  edited\nsecond  ";
    const prompt = twoQuestions();
    prompt.questions[0] = {
      id: "editor",
      prompt: "Edit text",
      allowCustom: true,
      multiSelect: false,
      options: [],
      input: {
        kind: "multiline",
        initialValue: value,
        preserveWhitespace: true,
        allowEmpty: true,
      },
    };
    act(() => root.render(createElement(QuestionForm, { prompt, onReply })));
    expect(container.querySelector("textarea")!.value).toBe(value);

    act(() => button("继续").click());
    act(() => button("Large").click());
    act(() => button("返回").click());
    const editor = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(editor.value).toBe(value);

    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(editor, revised);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => navigationButton("下一题").click());
    act(() => navigationButton("上一题").click());
    expect(container.querySelector("textarea")!.value).toBe(revised);
    act(() => navigationButton("下一题").click());
    expect(button("Large").getAttribute("aria-pressed")).toBe("true");
    act(() => button("继续").click());

    expect(onReply).toHaveBeenCalledWith(9, {
      kind: "answered",
      answers: { editor: ["__custom__"], size: ["large"] },
      custom: { editor: revised },
    });
  });
});

describe("QuestionForm dock layout", () => {
  const typeReply = (value: string) => {
    const field = container.querySelector<HTMLInputElement>("input")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const render = (onReply = vi.fn(), onCollapse = vi.fn()) => {
    act(() => root.render(createElement(QuestionForm, {
      prompt: { requestId: 3, questions: [{ id: "kind", prompt: "Which part?",
        multiSelect: false, allowCustom: true,
        options: [{ id: "form", label: "Form" }, { id: "chat", label: "Chat" }] }] },
      onReply, onCollapse, variant: "dock",
    })));
    return { onReply, onCollapse };
  };
  const submit = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

  it("numbers the choices and replaces the Other row with a reply field", () => {
    const { onCollapse } = render();
    const options = Array.from(container.querySelectorAll("button[aria-pressed]"));
    expect(options.map((option) => option.textContent)).toEqual(["1Form", "2Chat"]);
    expect(container.querySelector("input")!.placeholder).toBe("Or write your own reply");
    expect(submit().disabled).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse question"]')!.click());
    expect(onCollapse).toHaveBeenCalled();
  });

  it("sends a written reply instead of a picked choice", () => {
    const { onReply } = render();
    act(() => container.querySelector<HTMLButtonElement>("button[aria-pressed]")!.click());
    typeReply("Both");
    expect(container.querySelector("button[aria-pressed]")!.getAttribute("aria-pressed")).toBe("false");
    act(() => submit().click());
    expect(onReply).toHaveBeenCalledWith(3, {
      kind: "answered", answers: { kind: ["__custom__"] }, custom: { kind: "Both" },
    });
  });
});
