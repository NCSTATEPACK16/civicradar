import { describe, expect, it } from "vitest";
import { rtfToText } from "../src/adapters/rtf.js";

describe("rtfToText", () => {
  it("converts a real Legistar minutes note", () => {
    // Shape copied from a Wake County minutes note (Legistar API, 2026-06-08).
    const rtf =
      "{\\rtf1\\ansi\\ansicpg1252\\deff0\\deflang1033{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}} {\\colortbl ;\\red0\\green0\\blue0;} " +
      "\\viewkind4\\uc1\\pard\\cf1\\fs24 Chair Mial shared today's agenda:\\par 1. Nomaco Park Improvements Update\\par \\par " +
      "He thanked the Commissioners for today\\rquote s presentation.\\par }";
    expect(rtfToText(rtf)).toBe(
      "Chair Mial shared today's agenda:\n1. Nomaco Park Improvements Update\n\nHe thanked the Commissioners for today’s presentation.",
    );
  });

  it("decodes hex and unicode escapes and skips \\* destinations", () => {
    expect(rtfToText("{\\rtf1 Caf\\'e9 {\\*\\generator Riched20;}na\\u239?ve\\par}")).toBe("Café naïve");
  });

  it("passes plain text through unchanged", () => {
    expect(rtfToText("Plain note")).toBe("Plain note");
  });
});
