import { test, expect } from "@playwright/test";

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`affiche le trajet pendant le chargement puis rend la connexion (${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion });
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/src/main.tsx", async route => { await ready; await route.continue(); });
    try {
      await page.goto("/connexion", { waitUntil: "commit" });
      const loader = page.getByRole("status");
      await expect(loader).toContainText("Chargement de SHENA Express");
      await expect(loader.getByRole("img", { name: "Miami → République dominicaine → Haïti" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      release();
      await expect(page.locator("#client-identifier")).toBeVisible();
      await expect(page.locator(".shena-loading")).toHaveCount(0);
      await expect(page.locator(".image-login-original")).toHaveAttribute("src", "/images/connexion-originale.png");
    } finally { release(); }
  });
}

test("l'avion passe par les trois villes et respecte la réduction des animations", async ({ page }) => {
  await page.goto("/loading-route.svg");
  const positions = await page.evaluate(() => {
    const svg = document.querySelector("svg")! as SVGSVGElement;
    const plane = document.querySelector(".flight-moving")! as SVGGElement;
    svg.pauseAnimations();
    return [0.1, 2.2, 4.5].map(time => {
      svg.setCurrentTime(time);
      const relative = svg.getCTM()!.inverse().multiply(plane.getCTM()!);
      return { x: relative.e, y: relative.f };
    });
  });
  expect(positions[0].x).toBeCloseTo(45, 0);
  expect(positions[1].x).toBeCloseTo(180, 0);
  expect(positions[2].x).toBeCloseTo(315, 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".flight-moving")).toBeHidden();
  await expect(page.locator(".flight-static")).toBeVisible();
});
