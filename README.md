# SHENA Express — Plateforme Logistique & Suivi de Colis

Plateforme web complète (React, TypeScript, Vite, Tailwind CSS et Firebase) destinée à la gestion des clients, commandes, articles reçus, colis, expéditions, statuts de suivi, dates estimées et suivi financier manuel pour **SHENA Express**.

---

## 1. Architecture & Fonctionnalités livrées

### Séparation stricte des espaces et des rôles
- **Espace Client (`/connexion`, `/espace-client`)** :
  - Connexion par **identifiant client unique** (ex. `SHE-CLIENT-001`) ou par adresse e-mail vérifiée.
  - Résolution serveur sécurisée (`clientSignIn`) sans **jamais** exposer les adresses e-mail des utilisateurs ni permettre leur énumération publique, avec limitation de débit par identifiant et par adresse IP.
  - Tableau de bord personnel (commandes, articles commandés, articles reçus, colis en transit, disponibles, livrés, prochaines dates estimées, dernières mises à jour).
  - Consultation détaillée des commandes (articles commandés vs reçus vs restant à recevoir, colis associés, frais et paiements si activés) et du suivi chronologique de chaque colis avec indicateur visuel de progression en 6 étapes.
  - Bouton **« Contacter SHENA Express sur WhatsApp »** avec message prérempli modifiable avant envoi (`https://wa.me/...`), sans aucune donnée sensible dans l'URL.
- **Espace Administrateur & Employés (`/admin/connexion`, `/admin`)** :
  - Vue d'ensemble avec indicateurs calculés en temps réel, alertes de retard et filtres par période, statut et client.
  - Gestion complète des clients : attribution séquentielle d'identifiants uniques jamais réutilisés (`SHE-CLIENT-001`…), prévention des doublons, activation/désactivation avec révocation immédiate des sessions, envoi d'invitation e-mail, génération de lien d'accès à usage unique (assistance sans connaître le mot de passe), notes administratives privées.
  - Gestion des commandes et réceptions : distinction stricte entre articles **commandés**, **effectivement reçus à l'entrepôt**, **emballés** et **expédiés**.
  - Gestion des colis : regroupement ou répartition d'articles sur un ou plusieurs colis avec blocage du double comptage, poids, dimensions, mode aérien/maritime, dates estimées et effectives.
  - Suivi chronologique à 15 statuts configurables : enregistrement systématique de l'ancien statut, du nouveau statut, de l'horodatage, de l'auteur et séparation stricte entre notes publiques et notes internes (`shipmentEventsPrivate`).
  - Module financier manuel optionnel : frais de transport, suppléments, réductions, paiements manuels (espèces, virement, MonCash, NatCash, etc.), calcul exact du solde sans mélange automatique USD / HTG, journalisation complète.
  - Gestion des paramètres de l'entreprise, des notifications (in-app et e-mail optionnel) et des comptes employés à permissions fines (`clients.read`, `orders.write`, etc.).

### Structure Firestore (`firestore.rules` & `firestore.indexes.json`)
| Collection | Contenu | Lecture | Écriture |
|---|---|---|---|
| `users/{uid}` | Profil et rôle (`admin`, `staff`, `client`) | Utilisateur lui-même ou `clients.read` | Serveur uniquement (Cloud Functions / Admin SDK) |
| `clients/{clientId}` | Fiche client autorisée | Client propriétaire (`clientUid`) ou `clients.read` | Serveur uniquement |
| `clientNotes/{clientId}` | Notes administratives privées sur le client | Personnel autorisé (`clients.read`) — **jamais le client** | Serveur uniquement |
| `orders/{orderId}` | Commande, lignes d'articles et compteurs | Client propriétaire ou `orders.read` | Serveur uniquement |
| `orderPrivate/{orderId}` | Notes internes de commande | Personnel autorisé (`orders.read`) — **jamais le client** | Serveur uniquement |
| `shipments/{shipmentId}` | Colis, numéro de suivi, lignes, dates | Client propriétaire ou `shipments.read` | Serveur uniquement |
| `shipmentPrivate/{shipmentId}` | Notes internes de colis | Personnel autorisé (`shipments.read`) — **jamais le client** | Serveur uniquement |
| `shipmentEvents/{eventId}` | Chronologie publique du suivi | Client propriétaire ou `shipments.read` / `orders.read` | Serveur uniquement |
| `shipmentEventsPrivate/{eventId}` | Notes internes liées à un événement | Personnel autorisé uniquement | Serveur uniquement |
| `orderFinance/{orderId}` | Frais, total dû, total payé, solde | Client propriétaire (si module actif) ou `finance.read` | Serveur uniquement |
| `paymentRecords/{paymentId}` | Historique des paiements manuels | Client propriétaire (si module actif) ou `finance.read` | Serveur uniquement |
| `notifications/{notificationId}` | Notifications destinées à un utilisateur | Destinataire (`recipientUid`) | Marquage `readAt` par le destinataire ; création serveur |
| `settings/public` | Coordonnées publiques, WhatsApp, devise, libellés | Public (nécessaire à la page de connexion) | Serveur uniquement (`settings.write`) |
| `settings/private` | Configuration interne des notifications | Personnel (`admin` / `staff`) | Serveur uniquement (`settings.write`) |
| `auditLogs/{logId}` | Journal d'audit administratif | Personnel autorisé (`audit.read`) | Serveur uniquement |

---

## 2. Prérequis & Installation

- **Node.js** 22 LTS ou 24 LTS et **npm** 10+.
- **Java JDK 21+** (requis uniquement pour lancer `Firebase Emulator Suite` en local).

```bash
# 1. Installer les dépendances du frontend et des outils de test
npm install

# 2. Installer les dépendances des Cloud Functions
npm --prefix functions install
```

---

## 3. Commandes de démarrage et de vérification

### Démarrer en mode développement local (sans identifiants Firebase réels)
En mode développement, si `.env.local` n'est pas renseigné (ou si `VITE_USE_EMULATORS=true`), l'application se connecte automatiquement aux émulateurs locaux (`demo-shena`) et affiche une bannière explicite de démonstration :

```bash
# Terminal 1 : démarrer les émulateurs Firebase (Auth: 9099, Firestore: 8080, Functions: 5001, UI: 4000)
npm run emulators:fresh

# Terminal 2 (optionnel) : initialiser le compte admin de démo et les paramètres exemples
npm run seed

# Terminal 3 : lancer le serveur de développement Vite (http://localhost:5173)
npm run dev
```

### Vérifications et tests automatisés
```bash
# Vérification du typage TypeScript (frontend + shared + functions)
npm run typecheck
npm run functions:build

# Build de production
npm run build

# Tests unitaires et composants (Vitest + Testing Library)
npm test

# Tests des règles de sécurité Firestore et parcours complet sur Firebase Emulator Suite
npm run test:emulators

# Tests responsives mobile Android & desktop (Playwright)
npm run test:e2e
```

---

## 4. Création et configuration du projet Firebase (Production)

1. Rendez-vous sur [console.firebase.google.com](https://console.firebase.google.com/) et créez un projet Firebase (ex. `shena-express-prod`).
2. Activez le plan **Blaze (Pay as you go)**, requis par Firebase pour déployer des Cloud Functions v2 (les quotas gratuits couvrent largement un usage PME).
3. **Activer Firebase Authentication** :
   - Menu **Authentication > Sign-in method** : activez le fournisseur **Adresse e-mail / mot de passe** (*Email/Password*).
   - Désactivez l'inscription publique libre dans **Authentication > Settings > User actions** (*Enable create (sign-up)* : faites gérer la création des comptes par les Cloud Functions, ou conservez l'option par défaut car aucun compte créé sans la Cloud Function `createClient` ou `setStaffRole` ne reçoit de rôle et se voit refuser tout accès par les règles Firestore).
   - Dans **Authentication > Templates**, personnalisez le modèle d'e-mail **Réinitialisation du mot de passe** en français et ajoutez votre domaine de production dans **Authentication > Settings > Authorized domains**.
4. **Activer Cloud Firestore** :
   - Menu **Firestore Database > Créer une base de données** en mode **Production**, région `nam5 (us-central)` ou `us-east1`.
5. **Variables d'environnement** :
   - Copiez `.env.example` vers `.env.local` et renseignez les clés Web Firebase (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, etc.).
   - Copiez `functions/.env.example` vers `functions/.env` et renseignez `WEB_API_KEY` (la même clé API Web Firebase), `APP_URL=https://votre-domaine.com` et `FUNCTIONS_REGION=us-east1`.

---

## 5. Déploiement des règles Firestore, des index et des Cloud Functions

Associez votre projet Firebase réel puis déployez :

```bash
npx firebase login
npx firebase use --add shena-express-prod

# Déployer uniquement les règles de sécurité et les index Firestore
npx firebase deploy --only firestore:rules,firestore:indexes

# Déployer les Cloud Functions serveur
npx firebase deploy --only functions
```

---

## 6. Création sécurisée du premier administrateur

Aucun utilisateur ne reçoit jamais automatiquement le rôle administrateur. Pour créer ou promouvoir le premier administrateur en production :

1. Dans la console Google Cloud / Firebase (**Paramètres du projet > Comptes de service**), générez une clé privée JSON temporaire et placez-la **hors du dépôt Git** (ex. `~/shena-admin-key.json`).
2. Exécutez le script d'amorçage :
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS="$HOME/shena-admin-key.json" \
   FIREBASE_PROJECT_ID="shena-express-prod" \
   ADMIN_EMAIL="direction@votre-domaine.com" \
   ADMIN_NAME="Direction SHENA Express" \
   node scripts/bootstrap-admin.mjs
   ```
3. Le script crée le compte (s'il n'existe pas), attribue le custom claim `{ role: "admin" }`, crée l'entrée `users/{uid}`, journalise l'opération dans `auditLogs` et affiche un lien sécurisé à usage unique pour définir le mot de passe.
4. **Supprimez immédiatement le fichier de clé JSON** de votre poste après l'opération.

---

## 7. Déploiement du Frontend (Firebase Hosting ou Netlify)

### Option A — Firebase Hosting
```bash
npm run build
npx firebase deploy --only hosting
```

### Option B — Netlify
Le fichier `netlify.toml` est déjà configuré (redirections SPA et en-têtes de sécurité HTTP) :
1. Connectez le dépôt Git à Netlify.
2. Commande de build : `npm run build` — dossier publié : `dist`.
3. Ajoutez les variables `VITE_FIREBASE_*` dans **Site configuration > Environment variables** (avec `VITE_USE_EMULATORS=false`).

### Configuration du domaine personnalisé
1. Dans Firebase Hosting (**Hosting > Ajouter un domaine personnalisé**) ou Netlify (**Domain management > Add custom domain**), saisissez votre domaine (ex. `suivi.shena-express.com`).
2. Créez les enregistrements DNS demandés (`A` / `CNAME` et `TXT` de vérification) chez votre registraire.
3. Attendez l'émission automatique du certificat TLS Let's Encrypt.
4. Ajoutez ce domaine dans **Firebase Console > Authentication > Settings > Authorized domains** et mettez à jour `APP_URL` dans `functions/.env`.

---

## 8. Sauvegarde et Restauration

### Sauvegardes gérées Google Cloud (recommandé en production)
```bash
# Activer la restauration à un instant donné (PITR) sur Firestore
gcloud firestore databases update --database="(default)" --enable-pitr --project=shena-express-prod

# Exporter un instantané complet vers un bucket Cloud Storage privé
gcloud firestore export gs://shena-express-backups/$(date +%F) --project=shena-express-prod

# Restaurer depuis un instantané
gcloud firestore import gs://shena-express-backups/2026-11-10 --project=shena-express-prod
```

### Export / Import JSON portable (script inclus)
```bash
# Sauvegarder toutes les collections dans un fichier JSON local
GOOGLE_APPLICATION_CREDENTIALS=/chemin/cle.json FIREBASE_PROJECT_ID=shena-express-prod \
  node scripts/backup-firestore.mjs export ./backups/shena-$(date +%F).json

# Restaurer depuis un fichier JSON
GOOGLE_APPLICATION_CREDENTIALS=/chemin/cle.json FIREBASE_PROJECT_ID=shena-express-prod \
  node scripts/backup-firestore.mjs restore ./backups/shena-2026-11-10.json
```

---

## 9. Paramètres restant à renseigner & Checklist avant mise en production

### Paramètres externes à configurer par SHENA Express
- [ ] Créer le projet Firebase de production et renseigner `.env.local` et `functions/.env`.
- [ ] Exécuter `scripts/bootstrap-admin.mjs` pour créer le premier compte administrateur réel.
- [ ] Se connecter à `/admin/parametres` et renseigner les vraies coordonnées de l'entreprise :
  - Numéro WhatsApp officiel au format international (ex. `+509...`).
  - Adresse e-mail professionnelle de contact.
  - Adresse de l'entrepôt de réception et du point de retrait en Haïti.
  - Horaires d'ouverture, devise principale (`USD` ou `HTG`) et instructions de retrait.
- [ ] *(Optionnel)* Installer l'extension Firebase **Trigger Email from Firestore** et renseigner `MAIL_COLLECTION=mail` dans `functions/.env` si vous souhaitez envoyer des notifications automatiques par e-mail en plus des notifications dans l'application.

### Checklist finale de sécurité avant ouverture aux clients
- [ ] `VITE_USE_EMULATORS` est défini à `false` (ou absent) dans l'environnement de build de production.
- [ ] Les règles `firestore.rules` et les index `firestore.indexes.json` sont déployés.
- [ ] Aucun fichier `.env`, clé de compte de service `.json` ou secret n'est présent dans `git status`.
- [ ] Le domaine personnalisé est ajouté aux *Authorized domains* de Firebase Authentication.
- [ ] `npm run test:all` passe intégralement au vert.
