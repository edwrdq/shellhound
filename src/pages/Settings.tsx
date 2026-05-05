import { useState } from "react";

import { clearData } from "../tauri";

type SettingsProps = {
  onCleared: () => Promise<void>;
};

export default function Settings({ onCleared }: SettingsProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClear = async () => {
    if (!confirm("Wipe all entities, relationships, and financials?")) return;
    setBusy(true);
    setError(null);
    try {
      await clearData();
      await onCleared();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-lg font-semibold text-neutral-100">Settings</h2>
      <section className="mt-6 max-w-md border border-neutral-800 bg-[#111] p-4">
        <h3 className="text-sm font-semibold text-neutral-200">Danger Zone</h3>
        <p className="mt-1 font-mono text-xs text-neutral-500">
          Resets data/entities.json, data/relationships.json, and
          data/financials.json to empty arrays.
        </p>
        <button
          type="button"
          className="mt-3 h-9 border border-red-500/60 bg-red-600 px-4 text-xs font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-neutral-800"
          onClick={() => void handleClear()}
          disabled={busy}
        >
          {busy ? "Clearing..." : "Clear All Data"}
        </button>
        {error ? (
          <p className="mt-2 font-mono text-xs text-red-400">{error}</p>
        ) : null}
      </section>
    </div>
  );
}
