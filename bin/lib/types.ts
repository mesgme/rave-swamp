/** Scope node in the parsed tree. */
export interface ScopeNode {
  type: string;
  target: string;
  description: string;
  children: ScopeNode[];
  /** Composite key for matching claims: "type:target" */
  key: string;
}

/** Claim parsed from YAML. */
export interface Claim {
  claim_id: string;
  statement: string;
  status: string;
  category: string;
  scope: { type: string; target: string };
  /** Derived from scope: "type:target" */
  scopeKey: string;
  decay_lambda: number;
}

/** Confidence data returned by swamp data get. */
export interface ConfidenceData {
  claimId: string;
  confidenceScore: number;
  previousScore: number | null;
  computedAt: string;
  lastValidated: string;
  fAvg: number;
  qAvg: number;
  decayFactor: number;
  statusTransition: string | null;
}

/** Full dashboard state. */
export interface DashboardState {
  scopeTree: ScopeNode;
  flatScopes: ScopeNode[];
  claims: Claim[];
  confidence: Map<string, ConfidenceData>;
  selectedScopeIndex: number;
  threshold: number;
}

export type ConfidenceLevel = "high" | "medium" | "low" | "critical" | "unknown";
