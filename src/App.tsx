import { useCallback, useEffect, useState } from "react";

import Dashboard from "./pages/Dashboard";
import Financials from "./pages/Financials";
import Relationships from "./pages/Relationships";
import Settings from "./pages/Settings";
import {
  readEntities,
  readFinancials,
  readRelationships,
} from "./tauri";
import type {
  Entity,
  Financial,
  Relationship,
} from "./types";

type Page = "dashboard" | "financials" | "relationships" | "settings";

const NAV: { id: Page; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "financials", label: "Financials" },
  { id: "relationships", label: "Relationships" },
  { id: "settings", label: "Settings" },
];

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [financials, setFinancials] = useState<Financial[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [financialsEntityId, setFinancialsEntityId] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [e, r, f] = await Promise.all([
        readEntities(),
        readRelationships(),
        readFinancials(),
      ]);
      setEntities(e);
      setRelationships(r);
      setFinancials(f);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleViewFinancials = (entityId: string) => {
    setFinancialsEntityId(entityId);
    setPage("financials");
  };

  return (
    <div className="flex min-h-screen bg-[#0a0a0a] text-neutral-100">
      <aside className="flex w-56 flex-col border-r border-neutral-800 bg-[#080808]">
        <div className="border-b border-neutral-800 px-5 py-4">
          <h1 className="text-base font-bold tracking-tight text-neutral-100">
            Shellhound
          </h1>
          <p className="font-mono text-[10px] uppercase tracking-wider text-neutral-500">
            Shell network tracer
          </p>
        </div>
        <nav className="flex flex-1 flex-col p-2">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setPage(item.id)}
              className={`mb-1 px-3 py-2 text-left text-sm transition-colors ${
                page === item.id
                  ? "bg-blue-600/20 text-blue-200"
                  : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="border-t border-neutral-800 px-3 py-2 font-mono text-[10px] text-neutral-600">
          {loading
            ? "loading..."
            : `${entities.length} entities · ${relationships.length} edges`}
        </div>
      </aside>

      <main className="flex-1 overflow-hidden">
        {loadError ? (
          <div className="m-4 border border-red-500/40 bg-red-950/30 p-3 font-mono text-xs text-red-300">
            {loadError}
          </div>
        ) : null}

        {page === "dashboard" ? (
          <Dashboard
            entities={entities}
            relationships={relationships}
            financials={financials}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRefresh={refresh}
            onViewFinancials={handleViewFinancials}
          />
        ) : null}

        {page === "financials" ? (
          <Financials
            entities={entities}
            financials={financials}
            initialEntityId={financialsEntityId}
          />
        ) : null}

        {page === "relationships" ? (
          <Relationships entities={entities} relationships={relationships} />
        ) : null}

        {page === "settings" ? <Settings onCleared={refresh} /> : null}
      </main>
    </div>
  );
}

export default App;
