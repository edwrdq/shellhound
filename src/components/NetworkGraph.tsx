import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useMemo, useRef } from "react";

import type { Entity, Financial, Relationship } from "../types";

type NetworkGraphProps = {
  entities: Entity[];
  relationships: Relationship[];
  financials: Financial[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

const typeColors: Record<Entity["type"], string> = {
  nonprofit: "#3b82f6",
  llc: "#ef4444",
  individual: "#eab308",
  corp: "#f97316",
};

function nodeSize(entity: Entity, financialsByEin: Map<string, Financial>): number {
  if (!entity.ein) return 30;
  const fin = financialsByEin.get(entity.ein);
  if (!fin || !fin.total_revenue || fin.total_revenue <= 0) return 30;
  const sized = 30 + Math.log10(fin.total_revenue) * 6;
  return Math.min(80, Math.max(30, sized));
}

function edgeWidth(amount: number | null): number {
  if (!amount || amount <= 0) return 1.5;
  const w = 1 + Math.log10(amount);
  return Math.min(8, Math.max(1.5, w));
}

export default function NetworkGraph({
  entities,
  relationships,
  financials,
  selectedId,
  onSelect,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const elements = useMemo<ElementDefinition[]>(() => {
    const finByEin = new Map<string, Financial>();
    for (const f of financials) {
      const existing = finByEin.get(f.ein);
      if (!existing || (f.year ?? 0) > (existing.year ?? 0)) {
        finByEin.set(f.ein, f);
      }
    }

    const entityIds = new Set(entities.map((e) => e.id));
    const nodes: ElementDefinition[] = entities.map((entity) => ({
      data: {
        id: entity.id,
        label: entity.name,
        type: entity.type,
        color: typeColors[entity.type] ?? "#64748b",
        size: nodeSize(entity, finByEin),
      },
      classes: entity.id === selectedId ? "selected" : "",
    }));

    const edges: ElementDefinition[] = relationships
      .filter(
        (r) => entityIds.has(r.source_id) && entityIds.has(r.target_id),
      )
      .map((r, i) => ({
        data: {
          id: `${r.source_id}-${r.target_id}-${r.type}-${i}`,
          source: r.source_id,
          target: r.target_id,
          label: r.type,
          width: edgeWidth(r.amount),
        },
      }));

    return [...nodes, ...edges];
  }, [entities, relationships, financials, selectedId]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    cyRef.current?.destroy();
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            "border-color": "#0a0a0a",
            "border-width": 2,
            color: "#e5e7eb",
            "font-family":
              "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
            "font-size": 10,
            height: "data(size)",
            width: "data(size)",
            label: "data(label)",
            "min-zoomed-font-size": 6,
            "text-background-color": "#0a0a0a",
            "text-background-opacity": 0.78,
            "text-background-padding": "3px",
            "text-halign": "center",
            "text-margin-y": -8,
            "text-max-width": "120px",
            "text-valign": "bottom",
            "text-wrap": "wrap",
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-color": "#22d3ee",
            "border-width": 4,
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "font-family":
              "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
            "font-size": 8,
            label: "data(label)",
            "line-color": "#475569",
            "target-arrow-color": "#475569",
            "target-arrow-shape": "triangle",
            "text-background-color": "#0a0a0a",
            "text-background-opacity": 0.85,
            "text-background-padding": "2px",
            "text-rotation": "autorotate",
            width: "data(width)",
          },
        },
      ],
      layout: {
        name: "cose",
        animate: false,
        idealEdgeLength: 130,
        nodeOverlap: 20,
        padding: 40,
        randomize: true,
      },
    });

    cyRef.current.on("tap", "node", (event) => {
      onSelect(event.target.id());
    });

    return () => {
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, [elements, onSelect]);

  return (
    <div className="relative h-full min-h-[460px] overflow-hidden border border-neutral-800 bg-[#0a0a0a]">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 text-[10px] uppercase text-neutral-400">
        {Object.entries(typeColors).map(([type, color]) => (
          <span key={type} className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 border border-white/20"
              style={{ backgroundColor: color }}
            />
            {type}
          </span>
        ))}
      </div>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
