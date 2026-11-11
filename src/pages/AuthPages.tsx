import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Lock, UserCheck, ShieldCheck, KeyRound, AlertCircle, CheckCircle2, ArrowLeft } from "lucide-react";
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
}: {
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
  const { t } = useI18n();
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <AuthShell
      eyebrow={t.brand.eyebrowClient}
      title={t.auth.clientTitle}
      subtitle={t.auth.clientSubtitle}
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
          <label htmlFor="client-identifier" className="block text-xs font-bold text-slate-700 mb-1.5">
            {t.auth.identifierLabel}
          </label>
          <div className="relative">
            <input
              id="client-identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              required
              disabled={submitting || firebaseState.mode === "unconfigured"}
              placeholder={t.auth.identifierPlaceholder}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-royal-600"
            />
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Identifiant remis par SHENA Express (ex. <code className="font-semibold">SHE-CLIENT-001</code>).
          </p>
        </div>

        <div>
          <label htmlFor="client-password" className="block text-xs font-bold text-slate-700 mb-1.5">
            {t.auth.passwordLabel}
          </label>
          <div className="relative flex items-center">
            <input
              id="client-password"
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
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-royal-600 px-4 py-3 text-sm font-bold text-white shadow-xs transition hover:bg-royal-700 disabled:opacity-60"
        >
          <UserCheck className="h-4 w-4" aria-hidden="true" />
          <span>{submitting ? t.auth.signingIn : t.auth.signIn}</span>
        </button>
      </form>
    </AuthShell>
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
