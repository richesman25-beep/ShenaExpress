import { useEffect, useMemo, useState, type FormEvent } from "react";
import { doc, getDoc } from "firebase/firestore";
import {
  Plus,
  Search,
  UserPlus,
  Edit3,
  Mail,
  KeyRound,
  Ban,
  CheckCircle2,
  Eye,
  Trash2,
  PackageCheck,
  Copy,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { getFirebaseDb } from "@/lib/firebase";
import { api, formatError } from "@/lib/api";
import {
  STATUS_CODES,
  CURRENCIES,
  CLIENT_ACCESS_LABELS,
  getClientAccessState,
  todayIso,
  formatIsoDate,
  parseMoney,
  formatMoney,
  type ClientDoc,
  type OrderDoc,
  type StatusCode,
  type TransportMode,
  type Currency,
} from "@shared/index";
import {
  StatusBadge,
  TransportBadge,
  Modal,
  ConfirmDialog,
  EmptyState,
  TrackingTimeline,
  useToast,
} from "@/components/ui";
import { useAdminData } from "./AdminContext";

/* =========================================================== 6.B. CLIENTS */
function ClientAccessBadge({ client }: { client: Pick<ClientDoc, "status" | "passwordConfigured"> }) {
  const state = getClientAccessState(client);
  const styles =
    state === "active"
      ? "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-300"
      : state === "pending_setup"
        ? "bg-amber-50 text-amber-900 ring-1 ring-amber-300"
        : "bg-rose-50 text-rose-900 ring-1 ring-rose-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${styles}`}>
      {CLIENT_ACCESS_LABELS[state]}
    </span>
  );
}

export function AdminClientsPage() {
  const { can } = useAuth();
  const { clients, orders } = useAdminData();
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ClientDoc | null>(null);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const [privateNotes, setPrivateNotes] = useState<string>("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [accessLink, setAccessLink] = useState<{
    clientId: string;
    fullName?: string;
    link: string;
    isNewAccount?: boolean;
  } | null>(null);
  const [accessFeedback, setAccessFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
    link?: string;
  } | null>(null);
  const [accessBusy, setAccessBusy] = useState<string | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<ClientDoc | null>(null);
  const [busy, setBusy] = useState(false);

  const canWrite = can("clients.write");
  const inspecting = useMemo(
    () => (inspectingId ? clients.find((c) => c.clientId === inspectingId) ?? null : null),
    [clients, inspectingId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clients.filter((c) => {
      const accessState = getClientAccessState(c);
      if (statusFilter !== "all" && accessState !== statusFilter) return false;
      if (!q) return true;
      return (
        c.clientId.toLowerCase().includes(q) ||
        c.fullName.toLowerCase().includes(q) ||
        c.phone.toLowerCase().includes(q) ||
        (c.whatsapp ?? "").toLowerCase().includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) ||
        (c.city ?? "").toLowerCase().includes(q)
      );
    });
  }, [clients, search, statusFilter]);

  useEffect(() => {
    if (!inspectingId) return;
    setPrivateNotes("");
    setAccessFeedback(null);
    getDoc(doc(getFirebaseDb(), "clientPrivate", inspectingId))
      .then((snap) => {
        if (snap.exists()) {
          setPrivateNotes((snap.data().notes as string) ?? "");
          return;
        }
        return getDoc(doc(getFirebaseDb(), "clientNotes", inspectingId)).then((legacy) => {
          if (legacy.exists()) setPrivateNotes((legacy.data().notes as string) ?? "");
        });
      })
      .catch(() => undefined);
  }, [inspectingId]);

  const handleToggleStatus = async () => {
    if (!confirmToggle) return;
    setBusy(true);
    try {
      const nextActive = confirmToggle.status !== "active";
      await api.setClientStatus({ clientId: confirmToggle.clientId, active: nextActive });
      notify(
        "success",
        `Accès ${confirmToggle.clientId} ${nextActive ? "réactivé" : "désactivé"} avec succès.`,
      );
      setConfirmToggle(null);
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyClientId = (clientId: string) => {
    navigator.clipboard?.writeText(clientId);
    setAccessFeedback({
      type: "info",
      message: `Identifiant client ${clientId} copié dans le presse-papiers.`,
    });
    notify("info", `Identifiant ${clientId} copié.`);
  };

  const handleSendInvite = async (client: ClientDoc) => {
    setAccessBusy("invite");
    setAccessFeedback(null);
    try {
      const res = await api.sendClientInvite({ clientId: client.clientId });
      if (res.emulated && res.link) {
        setAccessFeedback({
          type: "info",
          message:
            "Mode développement local (sans serveur d'e-mail) : aucun e-mail n'a été envoyé. Transmettez le lien de configuration sécurisé ci-dessous au client.",
          link: res.link,
        });
        notify("info", "Lien de configuration généré (mode local sans envoi d'e-mail).");
      } else {
        setAccessFeedback({
          type: "success",
          message: `Invitation de création de mot de passe envoyée à ${client.email}.`,
        });
        notify("success", `Invitation envoyée à ${client.email}.`);
      }
    } catch (err) {
      const msg = formatError(err);
      setAccessFeedback({ type: "error", message: msg });
      notify("error", msg);
    } finally {
      setAccessBusy(null);
    }
  };

  const handleGenerateAccessLink = async (client: ClientDoc) => {
    setAccessBusy("link");
    setAccessFeedback(null);
    try {
      const { link } = await api.generateClientAccessLink({ clientId: client.clientId });
      setAccessFeedback({
        type: "success",
        message:
          "Lien de configuration à usage unique généré avec succès. Transmettez-le au client pour qu'il définisse son mot de passe.",
        link,
      });
      notify("success", `Lien de configuration généré pour ${client.clientId}.`);
    } catch (err) {
      const msg = formatError(err);
      setAccessFeedback({ type: "error", message: msg });
      notify("error", msg);
    } finally {
      setAccessBusy(null);
    }
  };

  const handleResetPassword = async (client: ClientDoc) => {
    setAccessBusy("reset");
    setAccessFeedback(null);
    try {
      const { link } = await api.resetClientPassword({ clientId: client.clientId });
      setAccessFeedback({
        type: "success",
        message:
          "Mot de passe réinitialisé et sessions actives révoquées. Transmettez ce nouveau lien à usage unique au client.",
        link,
      });
      notify("success", `Accès de ${client.clientId} réinitialisé.`);
    } catch (err) {
      const msg = formatError(err);
      setAccessFeedback({ type: "error", message: msg });
      notify("error", msg);
    } finally {
      setAccessBusy(null);
    }
  };

  const handleSaveNotes = async (e: FormEvent) => {
    e.preventDefault();
    if (!inspecting) return;
    setSavingNotes(true);
    try {
      await api.saveClientNotes({ clientId: inspecting.clientId, notes: privateNotes });
      notify("success", "Notes administratives privées enregistrées.");
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setSavingNotes(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Gestion des clients</h1>
          <p className="text-xs text-slate-600">
            Créez les identifiants clients uniques, gérez leurs accès et consultez leur historique.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-royal-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-royal-700"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            <span>Nouveau client</span>
          </button>
        )}
      </div>

      {/* Recherche par identifiant, nom ou téléphone */}
      <div className="grid gap-3 sm:grid-cols-12 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="sm:col-span-8 relative">
          <label htmlFor="admin-client-search" className="sr-only">
            Rechercher un client
          </label>
          <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" aria-hidden="true" />
          <input
            id="admin-client-search"
            type="search"
            placeholder="Rechercher par identifiant (SHE-CLIENT-001 ou SHENA-0001), nom, téléphone, ville…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-300 ps-10 pe-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-4">
          <label htmlFor="admin-client-status" className="sr-only">
            Statut du compte
          </label>
          <select
            id="admin-client-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Tous les comptes</option>
            <option value="pending_setup">En attente de configuration</option>
            <option value="active">Comptes actifs</option>
            <option value="disabled">Comptes désactivés</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Aucun client trouvé"
          description="Créez un client pour générer son identifiant unique et son lien de configuration."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="py-3 px-4">Identifiant</th>
                  <th className="py-3 px-4">Nom complet</th>
                  <th className="py-3 px-4">Téléphone / WhatsApp</th>
                  <th className="py-3 px-4">Ville</th>
                  <th className="py-3 px-4">Commandes</th>
                  <th className="py-3 px-4">Statut du compte</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => {
                  const clientOrdersCount = orders.filter((o) => o.clientId === c.clientId).length;
                  return (
                    <tr key={c.clientId} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-extrabold text-navy-900">{c.clientId}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{c.fullName}</div>
                        {c.email && <div className="text-xs text-slate-500">{c.email}</div>}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">
                        <div>{c.phone}</div>
                        {c.whatsapp && <div className="text-emerald-700">WA : {c.whatsapp}</div>}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">{c.city ?? "—"}</td>
                      <td className="py-3 px-4 text-xs font-bold">{clientOrdersCount}</td>
                      <td className="py-3 px-4">
                        <ClientAccessBadge client={c} />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setInspectingId(c.clientId)}
                            className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Fiche &amp; accès
                          </button>
                          {canWrite && (
                            <>
                              <button
                                type="button"
                                onClick={() => setEditing(c)}
                                aria-label={`Modifier ${c.clientId}`}
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              >
                                <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmToggle(c)}
                                aria-label={c.status === "active" ? `Désactiver ${c.clientId}` : `Réactiver ${c.clientId}`}
                                className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                              >
                                {c.status === "active" ? (
                                  <Ban className="h-3.5 w-3.5 text-rose-600" aria-hidden="true" />
                                ) : (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal création / modification */}
      {(createOpen || editing) && (
        <ClientFormModal
          initial={editing}
          onClose={() => {
            setCreateOpen(false);
            setEditing(null);
          }}
          onSaved={(created) => {
            setCreateOpen(false);
            setEditing(null);
            if (created) {
              notify("success", `Client ${created.clientId} créé avec succès.`);
              setAccessLink({
                clientId: created.clientId,
                fullName: created.fullName,
                link: created.setupLink,
                isNewAccount: true,
              });
            } else {
              notify("success", "Informations client mises à jour.");
            }
          }}
        />
      )}

      {/* Modal fiche client : coordonnées, section « Accès au compte », notes privées, historique de commandes */}
      {inspecting && (
        <Modal
          title={`${inspecting.clientId} — ${inspecting.fullName}`}
          onClose={() => setInspectingId(null)}
          maxWidth="max-w-2xl"
        >
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 rounded-xl bg-slate-50 p-4 text-xs">
              <div>
                <span className="text-slate-500">Téléphone :</span>{" "}
                <strong className="text-slate-900">{inspecting.phone}</strong>
              </div>
              <div>
                <span className="text-slate-500">WhatsApp :</span>{" "}
                <strong className="text-slate-900">{inspecting.whatsapp ?? "—"}</strong>
              </div>
              <div>
                <span className="text-slate-500">E-mail :</span>{" "}
                <strong className="text-slate-900">{inspecting.email ?? "Non renseigné"}</strong>
              </div>
              <div>
                <span className="text-slate-500">Ville / Adresse :</span>{" "}
                <strong className="text-slate-900">
                  {[inspecting.address, inspecting.city].filter(Boolean).join(", ") || "—"}
                </strong>
              </div>
            </div>

            {/* Section obligatoire : Accès au compte */}
            <section aria-label="Accès au compte" className="rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-extrabold text-navy-900 uppercase tracking-wide">
                  Accès au compte
                </h3>
                <ClientAccessBadge client={inspecting} />
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 rounded-xl bg-slate-50 p-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Identifiant client :</span>
                  <strong className="text-sm font-extrabold text-navy-900">{inspecting.clientId}</strong>
                </div>
                <div>
                  <span className="text-slate-500 block">Adresse e-mail associée :</span>
                  <strong className="text-slate-900">
                    {inspecting.hasRealEmail && inspecting.email
                      ? inspecting.email
                      : "Non renseignée (connexion par identifiant client)"}
                  </strong>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyClientId(inspecting.clientId)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-navy-900 hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5 text-royal-600" aria-hidden="true" />
                  <span>Copier l&apos;identifiant client</span>
                </button>

                {canWrite && (
                  <>
                    <button
                      type="button"
                      disabled={accessBusy !== null || inspecting.status !== "active"}
                      onClick={() => handleGenerateAccessLink(inspecting)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-royal-600 px-3 py-2 text-xs font-bold text-white hover:bg-royal-700 disabled:opacity-60"
                    >
                      <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {accessBusy === "link"
                          ? "Génération…"
                          : "Générer un lien de configuration"}
                      </span>
                    </button>

                    {inspecting.hasRealEmail && inspecting.email && (
                      <button
                        type="button"
                        disabled={accessBusy !== null || inspecting.status !== "active"}
                        onClick={() => handleSendInvite(inspecting)}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-navy-900 hover:bg-slate-50 disabled:opacity-60"
                      >
                        <Mail className="h-3.5 w-3.5 text-royal-600" aria-hidden="true" />
                        <span>{accessBusy === "invite" ? "Envoi…" : "Envoyer une invitation"}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={accessBusy !== null || inspecting.status !== "active"}
                      onClick={() => handleResetPassword(inspecting)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-navy-900 hover:bg-slate-50 disabled:opacity-60"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                      <span>
                        {accessBusy === "reset" ? "Réinitialisation…" : "Réinitialiser le mot de passe"}
                      </span>
                    </button>
                  </>
                )}
              </div>

              {accessFeedback && (
                <div
                  role={accessFeedback.type === "error" ? "alert" : "status"}
                  className={`rounded-xl border p-3 text-xs space-y-2 ${
                    accessFeedback.type === "error"
                      ? "border-rose-200 bg-rose-50 text-rose-900"
                      : accessFeedback.type === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                        : "border-blue-200 bg-blue-50 text-slate-900"
                  }`}
                >
                  <div className="flex items-start gap-2 font-semibold">
                    {accessFeedback.type === "error" ? (
                      <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" aria-hidden="true" />
                    )}
                    <span>{accessFeedback.message}</span>
                  </div>
                  {accessFeedback.link && (
                    <div className="space-y-2 pt-1">
                      <div className="rounded-lg bg-white/90 border border-slate-200 p-2.5 font-mono text-[11px] break-all text-slate-800">
                        {accessFeedback.link}
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(accessFeedback.link!);
                            notify("info", "Lien de configuration copié dans le presse-papiers.");
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-royal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-royal-700"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Copier le lien de configuration</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Notes administratives privées */}
            <form onSubmit={handleSaveNotes} className="space-y-2">
              <label htmlFor="client-private-notes" className="block text-xs font-bold text-navy-900">
                Notes administratives privées (invisibles pour le client)
              </label>
              <textarea
                id="client-private-notes"
                rows={3}
                disabled={!canWrite || savingNotes}
                value={privateNotes}
                onChange={(e) => setPrivateNotes(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
                placeholder="Préférences de livraison, instructions internes…"
              />
              {canWrite && (
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={savingNotes}
                    className="rounded-xl bg-navy-900 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-navy-800"
                  >
                    {savingNotes ? "Enregistrement…" : "Enregistrer les notes privées"}
                  </button>
                </div>
              )}
            </form>

            {/* Historique des commandes du client */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-navy-900 uppercase">Historique des commandes</div>
              {orders.filter((o) => o.clientId === inspecting.clientId).length === 0 ? (
                <p className="text-xs text-slate-500">Aucune commande enregistrée pour ce client.</p>
              ) : (
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3">
                  {orders
                    .filter((o) => o.clientId === inspecting.clientId)
                    .map((o) => (
                      <li key={o.orderId} className="py-2.5 flex items-center justify-between text-xs">
                        <span>
                          <strong>{o.orderId}</strong> • {formatIsoDate(o.orderDate)} ({o.stats.received}/{o.stats.ordered} reçu(s))
                        </span>
                        <StatusBadge status={o.status} size="sm" />
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Modal récapitulatif d'accès après création ou génération de lien */}
      {accessLink && (
        <Modal
          title={
            accessLink.isNewAccount
              ? `Compte client créé — ${accessLink.clientId}`
              : `Lien de configuration — ${accessLink.clientId}`
          }
          onClose={() => setAccessLink(null)}
        >
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
              <div className="font-bold">Statut : En attente de configuration</div>
              <p className="mt-1">
                Transmettez l&apos;identifiant et le lien sécurisé à usage unique ci-dessous au client (par WhatsApp, SMS ou e-mail). Le client choisira lui-même son mot de passe et son compte passera automatiquement au statut <strong>Actif</strong>.
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase text-slate-500">Identifiant client</div>
                <div className="text-base font-extrabold text-navy-900">
                  {accessLink.clientId}
                  {accessLink.fullName ? ` — ${accessLink.fullName}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(accessLink.clientId);
                  notify("info", `Identifiant ${accessLink.clientId} copié.`);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-navy-900 hover:bg-slate-100"
              >
                <Copy className="h-3.5 w-3.5 text-royal-600" aria-hidden="true" />
                <span>Copier l&apos;identifiant client</span>
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-bold text-slate-700">
                Lien sécurisé de définition du mot de passe (valable 24h, usage unique) :
              </div>
              <div className="rounded-xl bg-slate-100 p-3 text-xs break-all font-mono text-slate-800">
                {accessLink.link}
              </div>
            </div>

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(
                    `Bonjour${accessLink.fullName ? ` ${accessLink.fullName}` : ""}, voici vos accès SHENA Express :\n- Identifiant client : ${accessLink.clientId}\n- Lien pour définir votre mot de passe : ${accessLink.link}`,
                  );
                  notify("info", "Message complet (identifiant + lien) copié.");
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-navy-900 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
                <span>Copier message complet</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(accessLink.link);
                  notify("info", "Lien de configuration copié dans le presse-papiers.");
                }}
                className="inline-flex items-center gap-1.5 rounded-xl bg-royal-600 px-4 py-2 text-xs font-bold text-white hover:bg-royal-700"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copier le lien de configuration</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(confirmToggle)}
        title={
          confirmToggle?.status === "active"
            ? `Désactiver le compte ${confirmToggle.clientId} ?`
            : `Réactiver le compte ${confirmToggle?.clientId} ?`
        }
        description={
          confirmToggle?.status === "active"
            ? "Le client ne pourra plus se connecter et ses sessions actives seront immédiatement révoquées. Son historique et son identifiant sont conservés."
            : "Le client pourra à nouveau se connecter à son espace personnel."
        }
        confirmLabel={confirmToggle?.status === "active" ? "Désactiver l'accès" : "Réactiver l'accès"}
        danger={confirmToggle?.status === "active"}
        busy={busy}
        onCancel={() => setConfirmToggle(null)}
        onConfirm={handleToggleStatus}
      />
    </div>
  );
}

function ClientFormModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: ClientDoc | null;
  onClose: () => void;
  onSaved: (created?: { clientId: string; fullName: string; setupLink: string }) => void;
}) {
  const [customClientId, setCustomClientId] = useState("");
  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (initial) {
        await api.updateClient({
          clientId: initial.clientId,
          fullName,
          phone,
          whatsapp: whatsapp || null,
          email: email || null,
          address: address || null,
          city: city || null,
        });
        onSaved();
      } else {
        const res = await api.createClient({
          clientId: customClientId.trim() ? customClientId.trim().toUpperCase() : null,
          fullName,
          phone,
          whatsapp: whatsapp || null,
          email: email || null,
          address: address || null,
          city: city || null,
          notes: notes || null,
          sendInvite: false,
        });
        onSaved({ clientId: res.clientId, fullName, setupLink: res.setupLink });
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initial ? `Modifier ${initial.clientId}` : "Créer un nouveau client"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {error && (
          <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900">
            {error}
          </div>
        )}
        <div>
          <label htmlFor="cf-name" className="block text-xs font-bold text-slate-700 mb-1">
            Nom complet *
          </label>
          <input
            id="cf-name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {!initial && (
          <div>
            <label htmlFor="cf-client-id" className="block text-xs font-bold text-slate-700 mb-1">
              Identifiant client unique (optionnel — généré automatiquement si vide)
            </label>
            <input
              id="cf-client-id"
              placeholder="Ex. SHE-CLIENT-001 ou SHENA-0001"
              value={customClientId}
              onChange={(e) => setCustomClientId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase"
            />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cf-phone" className="block text-xs font-bold text-slate-700 mb-1">
              Téléphone *
            </label>
            <input
              id="cf-phone"
              required
              placeholder="+509 …"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="cf-wa" className="block text-xs font-bold text-slate-700 mb-1">
              WhatsApp
            </label>
            <input
              id="cf-wa"
              placeholder="+509 …"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label htmlFor="cf-email" className="block text-xs font-bold text-slate-700 mb-1">
            E-mail (optionnel — utile pour la récupération autonome du mot de passe)
          </label>
          <input
            id="cf-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="cf-city" className="block text-xs font-bold text-slate-700 mb-1">
              Ville
            </label>
            <input
              id="cf-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="cf-address" className="block text-xs font-bold text-slate-700 mb-1">
              Adresse de livraison
            </label>
            <input
              id="cf-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        {!initial && (
          <div>
            <label htmlFor="cf-notes" className="block text-xs font-bold text-slate-700 mb-1">
              Notes administratives privées
            </label>
            <textarea
              id="cf-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-royal-600 px-4 py-2 text-xs font-bold text-white hover:bg-royal-700 disabled:opacity-60"
          >
            {busy ? "Enregistrement…" : initial ? "Enregistrer" : "Créer le client et générer son lien d'accès"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ========================================================= 6.C. COMMANDES */
export function AdminOrdersPage() {
  const { can } = useAuth();
  const { labelForStatus } = useSettings();
  const { clients, orders, shipments, events } = useAdminData();
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [transportFilter, setTransportFilter] = useState<string>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<OrderDoc | null>(null);
  const [receiving, setReceiving] = useState<OrderDoc | null>(null);
  const [inspecting, setInspecting] = useState<OrderDoc | null>(null);

  const canWrite = can("orders.write");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (transportFilter !== "all" && o.transportMode !== transportFilter) return false;
      if (!q) return true;
      return (
        o.orderId.toLowerCase().includes(q) ||
        o.clientId.toLowerCase().includes(q) ||
        o.clientName.toLowerCase().includes(q) ||
        (o.merchant ?? "").toLowerCase().includes(q) ||
        (o.merchantOrderRef ?? "").toLowerCase().includes(q) ||
        o.searchTokens?.some((t) => t.includes(q))
      );
    });
  }, [orders, search, statusFilter, transportFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Gestion des commandes</h1>
          <p className="text-xs text-slate-600">
            Créez des commandes, enregistrez explicitement les articles reçus et suivez leur expédition.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-royal-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-royal-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Nouvelle commande</span>
          </button>
        )}
      </div>

      {/* Recherche et filtres */}
      <div className="grid gap-3 sm:grid-cols-12 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="sm:col-span-6 relative">
          <label htmlFor="admin-order-search" className="sr-only">
            Rechercher une commande
          </label>
          <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" aria-hidden="true" />
          <input
            id="admin-order-search"
            type="search"
            placeholder="Référence commande, client, vendeur ou numéro de suivi…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-300 ps-10 pe-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="admin-order-status" className="sr-only">
            Statut
          </label>
          <select
            id="admin-order-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Tous les statuts</option>
            {STATUS_CODES.map((c) => (
              <option key={c} value={c}>
                {labelForStatus(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label htmlFor="admin-order-transport" className="sr-only">
            Mode de transport
          </label>
          <select
            id="admin-order-transport"
            value={transportFilter}
            onChange={(e) => setTransportFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Tous les modes</option>
            <option value="air">Aérien</option>
            <option value="sea">Maritime</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Aucune commande trouvée" description="Créez une commande pour un client existant." />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="py-3 px-4">N° Commande</th>
                  <th className="py-3 px-4">Client</th>
                  <th className="py-3 px-4">Vendeur / Date</th>
                  <th className="py-3 px-4">Cmd / Reçus / Exp.</th>
                  <th className="py-3 px-4">Colis</th>
                  <th className="py-3 px-4">Statut</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((o) => (
                  <tr key={o.orderId} className="hover:bg-slate-50/80">
                    <td className="py-3 px-4 font-extrabold text-navy-900">
                      <div>{o.orderId}</div>
                      <TransportBadge mode={o.transportMode} />
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900">{o.clientId}</div>
                      <div className="text-xs text-slate-500">{o.clientName}</div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      <div>{o.merchant ?? "—"}</div>
                      <div>{formatIsoDate(o.orderDate)}</div>
                    </td>
                    <td className="py-3 px-4 text-xs font-bold">
                      <span>{o.stats.ordered}</span> /{" "}
                      <span className="text-sky-800">{o.stats.received}</span> /{" "}
                      <span className="text-royal-700">{o.stats.shipped}</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-bold">{o.shipmentIds.length}</td>
                    <td className="py-3 px-4">
                      <StatusBadge status={o.status} size="sm" />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setInspecting(o)}
                          aria-label={`Détail ${o.orderId}`}
                          className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        {canWrite && (
                          <>
                            <button
                              type="button"
                              onClick={() => setReceiving(o)}
                              className="inline-flex items-center gap-1 rounded-lg bg-sky-50 border border-sky-200 px-2.5 py-1 text-xs font-bold text-sky-900 hover:bg-sky-100"
                            >
                              <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Réception</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(o)}
                              aria-label={`Modifier ${o.orderId}`}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(createOpen || editing) && (
        <OrderFormModal
          clients={clients}
          initial={editing}
          onClose={() => {
            setCreateOpen(false);
            setEditing(null);
          }}
          onSaved={(orderId) => {
            setCreateOpen(false);
            setEditing(null);
            notify("success", orderId ? `Commande ${orderId} créée.` : "Commande mise à jour.");
          }}
        />
      )}

      {receiving && (
        <RecordReceiptModal
          order={receiving}
          onClose={() => setReceiving(null)}
          onSaved={() => {
            setReceiving(null);
            notify("success", "Quantités reçues mises à jour.");
          }}
        />
      )}

      {inspecting && (
        <OrderInspectModal
          order={inspecting}
          shipments={shipments.filter((s) => s.orderIds.includes(inspecting.orderId))}
          events={events.filter((e) => e.orderId === inspecting.orderId)}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}

function OrderFormModal({
  clients,
  initial,
  onClose,
  onSaved,
}: {
  clients: ClientDoc[];
  initial: OrderDoc | null;
  onClose: () => void;
  onSaved: (orderId?: string) => void;
}) {
  const { settings } = useSettings();
  const [clientId, setClientId] = useState(initial?.clientId ?? clients.find((c) => c.status === "active")?.clientId ?? "");
  const [merchant, setMerchant] = useState(initial?.merchant ?? "");
  const [merchantOrderRef, setMerchantOrderRef] = useState(initial?.merchantOrderRef ?? "");
  const [orderDate, setOrderDate] = useState(initial?.orderDate ?? todayIso());
  const [currency, setCurrency] = useState<Currency>(initial?.currency ?? settings.currency);
  const [transportMode, setTransportMode] = useState<string>(initial?.transportMode ?? "");
  const [publicNote, setPublicNote] = useState(initial?.publicNote ?? "");
  const [internalNotes, setInternalNotes] = useState("");
  const [items, setItems] = useState<
    { lineId?: string; description: string; merchantRef: string; quantityOrdered: number; declaredValueStr: string }[]
  >(
    initial?.items.map((i) => ({
      lineId: i.lineId,
      description: i.description,
      merchantRef: i.merchantRef ?? "",
      quantityOrdered: i.quantityOrdered,
      declaredValueStr: i.declaredUnitValue ? (i.declaredUnitValue / 100).toFixed(2) : "",
    })) ?? [{ description: "", merchantRef: "", quantityOrdered: 1, declaredValueStr: "" }],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) return;
    getDoc(doc(getFirebaseDb(), "orderPrivate", initial.orderId))
      .then((snap) => {
        if (snap.exists()) setInternalNotes((snap.data().internalNotes as string) ?? "");
      })
      .catch(() => undefined);
  }, [initial]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const parsedItems = items.map((i) => ({
        ...(i.lineId ? { lineId: i.lineId } : {}),
        description: i.description,
        merchantRef: i.merchantRef || null,
        quantityOrdered: Number(i.quantityOrdered),
        declaredUnitValue: i.declaredValueStr.trim() ? parseMoney(i.declaredValueStr) : null,
      }));
      if (initial) {
        await api.updateOrder({
          orderId: initial.orderId,
          merchant: merchant || null,
          merchantOrderRef: merchantOrderRef || null,
          orderDate,
          currency,
          transportMode: (transportMode || null) as TransportMode | null,
          publicNote: publicNote || null,
          internalNotes: internalNotes || null,
          items: parsedItems,
        });
        onSaved();
      } else {
        const res = await api.createOrder({
          clientId,
          merchant: merchant || null,
          merchantOrderRef: merchantOrderRef || null,
          orderDate,
          currency,
          transportMode: (transportMode || null) as TransportMode | null,
          publicNote: publicNote || null,
          internalNotes: internalNotes || null,
          items: parsedItems,
        });
        onSaved(res.orderId);
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={initial ? `Modifier ${initial.orderId}` : "Créer une commande"}
      onClose={onClose}
      maxWidth="max-w-2xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900">
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="of-client" className="block text-xs font-bold text-slate-700 mb-1">
              Client *
            </label>
            <select
              id="of-client"
              required
              disabled={Boolean(initial)}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
            >
              <option value="">Sélectionner un client…</option>
              {clients
                .filter((c) => c.status === "active" || c.clientId === initial?.clientId)
                .map((c) => (
                  <option key={c.clientId} value={c.clientId}>
                    {c.clientId} — {c.fullName}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <label htmlFor="of-date" className="block text-xs font-bold text-slate-700 mb-1">
              Date de commande *
            </label>
            <input
              id="of-date"
              type="date"
              required
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <label htmlFor="of-merchant" className="block text-xs font-bold text-slate-700 mb-1">
              Site marchand / vendeur
            </label>
            <input
              id="of-merchant"
              placeholder="Amazon, Shein, Walmart…"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="of-mref" className="block text-xs font-bold text-slate-700 mb-1">
              Réf. vendeur
            </label>
            <input
              id="of-mref"
              value={merchantOrderRef}
              onChange={(e) => setMerchantOrderRef(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="of-mode" className="block text-xs font-bold text-slate-700 mb-1">
              Transport
            </label>
            <select
              id="of-mode"
              value={transportMode}
              onChange={(e) => setTransportMode(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">À préciser</option>
              <option value="air">Aérien</option>
              <option value="sea">Maritime</option>
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="of-currency" className="block text-xs font-bold text-slate-700 mb-1">
            Devise de la commande
          </label>
          <select
            id="of-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as Currency)}
            className="w-40 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Lignes d'articles */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-navy-900 uppercase">Lignes d&apos;articles *</span>
            <button
              type="button"
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  { description: "", merchantRef: "", quantityOrdered: 1, declaredValueStr: "" },
                ])
              }
              className="text-xs font-bold text-royal-600 hover:underline"
            >
              + Ajouter un article
            </button>
          </div>
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={item.lineId ?? idx} className="grid gap-2 sm:grid-cols-12 items-center rounded-xl bg-slate-50 p-2.5">
                <input
                  required
                  placeholder="Description de l'article *"
                  value={item.description}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                  }
                  className="sm:col-span-5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
                <input
                  placeholder="Réf."
                  value={item.merchantRef}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, merchantRef: e.target.value } : x)))
                  }
                  className="sm:col-span-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
                <input
                  type="number"
                  min={1}
                  required
                  aria-label="Quantité commandée"
                  value={item.quantityOrdered}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((x, i) => (i === idx ? { ...x, quantityOrdered: Number(e.target.value) } : x)),
                    )
                  }
                  className="sm:col-span-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
                <input
                  placeholder={`Valeur (${currency})`}
                  value={item.declaredValueStr}
                  onChange={(e) =>
                    setItems((prev) => prev.map((x, i) => (i === idx ? { ...x, declaredValueStr: e.target.value } : x)))
                  }
                  className="sm:col-span-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                />
                <div className="sm:col-span-1 flex justify-end">
                  {items.length > 1 && (
                    <button
                      type="button"
                      aria-label="Supprimer la ligne"
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="of-pubnote" className="block text-xs font-bold text-slate-700 mb-1">
              Note publique (visible par le client)
            </label>
            <textarea
              id="of-pubnote"
              rows={2}
              value={publicNote}
              onChange={(e) => setPublicNote(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="of-privnote" className="block text-xs font-bold text-slate-700 mb-1">
              Notes internes privées (administration uniquement)
            </label>
            <textarea
              id="of-privnote"
              rows={2}
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-royal-600 px-4 py-2 text-xs font-bold text-white hover:bg-royal-700 disabled:opacity-60"
          >
            {busy ? "Enregistrement…" : initial ? "Enregistrer" : "Créer la commande"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RecordReceiptModal({
  order,
  onClose,
  onSaved,
}: {
  order: OrderDoc;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(order.items.map((i) => [i.lineId, i.quantityReceived])),
  );
  const [publicNote, setPublicNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.recordReceipt({
        orderId: order.orderId,
        lines: order.items.map((i) => ({
          lineId: i.lineId,
          quantityReceived: Number(quantities[i.lineId] ?? 0),
        })),
        publicNote: publicNote || null,
      });
      onSaved();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Réception à l'entrepôt — ${order.orderId}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900">
            {error}
          </div>
        )}
        <p className="text-xs text-slate-600">
          Saisissez le nombre cumulé d&apos;articles effectivement reçus à l&apos;entrepôt pour chaque ligne.
        </p>
        <div className="space-y-2">
          {order.items.map((item) => (
            <div key={item.lineId} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 text-xs">
              <div>
                <div className="font-bold text-navy-900">{item.description}</div>
                <div className="text-slate-500">Commandé : {item.quantityOrdered}</div>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor={`rec-${item.lineId}`} className="text-slate-600">
                  Reçu :
                </label>
                <input
                  id={`rec-${item.lineId}`}
                  type="number"
                  min={0}
                  max={item.quantityOrdered}
                  value={quantities[item.lineId] ?? 0}
                  onChange={(e) => setQuantities((p) => ({ ...p, [item.lineId]: Number(e.target.value) }))}
                  className="w-20 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-bold text-right"
                />
              </div>
            </div>
          ))}
        </div>
        <div>
          <label htmlFor="rec-note" className="block text-xs font-bold text-slate-700 mb-1">
            Note publique optionnelle
          </label>
          <input
            id="rec-note"
            value={publicNote}
            onChange={(e) => setPublicNote(e.target.value)}
            placeholder="Ex. Articles vérifiés et en bon état."
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-royal-600 px-4 py-2 text-xs font-bold text-white hover:bg-royal-700"
          >
            {busy ? "Enregistrement…" : "Valider la réception"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function OrderInspectModal({
  order,
  shipments,
  events,
  onClose,
}: {
  order: OrderDoc;
  shipments: { shipmentId: string; trackingNumber: string; status: StatusCode; itemCount: number }[];
  events: Parameters<typeof TrackingTimeline>[0]["events"];
  onClose: () => void;
}) {
  const { can } = useAuth();
  const { labelForStatus } = useSettings();
  const { notify } = useToast();
  const [status, setStatus] = useState<StatusCode>(order.status);
  const [publicNote, setPublicNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [busy, setBusy] = useState(false);

  const handleUpdateStatus = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.updateStatus({
        targetType: "order",
        targetId: order.orderId,
        status,
        publicNote: publicNote || null,
        internalNote: internalNote || null,
      });
      notify("success", "Statut de la commande mis à jour.");
      setPublicNote("");
      setInternalNote("");
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Détail commande ${order.orderId}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-xl bg-slate-50 p-3 text-xs">
          <div>
            <span className="text-slate-500">Commandés :</span> <strong>{order.stats.ordered}</strong>
          </div>
          <div>
            <span className="text-slate-500">Reçus :</span> <strong>{order.stats.received}</strong>
          </div>
          <div>
            <span className="text-slate-500">Emballés :</span> <strong>{order.stats.packed}</strong>
          </div>
          <div>
            <span className="text-slate-500">Expédiés :</span> <strong>{order.stats.shipped}</strong>
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold text-navy-900 uppercase">Articles</div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3 text-xs">
            {order.items.map((i) => (
              <li key={i.lineId} className="py-2 flex items-center justify-between">
                <span>
                  <strong>{i.description}</strong> {i.merchantRef ? `(${i.merchantRef})` : ""}
                  {i.declaredUnitValue ? ` — Val. décl. ${formatMoney(i.declaredUnitValue, order.currency)}` : ""}
                </span>
                <span>
                  Reçus : <strong>{i.quantityReceived}</strong> / {i.quantityOrdered}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-bold text-navy-900 uppercase">Colis associés ({shipments.length})</div>
          {shipments.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun colis associé.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 px-3 text-xs">
              {shipments.map((s) => (
                <li key={s.shipmentId} className="py-2 flex items-center justify-between">
                  <span>
                    <strong>{s.trackingNumber}</strong> ({s.shipmentId}) — {s.itemCount} article(s)
                  </span>
                  <StatusBadge status={s.status} size="sm" />
                </li>
              ))}
            </ul>
          )}
        </div>

        {can("orders.write") && (
          <form onSubmit={handleUpdateStatus} className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="text-xs font-bold text-navy-900 uppercase">Changer le statut de la commande</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusCode)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
            >
              {STATUS_CODES.map((c) => (
                <option key={c} value={c}>
                  {labelForStatus(c)}
                </option>
              ))}
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                placeholder="Note publique (visible par le client)"
                value={publicNote}
                onChange={(e) => setPublicNote(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
              <input
                placeholder="Note interne privée (admin uniquement)"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-royal-600 px-3.5 py-2 text-xs font-bold text-white"
              >
                {busy ? "Mise à jour…" : "Enregistrer le statut"}
              </button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          <div className="text-xs font-bold text-navy-900 uppercase">Chronologie</div>
          <TrackingTimeline events={events} />
        </div>
      </div>
    </Modal>
  );
}
