import { describe, expect, it } from "vitest";
import { noteBar, noteTitle, notesOf, snapNoteTime } from "./notes";
import type { Drawing } from "./types";

const note = (id: number, t: number, text = "x"): Drawing => ({ id, kind: "note", points: [{ t, price: 10 }], text });

describe("notes", () => {
  const hourly = [0, 3600, 7200];
  it("snaps to the bar containing the timestamp", () => {
    expect(snapNoteTime(hourly, 3600 + 300)).toBe(3600);
    expect(snapNoteTime(hourly, 7200)).toBe(7200);
  });
  it("survives an interval switch", () => {
    const fiveMinute = Array.from({ length: 36 }, (_, i) => i * 300);
    const t = snapNoteTime(fiveMinute, 3900);
    expect(t).toBe(3900);
    expect(noteBar(hourly, t)).toBe(1);
  });
  it("has no bar before the loaded data or far after it", () => {
    expect(noteBar([100, 200], 50)).toBeNull();
    expect(noteBar([100, 200], 5000)).toBeNull();
    expect(snapNoteTime([100, 200], 50)).toBe(50);
  });
  it("lists only notes, oldest bar first", () => {
    const list: Drawing[] = [note(1, 300), { ...note(2, 0), kind: "text" }, note(3, 100)];
    expect(notesOf(list).map((d) => d.id)).toEqual([3, 1]);
  });
  it("titles with the first line, shortened", () => {
    expect(noteTitle("a\nb")).toBe("a");
    expect(noteTitle("x".repeat(80))).toHaveLength(60);
  });
});
