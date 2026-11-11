import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Bell,
  LogOut,
  Menu,
  X,
  Search,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  ChevronRight,
  CreditCard,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useI18n } from "@/i18n";
import { getFirebaseDb } from "@/lib/firebase";
import {
  STATUS_CODES,
  countShipmentsByBucket,
  sumOrderStats,
  relevantDates,
  isLate,
  todayIso,
  formatIsoDate,
  formatMoney,
  PAYMENT_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  type ClientDoc,
  type OrderDoc,
  type ShipmentDoc,
  type NotificationDoc,
  type OrderFinanceDoc,
  type PaymentRecordDoc,
} from "@shared/index";
import {
  ShenaLogo,
  StatusBadge,
  TransportBadge,
  ShipmentProgress,
  TrackingTimeline,
  WhatsappContactButton,
  EmptyState,
  type TrackingEventWithId,
} from "@/components/ui";

interface ClientDataContextValue {
  profile: ClientDoc | null;
  orders: OrderDoc[];
  shipments: ShipmentDoc[];
  events: TrackingEventWithId[];
  notifications: (NotificationDoc & { id: string })[];
  finances: Record<string, OrderFinanceDoc>;
  loading: boolean;
}

import { createContext, useContext } from "react";
const ClientDataContext = createContext<ClientDataContextValue>({
  profile: null,
  orders: [],
  shipments: [],
  events: [],
  notifications: [],
  finances: {},
  loading: true,
});

function useClientData() {
  return useContext(ClientDataContext);
}

/* ----------------------------------------------------- Layout Espace Client */
export function ClientLayout() {
  const { user, claims, signOut } = useAuth();
  const { settings } = useSettings();
  const { t, locale, setLocale, locales } = useI18n();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [profile, setProfile] = useState<ClientDoc | null>(null);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [shipments, setShipments] = useState<ShipmentDoc[]>([]);
  const [events, setEvents] = useState<TrackingEventWithId[]>([]);
  const [notifications, setNotifications] = useState<(NotificationDoc & { id: string })[]>([]);
  const [finances, setFinances] = useState<Record<string, OrderFinanceDoc>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const db = getFirebaseDb();
    const uid = user.uid;
    const unsubs: (() => void)[] = [];

    if (claims?.clientId) {
      unsubs.push(
        onSnapshot(doc(db, "clients", claims.clientId), (snap) => {
          setProfile(snap.exists() ? (snap.data() as ClientDoc) : null);
        }),
      );
    }

    unsubs.push(
      onSnapshot(
        query(collection(db, "orders"), where("clientUid", "==", uid)),
        (snap) => {
          const list = snap.docs.map((d) => d.data() as OrderDoc);
          list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
          setOrders(list);
          setLoading(false);
        },
        () => setLoading(false),
      ),
    );

    unsubs.push(
      onSnapshot(query(collection(db, "shipments"), where("clientUid", "==", uid)), (snap) => {
        const list = snap.docs.map((d) => d.data() as ShipmentDoc);
        list.sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
        setShipments(list);
      }),
    );

    unsubs.push(
      onSnapshot(query(collection(db, "shipmentEvents"), where("clientUid", "==", uid)), (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackingEventWithId, "id">) }));
        list.sort((a, b) => (b.at?.toMillis?.() ?? 0) - (a.at?.toMillis?.() ?? 0));
        setEvents(list);
      }),
    );

    unsubs.push(
      onSnapshot(query(collection(db, "notifications"), where("recipientUid", "==", uid)), (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as NotificationDoc) }));
        list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setNotifications(list);
      }),
    );

    if (settings.modules.finance) {
      unsubs.push(
        onSnapshot(
          query(collection(db, "orderFinance"), where("clientUid", "==", uid)),
          (snap) => {
            const map: Record<string, OrderFinanceDoc> = {};
            for (const d of snap.docs) {
              const data = d.data() as OrderFinanceDoc;
              map[data.orderId] = data;
            }
            setFinances(map);
          },
          () => setFinances({}),
        ),
      );
    } else {
      setFinances({});
    }

    return () => unsubs.forEach((u) => u());
  }, [user, claims?.clientId, settings.modules.finance]);

  const unreadCount = notifications.filter((n) => !n.readAt).length;

  const navItems = [
    { to: "/espace-client", end: true, label: t.nav.myDashboard, icon: LayoutDashboard },
    { to: "/espace-client/commandes", end: false, label: t.nav.myOrders, icon: ShoppingBag },
    { to: "/espace-client/colis", end: false, label: t.nav.myShipments, icon: Package },
    { to: "/espace-client/notifications", end: false, label: t.nav.notifications, icon: Bell, badge: unreadCount },
  ];

  const handleSignOut = async () => {
    await signOut();
    navigate("/connexion", { replace: true });
  };

  return (
    <ClientDataContext.Provider value={{ profile, orders, shipments, events, notifications, finances, loading }}>
      <div className="min-h-screen flex flex-col bg-slate-50">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-royal-600 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
        >
          {t.nav.skipToContent}
        </a>

        {/* Barre supérieure */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-navy-900 text-white">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
                aria-expanded={mobileOpen}
                className="lg:hidden rounded-lg p-2 text-slate-200 hover:bg-white/10"
              >
                {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
              <Link to="/espace-client">
                <ShenaLogo variant="light" size="sm" subtitle="Espace client" />
              </Link>
            </div>

            <nav aria-label="Navigation client principale" className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                        isActive ? "bg-royal-600 text-white" : "text-slate-200 hover:bg-white/10"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                    {item.badge ? (
                      <span className="rounded-full bg-gold-500 px-1.5 py-0.5 text-[10px] font-extrabold text-navy-950">
                        {item.badge}
                      </span>
                    ) : null}
                  </NavLink>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              {claims?.clientId && (
                <span className="hidden sm:inline-block rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-amber-300">
                  {claims.clientId}
                </span>
              )}
              <select
                aria-label="Langue"
                value={locale}
                onChange={(e) => setLocale(e.target.value as "fr" | "ht" | "en")}
                className="rounded-lg border border-white/20 bg-navy-800 px-2 py-1 text-xs font-semibold text-white"
              >
                {Object.entries(locales).map(([code, label]) => (
                  <option key={code} value={code}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">{t.nav.signOut}</span>
              </button>
            </div>
          </div>

          {/* Menu mobile */}
          {mobileOpen && (
            <nav aria-label="Menu mobile client" className="lg:hidden border-t border-white/10 bg-navy-950 px-4 py-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm font-bold ${
                        isActive ? "bg-royal-600 text-white" : "text-slate-200 hover:bg-white/10"
                      }`
                    }
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      <span>{item.label}</span>
                    </span>
                    {item.badge ? (
                      <span className="rounded-full bg-gold-500 px-2 py-0.5 text-xs font-extrabold text-navy-950">
                        {item.badge}
                      </span>
                    ) : null}
                  </NavLink>
                );
              })}
            </nav>
          )}
        </header>

        <main id="main-content" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </ClientDataContext.Provider>
  );
}

/* ------------------------------------------- A. Tableau de bord du Client */
export function ClientDashboardPage() {
  const { claims } = useAuth();
  const { settings, labelForStatus } = useSettings();
  const { profile, orders, shipments, events, loading } = useClientData();

  const stats = useMemo(() => sumOrderStats(orders.map((o) => o.stats)), [orders]);
  const buckets = useMemo(() => countShipmentsByBucket(shipments), [shipments]);

  const upcomingDates = useMemo(() => {
    const list: { shipmentId: string; trackingNumber: string; label: string; value: string }[] = [];
    for (const s of shipments) {
      if (s.status === "delivered" || s.status === "cancelled") continue;
      const rel = relevantDates(s.status, s.dates ?? {});
      for (const r of rel) {
        if (r.estimate || r.field === "availableAt") {
          list.push({
            shipmentId: s.shipmentId,
            trackingNumber: s.trackingNumber,
            label: r.label,
            value: r.value,
          });
        }
      }
    }
    return list.sort((a, b) => a.value.localeCompare(b.value)).slice(0, 5);
  }, [shipments]);

  if (loading) {
    return <p className="text-sm text-slate-600 py-8">Chargement de votre espace personnel…</p>;
  }

  return (
    <div className="space-y-6">
      {/* En-tête de bienvenue */}
      <section className="rounded-3xl bg-navy-900 text-white p-6 sm:p-8 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1.5">
          <span className="inline-block rounded-full bg-white/10 px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-amber-300">
            Identifiant : {profile?.clientId ?? claims?.clientId ?? "—"}
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold">
            Bienvenue{profile?.fullName ? `, ${profile.fullName}` : ""}
          </h1>
          <p className="text-sm text-slate-300">
            Consultez en temps réel l&apos;état de vos commandes, de vos articles et de vos colis.
          </p>
        </div>
        <div className="shrink-0">
          <WhatsappContactButton clientId={profile?.clientId ?? claims?.clientId} />
        </div>
      </section>

      {settings.serviceMessage && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950">
          <span className="font-bold">Note {settings.companyName} :</span> {settings.serviceMessage}
        </div>
      )}

      {/* Cartes d'indicateurs calculés à partir des données réelles */}
      <section aria-label="Indicateurs personnels" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Commandes" value={orders.length} tone="navy" />
        <KpiCard label="Articles commandés" value={stats.ordered} tone="neutral" />
        <KpiCard label="Articles reçus" value={stats.received} tone="sky" />
        <KpiCard label="Colis en transit" value={buckets.transit} tone="blue" />
        <KpiCard label="Colis disponibles" value={buckets.available} tone="amber" />
        <KpiCard label="Colis livrés" value={buckets.delivered} tone="emerald" />
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Prochaines dates estimées */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-navy-900 flex items-center gap-2">
              <Calendar className="h-4 w-4 text-royal-600" aria-hidden="true" />
              <span>Prochaines dates estimées</span>
            </h2>
            <Link to="/espace-client/colis" className="text-xs font-bold text-royal-600 hover:underline">
              Voir tous les colis →
            </Link>
          </div>
          {upcomingDates.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              Aucune date estimée en attente pour le moment.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcomingDates.map((d, idx) => (
                <li key={`${d.shipmentId}-${idx}`} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <Link
                      to={`/espace-client/colis/${d.shipmentId}`}
                      className="text-sm font-bold text-navy-900 hover:text-royal-600"
                    >
                      Colis {d.trackingNumber}
                    </Link>
                    <p className="text-xs text-slate-500">{d.label} (estimation)</p>
                  </div>
                  <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-royal-700">
                    {formatIsoDate(d.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-500">
            Les dates affichées sont des estimations fournies à titre indicatif et non des garanties.
          </p>
        </section>

        {/* Dernières mises à jour */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-navy-900">Dernières mises à jour</h2>
            <Link to="/espace-client/commandes" className="text-xs font-bold text-royal-600 hover:underline">
              Mes commandes →
            </Link>
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">Aucune mise à jour enregistrée pour le moment.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {events.slice(0, 6).map((ev) => (
                <li key={ev.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-navy-900">
                      {ev.shipmentId ? (
                        <Link to={`/espace-client/colis/${ev.shipmentId}`} className="hover:text-royal-600">
                          Colis {ev.shipmentId}
                        </Link>
                      ) : ev.orderId ? (
                        <Link to={`/espace-client/commandes/${ev.orderId}`} className="hover:text-royal-600">
                          Commande {ev.orderId}
                        </Link>
                      ) : (
                        "Suivi"
                      )}
                    </span>
                    {ev.toStatus && (
                      <span className="text-xs font-semibold text-royal-600">{labelForStatus(ev.toStatus)}</span>
                    )}
                  </div>
                  {ev.publicNote && <p className="text-xs text-slate-600">{ev.publicNote}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "navy" | "neutral" | "sky" | "blue" | "amber" | "emerald";
}) {
  const tones = {
    navy: "border-navy-900/15 bg-white text-navy-900",
    neutral: "border-slate-200 bg-white text-slate-900",
    sky: "border-sky-200 bg-sky-50/50 text-sky-950",
    blue: "border-blue-200 bg-blue-50/50 text-blue-950",
    amber: "border-amber-200 bg-amber-50/60 text-amber-950",
    emerald: "border-emerald-200 bg-emerald-50/50 text-emerald-950",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-xs ${tones[tone]}`}>
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      <div className="mt-1.5 text-2xl font-extrabold tracking-tight">{value}</div>
    </div>
  );
}

/* --------------------------------------------------- B. Mes Commandes */
export function ClientOrdersPage() {
  const { settings, labelForStatus } = useSettings();
  const { orders, finances } = useClientData();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (!q) return true;
      return (
        o.orderId.toLowerCase().includes(q) ||
        (o.merchant ?? "").toLowerCase().includes(q) ||
        (o.merchantOrderRef ?? "").toLowerCase().includes(q) ||
        o.items.some((i) => i.description.toLowerCase().includes(q))
      );
    });
  }, [orders, search, statusFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Mes commandes</h1>
          <p className="text-xs text-slate-600">
            Consultez le détail de vos articles commandés, reçus et expédiés.
          </p>
        </div>
      </div>

      {/* Filtres */}
      <div className="grid gap-3 sm:grid-cols-12 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <div className="sm:col-span-7 relative">
          <label htmlFor="client-order-search" className="sr-only">
            Rechercher une référence
          </label>
          <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" aria-hidden="true" />
          <input
            id="client-order-search"
            type="search"
            placeholder="Rechercher par numéro de commande, vendeur ou article…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-300 ps-10 pe-3 py-2 text-sm"
          />
        </div>
        <div className="sm:col-span-5">
          <label htmlFor="client-order-status" className="sr-only">
            Filtrer par statut
          </label>
          <select
            id="client-order-status"
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
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title="Aucune commande trouvée"
          description="Aucune commande ne correspond à vos critères actuels."
        />
      ) : (
        <div className="grid gap-4">
          {filtered.map((o) => {
            const fin = settings.modules.finance ? finances[o.orderId] : undefined;
            return (
              <article
                key={o.orderId}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs hover:border-royal-500/50 transition"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        to={`/espace-client/commandes/${o.orderId}`}
                        className="text-base font-extrabold text-navy-900 hover:text-royal-600"
                      >
                        {o.orderId}
                      </Link>
                      <StatusBadge status={o.status} />
                      <TransportBadge mode={o.transportMode} />
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Date de commande : {formatIsoDate(o.orderDate)}
                      {o.merchant ? ` • Vendeur : ${o.merchant}` : ""}
                      {o.merchantOrderRef ? ` (Réf. ${o.merchantOrderRef})` : ""}
                    </p>
                  </div>
                  <Link
                    to={`/espace-client/commandes/${o.orderId}`}
                    className="inline-flex items-center gap-1 rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-navy-900 hover:bg-royal-600 hover:text-white transition"
                  >
                    <span>Ouvrir le détail</span>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-xl bg-slate-50 p-3 text-xs">
                  <div>
                    <span className="text-slate-500">Articles commandés :</span>{" "}
                    <span className="font-bold text-slate-900">{o.stats.ordered}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Articles reçus :</span>{" "}
                    <span className="font-bold text-sky-900">{o.stats.received}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Articles expédiés :</span>{" "}
                    <span className="font-bold text-royal-700">{o.stats.shipped}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Colis associés :</span>{" "}
                    <span className="font-bold text-slate-900">{o.shipmentIds.length}</span>
                  </div>
                </div>

                {fin && fin.totalDue > 0 && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                    <span className="text-slate-600">
                      Total dû : <strong>{formatMoney(fin.totalDue, fin.currency)}</strong> • Payé :{" "}
                      <strong>{formatMoney(fin.totalPaid, fin.currency)}</strong>
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-bold ${
                        fin.balance <= 0 ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"
                      }`}
                    >
                      Solde : {formatMoney(fin.balance, fin.currency)} ({PAYMENT_STATUS_LABELS[fin.paymentStatus]})
                    </span>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------- C. Détail d'une Commande */
export function ClientOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { user } = useAuth();
  const { settings } = useSettings();
  const { orders, shipments, events, finances } = useClientData();
  const [payments, setPayments] = useState<(PaymentRecordDoc & { id: string })[]>([]);

  const order = orders.find((o) => o.orderId === orderId);
  const orderShipments = useMemo(
    () => shipments.filter((s) => order && s.orderIds.includes(order.orderId)),
    [shipments, order],
  );
  const orderEvents = useMemo(() => {
    if (!order) return [];
    const shipIds = new Set(orderShipments.map((s) => s.shipmentId));
    return events.filter((e) => e.orderId === order.orderId || (e.shipmentId && shipIds.has(e.shipmentId)));
  }, [events, order, orderShipments]);

  useEffect(() => {
    if (!user || !orderId || !settings.modules.finance) return;
    const unsub = onSnapshot(
      query(
        collection(getFirebaseDb(), "paymentRecords"),
        where("clientUid", "==", user.uid),
        where("orderId", "==", orderId),
      ),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as PaymentRecordDoc) }));
        list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
        setPayments(list);
      },
      () => setPayments([]),
    );
    return () => unsub();
  }, [user, orderId, settings.modules.finance]);

  if (!order) {
    return (
      <EmptyState
        title="Commande introuvable"
        description="Cette commande n'existe pas ou n'appartient pas à votre compte."
        action={
          <Link to="/espace-client/commandes" className="text-xs font-bold text-royal-600 hover:underline">
            ← Retour à mes commandes
          </Link>
        }
      />
    );
  }

  const fin = settings.modules.finance ? finances[order.orderId] : undefined;
  const primaryTracking = orderShipments[0]?.trackingNumber ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/espace-client/commandes"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-navy-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Retour à mes commandes</span>
        </Link>
        <WhatsappContactButton
          orderId={order.orderId}
          trackingNumber={primaryTracking}
          clientId={order.clientId}
        />
      </div>

      {/* En-tête commande */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">{order.orderId}</h1>
              <StatusBadge status={order.status} />
              <TransportBadge mode={order.transportMode} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Enregistrée le {formatIsoDate(order.orderDate)}
              {order.merchant ? ` • Vendeur : ${order.merchant}` : ""}
              {order.merchantOrderRef ? ` • Réf. marchand : ${order.merchantOrderRef}` : ""}
            </p>
          </div>
        </div>

        <ShipmentProgress status={order.status} />

        {order.publicNote && (
          <div className="rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-xs text-blue-950">
            <span className="font-bold">Information : </span>
            {order.publicNote}
          </div>
        )}
      </section>

      {/* Articles commandés, reçus et restant à recevoir */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-navy-900">Articles de la commande</h2>
          <div className="flex flex-wrap gap-3 text-xs font-semibold">
            <span>Commandés : {order.stats.ordered}</span>
            <span className="text-sky-800">Reçus : {order.stats.received}</span>
            <span className="text-amber-800">
              Restant à recevoir : {Math.max(0, order.stats.ordered - order.stats.received)}
            </span>
            <span className="text-royal-700">Expédiés : {order.stats.shipped}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <th className="py-2.5 pe-3">Description</th>
                <th className="py-2.5 px-3">Réf.</th>
                <th className="py-2.5 px-3 text-right">Commandé</th>
                <th className="py-2.5 px-3 text-right">Reçu à l&apos;entrepôt</th>
                <th className="py-2.5 ps-3 text-right">Restant à recevoir</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.items.map((item) => {
                const remaining = Math.max(0, item.quantityOrdered - item.quantityReceived);
                return (
                  <tr key={item.lineId}>
                    <td className="py-3 pe-3 font-semibold text-navy-900">{item.description}</td>
                    <td className="py-3 px-3 text-xs text-slate-500">{item.merchantRef ?? "—"}</td>
                    <td className="py-3 px-3 text-right font-semibold">{item.quantityOrdered}</td>
                    <td className="py-3 px-3 text-right font-bold text-sky-900">{item.quantityReceived}</td>
                    <td className="py-3 ps-3 text-right font-bold text-amber-900">{remaining}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Colis associés et dates estimées */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-base font-extrabold text-navy-900">
          Colis associés &amp; dates estimées ({orderShipments.length})
        </h2>
        {orderShipments.length === 0 ? (
          <p className="text-xs text-slate-500">
            Aucun colis n&apos;est encore associé à cette commande. Vos articles seront regroupés ou répartis en colis dès leur préparation.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {orderShipments.map((sh) => {
              const dates = relevantDates(sh.status, sh.dates ?? {});
              return (
                <div key={sh.shipmentId} className="rounded-xl border border-slate-200 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link
                      to={`/espace-client/colis/${sh.shipmentId}`}
                      className="text-sm font-extrabold text-navy-900 hover:text-royal-600"
                    >
                      Suivi : {sh.trackingNumber}
                    </Link>
                    <StatusBadge status={sh.status} size="sm" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <TransportBadge mode={sh.transportMode} />
                    <span>• {sh.itemCount} article(s)</span>
                    {sh.weightKg ? <span>• {sh.weightKg} kg</span> : null}
                  </div>
                  {dates.length > 0 && (
                    <ul className="space-y-1 text-xs text-slate-700 bg-slate-50 rounded-lg p-2.5">
                      {dates.map((d) => (
                        <li key={d.field} className="flex justify-between gap-2">
                          <span className="text-slate-500">
                            {d.label} {d.estimate ? "(estimation)" : ""} :
                          </span>
                          <span className="font-bold">{formatIsoDate(d.value)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <Link
                      to={`/espace-client/colis/${sh.shipmentId}`}
                      className="text-xs font-bold text-royal-600 hover:underline"
                    >
                      Voir le suivi détaillé →
                    </Link>
                    <WhatsappContactButton
                      orderId={order.orderId}
                      trackingNumber={sh.trackingNumber}
                      clientId={order.clientId}
                      compact
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Frais et paiements (si activés) */}
      {settings.modules.finance && fin && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-extrabold text-navy-900 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-royal-600" aria-hidden="true" />
              <span>Frais et paiements ({fin.currency})</span>
            </h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-navy-900">
              {PAYMENT_STATUS_LABELS[fin.paymentStatus]}
            </span>
          </div>

          {fin.charges.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun frais n&apos;a encore été facturé sur cette commande.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4 space-y-2 text-xs">
                <div className="font-bold text-slate-700 uppercase">Détail des frais</div>
                {fin.charges.map((c) => (
                  <div key={c.id} className="flex justify-between">
                    <span>{c.label}</span>
                    <span className={c.kind === "discount" ? "font-bold text-emerald-700" : "font-semibold"}>
                      {c.kind === "discount" ? "− " : ""}
                      {formatMoney(c.amount, fin.currency)}
                    </span>
                  </div>
                ))}
                <div className="border-t border-slate-200 pt-2 flex justify-between text-sm font-extrabold text-navy-900">
                  <span>Montant total dû</span>
                  <span>{formatMoney(fin.totalDue, fin.currency)}</span>
                </div>
                <div className="flex justify-between text-emerald-800 font-bold">
                  <span>Montant payé</span>
                  <span>{formatMoney(fin.totalPaid, fin.currency)}</span>
                </div>
                <div className="flex justify-between text-sm font-extrabold text-amber-950">
                  <span>Solde restant</span>
                  <span>{formatMoney(fin.balance, fin.currency)}</span>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 space-y-2 text-xs">
                <div className="font-bold text-slate-700 uppercase">Paiements enregistrés</div>
                {payments.filter((p) => !p.voided).length === 0 ? (
                  <p className="text-slate-500">Aucun paiement enregistré.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {payments
                      .filter((p) => !p.voided)
                      .map((p) => (
                        <li key={p.id} className="py-2 flex justify-between">
                          <span>
                            {formatIsoDate(p.receivedOn)} • {PAYMENT_METHOD_LABELS[p.method]}
                            {p.reference ? ` (${p.reference})` : ""}
                          </span>
                          <span className="font-bold text-emerald-800">{formatMoney(p.amount, p.currency)}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Chronologie du transport */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-base font-extrabold text-navy-900">Chronologie du transport</h2>
        <TrackingTimeline events={orderEvents} />
      </section>
    </div>
  );
}

/* --------------------------------------------------- D. Suivi des Colis */
export function ClientShipmentsPage() {
  const { shipments } = useClientData();
  const [search, setSearch] = useState("");
  const today = todayIso();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shipments.filter(
      (s) =>
        !q ||
        s.trackingNumber.toLowerCase().includes(q) ||
        s.shipmentId.toLowerCase().includes(q) ||
        s.orderIds.some((id) => id.toLowerCase().includes(q)),
    );
  }, [shipments, search]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Suivi de mes colis</h1>
        <p className="text-xs text-slate-600">
          Ouvrez un colis pour voir sa progression étape par étape, ses dates estimées et les instructions de retrait.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
        <label htmlFor="client-shipment-search" className="sr-only">
          Rechercher un colis
        </label>
        <div className="relative">
          <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" aria-hidden="true" />
          <input
            id="client-shipment-search"
            type="search"
            placeholder="Rechercher par numéro de suivi ou numéro de commande…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-300 ps-10 pe-3 py-2 text-sm"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Aucun colis trouvé" description="Aucun colis ne correspond à votre recherche." />
      ) : (
        <div className="grid gap-4">
          {filtered.map((sh) => {
            const late = isLate(sh.status, sh.dates ?? {}, today);
            return (
              <article key={sh.shipmentId} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <Link
                        to={`/espace-client/colis/${sh.shipmentId}`}
                        className="text-base font-extrabold text-navy-900 hover:text-royal-600"
                      >
                        Suivi : {sh.trackingNumber}
                      </Link>
                      <StatusBadge status={sh.status} />
                      <TransportBadge mode={sh.transportMode} />
                      {late && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-bold text-orange-900">
                          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                          Estimation dépassée
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      Réf. colis : {sh.shipmentId} • {sh.itemCount} article(s) • Commandes : {sh.orderIds.join(", ") || "—"}
                    </p>
                  </div>
                  <Link
                    to={`/espace-client/colis/${sh.shipmentId}`}
                    className="inline-flex items-center gap-1 rounded-xl bg-royal-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-royal-700"
                  >
                    <span>Détail du suivi</span>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                <ShipmentProgress status={sh.status} lastStep={sh.lastStep} />
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------- Détail d'un Colis */
export function ClientShipmentDetailPage() {
  const { shipmentId } = useParams<{ shipmentId: string }>();
  const { settings } = useSettings();
  const { shipments, events } = useClientData();

  const sh = shipments.find((s) => s.shipmentId === shipmentId);
  const shEvents = useMemo(
    () => events.filter((e) => e.shipmentId === shipmentId),
    [events, shipmentId],
  );

  if (!sh) {
    return (
      <EmptyState
        title="Colis introuvable"
        description="Ce colis n'existe pas ou n'appartient pas à votre compte."
        action={
          <Link to="/espace-client/colis" className="text-xs font-bold text-royal-600 hover:underline">
            ← Retour aux colis
          </Link>
        }
      />
    );
  }

  const dates = relevantDates(sh.status, sh.dates ?? {});
  const instructions = sh.pickupInstructions || settings.pickupInstructions;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/espace-client/colis"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-navy-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Retour au suivi des colis</span>
        </Link>
        <WhatsappContactButton
          orderId={sh.orderIds[0] ?? null}
          trackingNumber={sh.trackingNumber}
          clientId={sh.clientId}
        />
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">
                Colis {sh.trackingNumber}
              </h1>
              <StatusBadge status={sh.status} />
              <TransportBadge mode={sh.transportMode} />
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Identifiant colis : {sh.shipmentId}
              {sh.weightKg ? ` • Poids : ${sh.weightKg} kg` : ""}
              {sh.dimensionsCm
                ? ` • Dimensions : ${sh.dimensionsCm.length}×${sh.dimensionsCm.width}×${sh.dimensionsCm.height} cm`
                : ""}
            </p>
          </div>
        </div>

        <ShipmentProgress status={sh.status} lastStep={sh.lastStep} />

        {sh.dateChangeMessage && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-950">
            <span className="font-bold">Note sur le délai : </span>
            {sh.dateChangeMessage}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Dates estimées & instructions */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-base font-extrabold text-navy-900">Dates &amp; estimations</h2>
          {dates.length === 0 ? (
            <p className="text-xs text-slate-500">Aucune date enregistrée pour le moment.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {dates.map((d) => (
                <li key={d.field} className="py-2.5 flex items-center justify-between gap-2">
                  <span className="text-slate-600">
                    {d.label}{" "}
                    {d.estimate && <span className="text-xs text-slate-400">(estimation)</span>}
                  </span>
                  <span className="font-bold text-navy-900">{formatIsoDate(d.value)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[11px] text-slate-500">
            Une date estimée est fournie à titre indicatif et ne constitue jamais une garantie.
          </p>

          {instructions && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 space-y-1 text-xs text-emerald-950">
              <div className="font-bold">Instructions de retrait / livraison</div>
              <p className="leading-relaxed">{instructions}</p>
            </div>
          )}
        </section>

        {/* Articles contenus dans ce colis */}
        <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
          <h2 className="text-base font-extrabold text-navy-900">
            Articles dans ce colis ({sh.itemCount})
          </h2>
          {sh.lines.length === 0 ? (
            <p className="text-xs text-slate-500">Détail des articles en attente d&apos;affectation.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {sh.lines.map((l) => (
                <li key={`${l.orderId}-${l.lineId}`} className="py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-navy-900">{l.description}</div>
                    <Link
                      to={`/espace-client/commandes/${l.orderId}`}
                      className="text-xs text-royal-600 hover:underline"
                    >
                      Commande {l.orderId}
                    </Link>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-800">
                    Qté : {l.quantity}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Historique chronologique */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs space-y-4">
        <h2 className="text-base font-extrabold text-navy-900">Historique des événements</h2>
        <TrackingTimeline events={shEvents} />
      </section>
    </div>
  );
}

/* --------------------------------------------------- Notifications Client */
export function ClientNotificationsPage() {
  const { notifications } = useClientData();

  const markAsRead = async (id: string) => {
    await updateDoc(doc(getFirebaseDb(), "notifications", id), {
      readAt: serverTimestamp(),
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-navy-900">Mes notifications</h1>
        <p className="text-xs text-slate-600">
          Alertes lors de la création d&apos;une commande, réception, expédition, modification de date ou disponibilité.
        </p>
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          title="Aucune notification"
          description="Vous recevrez ici les alertes importantes concernant vos commandes et vos colis."
        />
      ) : (
        <ul className="space-y-3">
          {notifications.map((n) => (
            <li
              key={n.id}
              className={`rounded-2xl border p-4 shadow-xs flex flex-wrap items-start justify-between gap-3 ${
                n.readAt ? "border-slate-200 bg-white" : "border-royal-500 bg-blue-50/40"
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  {!n.readAt && <span className="h-2 w-2 rounded-full bg-royal-600" aria-hidden="true" />}
                  <h2 className="text-sm font-extrabold text-navy-900">{n.title}</h2>
                </div>
                <p className="text-xs text-slate-700">{n.body}</p>
                <div className="flex flex-wrap items-center gap-3 pt-1 text-xs">
                  {n.orderId && (
                    <Link to={`/espace-client/commandes/${n.orderId}`} className="font-bold text-royal-600 hover:underline">
                      Voir la commande {n.orderId} →
                    </Link>
                  )}
                  {n.shipmentId && (
                    <Link to={`/espace-client/colis/${n.shipmentId}`} className="font-bold text-royal-600 hover:underline">
                      Voir le colis {n.shipmentId} →
                    </Link>
                  )}
                </div>
              </div>
              {!n.readAt && (
                <button
                  type="button"
                  onClick={() => markAsRead(n.id)}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                  <span>Marquer comme lu</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
