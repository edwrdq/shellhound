import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Entity, Financial, Relationship, SeedType } from "./types";

export function readEntities() {
  return invoke<Entity[]>("read_entities");
}

export function writeEntities(data: Entity[]) {
  return invoke<void>("write_entities", { data: JSON.stringify(data) });
}

export function readRelationships() {
  return invoke<Relationship[]>("read_relationships");
}

export function writeRelationships(data: Relationship[]) {
  return invoke<void>("write_relationships", { data: JSON.stringify(data) });
}

export function readFinancials() {
  return invoke<Financial[]>("read_financials");
}

export function writeFinancials(data: Financial[]) {
  return invoke<void>("write_financials", { data: JSON.stringify(data) });
}

export function runScraper(seed: string, seedType: SeedType, depth: number) {
  return invoke<void>("run_scraper", { seed, seedType, depth });
}

export function clearData() {
  return invoke<void>("clear_data");
}

export async function onScraperLog(
  cb: (line: string) => void,
): Promise<UnlistenFn> {
  return listen<string>("scraper-log", (event) => cb(event.payload));
}

export async function onScraperDone(
  cb: (code: number) => void,
): Promise<UnlistenFn> {
  return listen<number>("scraper-done", (event) => cb(event.payload));
}
