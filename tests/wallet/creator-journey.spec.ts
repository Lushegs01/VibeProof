import { test, expect } from "./fixtures";
import { createPublicClient, http, keccak256, toBytes } from "viem";
import { REGISTRY_ABI } from "../../src/lib/registry/abi";
import { RPC_URL } from "./settings";

test("creator connects, signs SIWE, submits evidence, anchors and independently verifies the public passport", async ({ page, manifest, wallet }, info) => {
  await page.goto(`/submit?token=${manifest.token}`);
  await page.getByRole("button", { name: "Browser wallet", exact: true }).click();
  await wallet.wrongChain();
  await page.getByRole("button", { name: "Sign message", exact: true }).click();
  await expect(page.getByText("Signed in. No transaction was sent.")).toBeVisible();
  expect(wallet.signedMessages()[0]).toContain("Chain ID: 46630");
  // Reachability failure remains an honest negative observation; it is not promoted to control verification.
  await page.getByPlaceholder("https://yourproject.xyz").fill("https://127.0.0.1");
  await page.getByPlaceholder("https://x.com/yourproject").fill("https://x.com/local-browser-project");
  await page.getByLabel("Short description (shown as a creator claim)").fill(`Browser lifecycle ${info.project.name}`);
  const submitted = page.waitForResponse((response) => response.url().endsWith("/api/proofs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Generate passport", exact: true }).click();
  const submission = await (await submitted).json();
  expect(submission.data.creator.toLowerCase()).toBe(manifest.creator.toLowerCase());
  await expect(page.getByRole("heading", { name: "Your Project Passport" })).toBeVisible();
  await expect(page.getByText(/Rejected:/)).toBeVisible();
  await page.getByRole("button", { name: "Anchor hash onchain (optional)", exact: true }).click();
  await expect(page.getByRole("link", { name: /Verify anchored document independently/ })).toBeVisible();
  expect(wallet.sentTransactions()).toBe(1);
  const proof = await page.request.get(`/api/tokens/${manifest.token}/proof`);
  const publicProof = (await proof.json()).data;
  expect(publicProof.metadataHash).toBe(submission.data.metadataHash);
  expect(publicProof.registryTx).toMatch(/^0x[0-9a-f]{64}$/);
  const bytes = await (await page.request.get(publicProof.metadataUri)).body();
  expect(keccak256(bytes)).toBe(submission.data.metadataHash);
  const rpc = createPublicClient({ transport: http(RPC_URL) });
  const committed = await rpc.readContract({
    address: manifest.registry,
    abi: REGISTRY_ABI,
    functionName: "getProof",
    args: [manifest.creator, manifest.token],
  });
  expect(committed.metadataHash).toBe(submission.data.metadataHash);
  await page.getByRole("link", { name: "View Launch Passport", exact: true }).click();
  await expect(page.locator("#product")).toContainText(`Browser lifecycle ${info.project.name}`);
  await page.getByRole("button", { name: "Independently verify commitment", exact: true }).click();
  await expect(page.locator("#product").getByText("cryptographically verified", { exact: true })).toBeVisible();
  await expect(page.locator("#product")).toContainText("Creator authority: launch creator");
  await info.attach("local-commitment", {
    body: JSON.stringify({
      chainId: 46630,
      registry: manifest.registry,
      token: manifest.token,
      launchTx: manifest.launchTx,
      anchorTx: publicProof.registryTx,
      metadataHash: submission.data.metadataHash,
    }),
    contentType: "application/json",
  });
});

test("signature rejection is recoverable and wrong creators cannot submit", async ({ page, manifest, wallet }) => {
  await page.goto(`/submit?token=${manifest.token}`);
  await page.getByRole("button", { name: "Browser wallet", exact: true }).click();
  await wallet.rejectNextSignature();
  await page.getByRole("button", { name: "Sign message", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "rejected" })).toBeVisible();
  await page.getByRole("button", { name: "Sign message", exact: true }).click();
  await expect(page.getByText("Signed in. No transaction was sent.")).toBeVisible();
  await wallet.selectAccount(1);
  await expect(page.getByRole("button", { name: "Generate passport", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Sign message", exact: true }).click();
  await expect(page.getByText("Signed in. No transaction was sent.")).toBeVisible();
  await page.getByRole("button", { name: "Generate passport", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Only the launch creator" })).toBeVisible();
  expect(wallet.sentTransactions()).toBe(0);
});

test("retrying a temporary anchor verification failure reuses the original transaction", async ({ page, manifest, wallet }, info) => {
  await page.goto(`/submit?token=${manifest.token}`);
  await page.getByRole("button", { name: "Browser wallet", exact: true }).click();
  await page.getByRole("button", { name: "Sign message", exact: true }).click();
  await expect(page.getByText("Signed in. No transaction was sent.")).toBeVisible();
  await page.getByLabel("Short description (shown as a creator claim)").fill(`Retry lifecycle ${info.project.name}`);
  await page.getByRole("button", { name: "Generate passport", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Project Passport" })).toBeVisible();
  // This explicitly simulates only a transient API failure, never a blockchain confirmation.
  await page.route(
    "**/api/proofs/anchor",
    async (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "temporary_unavailable", message: "Temporary verification outage. Retry shortly." } }),
      }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "Anchor hash onchain (optional)", exact: true }).click();
  await expect(page.getByText("Temporary verification outage. Retry shortly.")).toBeVisible();
  await page.getByRole("button", { name: "Retry anchor verification", exact: true }).click();
  await expect(page.getByRole("link", { name: /Verify anchored document independently/ })).toBeVisible();
  expect(wallet.sentTransactions()).toBe(1);
});
