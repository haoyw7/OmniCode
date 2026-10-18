import { describe, expect, it } from "vitest";
import type { Attachment } from "../model/session";
import { mergeAttachmentPresence } from "./AttachmentList";

const file = (id: string) => ({ id, name: id, kind: "file" }) as unknown as Attachment;
const present = (...ids: string[]) => ids.map(id => ({ attachment: file(id), leaving: false }));
const shape = (list: { attachment: Attachment; leaving: boolean }[]) =>
  list.map(({ attachment, leaving }) => `${attachment.id}${leaving ? "-" : ""}`);

describe("mergeAttachmentPresence", () => {
  it("keeps a removed chip in its slot while it leaves", () => {
    expect(shape(mergeAttachmentPresence(present("a", "b", "c"), [file("a"), file("c")]))).toEqual(["a", "b-", "c"]);
    expect(shape(mergeAttachmentPresence(present("a", "b"), [file("b")]))).toEqual(["a-", "b"]);
  });

  it("brings a leaving chip back when it is re-added", () => {
    const leaving = mergeAttachmentPresence(present("a", "b"), [file("a")]);
    expect(shape(mergeAttachmentPresence(leaving, [file("a"), file("b")]))).toEqual(["a", "b"]);
  });
});
