import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Clock,
  Truck,
  PackageCheck,
  MapPin,
  XCircle,
  MessageCircle,
  Info,
  X,
  Plane,
  Ship,
  ExternalLink,
} from "lucide-react";
import {
  STATUS_DEFINITIONS,
  PROGRESS_STEPS,
  progressStep,
  DATE_FIELD_LABELS,
  formatIsoDate,
  buildWhatsappMessage,
  buildWhatsappUrl,
  type StatusCode,
  type StatusTone,
  type TrackingEventDoc,
  type TransportMode,
  type ShipmentDates,
} from "@shared/index";
import { useSettings } from "@/contexts/SettingsContext";

/* ------------------------------------------------------------------- Logo */
export function ShenaLogo({
  variant = "dark",
  subtitle,
  size = "md",
}: {
  variant?: "dark" | "light";
  subtitle?: string;
  size?: "sm" | "md" | "lg";
}) {
  const { settings } = useSettings();
  const textColor = variant === "light" ? "text-white" : "text-navy-900";
  const subColor = variant === "light" ? "text-amber-300" : "text-gold-600";
  const boxSize = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const titleSize = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";

  return (
    <div className="inline-flex items-center gap-3 select-none">
      {settings.logoUrl ? (
        <img
          src={settings.logoUrl}
          alt={settings.companyName}
          className={`${boxSize} rounded-xl object-contain bg-navy-900 p-1`}
        />
      ) : (
        <svg
          viewBox="0 0 64 64"
          role="img"
          aria-label="Logo SHENA Express"
          className={`${boxSize} shrink-0 rounded-xl shadow-sm`}
        >
          <rect width="64" height="64" rx="14" fill="#0f2342" />
          <path d="M11 22h25l8 10-8 10H11l7-10-7-10z" fill="#1d4ed8" />
          <path d="M25 17h17l10 15-10 15H25l9-15-9-15z" fill="#d4a017" />
          <circle cx="49" cy="32" r="3" fill="#ffffff" />
        </svg>
      )}
      <div className="leading-tight">
        <div className={`font-extrabold tracking-tight ${titleSize} ${textColor}`}>
          SHENA <span className={subColor}>Express</span>
        </div>
        {subtitle && (
          <div className={`text-[11px] font-semibold uppercase tracking-wider ${variant === "light" ? "text-slate-300" : "text-slate-500"}`}>
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- Status Badge */
const TONE_STYLES: Record<StatusTone, { bg: string; text: string; ring: string; dot: string }> = {
  neutral: {
    bg: "bg-slate-100",
    text: "text-slate-800",
    ring: "ring-slate-300",
    dot: "bg-slate-500",
  },
  received: {
    bg: "bg-sky-50",
    text: "text-sky-900",
    ring: "ring-sky-300",
    dot: "bg-sky-600",
  },
  transit: {
    bg: "bg-blue-50",
    text: "text-blue-900",
    ring: "ring-blue-300",
    dot: "bg-royal-600",
  },
  arrived: {
    bg: "bg-amber-50",
    text: "text-amber-950",
    ring: "ring-amber-300",
    dot: "bg-gold-500",
  },
  delivered: {
    bg: "bg-emerald-50",
    text: "text-emerald-900",
    ring: "ring-emerald-300",
    dot: "bg-emerald-600",
  },
  warning: {
    bg: "bg-orange-50",
    text: "text-orange-900",
    ring: "ring-orange-300",
    dot: "bg-orange-600",
  },
  danger: {
    bg: "bg-rose-50",
    text: "text-rose-900",
    ring: "ring-rose-300",
    dot: "bg-rose-600",
  },
};

function StatusIcon({ tone }: { tone: StatusTone }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  switch (tone) {
    case "received":
      return <PackageCheck className={cls} aria-hidden="true" />;
    case "transit":
      return <Truck className={cls} aria-hidden="true" />;
    case "arrived":
      return <MapPin className={cls} aria-hidden="true" />;
    case "delivered":
      return <CheckCircle2 className={cls} aria-hidden="true" />;
    case "warning":
      return <AlertTriangle className={cls} aria-hidden="true" />;
    case "danger":
      return <XCircle className={cls} aria-hidden="true" />;
    default:
      return <Clock className={cls} aria-hidden="true" />;
  }
}

export function StatusBadge({ status, size = "md" }: { status: StatusCode; size?: "sm" | "md" }) {
  const { labelForStatus } = useSettings();
  const def = STATUS_DEFINITIONS[status] ?? STATUS_DEFINITIONS.registered;
  const style = TONE_STYLES[def.tone];
  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold ring-1 ring-inset ${pad} ${style.bg} ${style.text} ${style.ring}`}
    >
      <StatusIcon tone={def.tone} />
      <span>{labelForStatus(status)}</span>
    </span>
  );
}

/* --------------------------------------------------------- Transport Badge */
export function TransportBadge({ mode }: { mode?: TransportMode | null }) {
  if (!mode) return <span className="text-xs text-slate-400">Non défini</span>;
  const isAir = mode === "air";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
      {isAir ? <Plane className="h-3.5 w-3.5 text-royal-600" aria-hidden="true" /> : <Ship className="h-3.5 w-3.5 text-navy-800" aria-hidden="true" />}
      {isAir ? "Aérien" : "Maritime"}
    </span>
  );
}

/* ---------------------------------------------------- Shipment ProgressBar */
export function ShipmentProgress({ status, lastStep = 0 }: { status: StatusCode; lastStep?: number }) {
  const { labelForStatus } = useSettings();
  const current = progressStep(status, lastStep);

  if (status === "cancelled") {
    return (
      <div
        role="region"
        aria-label="Progression de l'envoi"
        className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 flex items-center gap-2"
      >
        <XCircle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
        <span>Cet envoi a été annulé.</span>
      </div>
    );
  }

  return (
    <div role="region" aria-label={`Progression : ${labelForStatus(status)}`} className="space-y-2">
      {(status === "delayed" || status === "info_required") && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-900 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600" aria-hidden="true" />
          <span>Statut particulier en cours : {labelForStatus(status)}</span>
        </div>
      )}
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        {PROGRESS_STEPS.map((item) => {
          const done = current !== null && item.step < current;
          const active = current === item.step;
          return (
            <li
              key={item.step}
              aria-current={active ? "step" : undefined}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-semibold transition ${
                active
                  ? "border-royal-600 bg-blue-50 text-navy-900 shadow-xs"
                  : done
                    ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
                    : "border-slate-200 bg-white text-slate-400"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  active
                    ? "bg-royal-600 text-white"
                    : done
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-500"
                }`}
              >
                {done ? "✓" : item.step + 1}
              </span>
              <span className="truncate">{item.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------- Tracking Timeline */
export interface TrackingEventWithId extends TrackingEventDoc {
  id: string;
}

function formatEventTimestamp(at: TrackingEventDoc["at"]): string {
  if (!at || typeof at.toDate !== "function") return "À l'instant";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at.toDate());
}

export function TrackingTimeline({
  events,
  internalNotesById,
}: {
  events: TrackingEventWithId[];
  /** Si fourni (vue administrateur uniquement), affiche la note interne séparée. */
  internalNotesById?: Record<string, string>;
}) {
  const { labelForStatus } = useSettings();

  const sorted = [...events].sort((a, b) => {
    const ta = a.at && typeof a.at.toMillis === "function" ? a.at.toMillis() : 0;
    const tb = b.at && typeof b.at.toMillis === "function" ? b.at.toMillis() : 0;
    return ta - tb;
  });

  if (sorted.length === 0) {
    return <p className="text-sm text-slate-500 py-4">Aucun événement enregistré pour le moment.</p>;
  }

  return (
    <ol className="relative border-s-2 border-slate-200 ms-3 space-y-5 py-1">
      {sorted.map((ev) => {
        const dateKeys = ev.dateChanges ? Object.keys(ev.dateChanges) : [];
        const internal = internalNotesById?.[ev.id];
        return (
          <li key={ev.id} className="ms-5">
            <span
              className="absolute -start-[9px] mt-1.5 h-4 w-4 rounded-full border-2 border-white bg-royal-600 shadow-xs"
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {ev.toStatus ? (
                  <StatusBadge status={ev.toStatus} size="sm" />
                ) : (
                  <span className="text-xs font-semibold text-navy-900">Mise à jour des dates</span>
                )}
                {ev.fromStatus && ev.toStatus && ev.fromStatus !== ev.toStatus && (
                  <span className="text-xs text-slate-500">
                    (précédemment : {labelForStatus(ev.fromStatus)})
                  </span>
                )}
              </div>
              <time className="text-xs font-medium text-slate-500">{formatEventTimestamp(ev.at)}</time>
            </div>
            {ev.publicNote && <p className="mt-1.5 text-sm text-slate-700">{ev.publicNote}</p>}
            {dateKeys.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                {dateKeys.map((k) => {
                  const [before, after] = ev.dateChanges![k]!;
                  const label = DATE_FIELD_LABELS[k as keyof ShipmentDates] ?? k;
                  return (
                    <li key={k}>
                      <span className="font-medium">{label} :</span>{" "}
                      {before ? `${formatIsoDate(before)} → ` : ""}
                      <span className="font-semibold text-navy-900">{formatIsoDate(after)}</span>{" "}
                      <span className="text-slate-500">(estimation)</span>
                    </li>
                  );
                })}
              </ul>
            )}
            {internal && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs text-amber-950">
                <span className="font-semibold">Note interne (privée) :</span> {internal}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------------------------------- WhatsApp Button */
export function WhatsappContactButton({
  orderId,
  trackingNumber,
  clientId,
  compact = false,
}: {
  orderId?: string | null;
  trackingNumber?: string | null;
  clientId?: string | null;
  compact?: boolean;
}) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const defaultMsg = buildWhatsappMessage({
    orderId,
    trackingNumber,
    clientId,
    companyName: settings.companyName,
  });
  const [message, setMessage] = useState(defaultMsg);

  const openEditor = () => {
    setMessage(
      buildWhatsappMessage({
        orderId,
        trackingNumber,
        clientId,
        companyName: settings.companyName,
      }),
    );
    setOpen(true);
  };

  const url = buildWhatsappUrl(settings.whatsappNumber, message);

  return (
    <>
      <button
        type="button"
        onClick={openEditor}
        disabled={!settings.whatsappNumber}
        title={
          settings.whatsappNumber
            ? "Ouvrir WhatsApp avec un message prérempli"
            : "Numéro WhatsApp officiel non configuré dans les paramètres"
        }
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 font-semibold text-white shadow-xs transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 ${
          compact ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm"
        }`}
      >
        <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>Contacter {settings.companyName} sur WhatsApp</span>
      </button>

      {open && (
        <Modal title={`Contacter ${settings.companyName} sur WhatsApp`} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Vérifiez ou modifiez librement votre message ci-dessous avant d&apos;ouvrir WhatsApp. Le message ne sera
              envoyé que lorsque vous le validerez vous-même dans WhatsApp.
            </p>
            <div>
              <label htmlFor="wa-message" className="block text-xs font-semibold text-slate-700 mb-1">
                Message prérempli
              </label>
              <textarea
                id="wa-message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-royal-600"
              />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Annuler
              </button>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  <span>Ouvrir dans WhatsApp</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              ) : (
                <span className="text-xs text-rose-700">Numéro WhatsApp non configuré.</span>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- Modal */
export function Modal({
  title,
  onClose,
  children,
  maxWidth = "max-w-lg",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 p-4 backdrop-blur-[1px] overflow-y-auto"
    >
      <div className={`w-full ${maxWidth} rounded-2xl bg-white shadow-xl border border-slate-200 my-8`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-bold text-navy-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer la fenêtre"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Confirm Dialog */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <Modal title={title} onClose={onCancel} maxWidth="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-slate-700">{description}</p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-xs ${
              danger ? "bg-rose-600 hover:bg-rose-700" : "bg-royal-600 hover:bg-royal-700"
            } disabled:opacity-60`}
          >
            {busy ? "Traitement…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- Empty State */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
        <Info className="h-5 w-5" aria-hidden="true" />
      </div>
      <h3 className="text-sm font-bold text-navy-900">{title}</h3>
      <p className="mt-1 text-xs text-slate-600 max-w-md mx-auto">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/* ----------------------------------------------------------- Toast System */
interface ToastItem {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

interface ToastContextValue {
  notify: (kind: ToastItem["kind"], message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({ notify: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const notify = useCallback((kind: ToastItem["kind"], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] pointer-events-none"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium shadow-lg ${
              t.kind === "success"
                ? "border-emerald-200 bg-emerald-950 text-white"
                : t.kind === "error"
                  ? "border-rose-200 bg-rose-950 text-white"
                  : "border-slate-200 bg-navy-900 text-white"
            }`}
          >
            {t.kind === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" aria-hidden="true" />
            ) : t.kind === "error" ? (
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" aria-hidden="true" />
            ) : (
              <Info className="h-4 w-4 shrink-0 text-amber-300 mt-0.5" aria-hidden="true" />
            )}
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              aria-label="Fermer la notification"
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="text-slate-300 hover:text-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
