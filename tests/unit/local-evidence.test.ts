import { afterEach, expect, it, vi } from "vitest";
import { localEvidenceUrl } from "@/lib/proof/local-evidence";
afterEach(() => vi.unstubAllEnvs());
const path = `/api/evidence/0x${"a".repeat(64)}`;
it("allows only the exact own canonical route during development", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3200");
  expect(localEvidenceUrl(`http://localhost:3200${path}`)?.pathname).toBe(path);
  for (const url of [
    `http://localhost:3201${path}`,
    `http://127.0.0.1:3200${path}`,
    `http://localhost:3200${path}?redirect=evil`,
    `http://localhost:3200/api/ops`,
    `http://user:pass@localhost:3200${path}`,
  ])
    expect(localEvidenceUrl(url)).toBeNull();
});
it("never enables local network retrieval in production or test", () => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3200");
  for (const mode of ["production", "test"]) {
    vi.stubEnv("NODE_ENV", mode);
    expect(localEvidenceUrl(`http://localhost:3200${path}`)).toBeNull();
  }
});
