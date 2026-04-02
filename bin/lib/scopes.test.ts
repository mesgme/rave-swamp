import { assertEquals } from "jsr:@std/assert@1";
import { buildScopeTree, flattenScopes, parseScopeYaml } from "./scopes.ts";

const SAMPLE_YAML = `
version: "0.1.0"
description: "Test scope hierarchy"
scopes:
  - type: "repository"
    target: "org/repo"
    description: "Root repo"

  - type: "pipeline"
    target: "org/repo/main"
    parent:
      type: "repository"
      target: "org/repo"
    description: "CI pipeline"

  - type: "component"
    target: "org/repo/extensions"
    parent:
      type: "repository"
      target: "org/repo"
    description: "Extension models"

  - type: "component"
    target: "org/repo/workflows"
    parent:
      type: "repository"
      target: "org/repo"
    description: "Workflow files"
`;

Deno.test("parseScopeYaml parses all scopes from YAML string", () => {
  const scopes = parseScopeYaml(SAMPLE_YAML);
  assertEquals(scopes.length, 4);
  assertEquals(scopes[0].type, "repository");
  assertEquals(scopes[0].target, "org/repo");
});

Deno.test("buildScopeTree builds root with children", () => {
  const scopes = parseScopeYaml(SAMPLE_YAML);
  const root = buildScopeTree(scopes);
  assertEquals(root.key, "repository:org/repo");
  assertEquals(root.children.length, 3);
});

Deno.test("buildScopeTree children have correct keys", () => {
  const scopes = parseScopeYaml(SAMPLE_YAML);
  const root = buildScopeTree(scopes);
  const childKeys = root.children.map((c) => c.key);
  assertEquals(childKeys.includes("pipeline:org/repo/main"), true);
  assertEquals(childKeys.includes("component:org/repo/extensions"), true);
  assertEquals(childKeys.includes("component:org/repo/workflows"), true);
});

Deno.test("flattenScopes returns pre-order traversal", () => {
  const scopes = parseScopeYaml(SAMPLE_YAML);
  const root = buildScopeTree(scopes);
  const flat = flattenScopes(root);
  assertEquals(flat.length, 4);
  assertEquals(flat[0].key, "repository:org/repo");
  // Children follow root
  assertEquals(flat.slice(1).every((n) => n.key !== "repository:org/repo"), true);
});

Deno.test("buildScopeTree handles single scope (no parent references)", () => {
  const yaml = `
version: "0.1.0"
scopes:
  - type: "repository"
    target: "org/solo"
    description: "Solo repo"
`;
  const scopes = parseScopeYaml(yaml);
  const root = buildScopeTree(scopes);
  assertEquals(root.key, "repository:org/solo");
  assertEquals(root.children.length, 0);
});
