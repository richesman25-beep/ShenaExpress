import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { collection, doc, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  LayoutDashboard,
  Users,
  ShoppingBag,
  Package,
  CreditCard,
  Settings,
  ShieldAlert,
  LogOut,
  Menu,
  X,
  Search,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { useI18n } from "@/i18n";
import { getFirebaseDb } from "@/lib/firebase";
import {
  STATUS_CODES,
  countShipmentsByBucket,
  isLate,
  todayIso,
  formatIsoDate,
  formatMoney,
  type ClientDoc,
  type OrderDoc,
  type ShipmentDoc,
  type OrderFinanceDoc,
  type PaymentRecordDoc,
  type AuditLogDoc,
  type PrivateSettingsDoc,
} from "@shared/index";
import { ShenaLogo, StatusBadge, TransportBadge, type TrackingEventWithId } from "@/components/ui";

export interface AdminDataContextValue {
  clients: ClientDoc[];
  orders: OrderDoc[];
  shipments: ShipmentDoc[];
  events: TrackingEventWithId[];
  finances: Record<string, OrderFinanceDoc>;
  payments: (PaymentRecordDoc & { id: string })[];
  auditLogs: (AuditLogDoc & { id: string })[];
  privateSettings: PrivateSettingsDoc | null;
  loading: boolean;
}

const AdminDataContext = createContext<AdminDataContextValue>({
  clients: [],
  orders: [],
  shipments: [],
  events: [],
  finances: {},
  payments: [],
  auditLogs: [],
  privateSettings: null,
  loading: true,
});

export function useAdminData() {
  return useContext(AdminDataContext);
}

export function AdminLayout() {
  const { user, claims, signOut, can } = useAuth();
  const { settings } = useSettings();
  const { t, locale, setLocale, locales } = useI18n();
  const navigate = useNavigate();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [clients, setClients] = useState<ClientDoc[]>([]);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [shipments, setShipments] = useState<ShipmentDoc[]>([]);
  const [events, setEvents] = useState<TrackingEventWithId[]>([]);
  const [finances, setFinances] = useState<Record<string, OrderFinanceDoc>>({});
  const [payments, setPayments] = useState<(PaymentRecordDoc & { id: string })[]>([]);
  const [auditLogs, setAuditLogs] = useState<(AuditLogDoc & { id: string })[]>([]);
  const [privateSettings, setPrivateSettings] = useState<PrivateSettingsDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const db = getFirebaseDb();
    const unsubs: (() => void)[] = [];

    if (can("clients.read")) {
      unsubs.push(
        onSnapshot(
          collection(db, "clients"),
          (snap) => {
            const list = snap.docs.map((d) => d.data() as ClientDoc);
            list.sort((a, b) => a.clientId.localeCompare(b.clientId));
            setClients(list);
            setLoading(false);
          },
          () => setLoading(false),
        ),
      );
    } else {
      setLoading(false);
    }

    if (can("orders.read")) {
      unsubs.push(
        onSnapshot(collection(db, "orders"), (snap) => {
          const list = snap.docs.map((d) => d.data() as OrderDoc);
          list.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
          setOrders(list);
        }),
      );
    }

    if (can("shipments.read")) {
      unsubs.push(
        onSnapshot(collection(db, "shipments"), (snap) => {
          const list = snap.docs.map((d) => d.data() as ShipmentDoc);
          list.sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
          setShipments(list);
        }),
      );
    }

    if (can("shipments.read") || can("orders.read")) {
      unsubs.push(
        onSnapshot(query(collection(db, "shipmentEvents"), orderBy("at", "desc"), limit(250)), (snap) => {
          setEvents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TrackingEventWithId, "id">) })));
        }),
      );
    }

    if (can("finance.read")) {
      unsubs.push(
        onSnapshot(collection(db, "orderFinance"), (snap) => {
          const map: Record<string, OrderFinanceDoc> = {};
          for (const d of snap.docs) {
            const data = d.data() as OrderFinanceDoc;
            map[data.orderId] = data;
          }
          setFinances(map);
        }),
      );
      unsubs.push(
        onSnapshot(query(collection(db, "paymentRecords"), orderBy("createdAt", "desc"), limit(200)), (snap) => {
          setPayments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as PaymentRecordDoc) })));
        }),
      );
    }

    if (can("audit.read")) {
      unsubs.push(
        onSnapshot(query(collection(db, "auditLogs"), orderBy("at", "desc"), limit(150)), (snap) => {
          setAuditLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as AuditLogDoc) })));
        }),
      );
    }

    unsubs.push(
      onSnapshot(
        doc(db, "settings", "private"),
        (snap) => {
          setPrivateSettings(snap.exists() ? (snap.data() as PrivateSettingsDoc) : null);
        },
        () => setPrivateSettings(null),
      ),
    );

    return () => unsubs.forEach((u) => u());
  }, [user, can]);

  const navItems = [
    { to: "/admin", end: true, label: t.nav.overview, icon: LayoutDashboard, show: true },
    { to: "/admin/clients", end: false, label: t.nav.clients, icon: Users, show: can("clients.read") },
    { to: "/admin/commandes", end: false, label: t.nav.orders, icon: ShoppingBag, show: can("orders.read") },
    { to: "/admin/colis", end: false, label: t.nav.shipments, icon: Package, show: can("shipments.read") },
    {
      to: "/admin/finances",
      end: false,
      label: t.nav.finance,
      icon: CreditCard,
      show: can("finance.read") && settings.modules.finance,
    },
    { to: "/admin/parametres", end: false, label: t.nav.settings, icon: Settings, show: can("settings.write") },
    { to: "/admin/audit", end: false, label: t.nav.audit, icon: ShieldAlert, show: can("audit.read") },
  ].filter((i) => i.show);

  const handleSignOut = async () => {
    await signOut();
    navigate("/admin/connexion", { replace: true });
  };

  return (
    <AdminDataContext.Provider
      value={{ clients, orders, shipments, events, finances, payments, auditLogs, privateSettings, loading }}
    >
      <div className="min-h-screen flex flex-col bg-slate-50">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-royal-600 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
        >
          {t.nav.skipToContent}
        </a>

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
              <Link to="/admin">
                <ShenaLogo variant="light" size="sm" subtitle="Administration" />
              </Link>
            </div>

            <nav aria-label="Navigation administration" className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition ${
                        isActive ? "bg-royal-600 text-white" : "text-slate-200 hover:bg-white/10"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <span className="hidden md:inline-block rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold text-amber-300 uppercase">
                {claims?.role === "admin" ? "Administrateur" : "Employé"}
              </span>
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

          {mobileOpen && (
            <nav aria-label="Menu mobile administration" className="lg:hidden border-t border-white/10 bg-navy-950 px-4 py-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-sm font-bold ${
                        isActive ? "bg-royal-600 text-white" : "text-slate-200 hover:bg-white/10"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
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
    </AdminDataContext.Provider>
  );
}

/* ------------------------------------------- 6.A. Vue d'ensemble Admin */
export function AdminOverviewPage() {
  const { settings, labelForStatus } = useSettings();
  const { clients, orders, shipments, finances } = useAdminData();

  const [search, setSearch] = useState("");
  const [periodDays, setPeriodDays] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");

  const today = todayIso();

  const cutoffIso = useMemo(() => {
    if (periodDays === "all") return null;
    const days = Number(periodDays);
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }, [periodDays]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (clientFilter !== "all" && o.clientId !== clientFilter) return false;
      if (statusFilter !== "all" && o.status !== statusFilter) return false;
      if (cutoffIso && o.orderDate < cutoffIso) return false;
      if (!q) return true;
      return (
        o.orderId.toLowerCase().includes(q) ||
        o.clientId.toLowerCase().includes(q) ||
        o.clientName.toLowerCase().includes(q) ||
        (o.merchant ?? "").toLowerCase().includes(q)
      );
    });
  }, [orders, search, clientFilter, statusFilter, cutoffIso]);

  const filteredShipments = useMemo(() => {
    const q = search.trim().toLowerCase();
    return shipments.filter((s) => {
      if (clientFilter !== "all" && s.clientId !== clientFilter) return false;
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.trackingNumber.toLowerCase().includes(q) ||
        s.shipmentId.toLowerCase().includes(q) ||
        s.clientId.toLowerCase().includes(q) ||
        s.orderIds.some((id) => id.toLowerCase().includes(q))
      );
    });
  }, [shipments, search, clientFilter, statusFilter]);

  const buckets = useMemo(() => countShipmentsByBucket(filteredShipments), [filteredShipments]);
  const receivedShipmentsCount = useMemo(
    () =>
      filteredShipments.filter(
        (s) => s.status !== "cancelled" && s.status !== "registered" && s.status !== "awaiting_receipt",
      ).length,
    [filteredShipments],
  );
  const lateShipments = useMemo(
    () => filteredShipments.filter((s) => isLate(s.status, s.dates ?? {}, today)),
    [filteredShipments, today],
  );

  const pendingPayments = useMemo(() => {
    if (!settings.modules.finance) return { count: 0, totalBalance: 0 };
    const list = Object.values(finances).filter(
      (f) => (clientFilter === "all" || f.clientId === clientFilter) && f.balance > 0,
    );
    const totalBalance = list
      .filter((f) => f.currency === settings.currency)
      .reduce((s, f) => s + f.balance, 0);
    return { count: list.length, totalBalance };
  }, [finances, settings.modules.finance, settings.currency, clientFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-navy-900">Vue d&apos;ensemble opérationnelle</h1>
          <p className="text-xs text-slate-600">
            Indicateurs calculés en temps réel à partir des données enregistrées dans SHENA Express.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/clients"
            className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-navy-900 hover:bg-slate-50"
          >
            + Nouveau client
          </Link>
          <Link
            to="/admin/commandes"
            className="rounded-xl bg-royal-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-royal-700"
          >
            + Nouvelle commande
          </Link>
          <Link
            to="/admin/colis"
            className="rounded-xl bg-navy-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-navy-800"
          >
            + Nouveau colis
          </Link>
        </div>
      </div>

      {/* Filtres rapides : recherche, période, statut, client */}
      <section
        aria-label="Recherche et filtres"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
      >
        <div className="lg:col-span-5 relative">
          <label htmlFor="overview-search" className="sr-only">
            Recherche rapide
          </label>
          <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" aria-hidden="true" />
          <input
            id="overview-search"
            type="search"
            placeholder="Rechercher commande, suivi, client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-300 ps-10 pe-3 py-2 text-sm"
          />
        </div>
        <div className="lg:col-span-2">
          <label htmlFor="overview-period" className="sr-only">
            Période
          </label>
          <select
            id="overview-period"
            value={periodDays}
            onChange={(e) => setPeriodDays(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Toute période</option>
            <option value="7">7 derniers jours</option>
            <option value="30">30 derniers jours</option>
            <option value="90">90 derniers jours</option>
          </select>
        </div>
        <div className="lg:col-span-3">
          <label htmlFor="overview-status" className="sr-only">
            Statut
          </label>
          <select
            id="overview-status"
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
        <div className="lg:col-span-2">
          <label htmlFor="overview-client" className="sr-only">
            Client
          </label>
          <select
            id="overview-client"
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="all">Tous les clients</option>
            {clients.map((c) => (
              <option key={c.clientId} value={c.clientId}>
                {c.clientId} — {c.fullName}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Indicateurs calculés à partir des données réelles */}
      <section aria-label="Indicateurs clés" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <AdminKpi label="Total clients" value={clients.length} sub={`${clients.filter((c) => c.status === "active").length} actif(s)`} />
        <AdminKpi label="Commandes enregistrées" value={filteredOrders.length} />
        <AdminKpi label="Colis reçus" value={receivedShipmentsCount} />
        <AdminKpi label="Colis en transit" value={buckets.transit} />
        <AdminKpi label="Arrivés en Haïti" value={buckets.arrived} />
        <AdminKpi label="Prêts à livrer / retirer" value={buckets.available} />
        <AdminKpi label="Colis livrés" value={buckets.delivered} />
        <AdminKpi
          label="En retard sur estimation"
          value={lateShipments.length}
          alert={lateShipments.length > 0}
        />
        {settings.modules.finance && (
          <AdminKpi
            label="Paiements en attente"
            value={pendingPayments.count}
            sub={formatMoney(pendingPayments.totalBalance, settings.currency)}
            alert={pendingPayments.count > 0}
          />
        )}
      </section>

      {/* Alertes de retard */}
      {lateShipments.length > 0 && (
        <section className="rounded-2xl border border-orange-300 bg-orange-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-extrabold text-orange-950">
            <AlertTriangle className="h-4 w-4 text-orange-600" aria-hidden="true" />
            <span>Colis dont la date d&apos;arrivée estimée est dépassée ({lateShipments.length})</span>
          </div>
          <ul className="divide-y divide-orange-200/70 text-xs">
            {lateShipments.slice(0, 6).map((s) => (
              <li key={s.shipmentId} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{s.trackingNumber}</strong> ({s.shipmentId}) — Client {s.clientId}
                </span>
                <span className="font-bold text-orange-900">
                  Estimation : {formatIsoDate(s.dates.deliveryWindowEnd ?? s.dates.estimatedArrival)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Tableaux récents */}
      <div className="grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-navy-900">Dernières commandes</h2>
            <Link to="/admin/commandes" className="text-xs font-bold text-royal-600 hover:underline">
              Gérer les commandes →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase">
                  <th className="py-2 pe-2">Commande</th>
                  <th className="py-2 px-2">Client</th>
                  <th className="py-2 px-2">Reçus / Cmd</th>
                  <th className="py-2 ps-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.slice(0, 7).map((o) => (
                  <tr key={o.orderId}>
                    <td className="py-2.5 pe-2 font-bold text-navy-900">{o.orderId}</td>
                    <td className="py-2.5 px-2 text-slate-600">{o.clientId}</td>
                    <td className="py-2.5 px-2 font-semibold">
                      {o.stats.received} / {o.stats.ordered}
                    </td>
                    <td className="py-2.5 ps-2">
                      <StatusBadge status={o.status} size="sm" />
                    </td>
                  </tr>
                ))}
                {filteredOrders.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">
                      Aucune commande.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lg:col-span-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-extrabold text-navy-900">Derniers colis mis à jour</h2>
            <Link to="/admin/colis" className="text-xs font-bold text-royal-600 hover:underline">
              Gérer les colis →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 uppercase">
                  <th className="py-2 pe-2">Suivi</th>
                  <th className="py-2 px-2">Client</th>
                  <th className="py-2 px-2">Mode</th>
                  <th className="py-2 ps-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredShipments.slice(0, 7).map((s) => (
                  <tr key={s.shipmentId}>
                    <td className="py-2.5 pe-2 font-bold text-navy-900">{s.trackingNumber}</td>
                    <td className="py-2.5 px-2 text-slate-600">{s.clientId}</td>
                    <td className="py-2.5 px-2">
                      <TransportBadge mode={s.transportMode} />
                    </td>
                    <td className="py-2.5 ps-2">
                      <StatusBadge status={s.status} size="sm" />
                    </td>
                  </tr>
                ))}
                {filteredShipments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-500">
                      Aucun colis.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function AdminKpi({
  label,
  value,
  sub,
  alert = false,
}: {
  label: string;
  value: number;
  sub?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-xs ${
        alert ? "border-orange-300 bg-orange-50/60" : "border-slate-200 bg-white"
      }`}
    >
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      <div className={`mt-1 text-2xl font-extrabold ${alert ? "text-orange-900" : "text-navy-900"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] font-medium text-slate-500">{sub}</div>}
    </div>
  );
}
