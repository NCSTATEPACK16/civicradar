import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots } from "../src/http/robots.js";

const UA = "CivicRadar/0.1 (+https://example.org)";

describe("robots", () => {
  it("uses the * group and longest-match semantics", () => {
    const r = parseRobots("User-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow: /*.aspx$", UA);
    expect(isAllowed(r, "/AgendaCenter")).toBe(true);
    expect(isAllowed(r, "/admin/secret")).toBe(false);
    expect(isAllowed(r, "/admin/public/x")).toBe(true);
    expect(isAllowed(r, "/Search.aspx")).toBe(false);
    expect(isAllowed(r, "/Search.aspx?q=1")).toBe(true);
  });

  it("prefers a group naming our product token", () => {
    const r = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: civicradar\nDisallow: /private", UA);
    expect(isAllowed(r, "/AgendaCenter")).toBe(true);
    expect(isAllowed(r, "/private")).toBe(false);
  });

  it("treats empty robots.txt as allow-all", () => {
    expect(isAllowed(parseRobots("", UA), "/anything")).toBe(true);
  });
});
