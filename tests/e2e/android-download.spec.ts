import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

test("télécharge le véritable APK en un clic depuis l’accueil", async ({ page }, testInfo) => {
  await page.goto("/");
  const button = page.getByRole("link", { name: /Télécharger l’application Android/ });
  await expect(button).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe("SHENA-Express-1.1.apk");
  expect(new URL(download.url()).origin).toBe(new URL(page.url()).origin);
  const file = await download.path();
  expect(file).toBeTruthy();
  const actual = readFileSync(file!);
  const expected = readFileSync(resolve("public/downloads/SHENA-Express-1.1.apk"));
  expect(actual.subarray(0, 2).toString()).toBe("PK");
  expect(createHash("sha256").update(actual).digest("hex")).toBe(createHash("sha256").update(expected).digest("hex"));
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  const error = await page.getByRole("alert").boundingBox();
  const box = await button.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(error!.y + error!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("telechargement-apk.png"), fullPage: true });
});
