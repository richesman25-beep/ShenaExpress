# SHENA Express pour Android

Application Capacitor qui embarque le build React local et utilise le backend Firebase existant. Une connexion Internet est nécessaire pour la connexion au compte et le suivi des colis.

- Nom : SHENA Express
- Identifiant Android : `com.shenaexpress.client`
- Compatibilité : Android 6.0 (API 23) et versions suivantes
- JDK 21, SDK Android 35, Build Tools 34.0.0, Node.js 22 ou supérieur

## Produire un APK de test

Installer le SDK via Android Studio, définir `ANDROID_HOME` ou renseigner `sdk.dir` dans `android/local.properties` (fichier local ignoré par Git), puis :

```bash
npm ci
npm run android:apk
```

Résultat : `android/app/build/outputs/apk/debug/app-debug.apk`.
Ce fichier est signé avec la clé de débogage de la machine. Pour mettre à jour une installation de test, conserver la même clé ; une clé différente nécessite une désinstallation qui efface les données locales.

Les variables publiques Firebase peuvent être définies dans `.env.local` avant la compilation ; à défaut, le projet utilise sa configuration Firebase existante. Ne jamais activer les émulateurs pour un APK destiné à un téléphone réel.

## Installer

Transférer l’APK sur le téléphone, l’ouvrir et autoriser cette source d’installation à la demande d’Android. Ou utiliser `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

## Modifier avec Android Studio

```bash
npm run android:sync
npm run android:open
```

Après chaque modification du frontend, relancer `npm run android:sync` avant de compiler le projet Android.

## Publication

Le build debug est destiné aux essais. Pour publier, créer et conserver une clé de publication privée dans Android Studio (Build > Generate Signed Bundle / APK). Ne jamais versionner la clé ni ses mots de passe. Générer un APK release signé pour une distribution directe, ou un Android App Bundle signé pour Google Play, et adapter le SDK cible aux exigences Play au moment de publier.

Les notifications existantes restent visibles dans l’application. Les notifications push Android et l’ouverture des liens de réinitialisation du mot de passe directement dans l’application ne sont pas configurées dans cette première version.

Vérifier sur un téléphone : connexion/déconnexion, persistance de session, liste et détail des colis, retour Android, ouverture de WhatsApp et liens de récupération du mot de passe.
