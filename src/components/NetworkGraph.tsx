import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useMemo, useRef } from "react";

import type { Entity, Relationship } from "../types";

type NetworkGraphProps = {
  entities: Entity[];
  relationships: Relationship[];
  selectedId?: string;
  onSelect: (id: string) => void;
};

const typeColors: Record<Entity["type"], string> = {
  nonprofit: "#2f80ed",
  llc: "#ef4444",
  individual: "#f2c94c",
  government: "#27ae60",
};

export default function NetworkGraph({
  entities,
  relationships,
  selectedId,
  onSelect,
}: NetworkGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);

  const elements = useMemo<ElementDefinition[]>(() => {
    const entityIds = new Set(entities.map((entity) => entity.id));
    const nodes = entities.map((entity) => ({
      data: {
        id: entity.id,
        label: entity.name,
        type: entity.type,
        color: typeColors[entity.type],
      },
      classes: entity.id === selectedId ? "selected" : "",
    }));

    const edges = relationships
      .filter(
        (relationship) =>
          entityIds.has(relationship.source_id) &&
          entityIds.has(relationship.target_id),
      )
      .map((relationship, index) => ({
        data: {
          id: `${relationship.source_id}-${relationship.target_id}-${index}`,
          source: relationship.source_id,
          target: relationship.target_id,
          label: relationship.type,
        },
      }));

    return [...nodes, ...edges];
  }, [entities, relationships, selectedId]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    cyRef.current?.destroy();
    cyRef.current = cytoscape({
      container: containerRef.current,
      elements,
      minZoom: 0.25,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            "border-color": "#101820",
            "border-width": "2px",
            color: "#e5f7ff",
            "font-family":
              "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
            "font-size": "10px",
            height: "34px",
            label: "data(label)",
            "min-zoomed-font-size": 6,
            "overlay-opacity": 0,
            "text-background-color": "#05070a",
            "text-background-opacity": 0.72,
            "text-background-padding": "3px",
            "text-halign": "center",
            "text-margin-y": -7,
            "text-max-width": "90px",
            "text-valign": "bottom",
            "text-wrap": "wrap",
            width: "34px",
          },
        },
        {
          selector: "node.selected",
          style: {
            "border-color": "#6ef3d6",
            "border-width": "4px",
            height: "44px",
            width: "44px",
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "font-family":
              "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
            "font-size": "8px",
            label: "data(label)",
            "line-color": "#44606d",
            "target-arrow-color": "#44606d",
            "target-arrow-shape": "triangle",
            "text-background-color": "#05070a",
            "text-background-opacity": 0.84,
            "text-background-padding": "2px",
            "text-rotation": "autorotate",
            width: "1.3px",
          },
        },
      ],
      layout: {
        name: "cose",
        animate: false,
        idealEdgeLength: 110,
        nodeOverlap: 18,
        padding: 38,
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
    <div className="relative h-full min-h-[460px] overflow-hidden border border-cyan-500/20 bg-[#05070a]">
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 text-[10px] uppercase text-slate-300">
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
