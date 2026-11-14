import { useEffect, useMemo, useState, type FormEvent } from "react";
import { NavLink, useParams } from "react-router-dom";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebaseDb, getFirebaseFunctions } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";
import { formatError } from "@/lib/api";
import {
  bookTotals,
  formatMoney,
  parseMoney,
  ACCOUNTING_CATEGORIES,
  type BookInvoice,
  type BookEntry,
  type AccountingCommand,
} from "@shared/index";
import { useAdminData } from "./AdminContext";
const tabs = [
  ["", "Tableau de bord"],
  ["paiements", "Paiements"],
  ["depenses", "Dépenses"],
  ["factures", "Factures"],
  ["rapports", "Rapports"],
  ["objectifs", "Objectifs"],
];
const today = () => new Date().toISOString().slice(0, 10);
const money = (n: number) => formatMoney(n, "USD");
const labels: Record<string, string> = {
  receipts: "Paiements encaissés (hors annulations)",
  refunds: "Remboursements clients",
  transportCash: "Transport effectivement réglé",
  estimatedCost: "Transport estimé non confirmé",
  committedCost: "Transport confirmé",
  revenue: "Chiffre d’affaires facturé",
  cash: "Encaissements nets des remboursements",
  receivables: "Créances clients à la fin de période",
  cost: "Transport total (estimé + confirmé)",
  expenses: "Autres dépenses engagées",
  gross: "Marge brute",
  net: "Résultat net estimé",
  suppliers: "Dettes fournisseurs à la fin de période",
  count: "Colis facturés",
  weightMilli: "Poids facturé (lb)",
  savings: "Épargne personnelle enregistrée",
  expenseCash: "Autres dépenses payées",
};
const operationLabels: Record<string, string> = {
  invoice: "Émettre une facture",
  confirm_cost: "Confirmer la dette transporteur",
  payment: "Paiement / acompte",
  refund: "Remboursement",
  void: "Annulation documentée",
  expense: "Dépense",
  supplier_payment: "Règlement transporteur",
  expense_payment: "Règlement d’une dépense",
  savings: "Épargne personnelle",
  rates: "Tarifs futurs",
  goal: "Nouvel objectif",
  shipping: "Shipping (règlement fournisseur)",
  local_transport: "Transport local",
  internet: "Internet",
  supplies: "Fournitures",
  payment_fees: "Commissions de paiement",
  bank_fees: "Frais bancaires",
  marketing: "Marketing",
  other: "Autres",
  revenue: "Chiffre d’affaires",
  gross: "Marge brute",
  net: "Résultat net estimé",
};
function decimal(s: string, places: number) {
  const v = s.trim().replace(",", ".");
  if (!new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(v))
    throw Error("Nombre décimal invalide.");
  const [a, b = ""] = v.split(".");
  return Number(
    BigInt(a) * 10n ** BigInt(places) + BigInt(b.padEnd(places, "0")),
  );
}
export function AccountingPage() {
  const { can } = useAuth();
  const { section = "" } = useParams();
  const { shipments } = useAdminData();
  const [invoices, setInvoices] = useState<BookInvoice[]>([]),
    [entries, setEntries] = useState<BookEntry[]>([]),
    [goals, setGoals] = useState<
      {
        id: string;
        metric: string;
        amount: number;
        start: string;
        end: string;
      }[]
    >([]);
  const [start, setStart] = useState(today().slice(0, 7) + "-01"),
    [end, setEnd] = useState(today()),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [kind, setKind] = useState<AccountingCommand["kind"]>("payment"),
    [target, setTarget] = useState(""),
    [amount, setAmount] = useState(""),
    [currency, setCurrency] = useState<"USD" | "HTG">("USD"),
    [rate, setRate] = useState(""),
    [rateDate, setRateDate] = useState(today()),
    [date, setDate] = useState(today()),
    [method, setMethod] = useState("cash"),
    [reference, setReference] = useState(""),
    [description, setDescription] = useState(""),
    [category, setCategory] = useState("other"),
    [paid, setPaid] = useState(true),
    [clientRate, setClientRate] = useState("6.00"),
    [carrierRate, setCarrierRate] = useState("4.50"),
    [metric, setMetric] = useState("revenue");
  useEffect(() => {
    setKind(
      section === "factures"
        ? "invoice"
        : section === "depenses"
          ? "expense"
          : section === "objectifs"
            ? "goal"
            : "payment",
    );
    setTarget("");
    setPending(null);
  }, [section]);
  useEffect(() => {
    if (!can("finance.read")) return;
    const stop = [
      onSnapshot(
        doc(getFirebaseDb(), "accountingSettings", "rates"),
        (snapshot) => {
          const r = snapshot.data();
          if (r) {
            setClientRate((r.clientRateCents / 100).toFixed(2));
            setCarrierRate((r.carrierRateCents / 100).toFixed(2));
          }
        },
        (e) => setMessage(formatError(e)),
      ),
      onSnapshot(
        collection(getFirebaseDb(), "accountingInvoices"),
        (s) =>
          setInvoices(
            s.docs.map((d) => ({ ...d.data(), id: d.id }) as BookInvoice),
          ),
        (e) => setMessage(formatError(e)),
      ),
      onSnapshot(
        collection(getFirebaseDb(), "accountingEntries"),
        (s) =>
          setEntries(
            s.docs.map((d) => ({ ...d.data(), id: d.id }) as BookEntry),
          ),
        (e) => setMessage(formatError(e)),
      ),
      onSnapshot(
        collection(getFirebaseDb(), "accountingGoals"),
        (s) =>
          setGoals(
            s.docs.map(
              (d) => ({ ...d.data(), id: d.id }) as (typeof goals)[number],
            ),
          ),
        (e) => setMessage(formatError(e)),
      ),
    ];
    return () => stop.forEach((s) => s());
  }, [can]);
  const totals = useMemo(
    () => bookTotals(invoices, entries, start, end),
    [invoices, entries, start, end],
  );
  const ops = entries
    .filter((e) => e.date >= start && e.date <= end)
    .sort((a, b) => b.date.localeCompare(a.date));
  const rows = invoices.filter((i) => i.date >= start && i.date <= end);
  const chart = Object.entries(
    rows.reduce<Record<string, number>>(
      (a, i) => ({ ...a, [i.date]: (a[i.date] ?? 0) + i.revenue }),
      {},
    ),
  ).sort(([a], [b]) => a.localeCompare(b));
  if (!can("finance.read"))
    return (
      <p role="alert">
        Accès réservé aux utilisateurs autorisés à consulter la comptabilité.
      </p>
    );
  function period(type: string) {
    const d = new Date();
    let a = today();
    if (type === "week") {
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      a = d.toISOString().slice(0, 10);
    }
    if (type === "month") a = today().slice(0, 7) + "-01";
    if (type === "year") a = today().slice(0, 4) + "-01-01";
    setStart(a);
    setEnd(today());
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const requestId = pending ?? crypto.randomUUID();
      setPending(requestId);
      const value = parseMoney(amount);
      if (!["invoice", "rates", "void"].includes(kind) && !value)
        throw Error("Indiquez un montant positif.");
      const payload = {
        requestId,
        kind,
        targetId: target || undefined,
        date,
        amount: value ?? undefined,
        currency: ["goal", "rates", "invoice"].includes(kind)
          ? "USD"
          : currency,
        rateMicros:
          currency === "HTG" &&
          !["goal", "rates", "invoice", "void"].includes(kind)
            ? decimal(rate, 6)
            : undefined,
        rateDate,
        method,
        reference,
        description,
        category,
        paid,
        clientRateCents: parseMoney(clientRate) ?? undefined,
        carrierRateCents: parseMoney(carrierRate) ?? undefined,
        metric,
        dailyTargetCents:
          kind === "goal" && metric === "savings"
            ? (value ?? 10000)
            : undefined,
        end,
      } as AccountingCommand;
      // Le SDK callable transforme les valeurs undefined en null : omettre les champs facultatifs.
      const command = Object.fromEntries(
        Object.entries(payload).filter(([, value]) => value !== undefined),
      );
      await httpsCallable(getFirebaseFunctions(), "accountingCommand")(command);
      setMessage("Opération enregistrée et auditée.");
      setPending(null);
      setAmount("");
      setReference("");
    } catch (err) {
      setMessage(formatError(err));
    } finally {
      setBusy(false);
    }
  }
  function resetOperation() {
    setPending(null);
    setMessage("");
  }
  function selectTarget(id: string) {
    setTarget(id);
    if (kind === "refund" || kind === "void") {
      const original = entries.find((e) => e.id === id);
      if (original) {
        setCurrency(original.currency as "USD" | "HTG");
        setRate(String(original.rateMicros / 1_000_000));
        setRateDate(original.rateDate);
      }
    }
  }
  const costAt = (i: BookInvoice) =>
    i.costConfirmed && (!i.costConfirmedOn || i.costConfirmedOn <= end)
      ? i.cost
      : (i.estimatedCost ?? i.cost);
  const paidAt = (i: BookInvoice) =>
    entries
      .filter(
        (e) =>
          e.targetId === i.id &&
          e.date <= end &&
          ["payment", "refund", "void"].includes(e.kind),
      )
      .reduce((s, e) => s + e.usd, 0);
  const receivableRows = invoices
    .filter((i) => i.date <= end)
    .map((i) => ({
      id: i.id,
      orderId: i.orderId,
      clientId: i.clientId,
      date: i.date,
      balance: i.revenue - paidAt(i),
    }))
    .filter((i) => i.balance !== 0);
  const supplierRows = [
    ...invoices
      .filter(
        (i) =>
          i.date <= end &&
          i.costConfirmed &&
          (!i.costConfirmedOn || i.costConfirmedOn <= end),
      )
      .map((i) => ({
        id: i.id,
        date: i.costConfirmedOn ?? i.date,
        description: "Transport — " + i.orderId,
        balance:
          i.cost -
          entries
            .filter(
              (e) =>
                e.targetId === i.id &&
                e.kind === "supplier_payment" &&
                e.date <= end,
            )
            .reduce((s, e) => s + e.usd, 0),
      })),
    ...entries
      .filter((e) => e.date <= end && e.kind === "expense" && !e.paid)
      .map((e) => ({
        id: e.id,
        date: e.date,
        description: e.description,
        balance:
          e.usd -
          entries
            .filter(
              (p) =>
                p.targetId === e.id &&
                p.kind === "expense_payment" &&
                p.date <= end,
            )
            .reduce((s, p) => s + p.usd, 0),
      })),
  ].filter((e) => e.balance !== 0);
  const report = [
    ["Rapport USD", start, end],
    ...Object.entries(totals).map(([k, v]) => [
      labels[k] ?? k,
      k === "count" ? v : k === "weightMilli" ? v / 1000 : (v / 100).toFixed(2),
    ]),
    ["Factures", "Commande", "Date", "Facturé USD", "Coût USD", "Encaissé USD"],
    ...rows.map((i) => [
      i.id,
      i.orderId,
      i.date,
      (i.revenue / 100).toFixed(2),
      (costAt(i) / 100).toFixed(2),
      (paidAt(i) / 100).toFixed(2),
    ]),
    [
      "Opérations",
      "Type",
      "Date",
      "Original",
      "Devise",
      "Taux HTG/USD",
      "Date taux",
      "USD",
      "Référence",
      "Auteur",
      "Catégorie",
      "Mode",
      "Description",
      "Écart coût transport USD",
    ],
    ...ops.map((e) => [
      e.id,
      operationLabels[e.kind] ?? e.kind,
      e.date,
      (e.amount / 100).toFixed(2),
      e.currency,
      e.rateMicros / 1000000,
      e.rateDate,
      (e.usd / 100).toFixed(2),
      e.reference,
      e.recordedBy,
      operationLabels[e.category] ?? e.category,
      (
        {
          cash: "Espèces",
          natcash: "NatCash",
          moncash: "MonCash",
          transfer: "Virement",
          other: "Autre",
        } as Record<string, string>
      )[e.method] ?? e.method,
      e.description,
      ((e.costAdjustment ?? 0) / 100).toFixed(2),
    ]),
    [
      "Créances clients à la date de fin",
      "Commande",
      "Client",
      "Date facture",
      "Solde USD",
    ],
    ...receivableRows.map((i) => [
      i.id,
      i.orderId,
      i.clientId,
      i.date,
      (i.balance / 100).toFixed(2),
    ]),
    [
      "Dettes fournisseurs à la date de fin",
      "Date",
      "Description",
      "Solde USD",
    ],
    ...supplierRows.map((e) => [
      e.id,
      e.date,
      e.description,
      (e.balance / 100).toFixed(2),
    ]),
  ];
  function csv() {
    const text =
      "\ufeff" +
      report
        .map((row) =>
          row
            .map(
              (v) =>
                '"' +
                String(v)
                  .replace(/^[=+@-]/, "'$&")
                  .replaceAll('"', '""') +
                '"',
            )
            .join(";"),
        )
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `SHENA-comptabilite-${start}-${end}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function pdf() {
    const popup = window.open("", "_blank");
    if (!popup) {
      setMessage("Autorisez l’ouverture du rapport pour l’enregistrer en PDF.");
      return;
    }
    const esc = (v: unknown) =>
      String(v)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    const groups: (typeof report)[] = [];
    for (const row of report) {
      if (
        [
          "Rapport USD",
          "Factures",
          "Opérations",
          "Créances clients à la date de fin",
          "Dettes fournisseurs à la date de fin",
        ].includes(String(row[0]))
      )
        groups.push([]);
      groups[groups.length - 1]!.push(row);
    }
    const tables = groups
      .map(
        (rows) =>
          "<table>" +
          rows
            .map(
              (row, index) =>
                "<tr>" +
                row
                  .map(
                    (cell) =>
                      `<${index === 0 ? "th" : "td"}>${esc(cell)}</${index === 0 ? "th" : "td"}>`,
                  )
                  .join("") +
                "</tr>",
            )
            .join("") +
          "</table>",
      )
      .join("");
    popup.document.write(
      `<html lang="fr"><title>SHENA — rapport financier</title><style>body{font:10px Arial;color:#102443}td,th{padding:4px;border-bottom:1px solid #ddd;overflow-wrap:anywhere;text-align:left}th{background:#eef2f6}table{border-collapse:collapse;width:100%;margin:18px 0;table-layout:fixed}thead{display:table-header-group}@page{size:A4 landscape}</style><h1>SHENA Express — Comptabilité</h1><p>Créances et dettes : position à la date de fin. Encaissements nets distincts des factures.</p>${tables}</html>`,
    );
    popup.document.close();
    popup.print();
  }
  return (
    <div className="accounting-page space-y-5">
      <h1 className="text-2xl font-extrabold text-navy-900">Comptabilité</h1>
      <nav className="flex flex-wrap gap-2" aria-label="Comptabilité">
        {tabs.map(([url, label]) => (
          <NavLink
            key={url}
            end
            to={"/admin/comptabilite" + (url ? "/" + url : "")}
            className={({ isActive }) =>
              `rounded-xl px-4 py-2 text-sm font-bold ${isActive ? "bg-orange-500 text-white" : "bg-white text-navy-900 border"}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <section className="rounded-2xl border bg-white p-4 flex flex-wrap items-end gap-3">
        <label>
          Début
          <input
            className="block border rounded p-2"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          Fin
          <input
            className="block border rounded p-2"
            type="date"
            min={start}
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
        {[
          ["day", "Jour"],
          ["week", "Semaine"],
          ["month", "Mois"],
          ["year", "Année"],
        ].map(([id, label]) => (
          <button
            className="border rounded-xl p-2"
            key={id}
            onClick={() => period(id)}
          >
            {label}
          </button>
        ))}
      </section>
      {message && (
        <p role="status" className="border rounded-xl bg-amber-50 p-3">
          {message}
        </p>
      )}
      {(!section || section === "rapports") && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Object.entries(totals).map(([key, value]) => (
              <div className="rounded-2xl border bg-white p-4" key={key}>
                <p className="text-xs text-slate-600">{labels[key]}</p>
                <strong className="text-xl text-navy-900">
                  {key === "count"
                    ? value
                    : key === "weightMilli"
                      ? `${value / 1000} lb`
                      : money(value)}
                </strong>
              </div>
            ))}
          </div>
          <section className="rounded-2xl border bg-white p-4">
            <h2 className="font-bold">
              Facturation par jour — cliquez pour explorer
            </h2>
            <div className="flex items-end gap-2 overflow-x-auto h-48 p-3">
              {chart.map(([day, value]) => (
                <button
                  key={day}
                  title={`${day} : ${money(value)}`}
                  onClick={() => {
                    setStart(day);
                    setEnd(day);
                  }}
                  style={{
                    height: Math.max(
                      30,
                      (value / Math.max(...chart.map((v) => v[1]), 1)) * 140,
                    ),
                  }}
                  className="min-w-20 bg-orange-500 rounded-t p-1 text-xs"
                >
                  {day}
                  <br />
                  {money(value)}
                </button>
              ))}
              {!chart.length && <p>Aucune facture sur cette période.</p>}
            </div>
          </section>
          <p className="text-xs">
            Les coûts engagés comprennent la dette transporteur ; les règlements
            fournisseurs ne sont pas une seconde dépense. Les créances et dettes
            sont calculées à la date de fin. L’épargne personnelle est une
            affectation volontaire distincte du résultat.
          </p>
        </>
      )}
      {section === "objectifs" && (
        <section className="rounded-2xl bg-white border p-5 space-y-4">
          <h2 className="font-bold">Objectifs et épargne personnelle</h2>
          <p>
            Repère personnel : 100 USD par jour (à configurer comme objectif
            d’épargne). Aucun transfert n’est supposé à partir de la marge.
          </p>
          {goals.map((g) => {
            const t = bookTotals(invoices, entries, g.start, g.end);
            const actual =
              (
                {
                  revenue: t.revenue,
                  gross: t.gross,
                  net: t.net,
                  savings: t.savings,
                } as Record<string, number>
              )[g.metric] ?? 0;
            return (
              <div key={g.id}>
                <strong>
                  {operationLabels[g.metric] ?? g.metric} : {money(actual)} /{" "}
                  {money(g.amount)}
                </strong>
                <p>
                  {g.start} → {g.end} · {Math.round((actual / g.amount) * 100)}{" "}
                  %
                </p>
                <progress
                  className="w-full"
                  value={Math.max(0, actual)}
                  max={g.amount}
                />
              </div>
            );
          })}
        </section>
      )}
      {section === "rapports" && (
        <div className="flex gap-3">
          <button
            className="bg-navy-900 text-white rounded-xl p-3"
            onClick={csv}
          >
            Exporter CSV
          </button>
          <button className="border rounded-xl bg-white p-3" onClick={pdf}>
            Rapport PDF / Imprimer
          </button>
        </div>
      )}
      {section && section !== "rapports" && can("finance.write") && (
        <form
          onSubmit={submit}
          onChange={resetOperation}
          className="rounded-2xl border bg-white p-5 grid gap-4 sm:grid-cols-2"
        >
          <h2 className="font-bold sm:col-span-2">Enregistrer une opération</h2>
          <label>
            Opération
            <select
              className="block w-full border rounded p-2"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind);
                setTarget("");
              }}
            >
              {(section === "factures"
                ? ["invoice", "rates"]
                : section === "depenses"
                  ? [
                      "expense",
                      "confirm_cost",
                      "supplier_payment",
                      "expense_payment",
                    ]
                  : section === "objectifs"
                    ? ["goal", "savings"]
                    : ["payment", "refund", "void"]
              ).map((k) => (
                <option key={k} value={k}>
                  {operationLabels[k] ?? k}
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input
              required
              type="date"
              className="block w-full border rounded p-2"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {[
            "invoice",
            "payment",
            "refund",
            "void",
            "supplier_payment",
            "expense_payment",
            "confirm_cost",
          ].includes(kind) && (
            <label className="sm:col-span-2">
              {kind === "invoice"
                ? "Colis pesé"
                : kind === "expense_payment"
                  ? "Dépense non payée"
                  : kind === "refund" || kind === "void"
                    ? "Paiement original"
                    : "Facture"}
              <select
                required
                className="block w-full border rounded p-2"
                value={target}
                onChange={(e) => selectTarget(e.target.value)}
              >
                <option value="">Choisir…</option>
                {kind === "invoice"
                  ? shipments
                      .filter(
                        (s) =>
                          s.weighedAt &&
                          !invoices.some((i) => i.shipmentId === s.shipmentId),
                      )
                      .map((s) => (
                        <option key={s.shipmentId} value={s.shipmentId}>
                          {s.trackingNumber} · {s.actualWeightLb} lb
                        </option>
                      ))
                  : kind === "expense_payment"
                    ? entries
                        .filter((e) => e.kind === "expense" && !e.paid)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.description} · {money(e.usd)}
                          </option>
                        ))
                    : kind === "refund" || kind === "void"
                      ? entries
                          .filter((e) => e.kind === "payment")
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.date} · {money(e.usd)} · {e.id}
                            </option>
                          ))
                      : invoices.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.id} · {i.orderId} · solde{" "}
                            {money(
                              kind === "supplier_payment"
                                ? i.cost - i.supplierPaid
                                : i.revenue - i.paid,
                            )}
                          </option>
                        ))}
              </select>
            </label>
          )}
          {kind === "rates" ? (
            <>
              <label>
                Prix client USD/lb
                <input
                  className="block border rounded p-2"
                  value={clientRate}
                  onChange={(e) => setClientRate(e.target.value)}
                />
              </label>
              <label>
                Coût transporteur USD/lb
                <input
                  className="block border rounded p-2"
                  value={carrierRate}
                  onChange={(e) => setCarrierRate(e.target.value)}
                />
              </label>
              <p>
                Tarifs futurs uniquement ; chaque facture conserve ses tarifs.
              </p>
            </>
          ) : kind !== "invoice" && kind !== "void" ? (
            <>
              <label>
                {kind === "goal" && metric === "savings"
                  ? "Épargne personnelle par jour (USD)"
                  : "Montant"}
                <input
                  required
                  inputMode="decimal"
                  className="block w-full border rounded p-2"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              {kind !== "goal" && (
                <label>
                  Devise
                  <select
                    className="block w-full border rounded p-2"
                    value={currency}
                    onChange={(e) =>
                      setCurrency(e.target.value as typeof currency)
                    }
                  >
                    <option>USD</option>
                    <option>HTG</option>
                  </select>
                </label>
              )}
              {currency === "HTG" && kind !== "goal" && (
                <>
                  <label>
                    HTG pour 1 USD
                    <input
                      required
                      className="block border rounded p-2"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                    />
                  </label>
                  <label>
                    Date du taux
                    <input
                      required
                      type="date"
                      className="block border rounded p-2"
                      value={rateDate}
                      onChange={(e) => setRateDate(e.target.value)}
                    />
                  </label>
                </>
              )}
            </>
          ) : null}
          {kind === "expense" && (
            <>
              <label>
                Catégorie
                <select
                  className="block border rounded p-2"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {ACCOUNTING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {operationLabels[c] ?? c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={paid}
                  onChange={(e) => setPaid(e.target.checked)}
                />{" "}
                Dépense effectivement payée (sinon dette)
              </label>
            </>
          )}
          {kind === "goal" && (
            <>
              <label>
                Objectif USD
                <select
                  className="block border rounded p-2"
                  value={metric}
                  onChange={(e) => {
                    setMetric(e.target.value);
                    if (e.target.value === "savings") setAmount("100.00");
                  }}
                >
                  {["revenue", "gross", "net", "savings"].map((c) => (
                    <option key={c} value={c}>
                      {operationLabels[c] ?? c}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                La période est définie par la date de l’opération et la date de
                fin du filtre.
              </p>
            </>
          )}
          <label>
            Mode
            <select
              className="block w-full border rounded p-2"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {[
                ["cash", "Espèces"],
                ["natcash", "NatCash"],
                ["moncash", "MonCash"],
                ["transfer", "Virement"],
                ["other", "Autre"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            Référence / justificatif (texte ou URL)
            <input
              className="block w-full border rounded p-2"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className="sm:col-span-2">
            Description / motif
            <textarea
              className="block w-full border rounded p-2"
              required={
                kind === "refund" || kind === "void" || kind === "expense"
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <button
            disabled={busy}
            className="rounded-xl bg-orange-500 text-white p-3 font-bold"
          >
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          <p className="text-xs">
            Enregistrement serveur sécurisé. En cas d’échec réseau, réessayez
            sans modifier le formulaire pour conserver la même clé anti-doublon.
          </p>
        </form>
      )}
      <section className="rounded-2xl border bg-white p-4 overflow-x-auto">
        <h2 className="font-bold mb-3">
          Factures — données historiques des tarifs
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                "Facture / commande",
                "Date",
                "Poids",
                "Prix / coût par lb",
                "Facturé",
                "Coût",
                "Encaissé",
                "Solde / statut",
                "Dette fournisseur",
              ].map((t) => (
                <th className="p-2 text-left" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr className="border-t" key={i.id}>
                <td className="p-2">
                  {i.id}
                  <br />
                  {i.orderId}
                </td>
                <td>{i.date}</td>
                <td>{i.weightMilli / 1000} lb</td>
                <td>
                  {money(i.clientRateCents)} / {money(i.carrierRateCents)}
                </td>
                <td>{money(i.revenue)}</td>
                <td>{money(costAt(i))}</td>
                <td>{money(paidAt(i))}</td>
                <td>
                  {money(i.revenue - paidAt(i))} ·{" "}
                  {paidAt(i) === 0
                    ? "Non payé"
                    : paidAt(i) >= i.revenue
                      ? "Payé"
                      : "Partiellement payé"}
                </td>
                <td>
                  {i.costConfirmed &&
                  (!i.costConfirmedOn || i.costConfirmedOn <= end)
                    ? money(
                        supplierRows.find((row) => row.id === i.id)?.balance ??
                          0,
                      )
                    : "Coût estimé, dette non confirmée"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="rounded-2xl border bg-white p-4 overflow-x-auto">
        <h2 className="font-bold mb-3">Historique des opérations (immuable)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr>
              {[
                "Date",
                "Type",
                "Montant original",
                "Taux daté",
                "USD",
                "Référence / description",
                "Auteur",
              ].map((t) => (
                <th className="p-2 text-left" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ops.map((e) => (
              <tr className="border-t" key={e.id}>
                <td className="p-2">{e.date}</td>
                <td>{operationLabels[e.kind] ?? e.kind}</td>
                <td>
                  {e.amount / 100} {e.currency}
                </td>
                <td>
                  {e.rateMicros / 1000000} · {e.rateDate}
                </td>
                <td>{money(e.usd)}</td>
                <td>
                  {e.reference} {e.description}
                </td>
                <td>{e.recordedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-xs text-slate-500">
        Le module porte uniquement sur les factures comptables émises ici. Les
        anciens paiements nécessitent un rapprochement explicite ; ils ne sont
        pas assimilés à des encaissements nouveaux.
      </p>
    </div>
  );
}
