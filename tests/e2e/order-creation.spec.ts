import { test, expect } from "@playwright/test";

test("crée une commande, calcule le prix à Miami et suit les six étapes chez le client", async ({ page, browser }, testInfo) => {
  test.skip(!process.env.FIRESTORE_EMULATOR_HOST, "Nécessite les émulateurs demo-shena et npm run seed.");
  const tracking = `E2E-${testInfo.project.name}-${Date.now()}`.toUpperCase();
  await page.goto("/admin/connexion");
  await page.locator("#admin-email").fill("admin@shena-express.demo");
  await page.locator("#admin-password").fill("AdminDemo#2026");
  await page.getByRole("button", { name: "Se connecter à l'administration" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/commandes");
  await page.getByRole("button", { name: "Nouvelle commande / colis" }).click();
  await page.locator("#of-client").selectOption("SHE-CLIENT-001");
  await expect(page.locator("#of-status")).toHaveCount(0);
  await page.locator("#of-tracking").fill(tracking);
  await page.locator("#of-desc").fill("Colis test affichage client");
  await page.getByRole("button", { name: "Enregistrer la commande", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(tracking, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Nouvelle commande / colis" }).click();
  await page.locator("#of-client").selectOption("SHE-CLIENT-001");
  await page.locator("#of-tracking").fill(tracking.toLowerCase());
  await page.getByRole("button", { name: "Enregistrer la commande", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Ce numéro de suivi est déjà utilisé");

  await page.getByRole("button", { name: "Annuler", exact: true }).click();

  const clientContext = await browser.newContext();
  try {
    const client = await clientContext.newPage();
    await client.goto(`${testInfo.project.use.baseURL ?? "http://127.0.0.1:4173"}/connexion`);
    await client.locator("#client-identifier").fill("client1@shena-express.demo");
    await client.locator("#client-password").fill("ClientDemo#2026");
    await client.getByRole("button", { name: "Se connecter", exact: true }).click();
    await expect(client).toHaveURL(/\/espace-client$/);
    await client.goto("http://127.0.0.1:4173/espace-client/colis");
    await expect(client.getByRole("link", { name: `Numéro de suivi : ${tracking}`, exact: true })).toBeVisible();
    await client.getByRole("link", { name: `Numéro de suivi : ${tracking}`, exact: true }).click();
    await expect(client.getByRole("heading", { name: tracking, exact: true })).toBeVisible();
    await expect(client.getByText("Colis test affichage client", { exact: true })).toBeVisible();
    await expect(client.getByRole("region", { name: "Progression : Commande placée", exact: true })).toBeVisible();
    await expect(client.getByText("Poids réel", { exact: true })).toHaveCount(0);
    await page.getByRole("row").filter({ hasText: tracking }).getByRole("button", { name: "Suivi & statut" }).click();
    await page.locator("#quick-weight").fill("4,75");
    await expect(page.getByText(/4,75 lb ×.*28,50/)).toBeVisible();
    await page.getByRole("button", { name: "Enregistrer le poids et le prix", exact: true }).click();
    await expect(client.getByText("4,75 lb", { exact: true })).toBeVisible();
    await expect(client.getByText(/28,50/).first()).toBeVisible();
    await expect(client.getByRole("region", { name: "Progression : Arrivé à l'entrepôt de Miami", exact: true })).toBeVisible();
    for (const label of ["En avion — Départ des USA", "Entrepôt en République dominicaine", "En bus vers Haïti", "Disponible pour le retrait"]) {
      await page.getByRole("button", { name: `Passer à : ${label}`, exact: true }).click();
      await expect(client.getByRole("region", { name: `Progression : ${label}`, exact: true })).toBeVisible();
    }
    await expect(client.getByText("4,75 lb", { exact: true })).toBeVisible();

  } finally { await clientContext.close(); }
});
