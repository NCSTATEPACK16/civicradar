export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

/**
 * Minimal robots.txt parser: picks the group matching our product token, falling back
 * to "*", and supports Allow/Disallow with "*" wildcards and "$" anchors.
 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const token = userAgent.split("/")[0]!.toLowerCase();
  const groups: { agents: string[]; allow: string[]; disallow: string[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value) current.allow.push(value);
    if (field === "disallow" && value) current.disallow.push(value);
  }

  const specific = groups.find((g) => g.agents.some((a) => a !== "*" && token.includes(a)));
  const fallback = groups.find((g) => g.agents.includes("*"));
  const g = specific ?? fallback;
  return { allow: g?.allow ?? [], disallow: g?.disallow ?? [] };
}

/** Longest matching rule wins; Allow wins ties (Google/RFC 9309 semantics). */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  let best = -1;
  let allowed = true;
  for (const r of rules.disallow) {
    if (matches(r, path) && r.length > best) {
      best = r.length;
      allowed = false;
    }
  }
  for (const r of rules.allow) {
    if (matches(r, path) && r.length >= best) {
      best = r.length;
      allowed = true;
    }
  }
  return allowed;
}

function matches(rule: string, path: string): boolean {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const re = new RegExp(
    "^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""),
  );
  return re.test(path);
}
