// Module Detector - decomposes schemas into independently verifiable modules
// References: Blondel et al. (2008) Louvain community detection, Newman (2006) modularity

import type { SchemaCandidate, ModularityAnalysis } from "./types.js";
import { buildConstraintGraph, type SquareMatrix } from "./constraint-graph.js";

/**
 * Detects modular structure in schema constraints using Louvain community detection.
 * Identifies independently verifiable field groups and inter-module gaps.
 */
export class ModuleDetector {
  /**
   * Analyze modularity of a schema's constraint structure.
   * @param schema Schema candidate with property definitions
   * @param regoRules Array of Rego rule source strings
   * @returns ModularityAnalysis with communities, coupling and gaps
   */
  analyze(schema: SchemaCandidate, regoRules: string[]): ModularityAnalysis {
    const { fieldNames, adjacency: adj } = buildConstraintGraph(schema, regoRules);
    const n = fieldNames.length;

    if (n <= 1) {
      return {
        modularityScore: n === 1 ? 1 : 0,
        modules: n === 1 ? [{ id: 0, fields: fieldNames, internalCoupling: 0, externalCoupling: 0 }] : [],
        interModuleGaps: [],
      };
    }

    let totalWeight = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) totalWeight += adj.get(i, j);
    }

    if (totalWeight === 0) {
      // No edges: each field is its own module.
      return {
        modularityScore: 0,
        modules: fieldNames.map((f, i) => ({ id: i, fields: [f], internalCoupling: 0, externalCoupling: 0 })),
        interModuleGaps: [],
      };
    }

    const communities = this.louvain(adj);

    const communityMap = new Map<number, number[]>();
    communities.forEach((c, i) => {
      const members = communityMap.get(c) ?? [];
      members.push(i);
      communityMap.set(c, members);
    });

    // Modularity Q = (1 / 2m) * sum over same-community pairs of (A_ij - k_i k_j / 2m).
    const degrees = Array.from({ length: n }, (_, i) => adj.rowSum(i));
    const m2 = 2 * totalWeight;
    let q = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (communities[i] === communities[j]) {
          q += adj.get(i, j) - ((degrees[i] ?? 0) * (degrees[j] ?? 0)) / m2;
        }
      }
    }
    q /= m2;

    const moduleIds = [...communityMap.keys()].sort((a, b) => a - b);
    const modules = moduleIds.map((cid, idx) => {
      const members = communityMap.get(cid) ?? [];
      let internal = 0;
      let external = 0;
      for (const i of members) {
        for (let j = 0; j < n; j++) {
          const w = adj.get(i, j);
          if (w <= 0) continue;
          if (communities[j] === cid) internal += w;
          else external += w;
        }
      }
      return {
        id: idx,
        fields: members.map((i) => fieldNames[i] ?? ""),
        internalCoupling: Math.round(internal * 100) / 100,
        externalCoupling: Math.round(external * 100) / 100,
      };
    });

    const interModuleGaps: ModularityAnalysis["interModuleGaps"] = [];
    for (let a = 0; a < modules.length; a++) {
      for (let b = a + 1; b < modules.length; b++) {
        const aIndices = communityMap.get(moduleIds[a] ?? -1) ?? [];
        const bIndices = communityMap.get(moduleIds[b] ?? -1) ?? [];
        const hasEdge = aIndices.some((ai) => bIndices.some((bi) => adj.get(ai, bi) > 0));
        const moduleA = modules[a];
        const moduleB = modules[b];
        if (!hasEdge && moduleA && moduleB && moduleA.fields.length > 0 && moduleB.fields.length > 0) {
          interModuleGaps.push({
            moduleA: a,
            moduleB: b,
            missingRules: [
              `Consider cross-validation between {${moduleA.fields.join(", ")}} and {${moduleB.fields.join(", ")}}`,
            ],
          });
        }
      }
    }

    return {
      modularityScore: Math.round(Math.max(0, q) * 1000) / 1000,
      modules,
      interModuleGaps,
    };
  }

  /**
   * Local moving phase of the Louvain method. Each node moves to the
   * neighbouring community with the largest positive modularity gain until no
   * move improves the modularity. Returns the community of each node, numbered
   * from 0 in order of first appearance.
   */
  private louvain(adj: SquareMatrix): number[] {
    const n = adj.size;
    const community = Array.from({ length: n }, (_, i) => i);
    const degrees = Array.from({ length: n }, (_, i) => adj.rowSum(i));
    const m2 = degrees.reduce((s, d) => s + d, 0);
    if (m2 === 0) return community;

    // Gain of placing node i into community c, from which i is absent:
    // k_i,in / m - sigma_tot * k_i / (2 m^2), with m2 = 2m.
    const gain = (i: number, c: number): number => {
      let kiIn = 0;
      let sigmaTot = 0;
      for (let j = 0; j < n; j++) {
        if (j === i || community[j] !== c) continue;
        kiIn += adj.get(i, j);
        sigmaTot += degrees[j] ?? 0;
      }
      return (2 * kiIn) / m2 - (2 * sigmaTot * (degrees[i] ?? 0)) / (m2 * m2);
    };

    const maxIterations = 100;
    for (let iter = 0; iter < maxIterations; iter++) {
      let improved = false;
      for (let i = 0; i < n; i++) {
        const current = community[i] ?? i;
        const stay = gain(i, current);
        let best = current;
        let bestGain = stay;
        const neighbours = new Set<number>();
        for (let j = 0; j < n; j++) {
          if (j !== i && adj.get(i, j) > 0) neighbours.add(community[j] ?? j);
        }
        for (const target of neighbours) {
          if (target === current) continue;
          const g = gain(i, target);
          if (g > bestGain + 1e-12) {
            bestGain = g;
            best = target;
          }
        }
        if (best !== current) {
          community[i] = best;
          improved = true;
        }
      }
      if (!improved) break;
    }

    const remap = new Map<number, number>();
    return community.map((c) => {
      const known = remap.get(c);
      if (known !== undefined) return known;
      const id = remap.size;
      remap.set(c, id);
      return id;
    });
  }
}
