import { useEffect, useMemo, useState } from "react";

import type { Entity, Financial } from "../types";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type FinancialsProps = {
  entities: Entity[];
  financials: Financial[];
  initialEntityId?: string;
};

export default function Financials({
  entities,
  financials,
  initialEntityId,
}: FinancialsProps) {
  const entitiesWithEin = useMemo(
    () => entities.filter((e) => e.ein),
    [entities],
  );

  const [entityId, setEntityId] = useState<string>(
    initialEntityId ?? entitiesWithEin[0]?.id ?? "",
  );

  useEffect(() => {
    if (initialEntityId) setEntityId(initialEntityId);
  }, [initialEntityId]);

  const selectedEntity = entities.find((e) => e.id === entityId);

  const entityFinancials = useMemo(() => {
    if (!selectedEntity?.ein) return [];
    return financials
      .filter((f) => f.ein === selectedEntity.ein)
      .sort((a, b) => b.year - a.year);
  }, [financials, selectedEntity]);

  const [year, setYear] = useState<number | undefined>(
    entityFinancials[0]?.year,
  );

  useEffect(() => {
    setYear(entityFinancials[0]?.year);
  }, [entityFinancials]);

  const current = entityFinancials.find((f) => f.year === year);

  const handleExport = () => {
    if (!current) return;
    const headers = [
      "ein",
      "year",
      "total_revenue",
      "total_expenses",
      "total_salaries",
      "program_expenses",
    ];
    const summary = headers.map((h) => String((current as any)[h] ?? ""));
    const execHeader =
      "\n\nExecutives\nname,title,compensation,pct_of_expenses\n";
    const execRows = current.executives
      .map((ex) => {
        const pct = current.total_expenses
          ? ((ex.compensation / current.total_expenses) * 100).toFixed(2)
          : "0";
        return [ex.name, ex.title, ex.compensation, pct]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(",");
      })
      .join("\n");

    const csv = `${headers.join(",")}\n${summary.join(",")}${execHeader}${execRows}`;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${current.ein}-${current.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (entitiesWithEin.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center font-mono text-sm text-neutral-500">
        No entities with EINs yet — hunt some nonprofits first.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Entity
          </label>
          <select
            className="h-9 min-w-64 border border-neutral-700 bg-[#0a0a0a] px-2 font-mono text-sm text-neutral-100 focus:border-blue-500"
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
          >
            {entitiesWithEin.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.ein})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Year
          </label>
          <select
            className="h-9 border border-neutral-700 bg-[#0a0a0a] px-2 font-mono text-sm text-neutral-100 focus:border-blue-500"
            value={year ?? ""}
            onChange={(e) => setYear(Number(e.target.value))}
            disabled={entityFinancials.length === 0}
          >
            {entityFinancials.map((f) => (
              <option key={f.year} value={f.year}>
                {f.year}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className="h-9 border border-neutral-700 bg-[#1a1a1a] px-3 text-xs font-semibold text-neutral-200 hover:bg-[#262626] disabled:cursor-not-allowed disabled:text-neutral-600"
          onClick={handleExport}
          disabled={!current}
        >
          Export CSV
        </button>
      </div>

      {current ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Total Revenue" value={currency.format(current.total_revenue)} />
            <Card label="Total Expenses" value={currency.format(current.total_expenses)} />
            <Card
              label="Salary %"
              value={
                current.total_expenses
                  ? `${((current.total_salaries / current.total_expenses) * 100).toFixed(1)}%`
                  : "N/A"
              }
            />
            <Card
              label="Program Service %"
              value={
                current.total_expenses
                  ? `${((current.program_expenses / current.total_expenses) * 100).toFixed(1)}%`
                  : "N/A"
              }
            />
          </div>

          <section className="border border-neutral-800 bg-[#111]">
            <header className="border-b border-neutral-800 px-4 py-2 text-[11px] uppercase tracking-wider text-neutral-400">
              Executives
            </header>
            <table className="w-full font-mono text-xs">
              <thead className="bg-[#0a0a0a] text-left text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2 text-right">Compensation</th>
                  <th className="px-3 py-2 text-right">% of Expenses</th>
                </tr>
              </thead>
              <tbody>
                {current.executives.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-neutral-600">
                      No executives reported.
                    </td>
                  </tr>
                ) : (
                  current.executives.map((ex, i) => (
                    <tr
                      key={`${ex.name}-${i}`}
                      className="border-t border-neutral-800"
                    >
                      <td className="px-3 py-2 text-neutral-200">{ex.name}</td>
                      <td className="px-3 py-2 text-neutral-400">{ex.title}</td>
                      <td className="px-3 py-2 text-right text-neutral-100">
                        {currency.format(ex.compensation)}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-300">
                        {current.total_expenses
                          ? `${((ex.compensation / current.total_expenses) * 100).toFixed(2)}%`
                          : "N/A"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <section className="border border-neutral-800 bg-[#111]">
            <header className="border-b border-neutral-800 px-4 py-2 text-[11px] uppercase tracking-wider text-neutral-400">
              Related Party Transactions
            </header>
            <table className="w-full font-mono text-xs">
              <thead className="bg-[#0a0a0a] text-left text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {current.related_party_transactions.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-neutral-600">
                      None reported.
                    </td>
                  </tr>
                ) : (
                  current.related_party_transactions.map((tx, i) => (
                    <tr key={i} className="border-t border-neutral-800">
                      <td className="px-3 py-2 text-neutral-200">
                        {tx.description}
                      </td>
                      <td className="px-3 py-2 text-right text-neutral-100">
                        {currency.format(tx.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <p className="font-mono text-sm text-neutral-500">
          No financials for this entity.
        </p>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-neutral-800 bg-[#111] p-3">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mt-1 font-mono text-lg text-neutral-100">{value}</p>
    </div>
  );
}
