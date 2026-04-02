import { parse as parseYaml } from "jsr:@std/yaml@1";
import type { ScopeNode } from "./types.ts";

interface RawScope {
  type: string;
  target: string;
  description?: string;
  parent?: { type: string; target: string };
}

interface ScopeFile {
  version: string;
  description?: string;
  scopes: RawScope[];
}

/** Parse a scope YAML string into raw scope definitions. */
export function parseScopeYaml(yamlStr: string): RawScope[] {
  const doc = parseYaml(yamlStr) as ScopeFile;
  return doc.scopes ?? [];
}

/** Build a scope tree from raw definitions. Returns the root node. */
export function buildScopeTree(rawScopes: RawScope[]): ScopeNode {
  const nodes = new Map<string, ScopeNode>();

  // Create all nodes
  for (const raw of rawScopes) {
    const key = `${raw.type}:${raw.target}`;
    nodes.set(key, {
      type: raw.type,
      target: raw.target,
      description: raw.description ?? "",
      children: [],
      key,
    });
  }

  // Wire parent-child relationships
  let root: ScopeNode | null = null;
  for (const raw of rawScopes) {
    const key = `${raw.type}:${raw.target}`;
    const node = nodes.get(key)!;
    if (raw.parent) {
      const parentKey = `${raw.parent.type}:${raw.parent.target}`;
      const parent = nodes.get(parentKey);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphan — treat as root candidate
        root ??= node;
      }
    } else {
      // No parent — this is the root
      root ??= node;
    }
  }

  if (!root) {
    throw new Error("No root scope found (a scope with no parent)");
  }
  return root;
}

/** Flatten a scope tree in pre-order (root, then children depth-first). */
export function flattenScopes(node: ScopeNode): ScopeNode[] {
  const result: ScopeNode[] = [node];
  for (const child of node.children) {
    result.push(...flattenScopes(child));
  }
  return result;
}

/** Read and parse a scope YAML file. */
export async function parseScopeFile(path: string): Promise<ScopeNode> {
  const text = await Deno.readTextFile(path);
  const rawScopes = parseScopeYaml(text);
  return buildScopeTree(rawScopes);
}
