import { expect, test } from "@playwright/test";

const LATTICE = "0xDE00000000000000000000000000000000070001";

test.describe("core flow: search → passport → contract → creator → product → activity → share", () => {
  test("a new user can inspect a launch end to end", async ({ page, context, isMobile }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Proof over ghost stories.");
    await expect(page.getByText("Demo data · deterministic fixtures", { exact: false }).first()).toBeVisible();

    // Search
    await page.getByRole("button", { name: "Search token, wallet or transaction" }).first().click();
    const input = page.getByRole("dialog", { name: /Search tokens/ }).getByRole("textbox");
    await input.fill("$LATTICE");
    await expect(page.getByRole("option").first()).toContainText("$LATTICE");
    await input.press("Enter");

    // Passport
    await expect(page).toHaveURL(new RegExp(`/token/robinhood-testnet/${LATTICE}`, "i"));
    await expect(page.getByRole("heading", { level: 1, name: "$LATTICE" })).toBeVisible();
    await expect(page.getByText("vibe/vibe launch · v6-run15")).toBeVisible();

    // Contract
    const contract = page.locator("#contract");
    await expect(contract.getByText("Mint authority", { exact: true }).first()).toBeVisible();
    await contract.getByText(/View technical details/).click();
    await expect(contract.getByRole("table")).toBeVisible();

    // Evidence panel ("Why am I seeing this?")
    await page
      .getByRole("button", { name: /Provenance for Holders/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Data provenance" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Source");
    await expect(dialog).toContainText("Method");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();

    // Product proof
    const product = page.locator("#product");
    await expect(product.getByText("GitHub", { exact: true }).first()).toBeVisible();
    await expect(product.getByText("Commits / 30d").first()).toBeVisible();

    // Activity
    const activity = page.locator("#activity");
    await expect(activity.getByText("Curve buys", { exact: true }).first()).toBeVisible();
    await expect(activity.getByRole("img", { name: /Event activity/ })).toBeVisible();

    // What changed + statement ledger
    await expect(page.locator("#changes")).toContainText("holders");
    await expect(page.locator("#statements")).toContainText("None provided");

    // Share
    await page.getByRole("button", { name: /Share passport/ }).click();
    if (!isMobile) await expect(page.getByText(/Link copied|Could not share/)).toBeVisible();
    const res = await page.request.post(`/api/tokens/${LATTICE}/share`);
    const { data } = await res.json();
    await page.goto(data.path);
    await expect(page.getByRole("heading", { level: 1, name: "$LATTICE" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open full passport/ })).toBeVisible();

    // Creator
    await page.goto(`/token/robinhood-testnet/${LATTICE}`);
    await page.getByRole("link", { name: /View Creator Passport/ }).click();
    await expect(page.getByText("Creator Passport", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("table")).toContainText("$QLDG");
  });

  test("unavailable data is never shown as zero and invalid addresses 404", async ({ page }) => {
    const r = await page.goto("/token/robinhood-testnet/0xnot-an-address");
    expect(r?.status()).toBe(404);
    await expect(page.getByText("Nothing observable here")).toBeVisible();
  });

  test("watchlist persists locally", async ({ page }) => {
    await page.goto(`/token/robinhood-testnet/${LATTICE}`);
    await page.getByRole("button", { name: "Watch", exact: true }).click();
    await page.goto("/watchlist");
    await expect(page.getByRole("link", { name: "$LATTICE" })).toBeVisible();
    await expect(page.getByText(/427 holders/)).toBeVisible();
  });

  test("discover explains its sorting and never ranks by a score", async ({ page }) => {
    await page.goto("/discover?sort=holders");
    await expect(page.getByText("How this is sorted:")).toBeVisible();
    await expect(page.locator("tbody tr").first()).toContainText("$PPRBT");
    await expect(page.locator("body")).not.toContainText(/score/i);
  });

  test("keyboard: ⌘K opens search, Escape closes it", async ({ page, isMobile }) => {
    test.skip(isMobile, "keyboard shortcut is desktop-only");
    await page.goto("/");
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog", { name: /Search tokens/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Search tokens/ })).toBeHidden();
  });
});

test("demo operational and account boundaries remain explicit", async ({ page }) => {
  expect((await page.request.get("/api/live")).status()).toBe(200);
  const readiness = await page.request.get("/api/ready");
  expect(readiness.status()).toBe(503);
  expect((await readiness.json()).demo).toBe(true);
  expect((await page.request.get("/api/ops")).status()).toBe(401);
  expect((await page.request.get("/api/auth/nonce")).status()).toBe(403);
  const spec = await page.request.get("/api/v1/openapi");
  expect(spec.status()).toBe(200);
  expect((await spec.json()).openapi).toBe("3.1.0");
  await page.goto("/developers");
  await expect(page.getByRole("heading", { name: "Developer account", exact: true })).toBeVisible();
});
