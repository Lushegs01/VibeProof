import { describe, expect, it } from "vitest";
import { checkGithub, checkWebsite, socialClaim } from "@/lib/proof/checks";
import { SafeFetchError } from "@/lib/proof/safe-fetch";

const TOKEN = "0xe794217880011f9cA6961340eD5c16EC9559Fea0";
const res =
  (body: string, status = 200) =>
  async () => ({
    finalUrl: "https://x.xyz/",
    status,
    headers: {},
    body,
    bytes: Buffer.from(body),
    truncated: false,
    tls: { valid: true },
    redirects: [],
    ms: 12,
  });

describe("website check", () => {
  it("is 'observed' when reachable", async () => {
    const r = await checkWebsite("website", "https://x.xyz", TOKEN, res("<title>X</title>"));
    expect(r.state).toBe("observed");
    expect(r.facts.title).toBe("X");
    expect(r.facts.mentionsContract).toBe(false);
  });
  it("keeps address mentions as observations rather than control verification", async () => {
    const r = await checkWebsite("website", "https://x.xyz", TOKEN, res(`contract: ${TOKEN.toLowerCase()}`));
    expect(r.state).toBe("observed");
  });
  it("is 'not_found' on 404 and 'unavailable' on 5xx", async () => {
    expect((await checkWebsite("demo", "https://x.xyz", TOKEN, res("", 404))).state).toBe("not_found");
    expect((await checkWebsite("demo", "https://x.xyz", TOKEN, res("", 503))).state).toBe("unavailable");
  });
  it("network failures are 'unavailable', never negative", async () => {
    const r = await checkWebsite("website", "https://x.xyz", TOKEN, async () => {
      throw new SafeFetchError("Timed out", "timeout");
    });
    expect(r.state).toBe("unavailable");
    expect(r.facts.reachable).toBeNull();
  });
  it("blocked internal targets are rejected", async () => {
    const r = await checkWebsite("website", "https://x.xyz", TOKEN, async () => {
      throw new SafeFetchError("Resolved to a non-public address", "blocked");
    });
    expect(r.state).toBe("not_found");
    expect(r.summary).toMatch(/Rejected/);
  });
});

describe("GitHub check", () => {
  const now = Date.parse("2026-09-30T00:00:00Z");
  const gh = (routes: Record<string, { status: number; json?: unknown; link?: string }>) => async (path: string) => {
    const key =
      Object.keys(routes).find((k) => path.startsWith(k) && (k.includes("?") || !path.slice(k.length).startsWith("/"))) ??
      Object.keys(routes).find((k) => path.split("?")[0] === k);
    const r = key ? routes[key] : { status: 404 };
    return { status: r.status, json: r.json ?? null, link: r.link ?? null };
  };
  const repo = {
    private: false,
    stargazers_count: 12,
    pushed_at: "2026-09-29T21:00:00Z",
    default_branch: "main",
    archived: false,
    fork: false,
    full_name: "o/r",
  };

  it("reports repository facts with counts from Link headers", async () => {
    const r = await checkGithub(
      "https://github.com/o/r",
      TOKEN,
      gh({
        "/repos/o/r": { status: 200, json: repo },
        "/repos/o/r/commits?since": {
          status: 200,
          json: [{}],
          link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=27>; rel="last"',
        },
        "/repos/o/r/contributors": { status: 200, json: [{}], link: '<https://api.github.com/x?page=4>; rel="last"' },
        "/repos/o/r/releases": { status: 200, json: [] },
        "/repos/o/r/readme": { status: 200, json: { content: Buffer.from(`Token: ${TOKEN}`).toString("base64") } },
        "/repos/o/r/commits?per_page=1": { status: 200, json: [{ commit: { committer: { date: "2026-09-29T21:00:00Z" } } }] },
      }),
      now,
    );
    expect(r.state).toBe("observed");
    expect(r.facts.commits30d).toBe(27);
    expect(r.facts.contributors).toBe(4);
    expect(r.facts.releases).toBe(0);
    expect(r.facts.lastCommitAt).toBe("2026-09-29T21:00:00Z");
  });
  it("404 → not_found", async () => {
    const r = await checkGithub("https://github.com/o/missing", TOKEN, gh({}), now);
    expect(r.state).toBe("not_found");
  });
  it("rate limit → unavailable (not zero commits)", async () => {
    const r = await checkGithub("https://github.com/o/r", TOKEN, gh({ "/repos/o/r": { status: 403 } }), now);
    expect(r.state).toBe("unavailable");
    expect(r.facts.commits30d).toBeUndefined();
    expect(r.summary).toBe("GitHub verification could not be completed.");
  });
  it("a failed sub-request yields null, not 0", async () => {
    const r = await checkGithub(
      "https://github.com/o/r",
      TOKEN,
      gh({ "/repos/o/r": { status: 200, json: repo }, "/repos/o/r/commits?since": { status: 500 } }),
      now,
    );
    expect(r.state).toBe("observed");
    expect(r.facts.commits30d).toBeNull();
  });
  it("non-GitHub URLs are rejected", async () => {
    expect((await checkGithub("https://gitlab.com/o/r", TOKEN, gh({}), now)).state).toBe("not_found");
  });
});

describe("social links", () => {
  it("are always creator claims", () => {
    expect(socialClaim("twitter", "https://x.com/o").state).toBe("creator_claimed");
  });
});
