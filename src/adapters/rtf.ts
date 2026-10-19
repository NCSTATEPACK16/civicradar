const SYMBOLS: Record<string, string> = {
  par: "\n", line: "\n", tab: "\t", sect: "\n", page: "\n",
  lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”",
  endash: "–", emdash: "—", bullet: "•", emspace: " ", enspace: " ", qmspace: " ", "~": " ",
};
/** Destination groups whose content is never visible text. */
const SKIP_GROUPS = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "listtable", "listoverridetable", "generator"]);

/**
 * Converts RTF (as Legistar stores minutes/agenda notes) to plain text. Handles
 * paragraphs, hex (\'hh) and unicode (\uN) escapes, common symbol words, and skips
 * font/color tables and \* destinations. Strings that aren't RTF are returned as-is.
 */
export function rtfToText(input: string): string {
  if (!input.trimStart().startsWith("{\\rtf")) return input;
  let out = "";
  const stack: { skip: boolean; uc: number }[] = [];
  let skip = false;
  let uc = 1;
  let pendingSkipChars = 0;
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === "{") {
      stack.push({ skip, uc });
      i++;
      continue;
    }
    if (ch === "}") {
      ({ skip, uc } = stack.pop() ?? { skip: false, uc: 1 });
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = input[i + 1];
      if (next === "\\" || next === "{" || next === "}") {
        if (!skip) out += next;
        i += 2;
        continue;
      }
      if (next === "'") {
        if (pendingSkipChars > 0) pendingSkipChars--;
        else if (!skip) out += String.fromCharCode(parseInt(input.slice(i + 2, i + 4), 16));
        i += 4;
        continue;
      }
      if (next === "*") {
        skip = true;
        i += 2;
        continue;
      }
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(input.slice(i));
      if (!m) {
        // Control symbol such as \~ or \-.
        if (!skip && next && SYMBOLS[next]) out += SYMBOLS[next];
        i += 2;
        continue;
      }
      const [whole, word, arg] = m;
      i += whole.length;
      if (SKIP_GROUPS.has(word!)) skip = true;
      else if (word === "uc") uc = Number(arg ?? 1);
      else if (word === "u" && arg !== undefined) {
        if (!skip) out += String.fromCharCode((Number(arg) + 65536) % 65536);
        pendingSkipChars = uc;
      } else if (!skip && SYMBOLS[word!]) out += SYMBOLS[word!];
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (pendingSkipChars > 0) pendingSkipChars--;
    else if (!skip) out += ch;
    i++;
  }
  return out
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
