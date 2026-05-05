import { useMemo, useState } from "react";

import type { Entity, Relationship, RelationshipType } from "../types";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const RELATED_PARTY: RelationshipType[] = ["vendor", "landlord", "affiliated"];
const ALL_TYPES: RelationshipType[] = [
  "officer",
  "registered_agent",
  "vendor",
  "landlord",
  "affiliated",
];

type RelationshipsProps = {
  entities: Entity[];
  relationships: Relationship[];
};

type SortDir = "asc" | "desc" | null;

export default function Relationships({
  entities,
  relationships,
}: RelationshipsProps) {
  const [typeFilter, setTypeFilter] = useState<RelationshipType | "all">("all");
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<number | "all">("all");
  const [amountSort, setAmountSort] = useState<SortDir>(null);

  const nameById = useMemo(
    () => new Map(entities.map((e) => [e.id, e.name])),
    [entities],
  );

  const years = useMemo(() => {
    const set = new Set<number>();
    for (const r of relationships) {
      if (r.year) set.add(r.year);
    }
    return [...set].sort((a, b) => b - a);
  }, [relationships]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows = relationships.filter((r) => {
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (yearFilter !== "all" && r.year !== yearFilter) return false;
      if (needle) {
        const src = (nameById.get(r.source_id) || "").toLowerCase();
        const tgt = (nameById.get(r.target_id) || "").toLowerCase();
        if (!src.includes(needle) && !tgt.includes(needle)) return false;
      }
      return true;
    });

    if (amountSort) {
      const dir = amountSort === "asc" ? 1 : -1;
      rows = [...rows].sort(
        (a, b) => ((a.amount ?? 0) - (b.amount ?? 0)) * dir,
      );
    }
    return rows;
  }, [relationships, typeFilter, yearFilter, search, nameById, amountSort]);

  const cycleAmountSort = () =>
    setAmountSort((prev) =>
      prev === null ? "desc" : prev === "desc" ? "asc" : null,
    );

  if (relationships.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center font-mono text-sm text-neutral-500">
        No relationships yet — run a hunt to populate the graph.
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Type
          </label>
          <select
            className="h-9 border border-neutral-700 bg-[#0a0a0a] px-2 font-mono text-sm text-neutral-100 focus:border-blue-500"
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as RelationshipType | "all")
            }
          >
            <option value="all">All</option>
            {ALL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Search
          </label>
          <input
            className="h-9 w-72 border border-neutral-700 bg-[#0a0a0a] px-3 font-mono text-sm text-neutral-100 focus:border-blue-500"
            placeholder="Entity name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wider text-neutral-500">
            Year
          </label>
          <select
            className="h-9 border border-neutral-700 bg-[#0a0a0a] px-2 font-mono text-sm text-neutral-100 focus:border-blue-500"
            value={yearFilter === "all" ? "all" : String(yearFilter)}
            onChange={(e) =>
              setYearFilter(
                e.target.value === "all" ? "all" : Number(e.target.value),
              )
            }
          >
            <option value="all">All</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="border border-neutral-800 bg-[#111]">
        <table className="w-full font-mono text-xs">
          <thead className="bg-[#0a0a0a] text-left text-neutral-500">
            <tr>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Type</th>
              <th
                className="cursor-pointer select-none px-3 py-2 text-right hover:text-neutral-200"
                onClick={cycleAmountSort}
              >
                Amount
                {amountSort === "asc" ? " ▲" : amountSort === "desc" ? " ▼" : ""}
              </th>
              <th className="px-3 py-2 text-right">Year</th>
              <th className="px-3 py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => {
              const isRelatedParty = RELATED_PARTY.includes(r.type);
              return (
                <tr
                  key={`${r.source_id}-${r.target_id}-${r.type}-${i}`}
                  className={`border-t border-neutral-800 ${
                    isRelatedParty ? "bg-red-500/10" : ""
                  }`}
                >
                  <td className="px-3 py-2 text-neutral-200">
                    {nameById.get(r.source_id) || r.source_id}
                  </td>
                  <td className="px-3 py-2 text-neutral-200">
                    {nameById.get(r.target_id) || r.target_id}
                  </td>
                  <td className="px-3 py-2 text-neutral-400">{r.type}</td>
                  <td className="px-3 py-2 text-right text-neutral-100">
                    {r.amount != null ? currency.format(r.amount) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-neutral-400">
                    {r.year ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-neutral-300">{r.description}</td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-neutral-600">
                  No relationships match the filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
