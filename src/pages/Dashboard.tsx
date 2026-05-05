import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import NetworkGraph from "../components/NetworkGraph";
import { onScraperDone, onScraperLog, runScraper } from "../tauri";
import type { Entity, Financial, Relationship, SeedType } from "../types";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const typeBadgeColor: Record<Entity["type"], string> = {
  nonprofit: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  llc: "bg-red-500/20 text-red-300 border-red-500/40",
  corp: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  individual: "bg-yellow-500/20 text-yellow-300 border-yellow-500/40",
};

type DashboardProps = {
  entities: Entity[];
  relationships: Relationship[];
  financials: Financial[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onRefresh: () => Promise<void>;
  onViewFinancials: (entityId: string) => void;
};

export default function Dashboard({
  entities,
  relationships,
  financials,
  selectedId,
  onSelect,
  onRefresh,
  onViewFinancials,
}: DashboardProps) {
  const [seed, setSeed] = useState("");
  const [seedType, setSeedType] = useState<SeedType>("ein");
  const [depth, setDepth] = useState(2);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cleanupLog: (() => void) | undefined;
    let cleanupDone: (() => void) | undefined;

    onScraperLog((line) => {
      setLogs((prev) => [...prev, line]);
    }).then((u) => {
      cleanupLog = u;
    });

    onScraperDone((code) => {
      setRunning(false);
      setLogs((prev) => [...prev, `[done] exit code ${code}`]);
      void onRefresh();
    }).then((u) => {
      cleanupDone = u;
    });

    return () => {
      cleanupLog?.();
      cleanupDone?.();
    };
  }, [onRefresh]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleHunt = useCallback(async () => {
    if (!seed.trim()) return;
    setError(null);
    setLogs([`[start] hunting ${seedType}=${seed} depth=${depth}`]);
    setRunning(true);
    try {
      await runScraper(seed.trim(), seedType, depth);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }, [seed, seedType, depth]);

  const selected = useMemo(
    () => entities.find((e) => e.id === selectedId),
    [entities, selectedId],
  );

  const selectedRelationshipCount = useMemo(() => {
    if (!selected) return 0;
    return relationships.filter(
      (r) => r.source_id === selected.id || r.target_id === selected.id,
    ).length;
  }, [relationships, selected]);

  const selectedFinancial = useMemo(() => {
    if (!selected?.ein) return undefined;
    return financials
      .filter((f) => f.ein === selected.ein)
      .sort((a, b) => b.year - a.year)[0];
  }, [financials, selected]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-800 bg-[#111] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">
              Seed
            </label>
            <input
              className="h-9 w-72 border border-neutral-700 bg-[#0a0a0a] px-3 font-mono text-sm text-neutral-100 outline-none focus:border-blue-500"
              placeholder={seedType === "ein" ? "9-digit EIN" : "Organization name"}
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              disabled={running}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">
              Type
            </label>
            <select
              className="h-9 border border-neutral-700 bg-[#0a0a0a] px-2 font-mono text-sm text-neutral-100 outline-none focus:border-blue-500"
              value={seedType}
              onChange={(e) => setSeedType(e.target.value as SeedType)}
              disabled={running}
            >
              <option value="ein">EIN</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-neutral-500">
              Depth
            </label>
            <select
              className="h-9 border border-neutral-700 bg-[#0a0a0a] px-2 font-mono text-sm text-neutral-100 outline-none focus:border-blue-500"
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
              disabled={running}
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
          <button
            type="button"
            className="h-9 border border-blue-500/60 bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:border-neutral-700 disabled:bg-neutral-800 disabled:text-neutral-500"
            onClick={() => void handleHunt()}
            disabled={running || !seed.trim()}
          >
            {running ? (
              <span className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 animate-spin border-2 border-white/40 border-t-white" />
                Hunting
              </span>
            ) : (
              "Hunt"
            )}
          </button>
          {error ? (
            <p className="font-mono text-xs text-red-400">{error}</p>
          ) : null}
        </div>

        {logs.length ? (
          <div
            className="mt-3 h-32 overflow-y-auto border border-neutral-800 bg-[#050505] p-2 font-mono text-[11px] text-neutral-300"
          >
            {logs.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {line}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        ) : null}
      </div>

      <div className="grid flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-[500px] p-4">
          {entities.length === 0 ? (
            <div className="flex h-full items-center justify-center border border-dashed border-neutral-800 bg-[#0a0a0a] p-8 text-center font-mono text-sm text-neutral-500">
              No entities yet — run a hunt to begin.
            </div>
          ) : (
            <NetworkGraph
              entities={entities}
              relationships={relationships}
              financials={financials}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          )}
        </div>

        <aside className="border-l border-neutral-800 bg-[#111] p-4">
          {selected ? (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold text-neutral-100">
                  {selected.name}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span
                    className={`border px-2 py-0.5 font-mono text-[10px] uppercase ${typeBadgeColor[selected.type]}`}
                  >
                    {selected.type}
                  </span>
                  <span className="font-mono text-[10px] uppercase text-neutral-500">
                    {selected.status}
                  </span>
                </div>
              </div>

              <div className="space-y-1 text-sm">
                <Detail label="EIN" value={selected.ein ?? "N/A"} />
                <Detail label="State" value={selected.state || "N/A"} />
                <Detail
                  label="Registered Agent"
                  value={selected.registered_agent ?? "N/A"}
                />
              </div>

              <section>
                <h3 className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">
                  Officers
                </h3>
                {selected.officers.length === 0 ? (
                  <p className="font-mono text-xs text-neutral-600">None recorded</p>
                ) : (
                  <ul className="space-y-1">
                    {selected.officers.map((o, i) => (
                      <li
                        key={`${o.name}-${i}`}
                        className="border border-yellow-500/20 bg-yellow-500/5 px-2 py-1 font-mono text-xs text-yellow-200"
                      >
                        {o.name}
                        {o.title ? ` — ${o.title}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {selectedFinancial ? (
                <section className="border border-neutral-800 bg-[#0a0a0a] p-3">
                  <h3 className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
                    Financials ({selectedFinancial.year})
                  </h3>
                  <div className="space-y-1 font-mono text-xs">
                    <Row
                      label="Revenue"
                      value={currency.format(selectedFinancial.total_revenue)}
                    />
                    <Row
                      label="Expenses"
                      value={currency.format(selectedFinancial.total_expenses)}
                    />
                    <Row
                      label="Salary %"
                      value={
                        selectedFinancial.total_expenses
                          ? `${(
                              (selectedFinancial.total_salaries /
                                selectedFinancial.total_expenses) *
                              100
                            ).toFixed(1)}%`
                          : "N/A"
                      }
                    />
                  </div>
                  <button
                    type="button"
                    className="mt-3 h-8 w-full border border-blue-500/40 bg-blue-600/20 text-xs font-semibold text-blue-200 hover:bg-blue-600/40"
                    onClick={() => onViewFinancials(selected.id)}
                  >
                    View Financials
                  </button>
                </section>
              ) : null}

              <section>
                <h3 className="mb-1 text-[10px] uppercase tracking-wider text-neutral-500">
                  Connections
                </h3>
                <p className="font-mono text-xs text-neutral-400">
                  {selectedRelationshipCount} relationships
                </p>
              </section>
            </div>
          ) : (
            <p className="font-mono text-sm text-neutral-500">
              Click a node to inspect.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
      </span>
      <span className="font-mono text-xs text-neutral-200">{value}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-100">{value}</span>
    </div>
  );
}
