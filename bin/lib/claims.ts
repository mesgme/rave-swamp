import { parse as parseYaml } from "jsr:@std/yaml@1";
import type { Claim, ScopeNode } from "./types.ts";

interface RawClaim {
  claim_id: string;
  statement: string;
  status: string;
  category: string;
  scope: { type: string; target: string };
  decay_lambda: number;
}

/** Parse a single claim YAML string into a Claim. */
export function parseClaimYaml(yamlStr: string): Claim {
  const raw = parseYaml(yamlStr) as RawClaim;
  return {
    claim_id: raw.claim_id,
    statement: raw.statement,
    status: raw.status,
    category: raw.category,
    scope: raw.scope,
    scopeKey: `${raw.scope.type}:${raw.scope.target}`,
    decay_lambda: raw.decay_lambda,
  };
}

/** Collect all scope keys from a node and its descendants. */
function collectScopeKeys(node: ScopeNode): Set<string> {
  const keys = new Set<string>([node.key]);
  for (const child of node.children) {
    for (const k of collectScopeKeys(child)) {
      keys.add(k);
    }
  }
  return keys;
}

/** Filter claims to those matching the given scope or any descendant scope. */
export function claimsForScope(claims: Claim[], scope: ScopeNode): Claim[] {
  const keys = collectScopeKeys(scope);
  return claims.filter((c) => keys.has(c.scopeKey));
}

/** Read all claim YAML files from a directory. */
export async function parseClaimFiles(dir: string): Promise<Claim[]> {
  const claims: Claim[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.startsWith("claim-") && entry.name.endsWith(".yaml")) {
      const text = await Deno.readTextFile(`${dir}/${entry.name}`);
      claims.push(parseClaimYaml(text));
    }
  }
  claims.sort((a, b) => a.claim_id.localeCompare(b.claim_id));
  return claims;
}
