import { FlightLoader } from "@/components/FlightLoader";
import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import {
  Eye,
  EyeOff,
  Lock,
  UserCheck,
  ShieldCheck,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Copy,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useI18n } from "@/i18n";
import { firebaseState } from "@/lib/firebase";
import { api, formatError } from "@/lib/api";
import { ShenaLogo, WhatsappContactButton } from "@/components/ui";

function ConfigErrorBanner() {
  if (firebaseState.mode === "unconfigured") {
    return (
      <div role="alert" className="bg-rose-900 text-white px-4 py-2.5 text-xs font-medium text-center">
        {firebaseState.configError}
      </div>
    );
  }
  return null;
}

function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
  busy = false,
}: {
  busy?: boolean;
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const { settings } = useSettings();
  const { locale, setLocale, locales } = useI18n();

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <ConfigErrorBanner />
      {busy && <FlightLoader overlay label="Connexion à l’administration…" />}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
          <Link to="/connexion" aria-label="Accueil SHENA Express">
            <ShenaLogo subtitle="Logistique & suivi" />
          </Link>
          <div className="flex items-center gap-3">
            <label htmlFor="lang-select" className="sr-only">
              Langue
            </label>
            <select
              id="lang-select"
              value={locale}
              onChange={(e) => setLocale(e.target.value as "fr" | "ht" | "en")}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
            >
              {Object.entries(locales).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-5xl grid gap-8 lg:grid-cols-12 items-center">
          {/* Colonne identité de marque */}
          <div className="lg:col-span-6 rounded-3xl bg-navy-900 text-white p-7 sm:p-9 shadow-xl relative overflow-hidden">
            <div className="relative z-10 space-y-5">
              <ShenaLogo variant="light" size="lg" subtitle="Expédition internationale" />
              <p className="text-xs font-bold uppercase tracking-widest text-amber-300">{eyebrow}</p>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight leading-snug">
                Suivez chaque commande et chaque colis, de la réception en entrepôt jusqu&apos;à la livraison en Haïti.
              </h2>
              <ul className="space-y-2.5 text-sm text-slate-200 pt-1">
                <li className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-gold-500" aria-hidden="true" />
                  <span>Identifiant client personnel et espace privé sécurisé</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-gold-500" aria-hidden="true" />
                  <span>Distinction claire : articles commandés, reçus, expédiés et livrés</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-gold-500" aria-hidden="true" />
                  <span>Chronologie vérifiée et contact direct WhatsApp par commande</span>
                </li>
              </ul>
              {settings.serviceMessage && (
                <div className="rounded-2xl border border-white/15 bg-white/10 p-3.5 text-xs text-slate-100">
                  <span className="font-bold text-amber-300">Information service : </span>
                  {settings.serviceMessage}
                </div>
              )}
              {(settings.address || settings.openingHours) && (
                <div className="pt-2 border-t border-white/10 text-xs text-slate-300 space-y-1">
                  {settings.address && <div>Adresse : {settings.address}</div>}
                  {settings.serviceArea && <div>Zone desservie : {settings.serviceArea}</div>}
                  {settings.openingHours && <div>Horaires : {settings.openingHours}</div>}
                </div>
              )}
            </div>
          </div>

          {/* Carte de connexion */}
          <div className="lg:col-span-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
              <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-royal-600">
                {eyebrow}
              </span>
              <h1 className="mt-3 text-2xl font-extrabold text-navy-900">{title}</h1>
              <p className="mt-1.5 text-sm text-slate-600">{subtitle}</p>
              <div className="mt-6">{children}</div>
              {footer && <div className="mt-6 border-t border-slate-200 pt-4">{footer}</div>}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ------------------------------------------------------ Connexion Client */
export function ClientLoginPage() {
  const { user, claims, loading, signInClient, isBackOffice } = useAuth();
  const { t, locale, setLocale, locales } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const oobFromUrl = searchParams.get("oobCode");
  const prefillClientId = searchParams.get("clientId") ?? "";

  const [identifier, setIdentifier] = useState(prefillClientId);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (oobFromUrl) {
    return (
      <Navigate
        to={`/definir-mot-de-passe?oobCode=${encodeURIComponent(oobFromUrl)}${
          prefillClientId ? `&clientId=${encodeURIComponent(prefillClientId)}` : ""
        }`}
        replace
      />
    );
  }

  if (!loading && user && claims?.role === "client") {
    return <Navigate to="/espace-client" replace />;
  }
  if (!loading && user && isBackOffice) {
    return <Navigate to="/admin" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanId = identifier.trim();
    if (!cleanId) {
      setError("Veuillez saisir votre identifiant client (ex. SHE-CLIENT-001).");
      return;
    }
    if (!password) {
      setError("Veuillez saisir votre mot de passe.");
      return;
    }
    setSubmitting(true);
    try {
      await signInClient(cleanId, password);
      navigate("/espace-client", { replace: true });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="image-login">
      <main id="main-content" className="image-login-frame" aria-labelledby="image-login-title">
        <img className="image-login-original" src="/images/connexion-originale.png" alt="" width="1671" height="941" fetchPriority="high" />
        <h1 id="image-login-title" className="sr-only">Connexion client</h1>
        <label className="sr-only" htmlFor="image-login-language">Langue</label>
        <select id="image-login-language" className={`image-login-language ${locale === "fr" ? "image-login-transparent" : ""}`}
          value={locale} onChange={e => setLocale(e.target.value as "fr" | "ht" | "en")}>
          {Object.entries(locales).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
        </select>
        <form onSubmit={handleSubmit} noValidate aria-label="Connexion client" aria-busy={submitting}>
          <label htmlFor="client-identifier" className="sr-only">{t.auth.identifierLabel}</label>
          <input id="client-identifier" name="identifier" type="text" autoComplete="username" required
            disabled={submitting || firebaseState.mode === "unconfigured"}
            aria-describedby={error ? "image-login-error" : undefined}
            className={`image-login-input image-login-identifier ${identifier ? "image-login-filled" : ""}`}
            value={identifier} onChange={e => setIdentifier(e.target.value)} />
          <label htmlFor="client-password" className="sr-only">{t.auth.passwordLabel}</label>
          <input id="client-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required
            disabled={submitting || firebaseState.mode === "unconfigured"}
            aria-describedby={error ? "image-login-error" : undefined}
            className="image-login-input image-login-password"
            value={password} onChange={e => setPassword(e.target.value)} />
          <button type="button" className="image-login-eye" onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword} aria-pressed={showPassword} />
          <button type="submit" className="image-login-submit" disabled={submitting || firebaseState.mode === "unconfigured"}>
            <span className="sr-only">{submitting ? t.auth.signingIn : t.auth.signIn}</span>
            {submitting && <span className="image-login-spinner" aria-hidden="true" />}
          </button>
          {error && <p role="alert" id="image-login-error" className="image-login-error">{error}</p>}
        </form>
        <Link className="image-login-forgot" to="/mot-de-passe-oublie"><span className="sr-only">{t.auth.forgotPassword}</span></Link>
      </main>
      {submitting && <FlightLoader overlay label="Connexion à votre espace client…" />}
    </div>
  );
}

/* ----------------------------------------------- Connexion Administrateur */
export function AdminLoginPage() {
  const { user, claims, loading, signInStaff, isBackOffice } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user && isBackOffice) {
    return <Navigate to="/admin" replace />;
  }
  if (!loading && user && claims?.role === "client") {
    return <Navigate to="/espace-client" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Veuillez saisir votre adresse e-mail professionnelle.");
      return;
    }
    if (!password) {
      setError("Veuillez saisir votre mot de passe.");
      return;
    }
    setSubmitting(true);
    try {
      await signInStaff(email, password);
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      busy={submitting}
      eyebrow={t.brand.eyebrowAdmin}
      title={t.auth.adminTitle}
      subtitle={t.auth.adminSubtitle}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
          <Link to="/mot-de-passe-oublie" className="font-semibold text-royal-600 hover:underline">
            {t.auth.forgotPassword}
          </Link>
        </div>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-medium text-rose-900"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label htmlFor="admin-email" className="block text-xs font-bold text-slate-700 mb-1.5">
            {t.auth.emailLabel}
          </label>
          <input
            id="admin-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={submitting || firebaseState.mode === "unconfigured"}
            placeholder={t.auth.emailPlaceholder}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-royal-600"
          />
        </div>

        <div>
          <label htmlFor="admin-password" className="block text-xs font-bold text-slate-700 mb-1.5">
            {t.auth.passwordLabel}
          </label>
          <div className="relative flex items-center">
            <input
              id="admin-password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              required
              disabled={submitting || firebaseState.mode === "unconfigured"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white ps-3.5 pe-11 py-2.5 text-sm text-slate-900 focus:border-royal-600"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
              aria-pressed={showPassword}
              className="absolute right-2.5 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            >
              {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting || firebaseState.mode === "unconfigured"}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-navy-800 disabled:opacity-60"
        >
          <ShieldCheck className="h-4 w-4 text-amber-300" aria-hidden="true" />
          <span>{submitting ? t.auth.signingIn : "Se connecter à l'administration"}</span>
        </button>
      </form>
    </AuthShell>
  );
}

/* ------------------------------------------- Récupération de mot de passe */
export function PasswordResetPage() {
  const { t } = useI18n();
  const [identifier, setIdentifier] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSent(false);
    if (!identifier.trim()) {
      setError("Veuillez saisir votre identifiant client ou votre adresse e-mail.");
      return;
    }
    setSubmitting(true);
    try {
      await api.requestPasswordReset({ identifier: identifier.trim() });
      setSent(true);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="ASSISTANCE COMPTE"
      title={t.auth.resetTitle}
      subtitle={t.auth.resetSubtitle}
      footer={
        <div className="flex items-center justify-between text-xs">
          <Link to="/connexion" className="inline-flex items-center gap-1 font-semibold text-royal-600 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Retour à la connexion</span>
          </Link>
        </div>
      }
    >
      <div className="space-y-5">
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-medium text-rose-900"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
          {sent && (
            <div
              role="status"
              className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs font-medium text-emerald-950"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
              <span>{t.auth.resetSent}</span>
            </div>
          )}

          <div>
            <label htmlFor="reset-identifier" className="block text-xs font-bold text-slate-700 mb-1.5">
              Identifiant client ou adresse e-mail
            </label>
            <input
              id="reset-identifier"
              type="text"
              required
              disabled={submitting}
              placeholder="SHE-CLIENT-001 ou client@domaine.com"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-royal-600"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-royal-600 px-4 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-royal-700 disabled:opacity-60"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            <span>{submitting ? "Envoi en cours…" : t.auth.sendReset}</span>
          </button>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2.5">
          <div className="flex items-center gap-2 text-xs font-bold text-navy-900">
            <Lock className="h-4 w-4 text-royal-600" aria-hidden="true" />
            <span>{t.auth.noEmailHelpTitle}</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">{t.auth.noEmailHelpBody}</p>
          <div className="pt-1">
            <WhatsappContactButton clientId={identifier.trim() || undefined} compact />
          </div>
        </div>
      </div>
    </AuthShell>
  );
}

/* ---------------------------- Définition / Réinitialisation Mot de passe */
export function PasswordSetupPage() {
  const [searchParams] = useSearchParams();
  const oobCode = searchParams.get("oobCode")?.trim() ?? "";
  const urlClientId = searchParams.get("clientId")?.trim() ?? "";

  const [verifying, setVerifying] = useState<boolean>(Boolean(oobCode));
  const [tokenValid, setTokenValid] = useState<boolean>(false);
  const [clientId, setClientId] = useState<string>(urlClientId);
  const [fullName, setFullName] = useState<string>("");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!oobCode) {
      setVerifying(false);
      setTokenValid(false);
      setError("Lien incomplet : aucun code de sécurité n'est présent dans l'adresse.");
      return;
    }
    let cancelled = false;
    setVerifying(true);
    setError(null);
    api
      .verifyPasswordSetupToken({ oobCode })
      .then((res) => {
        if (cancelled) return;
        setTokenValid(res.valid);
        setClientId(res.clientId);
        setFullName(res.fullName);
      })
      .catch((err) => {
        if (cancelled) return;
        setTokenValid(false);
        setError(formatError(err));
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => {
      cancelled = true;
    };
  }, [oobCode]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError("Le mot de passe doit contenir au moins 8 caractères, dont au moins une lettre et un chiffre.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("La confirmation du mot de passe ne correspond pas.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.completePasswordSetup({ oobCode, newPassword });
      setClientId(res.clientId);
      setCompleted(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      eyebrow="ACTIVATION & SÉCURITÉ DU COMPTE"
      title={completed ? "Mot de passe enregistré" : "Définir votre mot de passe"}
      subtitle={
        completed
          ? "Votre compte SHENA Express est maintenant actif. Vous pouvez vous connecter avec votre identifiant client."
          : "Choisissez un mot de passe personnel sécurisé pour accéder à votre espace de suivi."
      }
      footer={
        <div className="flex items-center justify-between text-xs">
          <Link
            to={clientId ? `/connexion?clientId=${encodeURIComponent(clientId)}` : "/connexion"}
            className="inline-flex items-center gap-1 font-semibold text-royal-600 hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Aller à la page de connexion</span>
          </Link>
        </div>
      }
    >
      {verifying ? (
        <div className="py-8 text-center text-sm font-semibold text-slate-600">
          Vérification du lien de sécurité…
        </div>
      ) : completed ? (
        <div className="space-y-4">
          <div
            role="status"
            className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-xs font-medium text-emerald-950"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
            <div>
              <div className="font-bold">Votre mot de passe a été configuré avec succès.</div>
              <div className="mt-1 text-emerald-900">
                Ce lien à usage unique est désormais désactivé. Conservez précieusement votre identifiant client ci-dessous.
              </div>
            </div>
          </div>

          {clientId && (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase text-slate-500">Votre identifiant client</div>
                <div className="text-lg font-extrabold text-navy-900">{clientId}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(clientId);
                  setCopiedId(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-navy-900 hover:bg-slate-100"
              >
                <Copy className="h-3.5 w-3.5 text-royal-600" aria-hidden="true" />
                <span>{copiedId ? "Identifiant copié" : "Copier l'identifiant"}</span>
              </button>
            </div>
          )}

          <Link
            to={clientId ? `/connexion?clientId=${encodeURIComponent(clientId)}` : "/connexion"}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-royal-600 px-4 py-3 text-sm font-bold text-white shadow-xs hover:bg-royal-700"
          >
            <UserCheck className="h-4 w-4" aria-hidden="true" />
            <span>Se connecter à mon espace client</span>
          </Link>
        </div>
      ) : !tokenValid ? (
        <div className="space-y-4">
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-medium text-rose-900"
          >
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
            <span>{error ?? "Ce lien de configuration est invalide, expiré ou a déjà été utilisé."}</span>
          </div>
          <p className="text-xs text-slate-600 leading-relaxed">
            Pour votre sécurité, chaque lien de configuration est à usage unique et limité dans le temps. Vous pouvez demander un nouveau lien ou contacter l&apos;équipe SHENA Express.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/mot-de-passe-oublie"
              className="inline-flex items-center gap-1.5 rounded-xl bg-royal-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-royal-700"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Demander un nouveau lien</span>
            </Link>
            <WhatsappContactButton clientId={clientId || undefined} compact />
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs font-medium text-rose-900"
            >
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold uppercase text-slate-500">Compte client</div>
              <div className="text-sm font-extrabold text-navy-900">
                {clientId} {fullName ? `— ${fullName}` : ""}
              </div>
            </div>
            {clientId && (
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(clientId);
                  setCopiedId(true);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100"
              >
                <Copy className="h-3.5 w-3.5 text-royal-600" aria-hidden="true" />
                <span>{copiedId ? "Copié" : "Copier l'ID"}</span>
              </button>
            )}
          </div>

          <div>
            <label htmlFor="setup-new-password" className="block text-xs font-bold text-slate-700 mb-1.5">
              Nouveau mot de passe *
            </label>
            <div className="relative flex items-center">
              <input
                id="setup-new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                disabled={submitting}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Au moins 8 caractères (lettres et chiffres)"
                className="w-full rounded-xl border border-slate-300 bg-white ps-3.5 pe-11 py-2.5 text-sm text-slate-900 focus:border-royal-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                className="absolute right-2.5 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="setup-confirm-password" className="block text-xs font-bold text-slate-700 mb-1.5">
              Confirmer le mot de passe *
            </label>
            <input
              id="setup-confirm-password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              disabled={submitting}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-royal-600"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-royal-600 px-4 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-royal-700 disabled:opacity-60"
          >
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            <span>{submitting ? "Activation en cours…" : "Enregistrer mon mot de passe"}</span>
          </button>
        </form>
      )}
    </AuthShell>
  );
}
