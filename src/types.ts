export type EntityType = "nonprofit" | "llc" | "individual" | "government";

export type Entity = {
  id: string;
  name: string;
  type: EntityType;
  ein?: string;
  state?: string;
  status?: string;
  registered_agent?: string;
  officers: string[];
  metadata: Record<string, unknown>;
};

export type Relationship = {
  source_id: string;
  target_id: string;
  type: string;
  amount?: number | null;
  description?: string;
  year?: number | null;
};

export type Executive = {
  name: string;
  title: string;
  compensation: number;
};

export type Financial = {
  ein: string;
  year: number;
  total_revenue: number;
  total_expenses: number;
  salaries: number;
  related_party_transactions: unknown[];
  executives: Executive[];
};

export type ScraperResult = {
  entities?: Entity[];
  relationships?: Relationship[];
  financials?: Financial[];
  errors?: string[];
  seed?: string;
  scraper_type?: string;
};
