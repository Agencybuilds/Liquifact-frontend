import robots from "./robots";
import {
  validateRobotsPath,
  sanitizeDisallowPaths,
  safeSiteOrigin,
  MAX_PATH_LENGTH,
  MAX_PATHS,
  buildRobots,
  REJECT,
} from "@/lib/seo/robotsPolicy";

describe("validateRobotsPath", () => {
  it.each(["/", "/api/", "/admin/users", "/a-b_c.d"])("accepts %s", (p) => {
    expect(validateRobotsPath(p)).toEqual({ ok: true, path: p });
  });

  it.each([
    [42, REJECT.NOT_STRING],
    [null, REJECT.NOT_STRING],
    ["", REJECT.EMPTY],
    ["   ", REJECT.EMPTY],
    ["admin", REJECT.NO_LEADING_SLASH],
    ["https://evil.com/x", REJECT.NO_LEADING_SLASH],
    ["//evil.com/x", REJECT.PROTOCOL_RELATIVE],
    ["/a b", REJECT.ILLEGAL_CHARS],
    ["/a?x=1", REJECT.ILLEGAL_CHARS],
    ["/a#frag", REJECT.ILLEGAL_CHARS],
    ["/a\nb", REJECT.ILLEGAL_CHARS],
    ["/a/../b", REJECT.TRAVERSAL],
    ["/%2e%2e/b", REJECT.TRAVERSAL],
  ])("rejects %p as %s", (input, reason) => {
    expect(validateRobotsPath(input)).toEqual({ ok: false, reason });
  });

  it("boundary: length 200 ok, 201 rejected", () => {
    expect(validateRobotsPath("/" + "a".repeat(MAX_PATH_LENGTH - 1)).ok).toBe(true);
    expect(validateRobotsPath("/" + "a".repeat(MAX_PATH_LENGTH)).reason).toBe(REJECT.TOO_LONG);
  });
});

describe("sanitizeDisallowPaths", () => {
  it("dedupes and sorts deterministically", () => {
    const a = sanitizeDisallowPaths(["/b", "/a", "/b", "/a"]);
    const b = sanitizeDisallowPaths(["/a", "/b"]);
    expect(a.paths).toEqual(["/a", "/b"]);
    expect(a.paths).toEqual(b.paths);
  });

  it("drops invalid entries and reports reasons only", () => {
    const r = sanitizeDisallowPaths(["/ok", "bad", 5]);
    expect(r.paths).toEqual(["/ok"]);
    expect(r.rejected).toEqual([
      { reason: REJECT.NO_LEADING_SLASH },
      { reason: REJECT.NOT_STRING },
    ]);
  });

  it("handles empty and non-array input", () => {
    expect(sanitizeDisallowPaths([]).paths).toEqual([]);
    expect(sanitizeDisallowPaths(undefined).paths).toEqual([]);
  });

  it("boundary: 50 kept, 51 capped and flagged", () => {
    const fifty = Array.from({ length: MAX_PATHS }, (_, i) => `/p${i}`);
    expect(sanitizeDisallowPaths(fifty).rejected).toEqual([]);
    const over = sanitizeDisallowPaths([...fifty, "/extra"]);
    expect(over.paths).toHaveLength(MAX_PATHS);
    expect(over.rejected).toContainEqual({ reason: REJECT.OVER_LIMIT });
  });
});

describe("safeSiteOrigin", () => {
  it("accepts http(s) and strips trailing path", () => {
    expect(safeSiteOrigin("https://liquifact.com/")).toBe("https://liquifact.com");
  });
  it.each(["javascript:alert(1)", "ftp://x.com", "not a url", undefined, ""])(
    "falls back for %p",
    (v) => expect(safeSiteOrigin(v)).toBe("http://localhost:3000")
  );
});

describe("robots() regression", () => {
  it("keeps the previous public shape when no disallow paths are configured", () => {
    const result = robots();
    expect(result.rules).toEqual({ userAgent: "*", allow: "/" });
    expect(result.rules).not.toHaveProperty("disallow");
    expect(result.sitemap).toMatch(/\/sitemap\.xml$/);
  });

  it("is idempotent", () => {
    expect(robots()).toEqual(robots());
  });
});

describe("buildRobots", () => {
  const warn = jest.fn();
  beforeEach(() => warn.mockClear());

  it("adds disallow only for valid, deduped, sorted paths", () => {
    const r = buildRobots(["/b", "/a", "/b"], "https://liquifact.com", warn);
    expect(r.rules).toEqual({ userAgent: "*", allow: "/", disallow: ["/a", "/b"] });
    expect(r.sitemap).toBe("https://liquifact.com/sitemap.xml");
    expect(warn).not.toHaveBeenCalled();
  });

  it("drops invalid paths and logs reason codes only", () => {
    const r = buildRobots(["/ok", "https://evil.com", "/a?x=1"], "https://liquifact.com", warn);
    expect(r.rules.disallow).toEqual(["/ok"]);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0].join(" ");
    expect(logged).toContain("no_leading_slash");
    expect(logged).not.toContain("evil.com");
  });

  it("omits disallow when every candidate is invalid", () => {
    const r = buildRobots(["bad", 5], "https://liquifact.com", warn);
    expect(r.rules).toEqual({ userAgent: "*", allow: "/" });
  });

  it("falls back to the default origin for an unsafe site URL", () => {
    expect(buildRobots([], "javascript:alert(1)", warn).sitemap).toBe(
      "http://localhost:3000/sitemap.xml"
    );
  });
});