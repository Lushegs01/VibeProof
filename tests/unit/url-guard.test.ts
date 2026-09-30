import { describe, expect, it } from "vitest";
import { isPublicIp, parseGithubRepo, validatePublicUrl } from "@/lib/proof/url-guard";

describe("SSRF URL validation", () => {
  const blocked = [
    "http://localhost/",
    "https://localhost:443/",
    "https://127.0.0.1/",
    "https://0.0.0.0/",
    "https://10.1.2.3/",
    "https://172.16.0.1/",
    "https://172.31.255.255/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data",
    "https://100.64.0.1/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[fd00::1]/",
    "https://[fe80::1]/",
    "https://2130706433/", // decimal 127.0.0.1
    "https://0x7f000001/", // hex 127.0.0.1
    "https://017700000001/", // octal 127.0.0.1
    "https://metadata.google.internal/",
    "https://printer.local/",
    "https://intranet/",
    "https://user:pass@example.com/",
    "https://example.com:8080/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "gopher://example.com/",
  ];
  for (const url of blocked) {
    it(`blocks ${url}`, () => expect(validatePublicUrl(url, { allowHttp: true }).ok).toBe(false));
  }

  it("allows public https URLs", () => {
    expect(validatePublicUrl("https://example.com/path?q=1").ok).toBe(true);
    expect(validatePublicUrl("https://1.1.1.1/").ok).toBe(true);
    expect(validatePublicUrl("https://example.com:443/").ok).toBe(true);
  });
  it("rejects plain http unless allowed", () => {
    expect(validatePublicUrl("http://example.com/").ok).toBe(false);
    expect(validatePublicUrl("http://example.com/", { allowHttp: true }).ok).toBe(true);
  });
});

describe("isPublicIp", () => {
  it.each([
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["172.15.255.255", true],
    ["172.32.0.0", true],
    ["2606:4700:4700::1111", true],
    ["127.0.0.1", false],
    ["10.0.0.1", false],
    ["172.16.5.4", false],
    ["192.168.0.10", false],
    ["169.254.169.254", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["255.255.255.255", false],
    ["::", false],
    ["::1", false],
    ["::ffff:10.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["fc00::1", false],
    ["fe80::abcd", false],
    ["ff02::1", false],
    ["64:ff9b::a00:1", false],
    ["2002:7f00:1::", false],
    ["not-an-ip", false],
  ])("%s → %s", (ip, expected) => expect(isPublicIp(ip)).toBe(expected));
});

describe("GitHub allowlist", () => {
  it("parses github.com/{owner}/{repo}", () => {
    expect(parseGithubRepo("https://github.com/foundry-rs/forge-std")).toEqual({ owner: "foundry-rs", repo: "forge-std" });
    expect(parseGithubRepo("https://github.com/org/repo.git")).toEqual({ owner: "org", repo: "repo" });
    expect(parseGithubRepo("https://github.com/org/repo/tree/main/src")).toEqual({ owner: "org", repo: "repo" });
  });
  it("rejects other hosts and malformed paths", () => {
    expect(parseGithubRepo("https://gitlab.com/org/repo")).toBeNull();
    expect(parseGithubRepo("https://github.com.evil.com/org/repo")).toBeNull();
    expect(parseGithubRepo("https://evil.com/github.com/org/repo")).toBeNull();
    expect(parseGithubRepo("https://github.com/org")).toBeNull();
    expect(parseGithubRepo("http://github.com/org/repo")).toBeNull();
    // Dot segments are normalised by the URL parser; the result can only ever address api.github.com/repos/{owner}/{repo}.
    expect(parseGithubRepo("https://github.com/../../etc/passwd")).toEqual({ owner: "etc", repo: "passwd" });
    expect(parseGithubRepo("https://github.com/o%2F..%2F/r")).toBeNull();
  });
});
