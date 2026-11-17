# Comptabilité SHENA Express — validation locale

Le module est accessible aux administrateurs autorisés dans `/admin/comptabilite`. L’intégration initiale a été testée localement. Aucune migration ni suppression de données existantes n’a été effectuée. La publication ciblée des règles Firestore pour débloquer la pesée est décrite ci-dessous.

## Architecture réutilisée

React/Vite et le contexte administrateur fournissent les clients et colis existants. Firebase Auth et les permissions `finance.read`, `finance.write` sont conservés. Les écritures comptables passent exclusivement par la Cloud Function callable `accountingCommand` ; contrairement à certaines anciennes fonctionnalités, aucun fallback d'écriture depuis le navigateur n'est autorisé. La modification des tarifs exige le rôle administrateur.

La création d'une facture relie un colis pesé à sa commande et à son client. Les paiements mettent à jour atomiquement le registre comptable, `orderFinance`, `paymentRecords` et le statut de paiement du colis. L'espace client utilise ses données financières existantes et ne reçoit ni les coûts transporteur ni les résultats globaux.

## Collections et protection

| Collection | Contenu |
| --- | --- |
| `accountingInvoices` | Une facture par colis, poids et tarifs historiques, montant facturé, coût estimé ou confirmé, encaissement et règlement fournisseur |
| `accountingEntries` | Paiements, remboursements, contrepassations, dépenses, règlements, confirmations de coût et épargne explicitement enregistrée |
| `accountingSettings` | Tarifs futurs privés, valeurs initiales 600 et 450 centimes USD/lb |
| `accountingGoals` | Objectifs datés, dont épargne personnelle quotidienne configurable à 100 USD par défaut |
| `accountingRequests` | Clés d'idempotence liées à l'auteur et empreinte de la commande |
| `accountingReferences` | Réservation des références d'opération pour détecter les doublons |
| `accountingAudit` | Journal comptable protégé contre les écritures navigateur, avec commande, résultat et empreinte |
| `auditLogs` (existante) | Auteur, opération et identifiant de requête |

Les clients ne peuvent lire aucune de ces collections comptables. La lecture exige une permission administrative ; toutes les écritures navigateur sont interdites. Le serveur vérifie l'identité, les permissions et la désactivation du compte, valide les données et réalise toutes les lectures de transaction avant ses écritures. Les anciens points d'entrée financiers refusent de modifier une facture ou un paiement désormais géré par la comptabilité. Les règles protègent aussi ces documents et les montants du colis.

Une nouvelle tentative réseau avec la même requête ne crée pas un second paiement. Des requêtes distinctes sans référence restent des opérations distinctes : saisir une référence externe pour détecter aussi ce cas. Les paiements dépassant le solde, remboursements excessifs et règlements dépassant une dette sont refusés, y compris en concurrence.

## Calculs et dates

- Poids conservé au millième de livre, sans arrondi à la livre supérieure.
- Montants stockés en centimes entiers. Multiplications et divisions monétaires par `BigInt`, arrondi au centime le plus proche, demi-centime vers le haut.
- Exemple : 4,750 lb × 6 USD = 28,50 USD ; coût à 4,50 USD/lb = 21,38 USD ; marge = 7,12 USD.
- Le taux HTG est le nombre de gourdes pour 1 USD, conservé à six décimales avec sa date et le montant original. Aucun taux actuel n'est appliqué rétroactivement. Les remboursements utilisent le taux du paiement original et un arrondi cumulatif.
- Les tarifs sont figés sur les factures. Le tarif client réellement appliqué à la pesée est prioritaire. Modifier les tarifs ne modifie pas les pesées et factures historiques.
- La facturation constitue le chiffre d'affaires ; les règlements constituent les encaissements. Les dépenses engagées et les dépenses effectivement payées sont distinctes.
- Le coût transporteur commence comme estimation. « Confirmer la dette transporteur » exige une référence et un motif ; son éventuel écart de coût est daté. Le règlement fournisseur ne crée pas une seconde charge. La catégorie Shipping ne permet donc pas une dépense supplémentaire.
- Créances et dettes sont des positions à la date de fin ; les flux suivent la période sélectionnée. L'épargne est une affectation personnelle enregistrée explicitement, jamais la marge automatique de l'entreprise.

## Parcours de recette

1. Créer un client/une commande dans les émulateurs, réceptionner les articles, créer le colis et le peser à 4,75 lb.
2. Dans Comptabilité → Factures, sélectionner le colis et émettre sa facture : 28,50 USD, encaissement nul.
3. Dans Paiements, saisir 10 USD puis 18,50 USD avec deux références : statut partiel puis payé. Vérifier le solde dans la commande et l'espace client.
4. Rembourser une partie du premier paiement avec un motif : le solde client doit augmenter. Une annulation complète d'un paiement non remboursé produit une contrepassation, sans effacer l'original.
5. Tester un paiement HTG avec son taux daté ; tenter la même référence et un montant supérieur au solde : refus attendus.
6. Confirmer le coût transporteur puis le régler. Le coût ne doit pas augmenter au règlement. Ajouter une dépense non payée puis son règlement : la charge ne doit être comptée qu'une fois.
7. Comparer le tableau de bord et le CSV pour les mêmes dates. « Rapport PDF / Imprimer » ouvre un rapport imprimable : choisir Enregistrer au format PDF dans le navigateur.
8. Tester un compte client et un compte administratif sans permission d'écriture. Les règles doivent empêcher l'accès global et les écritures directes, même hors interface.

## Commandes

Prérequis : Node compatible avec le projet, Java pour Firebase Emulator Suite, dépendances racine et `functions`, navigateurs Playwright. Utiliser un projet `demo-shena` uniquement. En développement local, activer `VITE_USE_EMULATORS=true` dans `.env.local` et vérifier que tous les services pointent vers les émulateurs.

```sh
npm run build
npm run functions:build
npm run lint
npm test
npx firebase emulators:exec --project demo-shena --only auth,firestore,functions 'npx vitest run --project emulator tests/emulator/accounting.test.ts tests/emulator/order-creation.test.ts'
```

Pour la recette navigateur, démarrer les émulateurs dans un terminal, puis dans un second :

```sh
npm run emulators:fresh
```

```sh
npm run seed
npx playwright test --config playwright.accounting.config.ts
```

Le seed est réservé aux émulateurs. Le compte local de démonstration est `admin@shena-express.demo` / `AdminDemo#2026`. La recette automatisée de comptabilité exige aussi les variables `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` et `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` ; `emulators:exec` les fournit automatiquement.

Pour explorer vous-même les pages, laisser les émulateurs ouverts, exécuter le seed une seule fois puis lancer `VITE_USE_EMULATORS=true npm run dev` dans un autre terminal. Ouvrir l'adresse affichée par Vite, se connecter à `/admin/connexion` et choisir Comptabilité. Les données de démonstration restent locales. Éviter de lancer la recette automatisée en même temps que votre recette manuelle : les tests réinitialisent la base des émulateurs.

Vérification du 14 novembre 2026 : compilations frontend/Functions, ESLint et 27 tests unitaires réussis ; 41 tests sur la suite complète des émulateurs réussis après correction du rôle staff ; quatre parcours navigateur ordinateur/mobile réussis, dont affichage du paiement et du solde dans l'espace client. Le cycle historique Admin & Client réussit également. Le test historique de règles concernant `staff` passe désormais. Les parcours mobiles sont des simulations Chromium ; aucun test matériel Windows/Android ni nouvel APK n'a été effectué dans cette mission.

## Reprise et limites à valider avant publication

Aucune reprise automatique des anciens paiements n'est exécutée. Une commande déjà facturée/payée par l'ancien système est bloquée pour éviter un double comptage : prévoir un rapprochement validé et une migration distincte. Le tableau de bord couvre les factures émises dans le nouveau module et l'indique à l'écran.

Les colis regroupant plusieurs commandes et les anciennes commandes libellées HTG exigent une ventilation/reprise validée avant facturation USD. Les factures émises sont figées : les avoirs et corrections de poids après facturation ne disposent pas encore d'un parcours dédié. Les corrections de paiements passent par remboursement/annulation documentée. Les dépenses erronées ne disposent pas encore de contrepassation dédiée. Les justificatifs sont des références texte ou URL, sans nouveau stockage de fichiers.

Les exports réunissent les indicateurs, factures et opérations de la période, puis les créances et dettes détaillées à la date de fin, y compris celles émises avant la période. Le PDF repose sur l'impression du navigateur. Les abonnements chargent le registre autorisé en entier pour calculer les soldes ; une agrégation serveur et une pagination seront nécessaires pour un volume important.

Le défaut historique des permissions `staff` est corrigé. Les champs absents dans les claims/profils sont lus avec des valeurs par défaut. Les accès sont attribués collection par collection suivant les permissions `clients.*`, `orders.*`, `shipments.*`, `finance.*`, `audit.read` et `settings.write`, sans ajouter `staff` au groupe historique des utilisateurs disposant de tous les droits. Lorsque le profil utilisateur existe, sa permission doit aussi être active : un ancien token ne suffit pas après révocation ou désactivation. Les accès historiques `admin`, `operator` et `finance_manager` sont conservés. Les employés ne peuvent pas modifier les rôles ni les tarifs comptables réservés à l'administrateur. Le contexte administrateur ne demande plus les paramètres privés sans autorisation. La sauvegarde directe des paramètres fusionne atomiquement `settings/public` et `settings/private`, afin de conserver le tarif déjà enregistré. Aucun profil existant n'a été modifié. Pour vérifier toute la suite Firebase : `npm run test:emulators`.

## Correction du refus de pesée — publication Firebase

La comparaison avec les règles réellement publiées sur `shenaexpress-13924` a confirmé l’absence de la collection `notifications`. Le backend direct enregistre une notification dans la même transaction que le poids et le prix : cette écriture refusée annulait toute la pesée. Un push GitHub ou un déploiement Netlify ne publie pas les règles Firebase.

Les règles corrigées ont été publiées avec `firebase deploy --project shenaexpress-13924 --only firestore:rules --non-interactive`, puis relues via l’API Firebase pour vérifier leur identité exacte avec le fichier testé. Aucune donnée client/commande réelle n’a été écrite pour cette vérification et aucune Function n’a été déployée.

La version conserve les protections précédemment publiées : gestion des rôles réservée aux administrateurs, activation client limitée au propriétaire, existence du client vérifiée pour les jetons et audit réservé aux administrateurs ou aux employés avec `audit.read`. Des tests de régression couvrent ces protections et la pesée de 1,5 lb à 9 USD, avec notification et lecture par le client. Bilan : 44 tests Firebase, 27 tests unitaires, compilation et ESLint réussis.

Une copie des anciennes règles et les références de publication sont sauvegardées dans `backups/` (ignoré par Git). Les ajustements des règles et les tests sont versionnés dans le dépôt pour conserver la concordance avec la publication Firebase.

## Fichiers concernés

- `shared/accounting.ts`, `shared/finance.ts`, `shared/index.ts` : schémas, calculs et totaux communs.
- `functions/src/accounting.ts`, `functions/src/index.ts` : opérations serveur et export callable.
- `functions/src/finance.ts`, `functions/src/shipments.ts`, `src/lib/directBackend.ts` : synchronisation et protection des anciens points d'entrée ; tarifs futurs à la pesée.
- `firestore.rules` : accès et protection des documents gérés par la comptabilité.
- `src/pages/admin/Accounting.tsx`, `src/pages/admin/AdminContext.tsx`, `src/App.tsx`, `src/index.css` : pages, navigation et présentation responsive.
- `tests/unit/accounting.test.ts`, `tests/emulator/accounting.test.ts`, `tests/e2e/accounting.spec.ts`, `playwright.accounting.config.ts` : vérifications locales.
- `tests/emulator/staff-permissions.test.ts` : dix tests de permissions limitées, absence de claims, révocation, désactivation, protection des tarifs et compatibilité des anciens rôles.
- `tests/unit/domain-and-ui.test.tsx` : paramètres statiques pour isoler le test visuel de Firebase et éviter un abonnement réseau après la fermeture de jsdom.
- `tests/e2e/order-creation.spec.ts` : navigation client sur l'origine du serveur de test, sans port imposé.
- `docs/COMPTABILITE.md` : ce guide.
