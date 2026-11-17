import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
test("facture un colis, enregistre un acompte et exporte le rapport comptable", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    !process.env.FIRESTORE_EMULATOR_HOST,
    "Émulateurs locaux et seed requis.",
  );
  await page.goto("/admin/connexion");
  await page.locator("#admin-email").fill("admin@shena-express.demo");
  await page.locator("#admin-password").fill("AdminDemo#2026");
  await page
    .getByRole("button", { name: "Se connecter à l'administration" })
    .click();
  await expect(page).toHaveURL(/\/admin$/);
  const { shipmentId, orderId } = await page.evaluate(async () => {
    const modulePath = "/src/lib/api.ts";
    const { api } = await import(modulePath);
    const { orderId } = await api.createOrder({
      clientId: "SHE-CLIENT-001",
      orderDate: new Date().toISOString().slice(0, 10),
      currency: "USD",
      items: [{ description: "Colis comptabilité", quantityOrdered: 1 }],
    });
    await api.recordReceipt({
      orderId,
      lines: [{ lineId: "L1", quantityReceived: 1 }],
    });
    const { shipmentId: id } = await api.createShipment({
      clientId: "SHE-CLIENT-001",
      trackingNumber: "ACC-" + Date.now(),
      transportMode: "air",
      lines: [{ orderId, lineId: "L1", quantity: 1 }],
      dates: {},
    });
    await api.recordShipmentWeighing({
      shipmentId: id,
      actualWeightLb: 4.75,
      confirmMiamiReception: true,
    });
    return { shipmentId: id, orderId };
  });
  await page.goto("/admin/comptabilite/factures");
  await page
    .getByRole("combobox", { name: "Colis pesé", exact: true })
    .selectOption(shipmentId);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(
    page.getByText("Opération enregistrée et auditée."),
  ).toBeVisible();
  await page.goto("/admin/comptabilite/paiements");
  await page
    .getByRole("combobox", { name: "Facture", exact: true })
    .selectOption(shipmentId);
  await page.getByLabel("Montant", { exact: true }).fill("10.00");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(
    page.getByText("Opération enregistrée et auditée."),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: shipmentId }).first(),
  ).toContainText("18,50");
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
      client.getByText("Solde restant", { exact: true }).locator(".."),
    ).toContainText("18,50");
    await expect(
      client.getByRole("link", { name: "Comptabilité", exact: true }),
    ).toHaveCount(0);
  } finally {
    await clientContext.close();
  }
  await page.goto("/admin/comptabilite/rapports");
  // Attendre le snapshot comptable avant de demander un export.
  await expect(
    page.getByRole("row").filter({ hasText: shipmentId }).first(),
  ).toContainText("18,50");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Exporter CSV" }).click(),
  ]);
  expect(download.suggestedFilename()).toContain("SHENA-comptabilite");
  const reportPath = await download.path();
  expect(reportPath).not.toBeNull();
  const csv = readFileSync(reportPath!, "utf8");
  expect(csv).toContain("Créances clients à la date de fin");
  expect(csv).toContain("Catégorie");
  const revenueText = await page
    .getByText("Chiffre d’affaires facturé", { exact: true })
    .locator("..")
    .locator("strong")
    .innerText();
  const revenue = Number(
    revenueText.replace(/[^0-9,-]/g, "").replace(",", "."),
  );
  expect(csv).toContain(`"Chiffre d’affaires facturé";"${revenue.toFixed(2)}"`);
  const [pdf] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Rapport PDF / Imprimer" }).click(),
  ]);
  await expect(
    pdf.getByRole("heading", { name: "SHENA Express — Comptabilité" }),
  ).toBeVisible();
  await expect(pdf.locator("table")).toHaveCount(5);
  await pdf.pdf({
    path: testInfo.outputPath("rapport-comptabilite.pdf"),
    format: "A4",
    landscape: true,
  });
  await pdf.close();
  await page.screenshot({
    path: testInfo.outputPath("comptabilite.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
