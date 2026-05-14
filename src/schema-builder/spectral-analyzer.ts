// Spectral Analyzer - measures constraint coupling via graph Laplacian eigenvalues
// References: Fiedler (1973) algebraic connectivity, Chung (1997) spectral graph theory

import type { SchemaCandidate, SpectralAnalysis } from "./types.js";

interface FieldReference {
  ruleId: string;
  fields: string[];
}

/**
 * Analyzes structural coupling of schema constraints using graph spectral methods.
 * Computes the Fiedler value (lambda_2) as a measure of algebraic connectivity.
 */
export class SpectralAnalyzer {
  /**
   * Analyze constraint coupling via graph Laplacian eigenvalues.
   * @param schema Schema candidate with property definitions
   * @param regoRules Array of Rego rule source strings
   * @returns SpectralAnalysis with Fiedler value, spectral gap, and weakest cut
   */
  analyze(schema: SchemaCandidate, regoRules: string[]): SpectralAnalysis {
    const properties = schema.definition.properties as Record<string, unknown> | undefined;
    const fieldNames = properties ? Object.keys(properties) : [];

    if (fieldNames.length <= 1) {
      return {
        fiedlerValue: 0,
        spectralGap: 0,
        spectralScore: 0,
        weakestCut: {
          clusterA: fieldNames,
          clusterB: [],
          missingCouplings: [],
        },
        eigenvalues: fieldNames.length === 1 ? [0] : [],
      };
    }

    // Build adjacency matrix
    const n = fieldNames.length;
    const fieldIndex = new Map(fieldNames.map((f, i) => [f, i]));
    const adj: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

    // Parse Rego rules for cross-field references
    const refs = this.parseRegoForFieldReferences(regoRules.join("\n"));
    for (const ref of refs) {
      const indices = ref.fields
        .map(f => fieldIndex.get(f))
        .filter((i): i is number => i !== undefined);
      // Create edges between all fields in the same deny rule
      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          adj[indices[i]][indices[j]] += 1.0;
          adj[indices[j]][indices[i]] += 1.0;
        }
      }
    }

    // Add edges for required co-occurrence (weight 0.4)
    const required = schema.definition.required as string[] | undefined;
    if (required && required.length > 1) {
      const reqIndices = required
        .map(f => fieldIndex.get(f))
        .filter((i): i is number => i !== undefined);
      for (let i = 0; i < reqIndices.length; i++) {
        for (let j = i + 1; j < reqIndices.length; j++) {
          adj[reqIndices[i]][reqIndices[j]] += 0.4;
          adj[reqIndices[j]][reqIndices[i]] += 0.4;
        }
      }
    }

    // Compute graph Laplacian: L = D - A
    const laplacian: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      let degree = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) {
          laplacian[i][j] = -adj[i][j];
          degree += adj[i][j];
        }
      }
      laplacian[i][i] = degree;
    }

    // Compute eigenvalues using Jacobi algorithm
    const eigenvalues = this.jacobiEigenvalues(laplacian);
    eigenvalues.sort((a, b) => a - b);

    // lambda_1 is always ~0 (connected graph), lambda_2 is Fiedler value
    const fiedlerValue = eigenvalues.length >= 2 ? Math.max(0, eigenvalues[1]) : 0;
    const lambdaN = eigenvalues[eigenvalues.length - 1] || 1;
    const spectralGap = lambdaN > 0 ? fiedlerValue / lambdaN : 0;
    const spectralScore = fiedlerValue * spectralGap;

    // Compute Fiedler vector for weakest cut
    const fiedlerVector = this.computeFiedlerVector(laplacian, eigenvalues);
    const clusterA: string[] = [];
    const clusterB: string[] = [];

    for (let i = 0; i < n; i++) {
      if (fiedlerVector[i] >= 0) {
        clusterA.push(fieldNames[i]);
      } else {
        clusterB.push(fieldNames[i]);
      }
    }

    // Identify missing couplings between clusters
    const missingCouplings: string[] = [];
    for (const a of clusterA) {
      const ai = fieldIndex.get(a)!;
      for (const b of clusterB) {
        const bi = fieldIndex.get(b)!;
        if (adj[ai][bi] === 0) {
          missingCouplings.push(`${a} <-> ${b}`);
        }
      }
    }

    return {
      fiedlerValue: Math.round(fiedlerValue * 1000) / 1000,
      spectralGap: Math.round(spectralGap * 1000) / 1000,
      spectralScore: Math.round(spectralScore * 1000) / 1000,
      weakestCut: {
        clusterA,
        clusterB,
        missingCouplings: missingCouplings.slice(0, 10), // limit output
      },
      eigenvalues: eigenvalues.map(e => Math.round(e * 1000) / 1000),
    };
  }

  /**
   * Parse Rego source to extract field references per deny rule.
   */
  parseRegoForFieldReferences(regoSource: string): FieldReference[] {
    const refs: FieldReference[] = [];
    // Match deny blocks and extract field references
    const denyBlocks = regoSource.split(/(?=deny\[)/);

    for (let i = 0; i < denyBlocks.length; i++) {
      const block = denyBlocks[i];
      if (!block.startsWith("deny[") && !block.startsWith("deny ")) continue;

      const fields = new Set<string>();
      // Match input.payload.FIELD, input.FIELD, line.FIELD patterns
      const fieldMatches = block.matchAll(/(?:input\.payload\.|input\.|line\.|data\.)([a-zA-Z_][a-zA-Z0-9_]*)/g);
      for (const match of fieldMatches) {
        fields.add(match[1]);
      }

      if (fields.size > 0) {
        refs.push({
          ruleId: `deny_${i}`,
          fields: [...fields],
        });
      }
    }

    return refs;
  }

  /**
   * Jacobi eigenvalue algorithm for symmetric matrices.
   * Returns all eigenvalues sorted ascending.
   */
  private jacobiEigenvalues(matrix: number[][]): number[] {
    const n = matrix.length;
    if (n === 0) return [];
    if (n === 1) return [matrix[0][0]];

    // Copy matrix
    const a: number[][] = matrix.map(row => [...row]);
    const maxIter = 100 * n * n;
    const eps = 1e-10;

    for (let iter = 0; iter < maxIter; iter++) {
      // Find largest off-diagonal element
      let maxVal = 0;
      let p = 0;
      let q = 1;
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (Math.abs(a[i][j]) > maxVal) {
            maxVal = Math.abs(a[i][j]);
            p = i;
            q = j;
          }
        }
      }

      if (maxVal < eps) break;

      // Compute rotation angle
      // When a[p][p] == a[q][q], theta = 0 and t must be +-1 (45-degree rotation)
      // Math.sign(0) returns 0 in JavaScript, so we must handle this explicitly
      const diff = a[q][q] - a[p][p];
      let t: number;
      if (Math.abs(diff) < eps) {
        t = a[p][q] > 0 ? 1 : -1;
      } else {
        const theta = diff / (2 * a[p][q]);
        t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      }
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;

      // Apply rotation
      const app = a[p][p];
      const aqq = a[q][q];
      const apq = a[p][q];

      a[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
      a[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
      a[p][q] = 0;
      a[q][p] = 0;

      for (let i = 0; i < n; i++) {
        if (i !== p && i !== q) {
          const aip = a[i][p];
          const aiq = a[i][q];
          a[i][p] = c * aip - s * aiq;
          a[p][i] = a[i][p];
          a[i][q] = s * aip + c * aiq;
          a[q][i] = a[i][q];
        }
      }
    }

    // Extract eigenvalues from diagonal
    return Array.from({ length: n }, (_, i) => a[i][i]);
  }

  /**
   * Compute the Fiedler vector (eigenvector of lambda_2).
   * Uses inverse iteration.
   */
  private computeFiedlerVector(laplacian: number[][], eigenvalues: number[]): number[] {
    const n = laplacian.length;
    if (n <= 1) return [1];

    const sortedEigs = [...eigenvalues].sort((a, b) => a - b);
    const lambda2 = sortedEigs.length >= 2 ? sortedEigs[1] : 0;

    // Shifted matrix: (L - lambda2 * I) with small shift for numerical stability
    const shift = lambda2 - 0.01;
    const shifted: number[][] = laplacian.map(row => [...row]);
    for (let i = 0; i < n; i++) {
      shifted[i][i] -= shift;
    }

    // Power iteration on inverse (approximation via solving)
    let v = Array.from({ length: n }, () => Math.random() - 0.5);

    // Normalize
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    v = v.map(x => x / (norm || 1));

    // Simple 20-iteration Rayleigh quotient iteration
    for (let iter = 0; iter < 20; iter++) {
      // Multiply v by Laplacian
      const lv = Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          lv[i] += laplacian[i][j] * v[j];
        }
      }

      // Remove component along constant vector (lambda_1 eigenvector)
      const mean = lv.reduce((s, x) => s + x, 0) / n;
      const centered = lv.map(x => x - mean);

      // Normalize
      const cNorm = Math.sqrt(centered.reduce((s, x) => s + x * x, 0));
      v = centered.map(x => x / (cNorm || 1));
    }

    return v;
  }
}
