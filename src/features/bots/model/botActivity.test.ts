import { expect, it } from "vitest";
import { botActivityLabel } from "./botActivity";

it("describes the current action in plain words", () => {
  expect(
    botActivityLabel({
      action: "sessions.create",
      projectName: "web",
      at: 1,
    }),
  ).toEqual({
    key: "Starting a conversation in {project}…",
    params: { project: "web" },
  });
  expect(
    botActivityLabel({
      action: "sessions.send",
      sessionTitle: "Login",
      at: 1,
    }),
  ).toEqual({
    key: "Handing the task to {title}…",
    params: { title: "Login" },
  });
  expect(botActivityLabel({ action: "git.read", at: 1 }).key).toBe(
    "Checking Git status…",
  );
  expect(botActivityLabel(undefined).key).toBe("Working…");
});
