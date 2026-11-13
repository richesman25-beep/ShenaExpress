# Parcours administrateur simple

L'accueil administrateur affiche directement les commandes. Les fonctions complémentaires restent accessibles par « Autres outils ».

1. Cliquer sur « Nouvelle commande / colis », choisir le client, saisir le numéro de suivi et éventuellement une description. La commande et son colis sont créés ensemble au statut « Commande placée ». Le client les voit dans son espace.
2. Quand le colis est réellement reçu à Miami, ouvrir « Suivi & statut », saisir le poids en livres puis cliquer sur « Enregistrer le poids et le prix ». Le prix s'affiche dès la saisie et est recalculé côté Firebase. Le statut, le poids et le prix sont enregistrés ensemble. Exemple : 4,75 lb × 6 USD/lb = 28,50 USD.
3. Cliquer sur « Passer à : En avion — Départ des USA ».
4. Cliquer sur « Passer à : Entrepôt en République dominicaine ».
5. Cliquer sur « Passer à : En bus vers Haïti ».
6. Cliquer sur « Passer à : Disponible pour le retrait ».

Chaque étape est visible en temps réel dans l'espace client. Le parcours courant se termine à la disponibilité pour retrait. Les anciens statuts, dont la remise effective au client, restent accessibles dans les options avancées.

Les étapes dominicaine et bus utilisent les nouveaux codes `arrived_dr` et `bus_to_haiti`. Les anciens documents et leurs statuts ne sont pas migrés. La pesée conserve l'historique des corrections et le tarif déjà fixé pour les anciens colis ; le tarif par défaut des nouveaux colis est de 6 USD/lb.

## Vérification locale

- `npm run build` et `npm run functions:build` : compilation des deux parties.
- `npm run lint` et `npm test` : contrôles et tests unitaires.
- Test Firebase : `npx firebase emulators:exec --project demo-shena --only auth,firestore,functions "npx vitest run --project emulator tests/emulator/order-creation.test.ts"`.
- Navigateur : `npx firebase emulators:exec --project demo-shena --only auth,firestore,functions "npm run seed && npx playwright test tests/e2e/order-creation.spec.ts"` (Chrome installé, conformément à la configuration Playwright du projet).

Les tests utilisent une base locale jetable. Le test navigateur vérifie la création, le refus du doublon, la pesée à 4,75 lb, le montant de 28,50 USD et les six étapes dans une session client distincte, sur ordinateur et mobile.

Les modifications restent locales ; aucun push GitHub ni déploiement n'est effectué.
