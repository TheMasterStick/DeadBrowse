import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createServer } from "../src/server.js";
let time = Date.now();
const { server, game } = createServer({
  dbPath: ":memory:",
  clock: () => time,
  secureCookies: false,
  publicOrigin: undefined,
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  mkdirSync("test-results", { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const register = async (p, name) => {
    await p.goto(base);
    await p.getByLabel("Survivor name").fill(name);
    await p
      .getByLabel("Password", { exact: true })
      .fill("test-only-survivor-password");
    await p.getByRole("button", { name: "Enter the district" }).click();
    await p
      .getByRole("heading", { name: "Local area", exact: true })
      .first()
      .waitFor();
  };
  const state = async (p) =>
    p.evaluate(async () => (await (await fetch("/api/state")).json()).state);
  await register(page, "Nicholas");
  assert.equal(await page.locator(".map-tile").count(), 9);
  assert.equal((await state(page)).city.width, 100);
  await page.screenshot({ path: "test-results/district.png", fullPage: true });
  await page.locator('[data-location="5049"]').click();
  await page.getByRole("button", { name: "Travel here" }).click();
  await page.getByLabel("Journey in progress").waitFor();
  let s = await state(page);
  assert.equal(s.player.location, 5050);
  assert.equal(s.player.travel.to, 5049);
  await page.reload();
  await page.getByLabel("Journey in progress").waitFor();
  await page.screenshot({ path: "test-results/travel.png", fullPage: true });
  time += 20000;
  await page.reload();
  await page
    .getByRole("button", { name: "Search for supplies", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Search for supplies", exact: true })
    .click();
  await page.getByRole("button", { name: "Initiate attack" }).click();
  await page.getByRole("heading", { name: "Attacking", exact: true }).waitFor();
  await page.screenshot({ path: "test-results/combat.png", fullPage: true });
  const context2 = await browser.newContext(),
    second = await context2.newPage();
  await register(second, "SecondSurvivor");
  await second.locator('[data-location="5049"]').click();
  await second.getByRole("button", { name: "Travel here" }).click();
  await second.getByLabel("Journey in progress").waitFor();
  time += 20000;
  await second.reload();
  await second.getByText("Engaged by another survivor").waitFor();
  assert.equal(
    await second.getByRole("button", { name: "Initiate attack" }).isDisabled(),
    true,
  );
  for (let i = 0; i < 3; i++)
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/api/action") && r.status() === 200,
      ),
      page.getByRole("button", { name: /^Strike/ }).click(),
    ]);
  await page.getByRole("heading", { name: "Encounter complete" }).waitFor();
  s = await state(page);
  assert.equal(s.player.energy, 90);
  assert.equal(s.player.kills, 1);
  await page.getByRole("button", { name: "Return to local area" }).click();
  await page.locator('[data-location="5050"]').click();
  await page.getByRole("button", { name: "Travel here" }).click();
  await page.getByLabel("Journey in progress").waitFor();
  time += 5 * 60000;
  await page.reload();
  await page.getByRole("button", { name: "My refuge", exact: true }).click();
  await page.getByRole("button", { name: "Upgrade workbench" }).click();
  await page
    .getByText("Salvage workbench · Level 2", { exact: true })
    .waitFor();
  await page.locator("#toast.show").waitFor({ state: "hidden" });
  await page.screenshot({ path: "test-results/refuge.png", fullPage: true });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({ path: "test-results/overview.png", fullPage: true });
  await page.getByRole("button", { name: "Survivor", exact: true }).click();
  await page.getByRole("button", { name: "Use a medical kit" }).click();
  await page.getByRole("button", { name: "Local area", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Field journal", exact: true })
    .click();
  await page.getByRole("button", { name: "Local area", exact: true }).click();
  await page.locator("#toast.show").waitFor({ state: "hidden" });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: 9 visible tiles, 100×100 city, timed travel/reload/arrival, scavenging, 2-account contention, dedicated combat, initial energy cost, refuge upgrade, overview, healing, mobile navigation and no overflow. No JavaScript errors.",
  );
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
  game.close();
}
