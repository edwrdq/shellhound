import { useCallback, useEffect, useMemo, useReducer } from "react";

import NetworkGraph from "./components/NetworkGraph";
import {
  readEntities,
  readFinancials,
  readRelationships,
  runScraper,
  writeEntities,
  writeFinancials,
  writeRelationships,
} from "./tauri";
import type { Entity, Financial, Relationship, ScraperResult } from "./types";

type Page = "dashboard" | "financials" | "relationships";

type AppState = {
  entities: Entity[];
  relationships: Relationship[];
  financials: Financial[];
  selectedId?: string;
  activePage: Page;
  seed: string;
  scraperType: string;
  loading: boolean;
  scraperRunning: boolean;
  error?: string;
  status?: string;
};

type AppAction =
  | {
      type: "load:start";
    }
  | {
      type: "load:success";
      entities: Entity[];
      relationships: Relationship[];
      financials: Financial[];
    }
  | {
      type: "load:error";
      error: string;
    }
  | {
      type: "select";
      selectedId: string;
    }
  | {
      type: "page";
      activePage: Page;
    }
  | {
      type: "seed";
      seed: string;
    }
  | {
      type: "scraper-type";
      scraperType: string;
    }
  | {
      type: "scrape:start";
    }
  | {
      type: "scrape:success";
      entities: Entity[];
      relationships: Relationship[];
      financials: Financial[];
      status: string;
    }
  | {
      type: "scrape:error";
      error: string;
    };

const initialState: AppState = {
  activePage: "dashboard",
  entities: [],
  financials: [],
  loading: true,
  relationships: [],
  scraperRunning: false,
  scraperType: "crawler",
  seed: "",
};

const currency = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

const numberFormatter = new Intl.NumberFormat("en-US");

function reducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "load:start":
      return { ...state, error: undefined, loading: true };
    case "load:success":
      return {
        ...state,
        entities: action.entities,
        error: undefined,
        financials: action.financials,
        loading: false,
        relationships: action.relationships,
        selectedId: state.selectedId ?? action.entities[0]?.id,
        status: `Loaded ${action.entities.length} entities`,
      };
    case "load:error":
      return { ...state, error: action.error, loading: false };
    case "select":
      return { ...state, selectedId: action.selectedId };
    case "page":
      return { ...state, activePage: action.activePage };
    case "seed":
      return { ...state, seed: action.seed };
    case "scraper-type":
      return { ...state, scraperType: action.scraperType };
    case "scrape:start":
      return {
        ...state,
        error: undefined,
        scraperRunning: true,
        status: "Scraper running",
      };
    case "scrape:success":
      return {
        ...state,
        entities: action.entities,
        financials: action.financials,
        relationships: action.relationships,
        scraperRunning: false,
        selectedId: state.selectedId ?? action.entities[0]?.id,
        status: action.status,
      };
    case "scrape:error":
      return {
        ...state,
        error: action.error,
        scraperRunning: false,
        status: "Scraper failed",
      };
    default:
      return state;
  }
}

function mergeBy<T>(existing: T[], incoming: T[] | undefined, keyFor: (item: T) => string) {
  const merged = new Map(existing.map((item) => [keyFor(item), item]));
  incoming?.forEach((item) => {
    merged.set(keyFor(item), item);
  });
  return [...merged.values()];
}

function entityLabel(entity?: Entity) {
  if (!entity) {
    return "No entity selected";
  }

  return entity.ein ? `${entity.name} | EIN ${entity.ein}` : entity.name;
}

function formatCurrency(value?: number) {
  return currency.format(value ?? 0);
}

function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    let isActive = true;

    async function loadData() {
      dispatch({ type: "load:start" });
      try {
        const [entities, relationships, financials] = await Promise.all([
          readEntities(),
          readRelationships(),
          readFinancials(),
        ]);

        if (isActive) {
          dispatch({
            type: "load:success",
            entities,
            financials,
            relationships,
          });
        }
      } catch (error) {
        if (isActive) {
          dispatch({
            type: "load:error",
            error:
              error instanceof Error
                ? error.message
                : "Unable to load JSON data through Tauri",
          });
        }
      }
    }

    void loadData();

    return () => {
      isActive = false;
    };
  }, []);

  const selectedEntity = useMemo(
    () => state.entities.find((entity) => entity.id === state.selectedId),
    [state.entities, state.selectedId],
  );

  const selectedRelationships = useMemo(() => {
    if (!selectedEntity) {
      return [];
    }

    return state.relationships.filter(
      (relationship) =>
        relationship.source_id === selectedEntity.id ||
        relationship.target_id === selectedEntity.id,
    );
  }, [selectedEntity, state.relationships]);

  const selectedFinancials = useMemo(() => {
    if (!selectedEntity?.ein) {
      return [];
    }

    return state.financials
      .filter((financial) => financial.ein === selectedEntity.ein)
      .sort((left, right) => right.year - left.year);
  }, [selectedEntity, state.financials]);

  const entityNameById = useMemo(
    () => new Map(state.entities.map((entity) => [entity.id, entity.name])),
    [state.entities],
  );

  const handleSelect = useCallback((selectedId: string) => {
    dispatch({ type: "select", selectedId });
  }, []);

  const handleSearch = useCallback(() => {
    const needle = state.seed.trim().toLowerCase();
    if (!needle) {
      return;
    }

    const numericNeedle = needle.replace(/\D/g, "");
    const match = state.entities.find((entity) => {
      const entityEin = entity.ein?.replace(/\D/g, "") ?? "";
      return (
        entity.name.toLowerCase().includes(needle) ||
        (numericNeedle.length > 0 && entityEin.includes(numericNeedle))
      );
    });

    if (match) {
      dispatch({ type: "select", selectedId: match.id });
    }
  }, [state.entities, state.seed]);

  const handleRunScraper = useCallback(async () => {
    const seed = state.seed.trim();
    if (!seed) {
      return;
    }

    dispatch({ type: "scrape:start" });

    try {
      const result: ScraperResult = await runScraper(seed, state.scraperType);
      const entities = mergeBy(state.entities, result.entities, (entity) => entity.id);
      const relationships = mergeBy(
        state.relationships,
        result.relationships,
        (relationship) =>
          `${relationship.source_id}:${relationship.target_id}:${relationship.type}:${relationship.year ?? ""}`,
      );
      const financials = mergeBy(
        state.financials,
        result.financials,
        (financial) => `${financial.ein}:${financial.year}`,
      );

      await Promise.all([
        writeEntities(entities),
        writeRelationships(relationships),
        writeFinancials(financials),
      ]);

      dispatch({
        type: "scrape:success",
        entities,
        financials,
        relationships,
        status: `Merged ${result.entities?.length ?? 0} entities from ${result.scraper_type ?? state.scraperType}`,
      });
    } catch (error) {
      dispatch({
        type: "scrape:error",
        error:
          error instanceof Error
            ? error.message
            : "Scraper command failed",
      });
    }
  }, [
    state.entities,
    state.financials,
    state.relationships,
    state.scraperType,
    state.seed,
  ]);

  return (
    <div className="min-h-screen bg-[#030507] text-slate-100">
      <header className="border-b border-cyan-500/20 bg-[#071014] px-5 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-cyan-100">Shellhound</h1>
            <p className="font-mono text-xs text-emerald-300">
              {state.loading ? "Loading data" : state.status ?? "Ready"}
            </p>
          </div>

          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              handleSearch();
            }}
          >
            <input
              className="h-10 w-full border border-cyan-500/30 bg-[#020405] px-3 font-mono text-sm text-cyan-50 outline-none placeholder:text-slate-500 focus:border-cyan-300 sm:w-80"
              placeholder="Org name or EIN"
              value={state.seed}
              onChange={(event) =>
                dispatch({ type: "seed", seed: event.currentTarget.value })
              }
            />
            <select
              className="h-10 border border-cyan-500/30 bg-[#020405] px-3 font-mono text-sm text-cyan-50 outline-none focus:border-cyan-300"
              value={state.scraperType}
              onChange={(event) =>
                dispatch({
                  type: "scraper-type",
                  scraperType: event.currentTarget.value,
                })
              }
            >
              <option value="crawler">Crawler</option>
              <option value="sunbiz">Sunbiz</option>
              <option value="irs">IRS</option>
              <option value="propublica">ProPublica</option>
            </select>
            <button
              className="h-10 border border-cyan-400/40 bg-cyan-400 px-4 text-sm font-semibold text-[#031014] hover:bg-cyan-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
              type="submit"
              disabled={state.loading}
            >
              Search
            </button>
            <button
              className="h-10 border border-emerald-400/40 bg-emerald-400 px-4 text-sm font-semibold text-[#031014] hover:bg-emerald-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
              type="button"
              disabled={state.loading || state.scraperRunning || !state.seed.trim()}
              onClick={() => void handleRunScraper()}
            >
              {state.scraperRunning ? "Running" : "Run"}
            </button>
          </form>
        </div>

        {state.error ? (
          <div className="mt-3 border border-red-500/40 bg-red-950/40 px-3 py-2 font-mono text-xs text-red-200">
            {state.error}
          </div>
        ) : null}
      </header>

      <nav className="flex border-b border-cyan-500/20 bg-[#050b0f] px-5">
        {(["dashboard", "financials", "relationships"] satisfies Page[]).map(
          (page) => (
            <button
              key={page}
              className={`border-b-2 px-4 py-3 text-sm font-medium capitalize ${
                state.activePage === page
                  ? "border-cyan-300 text-cyan-200"
                  : "border-transparent text-slate-400 hover:text-slate-100"
              }`}
              type="button"
              onClick={() => dispatch({ type: "page", activePage: page })}
            >
              {page}
            </button>
          ),
        )}
      </nav>

      <main className="grid min-h-[calc(100vh-130px)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="min-h-[520px] border-r border-cyan-500/20 p-4">
          {state.activePage === "dashboard" ? (
            <NetworkGraph
              entities={state.entities}
              relationships={state.relationships}
              selectedId={state.selectedId}
              onSelect={handleSelect}
            />
          ) : null}

          {state.activePage === "financials" ? (
            <FinancialsTable financials={selectedFinancials} />
          ) : null}

          {state.activePage === "relationships" ? (
            <RelationshipsList
              entityNameById={entityNameById}
              relationships={selectedRelationships}
              selectedId={state.selectedId}
            />
          ) : null}
        </section>

        <aside className="bg-[#071014] p-4">
          <div className="mb-3 border-b border-cyan-500/20 pb-3">
            <p className="text-xs uppercase text-slate-500">Entity Details</p>
            <h2 className="mt-1 text-lg font-semibold text-cyan-100">
              {entityLabel(selectedEntity)}
            </h2>
          </div>

          {selectedEntity ? (
            <EntityDetails
              entity={selectedEntity}
              financials={selectedFinancials}
              relationships={selectedRelationships}
            />
          ) : (
            <p className="font-mono text-sm text-slate-500">No entity selected</p>
          )}
        </aside>
      </main>
    </div>
  );
}

function EntityDetails({
  entity,
  financials,
  relationships,
}: {
  entity: Entity;
  financials: Financial[];
  relationships: Relationship[];
}) {
  const latestFinancial = financials[0];

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Detail label="Type" value={entity.type} />
        <Detail label="State" value={entity.state ?? "Unknown"} />
        <Detail label="Status" value={entity.status ?? "Unknown"} />
        <Detail label="EIN" value={entity.ein ?? "N/A"} />
        <Detail label="Agent" value={entity.registered_agent ?? "N/A"} wide />
      </dl>

      <section>
        <h3 className="mb-2 text-xs uppercase text-slate-500">Officers</h3>
        <div className="space-y-2">
          {entity.officers.length ? (
            entity.officers.map((officer) => (
              <div
                key={officer}
                className="border border-yellow-400/20 bg-yellow-400/5 px-3 py-2 font-mono text-sm text-yellow-100"
              >
                {officer}
              </div>
            ))
          ) : (
            <p className="font-mono text-sm text-slate-500">No officers found</p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 font-mono text-sm">
        <Metric label="Connections" value={numberFormatter.format(relationships.length)} />
        <Metric
          label="Revenue"
          value={latestFinancial ? formatCurrency(latestFinancial.total_revenue) : "N/A"}
        />
      </section>
    </div>
  );
}

function Detail({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-xs uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-mono text-sm text-slate-100">{value}</dd>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-cyan-500/20 bg-cyan-400/5 px-3 py-2">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-cyan-100">{value}</p>
    </div>
  );
}

function FinancialsTable({ financials }: { financials: Financial[] }) {
  return (
    <div className="h-full overflow-auto border border-cyan-500/20 bg-[#05070a]">
      <table className="min-w-full border-collapse font-mono text-sm">
        <thead className="sticky top-0 bg-[#0a151a] text-left text-xs uppercase text-cyan-200">
          <tr>
            <th className="border-b border-cyan-500/20 px-3 py-3">Year</th>
            <th className="border-b border-cyan-500/20 px-3 py-3 text-right">
              Revenue
            </th>
            <th className="border-b border-cyan-500/20 px-3 py-3 text-right">
              Expenses
            </th>
            <th className="border-b border-cyan-500/20 px-3 py-3 text-right">
              Salaries
            </th>
            <th className="border-b border-cyan-500/20 px-3 py-3">Executives</th>
          </tr>
        </thead>
        <tbody>
          {financials.length ? (
            financials.map((financial) => (
              <tr key={`${financial.ein}-${financial.year}`} className="odd:bg-white/[0.03]">
                <td className="border-b border-cyan-500/10 px-3 py-3 text-emerald-300">
                  {financial.year}
                </td>
                <td className="border-b border-cyan-500/10 px-3 py-3 text-right">
                  {formatCurrency(financial.total_revenue)}
                </td>
                <td className="border-b border-cyan-500/10 px-3 py-3 text-right">
                  {formatCurrency(financial.total_expenses)}
                </td>
                <td className="border-b border-cyan-500/10 px-3 py-3 text-right">
                  {formatCurrency(financial.salaries)}
                </td>
                <td className="border-b border-cyan-500/10 px-3 py-3">
                  {financial.executives
                    .map(
                      (executive) =>
                        `${executive.name} (${executive.title}) ${formatCurrency(executive.compensation)}`,
                    )
                    .join("; ") || "N/A"}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="px-3 py-6 text-slate-500" colSpan={5}>
                No financials for selected entity
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RelationshipsList({
  entityNameById,
  relationships,
  selectedId,
}: {
  entityNameById: Map<string, string>;
  relationships: Relationship[];
  selectedId?: string;
}) {
  return (
    <div className="space-y-3">
      {relationships.length ? (
        relationships.map((relationship, index) => {
          const otherId =
            relationship.source_id === selectedId
              ? relationship.target_id
              : relationship.source_id;
          const direction =
            relationship.source_id === selectedId ? "Outbound" : "Inbound";

          return (
            <article
              key={`${relationship.source_id}-${relationship.target_id}-${index}`}
              className="border border-cyan-500/20 bg-[#071014] p-4"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs uppercase text-slate-500">{direction}</p>
                  <h3 className="mt-1 text-base font-semibold text-cyan-100">
                    {entityNameById.get(otherId) ?? otherId}
                  </h3>
                </div>
                <span className="w-fit border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 font-mono text-xs text-emerald-200">
                  {relationship.type}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-1 gap-3 font-mono text-sm sm:grid-cols-3">
                <Detail label="Year" value={String(relationship.year ?? "N/A")} />
                <Detail
                  label="Amount"
                  value={
                    relationship.amount != null
                      ? formatCurrency(relationship.amount)
                      : "N/A"
                  }
                />
                <Detail label="Description" value={relationship.description ?? "N/A"} />
              </dl>
            </article>
          );
        })
      ) : (
        <div className="border border-cyan-500/20 bg-[#071014] p-6 font-mono text-sm text-slate-500">
          No relationships for selected entity
        </div>
      )}
    </div>
  );
}

export default App;
