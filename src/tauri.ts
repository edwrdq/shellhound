import { invoke } from "@tauri-apps/api/core";

import type { Entity, Financial, Relationship, ScraperResult } from "./types";

export function readEntities() {
  return invoke<Entity[]>("read_entities");
}

export function writeEntities(data: Entity[]) {
  return invoke<void>("write_entities", { data });
}

export function readRelationships() {
  return invoke<Relationship[]>("read_relationships");
}

export function writeRelationships(data: Relationship[]) {
  return invoke<void>("write_relationships", { data });
}

export function readFinancials() {
  return invoke<Financial[]>("read_financials");
}

export function writeFinancials(data: Financial[]) {
  return invoke<void>("write_financials", { data });
}

export function runScraper(seed: string, scraperType: string) {
  return invoke<ScraperResult>("run_scraper", {
    seed,
    scraperType,
  });
}
