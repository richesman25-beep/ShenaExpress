# Correction de l'enregistrement des commandes

## Cause

En production, `api.createOrder` utilise `directBackend.createOrder`. Sa transaction écrivait le compteur `orders_<année>` avec `tx.set`, puis lisait le compteur `shipments_<année>` avec `tx.get` lorsqu'un numéro de suivi était renseigné. Firestore refuse toute lecture après la première écriture d'une transaction.

L'allocation des identifiants et le lot d'enregistrement des documents étaient aussi deux opérations séparées. Le contrôle des doublons était une requête exécutée avant la transaction et pouvait être invalidé par une autre création simultanée.

Une seconde occurrence existait dans `createShipment` côté Cloud Functions : `nextSequence` écrivait le compteur avant la vérification du suivi généré.

## Correction

- Toutes les lectures précèdent les écritures ; création de la commande, du colis éventuel, des notes, des finances, des événements, de l'audit et des compteurs dans une seule transaction.
- Lecture transactionnelle des documents cibles avant création. Un identifiant existant (y compris notes ou finances) provoque un refus sans écrasement ni écriture partielle.
- Lecture des deux noms historiques de compteurs (`orders_2026` et `orders-2026`, ainsi que les compteurs de colis), utilisation du maximum et mise à jour atomique des deux formats pour éviter les collisions entre les deux API.
- Verrou optimiste commun `counters/shipmentTracking`, utilisé par les créations et modifications de suivi côté API directe et Cloud Functions. Les vérifications de suivi sont relancées sur le serveur à chaque tentative avant l'écriture du verrou. Une création concurrente oblige Firestore à recommencer puis à détecter le doublon. Les anciens colis sont vérifiés même sans index d'unicité.
- Le SDK Web ne permet pas `tx.get(query)`. Il utilise une requête `getDocsFromServer` protégée par ce verrou ; le SDK Admin effectue ses requêtes avec `tx.get(query)`.
- Le contenu de création est commun aux deux API et conserve `clientId`, `clientUid`, `clientName`, les références croisées commande/colis et les jetons de recherche.
- Notifications Cloud Functions déclenchées après validation de la transaction, à partir du résultat validé, sans ajout dans une liste à chaque tentative.
- Aucun changement des règles Firestore, de l'interface ou des données de production. Les protections d'unicité concernent les chemins applicatifs corrigés ; les règles existantes autorisent toujours un employé à écrire directement dans Firestore.

## Transactions examinées

| Chemin | Traitement |
| --- | --- |
| API directe `createOrder` | Allocation des deux compteurs puis création regroupées dans une transaction, lectures en premier. |
| API directe `updateOrder` | Ancien lot remplacé par une transaction pour sérialiser les changements de suivi. |
| API directe `createShipment` | Allocation et enregistrement regroupés ; même protection de suivi et d'identifiant. |
| API directe `updateShipment` | Ancien lot remplacé par une transaction pour protéger les changements de suivi. |
| Cloud Function `createOrder` | Lectures des compteurs et documents cibles avant toute écriture ; prise en charge du colis saisi dans le formulaire. |
| Cloud Function `updateOrder` | Lectures via `loadOrdersWithShipments` et du document financier déjà effectuées avant les écritures ; conservée. |
| Cloud Function `recordReceipt` | Lectures déjà effectuées avant les écritures ; conservée. |
| Cloud Functions `createShipment` / `updateShipment` | Vérifications du suivi et des compteurs avant les écritures ; verrou commun. |
| API directe `recordReceipt` | Lot d'écritures après les lectures, sans transaction Firestore ; conservé. |

## Contrôles reproductibles

Prérequis : Node.js 22 (version des Functions), JDK 21, dépendances racine et `functions/` installées.

```bash
npm ci
npm --prefix functions ci
npm run build
npm run functions:build
npm run lint
npm test
npx firebase emulators:exec --project demo-shena --only auth,firestore,functions "npx vitest run --project emulator tests/emulator/order-creation.test.ts"
```

Le test ciblé est strictement local. Il refuse de démarrer sans les variables des émulateurs et réinitialise uniquement Firestore dans le projet jetable `demo-shena` entre les cas. Ne pas l'utiliser sur une instance locale dont on souhaite conserver les fixtures.

Il couvre les deux API, les doublons normalisés, les créations concurrentes (y compris commande contre colis), les collisions d'identifiants, les comptes désactivés, les deux formats de compteurs, la création sans colis et la visibilité via les requêtes et abonnements utilisés par les écrans. Il vérifie aussi le refus des lectures croisées entre clients, des notes privées et des modifications par le client.

Suite Firebase complète :

```bash
npm run test:emulators
```

## Vérification dans le navigateur

Test Playwright ajouté dans `tests/e2e/order-creation.spec.ts`. Sans émulateur, ce test est ignoré pour éviter tout accès à une application de production. Avec Chrome installé :

```bash
npx firebase emulators:exec --project demo-shena --only auth,firestore,functions "npm run seed && npx playwright test tests/e2e/order-creation.spec.ts"
```

Le test se connecte avec le compte administrateur de démonstration, crée une commande pour `SHE-CLIENT-001`, tente le même suivi une seconde fois, puis ouvre une session client distincte pour vérifier la liste et le détail du colis. Les identifiants sont ceux des données de démonstration, exclusivement locales.

Pour une vérification manuelle, lancer les émulateurs avec `npm run emulators:fresh`, puis `npm run seed` et `npm run dev` dans d'autres terminaux. Se connecter sur `/admin/connexion` avec le compte de démonstration affiché par le seed, créer une commande, vérifier le refus d'un suivi dupliqué, puis consulter `/espace-client/colis` avec le compte client de démonstration. Vérifier également qu'un autre client n'y accède pas.

Aucun déploiement Firebase ou Netlify, aucune publication et aucun push GitHub ne sont effectués par ces commandes de test.

## Résultats de la vérification locale

- Compilation frontend et Cloud Functions : réussies.
- ESLint et vérification TypeScript : réussis.
- Tests unitaires : 20 réussis.
- Tests ciblés de commandes et colis sur les émulateurs : 19 réussis.
- Parcours Playwright réel administrateur → client : réussi sur ordinateur et mobile Chromium.
- Suite Firebase complète : 20 réussis, 1 échec dans le test de sécurité existant. L'échec intervient sur la lecture d'une commande par le rôle `staff` avec `orders.read`. Les règles inchangées reconnaissent `admin`, `operator`, `finance_manager` et ne reconnaissent pas `staff` ; le jeton du test n'a pas non plus de champ `email`, ce que signale l'émulateur. Le scénario complet Admin & Client passe après isolation de ses données de test. Aucune attente de sécurité n'a été supprimée ou affaiblie.

L'environnement d'exécution utilise Node.js 24 ; l'émulateur a utilisé cette version malgré la version Node.js 22 déclarée par les Functions. La vérification sous Node.js 22 reste recommandée avant une future publication.
