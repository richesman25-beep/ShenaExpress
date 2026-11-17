# Gestion multi-colis et numérotation globale

## Architecture réutilisée

L’application reste en React/Vite, avec Firebase Auth, les permissions existantes, `orders`, `shipments`, les événements de suivi et la comptabilité existante. Le modèle possédait déjà `orders.shipmentIds` et `shipments.orderIds` ; l’administration utilisait surtout le premier colis. Les anciens identifiants et les anciennes pesées sont conservés.

Deux chemins doivent rester compatibles : les Cloud Functions et le backend Firestore direct utilisé par le site en production. Ils partagent maintenant le même compteur et le même protocole transactionnel.

## Identités et compteur

- Chaque nouveau colis créé par les API possède un `shipmentId` de la forme `SHE-PKG-000001`. C’est aussi l’identifiant de son document Firestore et la valeur de compatibilité `trackingNumber`.
- `externalTrackingNumber` contient exclusivement le numéro SHEIN, Amazon, Temu, AliExpress ou transporteur. L’administrateur peut le modifier ou l’effacer sans changer le numéro SHENA.
- `primaryOrderId`, `orderIds`, `clientId` et `clientUid` relient chaque nouveau colis à sa commande principale et à son propriétaire.
- `counters/packages.value` est global : aucune dépendance à l’année, à la commande ou au client. Les anciens compteurs annuels ne sont pas remis à zéro ni effacés.
- `packageNumbers/{id}` réserve définitivement chaque numéro et conserve sa séquence. Les règles interdisent de modifier ou supprimer cette réservation, de supprimer le compteur ou de diminuer sa valeur.
- Le compteur, la réservation, le colis et le lien vers la commande sont enregistrés dans une seule transaction. Toutes les lectures précèdent les écritures. Les identifiants existants sont contrôlés avant création : aucune commande ni aucun colis n’est écrasé.
- Lors d’un conflit entre créations Web et serveur, le backend Web ne rejoue un refus de commit que si une lecture serveur confirme que le compteur a changé. Les permissions sont vérifiées à nouveau et la reprise reste bornée.

Pour les anciens colis, l’absence de `externalTrackingNumber` permet de lire l’ancien `trackingNumber` comme tracking externe. Aucune mise à jour des documents n’est nécessaire pour cette compatibilité.

## Utilisation

Dans Administration → Commandes → Suivi & statut :

1. La liste présente tous les colis de la commande.
2. « + Ajouter un colis » crée un nouveau contenant et son numéro SHENA. Le tracking externe est facultatif.
3. Choisir le colis à gérer pour modifier son suivi, sa date de réception à Miami et son poids.
4. Confirmer le tarif affiché avant d’enregistrer le poids et le prix.
5. Utiliser le formulaire distinct de tracking externe pour corriger un numéro marchand.

L’ajout d’un contenant ne crée pas artificiellement d’articles et ne duplique pas les quantités de la commande. Les API existantes de répartition des articles reçus restent disponibles. Les anciens colis regroupant plusieurs commandes restent lisibles.

L’espace client présente tous les colis, leurs identités distinctes, leurs statuts et leurs prix. Les prix restent « Prix en attente » avant réception à Miami, pesée et confirmation du tarif. Chaque nouvelle pesée conserve `rateConfirmedAt`. Une ancienne pesée déjà complète, sans ce nouveau champ, reste considérée comme historique confirmée.

Le total additionne seulement les frais confirmés des colis actifs. Il devient provisoire si un prix manque ; les colis annulés sont exclus. Un devis shipping confirmé, une facture émise et un paiement encaissé restent trois notions distinctes. La comptabilité refuse la facturation d’un nouveau colis dont le tarif attend confirmation.

## Migration sûre

L’audit en lecture seule du projet existant a trouvé deux colis au format historique, aucun `SHE-PKG` et aucun compteur global. Un ancien colis sans `orderIds` est signalé pour rapprochement manuel. Aucun rattachement n’est deviné et aucun document existant n’a été modifié.

L’outil ci-dessous ne fait que lire sans `--apply` :

```sh
node scripts/migrate-package-counter.mjs --project shenaexpress-13924
```

Il calcule le maximum entre le compteur courant, les identifiants `SHE-PKG` existants et les réservations, y compris celles dont le colis a été supprimé. Il signale les colis orphelins. Un compteur invalide provoque un arrêt sans écriture.

Après validation du rapport et autorisation d’appliquer la migration :

```sh
node scripts/migrate-package-counter.mjs --project shenaexpress-13924 --apply
```

Cette opération initialise ou remonte seulement le compteur global dans une transaction ; elle ne renumérote, ne déplace et ne réécrit aucun colis. Elle est idempotente et ne diminue jamais le compteur. Si aucun numéro au nouveau format n’existe, le premier sera `SHE-PKG-000001`. Ne jamais effacer les réservations ou remettre le compteur à zéro via un outil administratif externe.

La connexion utilise la session Firebase CLI ou les identifiants Google configurés. Pour les émulateurs, seuls un projet `demo-*` et une adresse locale sont acceptés. Le mode `--apply` n’a été exercé ici que sur les émulateurs.

## Vérifications locales

```sh
npm run build
npm run functions:build
npm run lint
npm test
```

Avec Java et les émulateurs Firebase disponibles :

```sh
npm run test:emulators
```

Recette complète avec les navigateurs Playwright installés :

```sh
npx firebase emulators:exec --project demo-shena --only auth,firestore,functions 'npx vitest run --project emulator && npm run seed && npx playwright test --config playwright.multi-package.config.ts'
```

Les scénarios couvrent notamment : identifiants entre plusieurs clients et commandes, créations Web/serveur concurrentes, suppression sans réutilisation, tracking externe modifiable et identité immuable, anciens colis, montant de 1,5 lb à 9 USD, prix en attente, totaux provisoires et définitifs, permissions, migration idempotente, suivi et comptabilité. Les navigateurs simulent ordinateur, téléphone et tablette ; ils ne constituent pas une recette sur appareils physiques.

Validation réalisée le 17 novembre 2026 : compilation du site et des Functions, vérification TypeScript et ESLint réussies ; 31 tests unitaires, 49 tests Firebase et 9 parcours navigateur réussis. Les créations concurrentes ont été vérifiées sur trois vagues de six opérations mêlant backend Web et Cloud Functions. La recette navigateur couvre les trois parcours (commandes, multi-colis et comptabilité) sur ordinateur, téléphone et tablette. Un avertissement Vite sur la taille du bundle reste présent, sans bloquer la compilation.

Pour tester manuellement : activer `VITE_USE_EMULATORS=true`, lancer les émulateurs puis `npm run seed` et `npm run dev`. Le compte administrateur de démonstration est indiqué par le seed. Ne jamais utiliser le seed sur une base réelle.

## Publication ultérieure

Aucun déploiement, commit ou push n’est effectué pour cette intégration sans nouvelle demande. Avant mise en service : vérifier l’audit de migration, publier les règles compatibles, publier les Functions concernées puis la version du frontend. Les anciennes applications Android embarquant l’ancien code devront aussi recevoir une version actualisée pour utiliser la séquence globale.

## Fichiers concernés

- `shared/ids.ts`, `types.ts`, `schemas.ts`, `orderCreation.ts`, `counting.ts`, `finance.ts`, `packages.ts`, `index.ts` : format et compatibilité, validation, identités et totaux.
- `functions/src/lib/core.ts`, `lib/logistics.ts`, `orders.ts`, `shipments.ts`, `tracking.ts`, `packages.ts`, `accounting.ts`, `index.ts` : compteur commun, opérations atomiques et association commande/client.
- `firestore.rules` : réservations persistantes, compteur monotone et protection de l’identité interne.
- `src/lib/directBackend.ts`, `src/lib/api.ts` : même comportement transactionnel pour le site.
- `src/components/ui.tsx`, `src/pages/admin/AdminClientsAndOrders.tsx`, `AdminShipmentsFinanceSettings.tsx`, `src/pages/ClientPortal.tsx` : tous les colis et leurs frais dans les interfaces existantes.
- `src/pages/admin/AdminContext.tsx`, `src/index.css` : en-tête compact sur téléphone, modales et formulaires adaptés aux petits écrans.
- `scripts/migrate-package-counter.mjs` : audit et initialisation sûre du compteur.
- `tests/unit/packages.test.ts`, `domain-and-ui.test.tsx`, `tests/emulator/order-creation.test.ts`, `package-migration.test.ts`, `tests/e2e/multi-package.spec.ts`, `order-creation.spec.ts`, `accounting.spec.ts`, `playwright.multi-package.config.ts` : vérifications et recette.
