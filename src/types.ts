export type EntityType = "nonprofit" | "llc" | "corp" | "individual";

export type Officer = {
  name: string;
  title: string;
};

export type Entity = {
  id: string;
  name: string;
  type: EntityType;
  ein: string | null;
  state: string;
  status: string;
  registered_agent: string | null;
  officers: Officer[];
  sunbiz_url: string | null;
  metadata: Record<string, unknown>;
};

export type RelationshipType =
  | "officer"
  | "registered_agent"
  | "vendor"
  | "landlord"
  | "affiliated";

export type Relationship = {
  source_id: string;
  target_id: string;
  type: RelationshipType;
  amount: number | null;
  description: string;
  year: number | null;
};

export type Executive = {
  name: string;
  title: string;
  compensation: number;
};

export type RelatedPartyTransaction = {
  description: string;
  amount: number;
};

export type Financial = {
  ein: string;
  entity_id?: string;
  year: number;
  total_revenue: number;
  total_expenses: number;
  total_salaries: number;
  program_expenses: number;
  executives: Executive[];
  related_party_transactions: RelatedPartyTransaction[];
  source: "propublica" | "irs";
};

export type SeedType = "ein" | "name";
