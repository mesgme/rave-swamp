import { assertEquals } from "jsr:@std/assert@1";
import { parseClaimYaml, claimsForScope } from "./claims.ts";
import type { ScopeNode } from "./types.ts";

const SAMPLE_CLAIM = `
claim_id: claim-branch-protection-001
statement: Main branch requires a PR
owner:
  name: mellens
  contact: mesgme/rave-swamp
status: active
category: change_risk
scope:
  type: pipeline
  target: mesgme/rave-swamp/main
decay_lambda: 0.02
annotations: []
`;

Deno.test("parseClaimYaml extracts claim fields", () => {
  const claim = parseClaimYaml(SAMPLE_CLAIM);
  assertEquals(claim.claim_id, "claim-branch-protection-001");
  assertEquals(claim.status, "active");
  assertEquals(claim.category, "change_risk");
  assertEquals(claim.decay_lambda, 0.02);
});

Deno.test("parseClaimYaml derives scopeKey", () => {
  const claim = parseClaimYaml(SAMPLE_CLAIM);
  assertEquals(claim.scopeKey, "pipeline:mesgme/rave-swamp/main");
});

Deno.test("claimsForScope returns direct matches", () => {
  const claims = [parseClaimYaml(SAMPLE_CLAIM)];
  const scope: ScopeNode = {
    type: "pipeline",
    target: "mesgme/rave-swamp/main",
    description: "",
    children: [],
    key: "pipeline:mesgme/rave-swamp/main",
  };
  const filtered = claimsForScope(claims, scope);
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].claim_id, "claim-branch-protection-001");
});

Deno.test("claimsForScope returns descendant matches from parent", () => {
  const claims = [parseClaimYaml(SAMPLE_CLAIM)];
  const child: ScopeNode = {
    type: "pipeline",
    target: "mesgme/rave-swamp/main",
    description: "",
    children: [],
    key: "pipeline:mesgme/rave-swamp/main",
  };
  const root: ScopeNode = {
    type: "repository",
    target: "mesgme/rave-swamp",
    description: "",
    children: [child],
    key: "repository:mesgme/rave-swamp",
  };
  const filtered = claimsForScope(claims, root);
  assertEquals(filtered.length, 1);
});

Deno.test("claimsForScope returns empty for unrelated scope", () => {
  const claims = [parseClaimYaml(SAMPLE_CLAIM)];
  const scope: ScopeNode = {
    type: "component",
    target: "mesgme/other",
    description: "",
    children: [],
    key: "component:mesgme/other",
  };
  const filtered = claimsForScope(claims, scope);
  assertEquals(filtered.length, 0);
});
