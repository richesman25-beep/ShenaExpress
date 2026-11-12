import { useEffect, useMemo, useState, type FormEvent } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import {
  Plus,
  Search,
  Edit3,
  RefreshCw,
  Trash2,
  CreditCard,
  Ban,
  Save,
  UserCog,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { getFirebaseDb } from "@/lib/firebase";
import { api, formatError } from "@/lib/api";
import {
  STATUS_CODES,
  STATUS_DEFINITIONS,
  SHENA_PRIMARY_STATUSES,
  CURRENCIES,
  PERMISSIONS,
  PERMISSION_LABELS,
  NOTIFICATION_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  nextLogisticsStatus,
  todayIso,
  formatIsoDate,
  parseMoney,
  formatMoney,
  type ClientDoc,
  type ShipmentDoc,
  type StatusCode,
  type ChargeLine,
  type ChargeKind,
  type Currency,
  type Permission,
  type NotificationType,
  type UserDoc,
} from "@shared/index";
import {
  StatusBadge,
  ShipmentProgress,
  PickupAvailabilityBanner,
  TrackingTimeline,
  Modal,
  ConfirmDialog,
  EmptyState,
  useToast,
} from "@/components/ui";
import { useAdminData } from "./AdminContext";

/* =================================================== 6.D/E/F. COLIS & SUIVI */
export function AdminShipmentsPage() {
  const { can } = useAuth();
  const { labelForStatus } = useSettings();
  const { clients, shipments, events } = useAdminData();
  const { notify } = useToast();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ShipmentDoc | null>(null);
  const [statusModal, setStatusModal] = useState<ShipmentDoc | null>(null);

  const canWrite = can("shipments.write");

  const clientById = useMemo(() => {
    const map = new Map<string, ClientDoc>();
    for (const c of clients) map.set(c.clientId, c);
    return map;
  }, [clients]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shipments.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!q) return true;
      const clientName = clientById.get(s.clientId)?.fullName.toLowerCase() ?? "";
      return (
        s.trackingNumber.toLowerCase().includes(q) ||
        s.shipmentId.toLowerCase().includes(q) ||
        s.clientId.toLowerCase().includes(q) ||
        clientName.includes(q) ||
        s.lines.some((l) => l.description.toLowerCase().includes(q)) ||
        s.orderIds.some((id) => id.toLowerCase().includes(q))
      );
    });
  }, [shipments, clientById, search, statusFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Gestion des colis &amp; suivi logistique</h1>
          <p className="text-xs text-slate-600">
            Enregistrez les colis par numéro de suivi unique et pilotez les 3 étapes de transport SHENA Express jusqu&apos;à la disponibilité au retrait.
          </p>
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-royal-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-royal-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span>Nouveau colis</span>
          </button>
        )}
      </div>

      {/* Filtres */}
      <div className="grid gap-3 sm:grid-cols-12 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="sm:col-span-8 relative">
          <label htmlFor="admin-ship-search" className="sr-only">
            Rechercher un colis
          </label>
          <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" aria-hidden="true" />
          <input
            id="admin-ship-search"
            type="search"
            placeholder="Rechercher par numéro de suivi, client, référence ou description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-300 ps-10 pe-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-4">
          <label htmlFor="admin-ship-status" className="sr-only">
            Étape logistique
          </label>
          <select
            id="admin-ship-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Toutes les étapes logistiques</option>
            {SHENA_PRIMARY_STATUSES.map((c) => (
              <option key={c} value={c}>
                {labelForStatus(c)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Aucun colis trouvé"
          description="Enregistrez un colis avec son numéro de suivi unique pour suivre son acheminement."
        />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="py-3 px-4">Numéro de suivi</th>
                  <th className="py-3 px-4">Client associé</th>
                  <th className="py-3 px-4">Description / Référence</th>
                  <th className="py-3 px-4">Étape logistique actuelle</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((s) => {
                  const client = clientById.get(s.clientId);
                  return (
                    <tr key={s.shipmentId} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-navy-900 font-mono">{s.trackingNumber}</div>
                        <div className="text-xs text-slate-500">{s.shipmentId}</div>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-bold text-slate-900">{s.clientId}</div>
                        {client && <div className="text-slate-500">{client.fullName}</div>}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-semibold text-slate-900">
                          {s.lines[0]?.description ?? "Colis SHENA Express"}
                        </div>
                        {s.orderIds.length > 0 && (
                          <div className="text-slate-500">{s.orderIds.join(", ")}</div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={s.status} size="sm" />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setStatusModal(s)}
                            className="inline-flex items-center gap-1 rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-bold text-royal-700 hover:bg-blue-100"
                          >
                            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Suivi &amp; statut</span>
                          </button>
                          {canWrite && (
                            <button
                              type="button"
                              onClick={() => setEditing(s)}
                              aria-label={`Modifier ${s.trackingNumber}`}
                              className="rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100"
                            >
                              <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
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

      {(createOpen || editing) && (
        <ShipmentFormModal
          clients={clients}
          initial={editing}
          onClose={() => {
            setCreateOpen(false);
            setEditing(null);
          }}
          onSaved={(shipmentId) => {
            setCreateOpen(false);
            setEditing(null);
            notify(
              "success",
              shipmentId ? `Colis ${shipmentId} enregistré avec succès.` : "Colis mis à jour avec succès.",
            );
          }}
        />
      )}

      {statusModal && (
        <ShipmentStatusModal
          shipment={statusModal}
          client={clientById.get(statusModal.clientId) ?? null}
          events={events.filter((e) => e.shipmentId === statusModal.shipmentId)}
          onClose={() => setStatusModal(null)}
        />
      )}
    </div>
  );
}

function ShipmentFormModal({
  clients,
  initial,
  onClose,
  onSaved,
}: {
  clients: ClientDoc[];
  initial: ShipmentDoc | null;
  onClose: () => void;
  onSaved: (shipmentId?: string) => void;
}) {
  const { labelForStatus } = useSettings();
  const [clientId, setClientId] = useState(
    initial?.clientId ?? clients.find((c) => c.status === "active")?.clientId ?? "",
  );
  const [trackingNumber, setTrackingNumber] = useState(initial?.trackingNumber ?? "");
  const [orderRef, setOrderRef] = useState(initial?.orderIds[0] ?? "");
  const [description, setDescription] = useState(initial?.lines[0]?.description ?? "");
  const [initialStatus, setInitialStatus] = useState<StatusCode>(
    initial && SHENA_PRIMARY_STATUSES.includes(initial.status) ? initial.status : "received",
  );
  const [internalNotes, setInternalNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initial) return;
    getDoc(doc(getFirebaseDb(), "shipmentPrivate", initial.shipmentId))
      .then((snap) => {
        if (snap.exists()) setInternalNotes((snap.data().internalNotes as string) ?? "");
      })
      .catch(() => undefined);
  }, [initial]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const cleanTracking = trackingNumber.trim().toUpperCase();
    if (!cleanTracking) {
      setError("Le numéro de suivi unique est obligatoire.");
      return;
    }
    setBusy(true);
    try {
      if (initial) {
        await api.updateShipment({
          shipmentId: initial.shipmentId,
          trackingNumber: cleanTracking,
          initialStatus,
          orderRef: orderRef.trim() || null,
          description: description.trim() || `Colis ${cleanTracking}`,
          transportMode: initial.transportMode ?? "air",
          weightKg: initial.weightKg ?? null,
          dimensionsCm: initial.dimensionsCm ?? null,
          lines: initial.lines,
          dates: initial.dates,
          dateChangeMessage: null,
          pickupInstructions: initial.pickupInstructions ?? null,
          internalNotes: internalNotes.trim() || null,
        });
        onSaved();
      } else {
        const res = await api.createShipment({
          clientId,
          trackingNumber: cleanTracking,
          initialStatus,
          orderRef: orderRef.trim() || null,
          description: description.trim() || `Colis ${cleanTracking}`,
          transportMode: "air",
          weightKg: null,
          dimensionsCm: null,
          lines: [],
          dates: {
            warehouseReceivedAt: null,
            estimatedDeparture: null,
            shippedAt: null,
            estimatedArrival: null,
            deliveryWindowStart: null,
            deliveryWindowEnd: null,
            availableAt: null,
            deliveredAt: null,
          },
          dateChangeMessage: null,
          pickupInstructions: null,
          internalNotes: internalNotes.trim() || null,
        });
        onSaved(res.shipmentId);
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={initial ? `Modifier colis ${initial.trackingNumber}` : "Enregistrer un nouveau colis"}
      onClose={onClose}
      maxWidth="max-w-xl"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="sf-client" className="block text-xs font-bold text-slate-700 mb-1">
            Client associé *
          </label>
          <select
            id="sf-client"
            required
            disabled={Boolean(initial)}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
          >
            <option value="">Sélectionner un client…</option>
            {clients.map((c) => (
              <option key={c.clientId} value={c.clientId}>
                {c.clientId} — {c.fullName}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="sf-tn" className="block text-xs font-bold text-slate-700 mb-1">
              Numéro de suivi unique *
            </label>
            <input
              id="sf-tn"
              required
              placeholder="Ex. SHX26000001"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase font-mono"
            />
          </div>
          <div>
            <label htmlFor="sf-oref" className="block text-xs font-bold text-slate-700 mb-1">
              Référence de la commande (facultative)
            </label>
            <input
              id="sf-oref"
              placeholder="Ex. SHE-CMD-2026-00001 ou AMZ-114"
              value={orderRef}
              onChange={(e) => setOrderRef(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div>
          <label htmlFor="sf-desc" className="block text-xs font-bold text-slate-700 mb-1">
            Description courte du colis (facultative)
          </label>
          <input
            id="sf-desc"
            placeholder="Ex. Vêtements, électronique, chaussures…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label htmlFor="sf-status" className="block text-xs font-bold text-slate-700 mb-1">
            Statut logistique initial *
          </label>
          <select
            id="sf-status"
            value={initialStatus}
            onChange={(e) => setInitialStatus(e.target.value as StatusCode)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-navy-900"
          >
            {SHENA_PRIMARY_STATUSES.map((code) => (
              <option key={code} value={code}>
                {labelForStatus(code)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="sf-notes" className="block text-xs font-bold text-slate-700 mb-1">
            Notes internes privées (facultatives — réservées à l&apos;administrateur)
          </label>
          <textarea
            id="sf-notes"
            rows={2}
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            placeholder="Instructions internes invisibles pour le client…"
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
            {busy ? "Enregistrement…" : initial ? "Enregistrer" : "Enregistrer le colis"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ShipmentStatusModal({
  shipment,
  client,
  events,
  onClose,
}: {
  shipment: ShipmentDoc;
  client: ClientDoc | null;
  events: Parameters<typeof TrackingTimeline>[0]["events"];
  onClose: () => void;
}) {
  const { can } = useAuth();
  const { settings, labelForStatus } = useSettings();
  const { notify } = useToast();

  const [status, setStatus] = useState<StatusCode>(shipment.status);
  const [publicNote, setPublicNote] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [internalNotesById, setInternalNotesById] = useState<Record<string, string>>({});
  const [confirmNextStatus, setConfirmNextStatus] = useState<StatusCode | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(shipment.status);
  }, [shipment.status]);

  useEffect(() => {
    getDocs(collection(getFirebaseDb(), "shipmentEventsPrivate"))
      .then((snap) => {
        const map: Record<string, string> = {};
        for (const d of snap.docs) {
          const data = d.data() as { eventId: string; internalNote?: string };
          if (data.internalNote) map[data.eventId] = data.internalNote;
        }
        setInternalNotesById(map);
      })
      .catch(() => undefined);
  }, [events.length]);

  const executeStatusUpdate = async (targetStatus: StatusCode) => {
    setBusy(true);
    try {
      await api.updateStatus({
        targetType: "shipment",
        targetId: shipment.shipmentId,
        status: targetStatus,
        publicNote: publicNote || null,
        internalNote: internalNote || null,
      });
      notify("success", `Statut du colis ${shipment.trackingNumber} mis à jour : ${labelForStatus(targetStatus)}.`);
      setPublicNote("");
      setInternalNote("");
      setConfirmNextStatus(null);
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const nextStep = nextLogisticsStatus(shipment.status);

  return (
    <Modal title={`Suivi colis ${shipment.trackingNumber}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-5">
        {/* Récapitulatif du colis et du client associé */}
        <div className="grid sm:grid-cols-3 gap-2.5 rounded-xl bg-slate-50 border border-slate-200 p-3.5 text-xs">
          <div>
            <span className="text-slate-500 block">Client associé :</span>
            <strong className="text-navy-900">
              {shipment.clientId}
              {client ? ` — ${client.fullName}` : ""}
            </strong>
          </div>
          <div>
            <span className="text-slate-500 block">Numéro de suivi :</span>
            <strong className="text-navy-900 font-mono">{shipment.trackingNumber}</strong>
          </div>
          <div>
            <span className="text-slate-500 block">Statut actuel :</span>
            <div className="mt-0.5">
              <StatusBadge status={shipment.status} size="sm" />
            </div>
          </div>
        </div>

        <PickupAvailabilityBanner status={shipment.status} />
        <ShipmentProgress status={shipment.status} lastStep={shipment.lastStep} />

        {can("shipments.write") && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setConfirmNextStatus(status);
            }}
            className="rounded-xl border border-slate-200 p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-navy-900 uppercase">
                Progression logistique &amp; disponibilité au retrait
              </div>
              <div className="flex flex-wrap gap-2">
                {nextStep && nextStep !== "available" && (
                  <button
                    type="button"
                    onClick={() => setConfirmNextStatus(nextStep)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-orange-500 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-orange-600"
                  >
                    <span>Étape suivante : {labelForStatus(nextStep)}</span>
                  </button>
                )}
                {shipment.status !== "available" && (
                  <button
                    type="button"
                    onClick={() => setConfirmNextStatus("available")}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
                  >
                    <span>Marquer Disponible pour le retrait</span>
                  </button>
                )}
              </div>
            </div>

            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusCode)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold"
            >
              <optgroup label="Étapes logistiques SHENA Express">
                {SHENA_PRIMARY_STATUSES.map((c) => (
                  <option key={c} value={c}>
                    {labelForStatus(c)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Autres statuts / corrections">
                {STATUS_CODES.filter(
                  (c) => !SHENA_PRIMARY_STATUSES.includes(c) && !settings.disabledStatuses?.includes(c),
                ).map((c) => (
                  <option key={c} value={c}>
                    {labelForStatus(c)}
                  </option>
                ))}
              </optgroup>
            </select>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                placeholder="Note publique destinée au client (facultative)"
                value={publicNote}
                onChange={(e) => setPublicNote(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
              <input
                placeholder="Note interne (invisible pour le client)"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-royal-600 px-4 py-2 text-xs font-bold text-white hover:bg-royal-700"
              >
                {busy ? "Enregistrement…" : "Enregistrer la mise à jour"}
              </button>
            </div>
          </form>
        )}

        <div className="space-y-2">
          <div className="text-xs font-bold text-navy-900 uppercase">Chronologie complète (avec notes internes)</div>
          <TrackingTimeline events={events} internalNotesById={internalNotesById} />
        </div>

        <ConfirmDialog
          open={Boolean(confirmNextStatus)}
          title="Confirmer la mise à jour du statut ?"
          description={
            confirmNextStatus
              ? `Confirmez-vous le passage du colis ${shipment.trackingNumber} (client ${shipment.clientId}) au statut « ${labelForStatus(confirmNextStatus)} » ?`
              : ""
          }
          confirmLabel="Confirmer et enregistrer"
          busy={busy}
          onCancel={() => setConfirmNextStatus(null)}
          onConfirm={() => {
            if (confirmNextStatus) void executeStatusUpdate(confirmNextStatus);
          }}
        />
      </div>
    </Modal>
  );
}

/* =================================================== 6.G. FRAIS & PAIEMENTS */
export function AdminFinancePage() {
  const { can } = useAuth();
  const { orders, finances, payments } = useAdminData();
  const { notify } = useToast();

  const [selectedOrderId, setSelectedOrderId] = useState<string>(() => orders[0]?.orderId ?? "");
  const [charges, setCharges] = useState<{ id?: string; kind: ChargeKind; label: string; amountStr: string }[]>([]);
  const [savingCharges, setSavingCharges] = useState(false);

  const [payAmountStr, setPayAmountStr] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "transfer" | "moncash" | "natcash" | "card" | "other">("cash");
  const [payRef, setPayRef] = useState("");
  const [payDate, setPayDate] = useState(todayIso());
  const [recordingPay, setRecordingPay] = useState(false);

  const [voidTarget, setVoidTarget] = useState<{ id: string; amount: number; currency: Currency } | null>(null);
  const [voidReason, setVoidReason] = useState("Erreur de saisie");

  const canWrite = can("finance.write");
  const activeOrder = orders.find((o) => o.orderId === selectedOrderId) ?? orders[0];
  const activeFin = activeOrder ? finances[activeOrder.orderId] : undefined;

  useEffect(() => {
    if (!activeOrder) return;
    if (selectedOrderId !== activeOrder.orderId) setSelectedOrderId(activeOrder.orderId);
    const fin = finances[activeOrder.orderId];
    setCharges(
      fin?.charges.map((c) => ({
        id: c.id,
        kind: c.kind,
        label: c.label,
        amountStr: (c.amount / 100).toFixed(2),
      })) ?? [],
    );
  }, [activeOrder?.orderId, finances]);

  const handleSaveCharges = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    setSavingCharges(true);
    try {
      const parsed: ChargeLine[] = charges.map((c, idx) => {
        const amt = parseMoney(c.amountStr);
        if (amt === null) throw new Error(`Montant invalide sur la ligne « ${c.label || idx + 1} ».`);
        return { id: c.id ?? `C${idx + 1}`, kind: c.kind, label: c.label, amount: amt };
      });
      await api.setOrderCharges({ orderId: activeOrder.orderId, charges: parsed });
      notify("success", "Frais et réductions enregistrés.");
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setSavingCharges(false);
    }
  };

  const handleRecordPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    const amt = parseMoney(payAmountStr);
    if (!amt || amt <= 0) {
      notify("error", "Veuillez saisir un montant valide.");
      return;
    }
    setRecordingPay(true);
    try {
      await api.recordPayment({
        orderId: activeOrder.orderId,
        amount: amt,
        currency: activeOrder.currency,
        method: payMethod,
        reference: payRef || null,
        receivedOn: payDate,
      });
      setPayAmountStr("");
      setPayRef("");
      notify("success", "Paiement manuel enregistré.");
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setRecordingPay(false);
    }
  };

  const handleVoidPayment = async () => {
    if (!voidTarget) return;
    try {
      await api.voidPayment({ paymentId: voidTarget.id, reason: voidReason });
      notify("success", "Paiement annulé et journalisé.");
      setVoidTarget(null);
    } catch (err) {
      notify("error", formatError(err));
    }
  };

  const orderPayments = payments.filter((p) => activeOrder && p.orderId === activeOrder.orderId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Frais &amp; paiements (suivi manuel)</h1>
        <p className="text-xs text-slate-600">
          Gérez les frais de transport, suppléments, réductions et paiements enregistrés manuellement. Les devises USD et HTG ne sont jamais mélangées automatiquement.
        </p>
      </div>

      {orders.length === 0 ? (
        <EmptyState title="Aucune commande" description="Créez d'abord une commande pour y associer des frais." />
      ) : (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <label htmlFor="fin-order" className="text-xs font-bold text-slate-700">
                Commande :
              </label>
              <select
                id="fin-order"
                value={activeOrder?.orderId ?? ""}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-navy-900"
              >
                {orders.map((o) => (
                  <option key={o.orderId} value={o.orderId}>
                    {o.orderId} — {o.clientId} ({o.clientName}) [{o.currency}]
                  </option>
                ))}
              </select>
            </div>
            {activeFin && (
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <span>
                  Total dû : <strong>{formatMoney(activeFin.totalDue, activeFin.currency)}</strong>
                </span>
                <span className="text-emerald-800">
                  Payé : <strong>{formatMoney(activeFin.totalPaid, activeFin.currency)}</strong>
                </span>
                <span className="text-amber-950 font-extrabold">
                  Solde : {formatMoney(activeFin.balance, activeFin.currency)} ({PAYMENT_STATUS_LABELS[activeFin.paymentStatus]})
                </span>
              </div>
            )}
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Frais de la commande */}
            <form
              onSubmit={handleSaveCharges}
              className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-extrabold text-navy-900">
                  Lignes de frais ({activeOrder?.currency})
                </h2>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() =>
                      setCharges((p) => [...p, { kind: "transport", label: "Frais de transport", amountStr: "0.00" }])
                    }
                    className="text-xs font-bold text-royal-600 hover:underline"
                  >
                    + Ajouter une ligne
                  </button>
                )}
              </div>

              {charges.length === 0 ? (
                <p className="text-xs text-slate-500">Aucun frais défini pour cette commande.</p>
              ) : (
                <div className="space-y-2">
                  {charges.map((c, idx) => (
                    <div key={c.id ?? idx} className="grid grid-cols-12 gap-2 items-center">
                      <select
                        value={c.kind}
                        disabled={!canWrite}
                        onChange={(e) =>
                          setCharges((p) =>
                            p.map((x, i) => (i === idx ? { ...x, kind: e.target.value as ChargeKind } : x)),
                          )
                        }
                        className="col-span-4 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="transport">Frais de transport</option>
                        <option value="extra">Frais supplémentaire</option>
                        <option value="discount">Réduction / ajustement</option>
                      </select>
                      <input
                        required
                        disabled={!canWrite}
                        placeholder="Libellé"
                        value={c.label}
                        onChange={(e) =>
                          setCharges((p) => p.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)))
                        }
                        className="col-span-5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                      />
                      <input
                        required
                        disabled={!canWrite}
                        placeholder="0.00"
                        value={c.amountStr}
                        onChange={(e) =>
                          setCharges((p) => p.map((x, i) => (i === idx ? { ...x, amountStr: e.target.value } : x)))
                        }
                        className="col-span-2 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-right font-bold"
                      />
                      <div className="col-span-1 flex justify-end">
                        {canWrite && (
                          <button
                            type="button"
                            onClick={() => setCharges((p) => p.filter((_, i) => i !== idx))}
                            className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {canWrite && (
                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingCharges}
                    className="rounded-xl bg-royal-600 px-4 py-2 text-xs font-bold text-white hover:bg-royal-700"
                  >
                    {savingCharges ? "Enregistrement…" : "Enregistrer les frais"}
                  </button>
                </div>
              )}
            </form>

            {/* Enregistrement manuel des paiements */}
            <div className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <h2 className="text-base font-extrabold text-navy-900 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-royal-600" aria-hidden="true" />
                <span>Paiements manuels ({activeOrder?.currency})</span>
              </h2>

              {canWrite && (
                <form onSubmit={handleRecordPayment} className="grid gap-2.5 sm:grid-cols-12 rounded-xl bg-slate-50 p-3 text-xs">
                  <input
                    required
                    placeholder={`Montant (${activeOrder?.currency})`}
                    value={payAmountStr}
                    onChange={(e) => setPayAmountStr(e.target.value)}
                    className="sm:col-span-3 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-bold"
                  />
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as typeof payMethod)}
                    className="sm:col-span-3 rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Référence reçue"
                    value={payRef}
                    onChange={(e) => setPayRef(e.target.value)}
                    className="sm:col-span-3 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5"
                  />
                  <input
                    type="date"
                    required
                    value={payDate}
                    onChange={(e) => setPayDate(e.target.value)}
                    className="sm:col-span-3 rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                  />
                  <div className="sm:col-span-12 flex justify-end">
                    <button
                      type="submit"
                      disabled={recordingPay}
                      className="rounded-lg bg-emerald-600 px-3.5 py-1.5 font-bold text-white hover:bg-emerald-700"
                    >
                      {recordingPay ? "Ajout…" : "+ Enregistrer le paiement reçu"}
                    </button>
                  </div>
                </form>
              )}

              <ul className="divide-y divide-slate-100 text-xs">
                {orderPayments.map((p) => (
                  <li key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className={p.voided ? "line-through text-slate-400" : ""}>
                      <strong>{formatMoney(p.amount, p.currency)}</strong> • {PAYMENT_METHOD_LABELS[p.method]} •{" "}
                      {formatIsoDate(p.receivedOn)}
                      {p.reference ? ` (${p.reference})` : ""}
                      {p.voidReason ? ` — Annulé : ${p.voidReason}` : ""}
                    </div>
                    {!p.voided && canWrite && (
                      <button
                        type="button"
                        onClick={() => setVoidTarget({ id: p.id, amount: p.amount, currency: p.currency })}
                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2 py-1 text-rose-700 hover:bg-rose-50"
                      >
                        <Ban className="h-3 w-3" aria-hidden="true" />
                        <span>Annuler</span>
                      </button>
                    )}
                  </li>
                ))}
                {orderPayments.length === 0 && (
                  <li className="py-3 text-slate-500">Aucun paiement enregistré pour cette commande.</li>
                )}
              </ul>
            </div>
          </div>
        </>
      )}

      {voidTarget && (
        <Modal title="Annuler ce paiement ?" onClose={() => setVoidTarget(null)} maxWidth="max-w-md">
          <div className="space-y-4">
            <p className="text-sm text-slate-700">
              Le paiement de {formatMoney(voidTarget.amount, voidTarget.currency)} sera marqué comme annulé dans l&apos;historique et le solde sera recalculé.
            </p>
            <div>
              <label htmlFor="void-reason" className="block text-xs font-bold text-slate-700 mb-1">
                Motif de l&apos;annulation *
              </label>
              <input
                id="void-reason"
                required
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVoidTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={handleVoidPayment}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-bold text-white hover:bg-rose-700"
              >
                Confirmer l&apos;annulation
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* =================================================== 11. PARAMÈTRES & RÔLES */
export function AdminSettingsPage() {
  const { claims } = useAuth();
  const { settings } = useSettings();
  const { privateSettings } = useAdminData();
  const { notify } = useToast();

  const [companyName, setCompanyName] = useState(settings.companyName);
  const [logoUrl, setLogoUrl] = useState(settings.logoUrl ?? "");
  const [whatsappNumber, setWhatsappNumber] = useState(settings.whatsappNumber ?? "");
  const [contactEmail, setContactEmail] = useState(settings.contactEmail ?? "");
  const [address, setAddress] = useState(settings.address ?? "");
  const [serviceArea, setServiceArea] = useState(settings.serviceArea ?? "");
  const [currency, setCurrency] = useState<Currency>(settings.currency);
  const [openingHours, setOpeningHours] = useState(settings.openingHours ?? "");
  const [serviceMessage, setServiceMessage] = useState(settings.serviceMessage ?? "");
  const [pickupInstructions, setPickupInstructions] = useState(settings.pickupInstructions ?? "");
  const [financeEnabled, setFinanceEnabled] = useState(settings.modules.finance);
  const [statusLabels, setStatusLabels] = useState<Partial<Record<StatusCode, string>>>(settings.statusLabels ?? {});

  const [inAppNotif, setInAppNotif] = useState(privateSettings?.notifications.inApp ?? true);
  const [emailNotif, setEmailNotif] = useState(privateSettings?.notifications.email ?? false);
  const [eventsNotif, setEventsNotif] = useState<Partial<Record<NotificationType, boolean>>>(
    privateSettings?.notifications.events ?? {},
  );
  const [saving, setSaving] = useState(false);

  // Gestion des employés
  const [staffUsers, setStaffUsers] = useState<UserDoc[]>([]);
  const [staffEmail, setStaffEmail] = useState("");
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState<"admin" | "staff" | "none">("staff");
  const [staffPerms, setStaffPerms] = useState<Permission[]>(["clients.read", "orders.read", "shipments.read", "shipments.write"]);
  const [savingStaff, setSavingStaff] = useState(false);

  useEffect(() => {
    setCompanyName(settings.companyName);
    setLogoUrl(settings.logoUrl ?? "");
    setWhatsappNumber(settings.whatsappNumber ?? "");
    setContactEmail(settings.contactEmail ?? "");
    setAddress(settings.address ?? "");
    setServiceArea(settings.serviceArea ?? "");
    setCurrency(settings.currency);
    setOpeningHours(settings.openingHours ?? "");
    setServiceMessage(settings.serviceMessage ?? "");
    setPickupInstructions(settings.pickupInstructions ?? "");
    setFinanceEnabled(settings.modules.finance);
    setStatusLabels(settings.statusLabels ?? {});
  }, [settings]);

  useEffect(() => {
    if (!privateSettings) return;
    setInAppNotif(privateSettings.notifications.inApp);
    setEmailNotif(privateSettings.notifications.email);
    setEventsNotif(privateSettings.notifications.events ?? {});
  }, [privateSettings]);

  const loadStaff = () => {
    getDocs(collection(getFirebaseDb(), "users"))
      .then((snap) => {
        const list = snap.docs.map((d) => d.data() as UserDoc).filter((u) => u.role === "admin" || u.role === "staff");
        setStaffUsers(list);
      })
      .catch(() => undefined);
  };

  useEffect(() => {
    loadStaff();
  }, []);

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateSettings({
        publicSettings: {
          companyName,
          logoUrl: logoUrl || null,
          whatsappNumber: whatsappNumber || null,
          contactEmail: contactEmail || null,
          address: address || null,
          serviceArea: serviceArea || null,
          currency,
          openingHours: openingHours || null,
          serviceMessage: serviceMessage || null,
          pickupInstructions: pickupInstructions || null,
          modules: { finance: financeEnabled },
          statusLabels,
          disabledStatuses: settings.disabledStatuses ?? [],
        },
        privateSettings: {
          notifications: {
            inApp: inAppNotif,
            email: emailNotif,
            events: eventsNotif,
          },
        },
      });
      notify("success", "Paramètres de l'entreprise enregistrés.");
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveStaff = async (e: FormEvent) => {
    e.preventDefault();
    setSavingStaff(true);
    try {
      await api.setStaffRole({
        email: staffEmail,
        role: staffRole,
        permissions: staffRole === "staff" ? staffPerms : [],
        displayName: staffName || null,
      });
      setStaffEmail("");
      setStaffName("");
      loadStaff();
      notify("success", "Rôle et permissions mis à jour côté serveur.");
    } catch (err) {
      notify("error", formatError(err));
    } finally {
      setSavingStaff(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Paramètres de l&apos;entreprise</h1>
        <p className="text-xs text-slate-600">
          Configurez les coordonnées officielles SHENA Express, le numéro WhatsApp, la devise, les notifications et les accès employés.
        </p>
      </div>

      <form onSubmit={handleSaveSettings} className="space-y-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-base font-extrabold text-navy-900">Identité &amp; coordonnées officielles</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="st-name" className="block text-xs font-bold text-slate-700 mb-1">
                Nom de l&apos;entreprise *
              </label>
              <input
                id="st-name"
                required
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="st-wa" className="block text-xs font-bold text-slate-700 mb-1">
                Numéro WhatsApp officiel (format international, ex. +509 …)
              </label>
              <input
                id="st-wa"
                placeholder="+509 …"
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="st-email" className="block text-xs font-bold text-slate-700 mb-1">
                E-mail professionnel
              </label>
              <input
                id="st-email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="st-currency" className="block text-xs font-bold text-slate-700 mb-1">
                Devise principale par défaut
              </label>
              <select
                id="st-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as Currency)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="st-addr" className="block text-xs font-bold text-slate-700 mb-1">
                Adresse de l&apos;entrepôt / agence
              </label>
              <input
                id="st-addr"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="st-area" className="block text-xs font-bold text-slate-700 mb-1">
                Zone desservie
              </label>
              <input
                id="st-area"
                value={serviceArea}
                onChange={(e) => setServiceArea(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="st-hours" className="block text-xs font-bold text-slate-700 mb-1">
                Horaires d&apos;ouverture
              </label>
              <input
                id="st-hours"
                value={openingHours}
                onChange={(e) => setOpeningHours(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="st-logo" className="block text-xs font-bold text-slate-700 mb-1">
                URL du logo personnalisé (HTTPS, optionnel)
              </label>
              <input
                id="st-logo"
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="st-msg" className="block text-xs font-bold text-slate-700 mb-1">
                Message de service (bannière d&apos;information client)
              </label>
              <textarea
                id="st-msg"
                rows={2}
                value={serviceMessage}
                onChange={(e) => setServiceMessage(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label htmlFor="st-pickup" className="block text-xs font-bold text-slate-700 mb-1">
                Instructions de retrait par défaut
              </label>
              <textarea
                id="st-pickup"
                rows={2}
                value={pickupInstructions}
                onChange={(e) => setPickupInstructions(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-navy-900">
            <input
              type="checkbox"
              checked={financeEnabled}
              onChange={(e) => setFinanceEnabled(e.target.checked)}
              className="rounded border-slate-300"
            />
            <span>Activer le module financier (frais, paiements manuels et soldes visibles par les clients)</span>
          </label>
        </section>

        {/* Paramètres de notifications */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-base font-extrabold text-navy-900">Paramètres de notifications</h2>
          <div className="flex flex-wrap gap-6 text-xs font-bold text-slate-800">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={inAppNotif}
                onChange={(e) => setInAppNotif(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Notifications dans l&apos;application</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={emailNotif}
                onChange={(e) => setEmailNotif(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Notifications par e-mail (si un service d&apos;envoi `MAIL_COLLECTION` est configuré)</span>
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-4 text-xs">
            {(Object.keys(NOTIFICATION_LABELS) as NotificationType[]).map((type) => (
              <label key={type} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <input
                  type="checkbox"
                  checked={eventsNotif[type] !== false}
                  onChange={(e) => setEventsNotif((p) => ({ ...p, [type]: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                <span>{NOTIFICATION_LABELS[type]}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Personnalisation des libellés des 15 statuts */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-base font-extrabold text-navy-900">Configuration des libellés de suivi (optionnel)</h2>
          <div className="grid gap-2.5 sm:grid-cols-3 text-xs">
            {STATUS_CODES.map((code) => (
              <div key={code}>
                <label className="block text-[11px] font-semibold text-slate-500 mb-0.5">
                  {STATUS_DEFINITIONS[code].label}
                </label>
                <input
                  placeholder={STATUS_DEFINITIONS[code].label}
                  value={statusLabels[code] ?? ""}
                  onChange={(e) => setStatusLabels((p) => ({ ...p, [code]: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs"
                />
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-royal-600 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-royal-700"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            <span>{saving ? "Enregistrement…" : "Enregistrer tous les paramètres"}</span>
          </button>
        </div>
      </form>

      {/* Gestion des rôles employés (réservé aux administrateurs) */}
      {claims?.role === "admin" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-base font-extrabold text-navy-900 flex items-center gap-2">
            <UserCog className="h-4 w-4 text-royal-600" aria-hidden="true" />
            <span>Comptes administrateurs &amp; employés (permissions limitées)</span>
          </h2>
          <form onSubmit={handleSaveStaff} className="space-y-3 rounded-xl bg-slate-50 p-4 text-xs">
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="email"
                required
                placeholder="E-mail de l'employé / admin *"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
              <input
                placeholder="Nom complet"
                value={staffName}
                onChange={(e) => setStaffName(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
              <select
                value={staffRole}
                onChange={(e) => setStaffRole(e.target.value as typeof staffRole)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold"
              >
                <option value="staff">Employé (permissions choisies)</option>
                <option value="admin">Administrateur complet</option>
                <option value="none">Révoquer tout accès</option>
              </select>
            </div>
            {staffRole === "staff" && (
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-5 pt-1">
                {PERMISSIONS.map((perm) => (
                  <label key={perm} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={staffPerms.includes(perm)}
                      onChange={(e) =>
                        setStaffPerms((prev) =>
                          e.target.checked ? [...prev, perm] : prev.filter((p) => p !== perm),
                        )
                      }
                      className="rounded border-slate-300"
                    />
                    <span>{PERMISSION_LABELS[perm]}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingStaff}
                className="rounded-xl bg-navy-900 px-4 py-2 font-bold text-white hover:bg-navy-800"
              >
                {savingStaff ? "Application…" : "Appliquer le rôle côté serveur"}
              </button>
            </div>
          </form>

          <ul className="divide-y divide-slate-100 text-xs">
            {staffUsers.map((u) => (
              <li key={u.uid} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <strong>{u.displayName}</strong> ({u.email}) —{" "}
                  <span className="uppercase font-bold text-royal-600">{u.role}</span>
                </div>
                {u.role === "staff" && (
                  <span className="text-slate-500">
                    Permissions : {(u.permissions ?? []).join(", ") || "aucune"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/* =================================================== JOURNAL D'AUDIT ADMIN */
export function AdminAuditPage() {
  const { auditLogs } = useAdminData();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auditLogs.filter(
      (l) =>
        !q ||
        l.summary.toLowerCase().includes(q) ||
        l.action.toLowerCase().includes(q) ||
        l.targetId.toLowerCase().includes(q),
    );
  }, [auditLogs, search]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Historique des actions administratives</h1>
        <p className="text-xs text-slate-600">
          Journal immuable des créations, modifications de statuts, réceptions, opérations financières et changements de rôles.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <input
          type="search"
          placeholder="Filtrer par action, cible ou résumé…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Aucune entrée d'audit" description="Les actions administratives apparaissent ici automatiquement." />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 uppercase text-slate-500">
                  <th className="py-3 px-4">Date &amp; heure</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Cible</th>
                  <th className="py-3 px-4">Résumé</th>
                  <th className="py-3 px-4">Rôle auteur</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 text-slate-500 whitespace-nowrap">
                      {log.at?.toDate ? log.at.toDate().toLocaleString("fr-FR") : "—"}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-bold text-royal-700">{log.action}</td>
                    <td className="py-2.5 px-4 font-semibold text-navy-900">{log.targetId}</td>
                    <td className="py-2.5 px-4 text-slate-800">{log.summary}</td>
                    <td className="py-2.5 px-4 uppercase font-bold text-slate-500">{log.actorRole}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
