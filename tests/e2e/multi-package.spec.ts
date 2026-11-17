import { test, expect } from "@playwright/test";

test("ajoute deux colis à une commande et confirme leurs prix séparément", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    !process.env.FIRESTORE_EMULATOR_HOST,
    "Émulateurs locaux uniquement.",
  );
  await page.goto("/admin/connexion");
  await page.locator("#admin-email").fill("admin@shena-express.demo");
  await page.locator("#admin-password").fill("AdminDemo#2026");
  await page
    .getByRole("button", { name: "Se connecter à l'administration" })
    .click();
  await expect(page).toHaveURL(/\/admin$/);
  const orderId = await page.evaluate(async () => {
    const path = "/src/lib/api.ts";
    const { api } = await import(path);
    return (
      await api.createOrder({
        clientId: "SHE-CLIENT-001",
        createInitialPackage: true,
        description: "Commande multi-colis",
        orderDate: new Date().toISOString().slice(0, 10),
        currency: "USD",
        items: [{ description: "Commande multi-colis", quantityOrdered: 1 }],
      })
    ).orderId;
  });
  await page.goto("/admin/commandes");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=visualViewport!.width+1)).toBe(true);
  await page
    .getByRole("row")
    .filter({ hasText: orderId })
    .getByRole("button", { name: "Suivi & statut" })
    .click();
  const select = page.getByRole("combobox", {
    name: "Colis à gérer",
    exact: true,
  });
  const first = await select.inputValue();
  expect(first).toMatch(/^SHE-PKG-\d{6,}$/);
  const tracking = "TEMU-" + Date.now();
  await page
    .getByLabel("Tracking externe du nouveau colis (facultatif)", {
      exact: true,
    })
    .fill(tracking);
  await page
    .getByRole("button", { name: "+ Ajouter un colis", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Colis de la commande (2)" }),
  ).toBeVisible();
  await expect(select).not.toHaveValue(first);
  const second = await select.inputValue();
  expect(second).toMatch(/^SHE-PKG-\d{6,}$/);
  expect(Number(second.slice(8))).toBe(Number(first.slice(8)) + 1);
  const clientContext = await browser.newContext();
  try {
    const client = await clientContext.newPage();
    await client.goto(new URL("/connexion", page.url()).href);
    await client
      .locator("#client-identifier")
      .fill("client1@shena-express.demo");
    await client.locator("#client-password").fill("ClientDemo#2026");
    await client
      .getByRole("button", { name: "Se connecter", exact: true })
      .click();
    await expect(client).toHaveURL(/\/espace-client$/);
    await client.goto(
      new URL("/espace-client/commandes/" + orderId, client.url()).href,
    );
    await expect(
      client.getByRole("heading", { name: "Colis associés (2)" }),
    ).toBeVisible();
    const total = client.getByRole("region", {
      name: "Total shipping de la commande",
    });
    await expect(total).toContainText("2 prix en attente");
    await select.selectOption(first);
    await page.locator("#quick-weight").fill("1,5");
    await page.getByRole("checkbox", { name: /Je confirme le tarif/ }).check();
    await page
      .getByRole("button", {
        name: "Enregistrer le poids et le prix",
        exact: true,
      })
      .click();
    await expect(total).toContainText("9,00");
    await expect(total).toContainText("1 prix en attente");
    await page
      .getByRole("button", {
        name: "Passer à : En avion — Départ des USA",
        exact: true,
      })
      .click();
    await expect(client.locator(`[data-package-id="${first}"]`)).toContainText(
      "En avion",
    );
    await expect(client.locator(`[data-package-id="${second}"]`)).toContainText(
      "Commande placée",
    );
    await select.selectOption(second);
    await page.locator("#quick-weight").fill("2,25");
    await page.getByRole("checkbox", { name: /Je confirme le tarif/ }).check();
    await page
      .getByRole("button", {
        name: "Enregistrer le poids et le prix",
        exact: true,
      })
      .click();
    await expect(total).toContainText("22,50");
    await expect(total).toContainText("0 prix en attente");
    await expect(total).not.toContainText("provisoire");
    await page
      .getByLabel("Tracking externe du colis sélectionné", { exact: true })
      .fill(tracking + "-NEW");
    await page
      .getByRole("button", {
        name: "Enregistrer le tracking externe",
        exact: true,
      })
      .click();
    await expect(client.locator(`[data-package-id="${second}"]`)).toContainText(
      tracking + "-NEW",
    );
    await expect(client.locator(`[data-package-id="${second}"]`)).toContainText(
      second,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= visualViewport!.width + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("admin-multi-colis.png"),
      fullPage: true,
    });
    await client.screenshot({
      path: testInfo.outputPath("client-multi-colis.png"),
      fullPage: true,
    });
  } finally {
    await clientContext.close();
  }
});
