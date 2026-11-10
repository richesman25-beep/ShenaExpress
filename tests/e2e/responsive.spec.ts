import { test, expect } from "@playwright/test";

test.describe("15. Affichage responsive mobile Android & desktop + contrôle d'accès", () => {
  test("affiche la connexion client, permet d'afficher/masquer le mot de passe et redirige les visiteurs non connectés", async ({
    page,
  }) => {
    await page.goto("/espace-client");
    await expect(page).toHaveURL(/\/connexion$/);

    await expect(page.getByRole("heading", { name: "Connexion client" })).toBeVisible();
    const idInput = page.getByLabel("Identifiant client", { exact: true });
    const pwdInput = page.getByLabel("Mot de passe", { exact: true });
    await expect(idInput).toBeVisible();
    await expect(pwdInput).toHaveAttribute("type", "password");

    await page.getByRole("button", { name: "Afficher le mot de passe" }).click();
    await expect(pwdInput).toHaveAttribute("type", "text");

    // Vérifie l'absence de débordement horizontal sur mobile et desktop
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);

    // Navigation vers la récupération de mot de passe
    await page.getByRole("link", { name: "Mot de passe oublié ?" }).click();
    await expect(page.getByRole("heading", { name: "Récupération de mot de passe" })).toBeVisible();

    // Redirection d'un visiteur non connecté tentant d'accéder à /admin
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/connexion$/);
    await expect(page.getByRole("heading", { name: "Connexion administrateur" })).toBeVisible();
  });
});
