// Module Detector -- decomposes schemas into independently verifiable modules
// References: Blondel et al. (2008) Louvain community detection, Newman (2006) modularity

import type { SchemaCandidate, ModularityAnalysis } from "./types.js";

/**
 * Detects modular structure in schema constraints using Louvain community detection.
 * Identifies independently verifiable field groups and inter-module gaps.
 */
export class ModuleDetector {
  /**
   * Analyze modularity of a schema's constraint structure.
   * @param schema Schema candidate with property definitions
   * @param regoRules Array of Rego rule source strings
   * @returns ModularityAnalysis with communities, coupling, and gaps
   */
  analyze(schema: SchemaCandidate, regoRules: string[]): ModularityAnalysis {
    const properties = schema.definition.properties as Record<string, unknown> | undefined;
    const fieldNames = properties ? Object.keys(properties) : [];
    const n = fieldNames.length;

    if (n <= 1) {
      return {
        modularityScore: n === 1 ? 1 : 0,
        modules: n === 1 ? [{ id: 0, fields: fieldNames, internalCoupling: 0, externalCoupling: 0 }] : [],
        interModuleGaps: [],
      };
    }

    // Build adjacency matrix (same logic as SpectralAnalyzer)
    const fieldIndex = new Map(fieldNames.map((f, i) => [f, i]));
    const adj: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

    // Parse Rego rules
    const denyBlocks = regoRules.join("\n").split(/(?=deny\[)/);
    for (const block of denyBlocks) {
      if (!block.startsWith("deny[") && !block.startsWith("deny ")) continue;
      const fields: number[] = [];
      const fieldMatches = block.matchAll(/(?:input\.payload\.|input\.|line\.|data\.)([a-zA-Z_][a-zA-Z0-9_]*)/g);
      for (const match of fieldMatches) {
        const idx = fieldIndex.get(match[1]);
        if (idx !== undefined) fields.push(idx);
      }
      for (let i = 0; i < fields.length; i++) {
        for (let j = i + 1; j < fields.length; j++) {
          adj[fields[i]][fields[j]] += 1.0;
          adj[fields[j]][fields[i]] += 1.0;
        }
      }
    }

    // Add required co-occurrence edges
    const required = schema.definition.required as string[] | undefined;
    if (required) {
      const reqIdx = required.map(f => fieldIndex.get(f)).filter((i): i is number => i !== undefined);
      for (let i = 0; i < reqIdx.length; i++) {
        for (let j = i + 1; j < reqIdx.length; j++) {
          adj[reqIdx[i]][reqIdx[j]] += 0.4;
          adj[reqIdx[j]][reqIdx[i]] += 0.4;
        }
      }
    }

    // Total edge weight
    let totalWeight = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        totalWeight += adj[i][j];
      }
    }

    if (totalWeight === 0) {
      // No edges: each field is its own module
      return {
        modularityScore: 0,
        modules: fieldNames.map((f, i) => ({
          id: i,
          fields: [f],
          internalCoupling: 0,
          externalCoupling: 0,
        })),
        interModuleGaps: [],
      };
    }

    // Louvain community detection
    const communities = this.louvain(adj, n);

    // Group fields by community
    const communityMap = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const c = communities[i];
      if (!communityMap.has(c)) communityMap.set(c, []);
      communityMap.get(c)!.push(i);
    }

    // Compute modularity score Q
    const degrees: number[] = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        degrees[i] += adj[i][j];
      }
    }

    const m2 = 2 * totalWeight;
    let Q = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (communities[i] === communities[j]) {
          Q += adj[i][j] - (degrees[i] * degrees[j]) / m2;
        }
      }
    }
    Q /= m2;

    // Build module descriptors
    const moduleIds = [...communityMap.keys()].sort();
    const modules = moduleIds.map((cid, idx) => {
      const members = communityMap.get(cid)!;
      let internal = 0;
      let external = 0;

      for (const i of members) {
        for (let j = 0; j < n; j++) {
          if (adj[i][j] > 0) {
            if (communities[j] === cid) {
              internal += adj[i][j];
            } else {
              external += adj[i][j];
            }
          }
        }
      }

      return {
        id: idx,
        fields: members.map(i => fieldNames[i]),
        internalCoupling: Math.round(internal * 100) / 100,
        externalCoupling: Math.round(external * 100) / 100,
      };
    });

    // Detect inter-module gaps
    const interModuleGaps: ModularityAnalysis["interModuleGaps"] = [];
    for (let a = 0; a < modules.length; a++) {
      for (let b = a + 1; b < modules.length; b++) {
        let hasEdge = false;
        const aIndices = communityMap.get(moduleIds[a])!;
        const bIndices = communityMap.get(moduleIds[b])!;

        for (const ai of aIndices) {
          for (const bi of bIndices) {
            if (adj[ai][bi] > 0) {
              hasEdge = true;
              break;
            }
          }
          if (hasEdge) break;
        }

        if (!hasEdge && modules[a].fields.length > 0 && modules[b].fields.length > 0) {
          interModuleGaps.push({
            moduleA: a,
            moduleB: b,
            missingRules: [`Consider cross-validation between {${modules[a].fields.join(", ")}} and {${modules[b].fields.join(", ")}}`],
          });
        }
      }
    }

    return {
      modularityScore: Math.round(Math.max(0, Q) * 1000) / 1000,
      modules,
      interModuleGaps,
    };
  }

  /**
   * Louvain community detection algorithm.
   * Returns array mapping each node index to its community id.
   */
  private louvain(adj: number[][], n: number): number[] {
    // Initialize: each node in its own community
    const community = Array.from({ length: n }, (_, i) => i);

    // Compute degrees and total weight
    const degrees: number[] = Array(n).fill(0);
    let m2 = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        degrees[i] += adj[i][j];
      }
      m2 += degrees[i];
    }

    if (m2 === 0) return community;

    let improved = true;
    let iterations = 0;
    const maxIterations = 100;

    while (improved && iterations < maxIterations) {
      improved = false;
      iterations++;

      for (let i = 0; i < n; i++) {
        const currentCommunity = community[i];

        // Compute modularity gain of moving i to each neighbour's community
        const neighbourCommunities = new Set<number>();
        for (let j = 0; j < n; j++) {
          if (adj[i][j] > 0 && j !== i) {
            neighbourCommunities.add(community[j]);
          }
        }

        // Compute cost of removing from current community
        let kiInCurrent = 0;
        let sumTotCurrent = 0;
        for (let j = 0; j < n; j++) {
          if (j !== i && community[j] === currentCommunity) {
            sumTotCurrent += degrees[j];
            kiInCurrent += adj[i][j];
          }
        }
        const removalCost = (kiInCurrent / m2) - (sumTotCurrent * degrees[i]) / (m2 * m2);

        let bestCommunity = currentCommunity;
        let bestGain = 0;

        for (const targetCommunity of neighbourCommunities) {
          if (targetCommunity === currentCommunity) continue;

          // Compute modularity gain of joining target community
          let sumTot = 0; // sum of weights of nodes in target community
          let kiIn = 0; // sum of weights from i to target community

          for (let j = 0; j < n; j++) {
            if (community[j] === targetCommunity) {
              sumTot += degrees[j];
              if (adj[i][j] > 0) {
                kiIn += adj[i][j];
              }
            }
          }

          const gainJoin = (kiIn / m2) - (sumTot * degrees[i]) / (m2 * m2);
          const netGain = gainJoin - removalCost;

          if (netGain > bestGain) {
            bestGain = netGain;
            bestCommunity = targetCommunity;
          }
        }

        if (bestCommunity !== currentCommunity) {
          community[i] = bestCommunity;
          improved = true;
        }
      }
    }

    // Renumber communities to be contiguous
    const uniqueCommunities = [...new Set(community)];
    const remap = new Map(uniqueCommunities.map((c, i) => [c, i]));
    return community.map(c => remap.get(c)!);
  }
}
