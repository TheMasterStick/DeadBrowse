import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createServer } from "../src/server.js";

// An isolated world and controllable server clock; never touches player saves.
let worldTime = Date.now();
const { server, game } = createServer({
  dbPath: ":memory:",
  clock: () => worldTime,
  secureCookies: false,
  publicOrigin: undefined,
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
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
    viewport: { width: 1440, height: 1100 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function register(tab, name) {
    await tab.goto(base);
    await tab.getByLabel("SURVIVOR NAME").fill(name);
    await tab
      .getByLabel("PASSWORD", { exact: true })
      .fill("test-only-survivor-password");
    await tab.getByRole("button", { name: "Enter the district" }).click();
    await tab
      .getByRole("heading", { name: "The district", exact: true })
      .waitFor();
  }
  await page.goto(base);
  await page.screenshot({ path: "test-results/login.png", fullPage: true });
  await register(page, "Nicholas");
  await page.screenshot({ path: "test-results/district.png", fullPage: true });
  await page.getByRole("button", { name: "Row houses", exact: true }).click();
  await page.getByRole("button", { name: "Travel here" }).click();
  await page.getByRole("button", { name: "Search for supplies" }).click();
  await page.getByRole("button", { name: "Initiate attack" }).click();
  await page.getByRole("button", { name: "Strike", exact: true }).waitFor();

  const secondContext = await browser.newContext();
  const secondPlayer = await secondContext.newPage();
  secondPlayer.on("pageerror", (error) => errors.push(error.message));
  await register(secondPlayer, "SecondSurvivor");
  await secondPlayer
    .getByRole("button", { name: "Row houses", exact: true })
    .click();
  await secondPlayer.getByRole("button", { name: "Travel here" }).click();
  await secondPlayer.getByText("Engaged by another survivor").waitFor();
  assert.equal(
    await secondPlayer
      .getByRole("button", { name: "Initiate attack" })
      .isDisabled(),
    true,
  );

  for (let round = 0; round < 3; round++) {
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/action") && response.status() === 200,
      ),
      page.getByRole("button", { name: "Strike", exact: true }).click(),
    ]);
  }
  await page
    .getByText("Target defeated. Gained 20 XP and 12 scrap.", { exact: true })
    .first()
    .waitFor();
  assert.match(await page.locator(".stat.energy strong").textContent(), /90/);
  await page.reload();
  await page
    .getByRole("heading", { name: "The district", exact: true })
    .waitFor();
  assert.match(await page.locator(".stat.energy strong").textContent(), /90/);
  await page.getByRole("button", { name: "The refuge", exact: true }).click();
  await page.getByRole("button", { name: "Travel here" }).click();
  // Observe completion before advancing time and navigating away.
  await page.getByRole("button", { name: "Manage your refuge" }).waitFor();
  worldTime += 5 * 60_000;
  await page.reload();
  await page.getByRole("button", { name: "My refuge" }).click();
  await page.getByRole("button", { name: "Upgrade workbench" }).click();
  await page.getByText("Level 2 / 5", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Survivor", exact: true }).click();
  await page.getByRole("button", { name: "Use a medical kit" }).click();
  await page
    .getByText("Used a medical kit. Restored up to 35 health.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "The district", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  // The mobile navigation must remain named and operable at the narrow breakpoint.
  await page
    .getByRole("button", { name: "Field journal", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Field journal", exact: true })
    .first()
    .waitFor();
  await page.getByRole("button", { name: "The district", exact: true }).click();
  await page.locator("#toast.show").waitFor({ state: "hidden" });
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "Browser smoke passed: two accounts, movement, scavenging, shared target contention, combat energy, reload, upgrade, heal, mobile navigation/overflow, and logout. No browser errors.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  game.close();
}
