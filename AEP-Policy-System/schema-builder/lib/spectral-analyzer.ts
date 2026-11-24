// Spectral Analyzer - measures constraint coupling via graph Laplacian eigenvalues
// References: Fiedler (1973) algebraic connectivity, Chung (1997) spectral graph theory

import type { SchemaCandidate, SpectralAnalysis } from "./types.js";
import {
  SquareMatrix,
  buildConstraintGraph,
  parseRegoForFieldReferences,
  type FieldReference,
} from "./constraint-graph.js";

/** Eigenvalues with their eigenvectors, sorted by ascending eigenvalue. */
export interface EigenSystem {
  values: number[];
  /** vectors[k] is the unit eigenvector of values[k]. */
  vectors: number[][];
}

const ROUND = (x: number): number => Math.round(x * 1000) / 1000;

/**
 * Jacobi eigenvalue algorithm for a symmetric matrix. Returns every eigenvalue
 * with its eigenvector, sorted by ascending eigenvalue.
 */
export function symmetricEigen(matrix: SquareMatrix): EigenSystem {
  const n = matrix.size;
  if (n === 0) return { values: [], vectors: [] };

  const a = matrix.clone();
  // v holds the accumulated rotations; its columns become the eigenvectors.
  const v = new SquareMatrix(n);
  for (let i = 0; i < n; i++) v.set(i, i, 1);

  const maxIter = 100 * n * n;
  const eps = 1e-12;

  for (let iter = 0; iter < maxIter; iter++) {
    let maxVal = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const x = Math.abs(a.get(i, j));
        if (x > maxVal) {
          maxVal = x;
          p = i;
          q = j;
        }
      }
    }
    if (maxVal < eps) break;

    // When a[p][p] equals a[q][q] the rotation is 45 degrees. Math.sign(0) is
    // 0 in JavaScript, so that case is handled on its own.
    const app = a.get(p, p);
    const aqq = a.get(q, q);
    const apq = a.get(p, q);
    const diff = aqq - app;
    let t: number;
    if (Math.abs(diff) < eps) {
      t = apq > 0 ? 1 : -1;
    } else {
      const theta = diff / (2 * apq);
      t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    }
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;

    a.set(p, p, c * c * app - 2 * s * c * apq + s * s * aqq);
    a.set(q, q, s * s * app + 2 * s * c * apq + c * c * aqq);
    a.set(p, q, 0);
    a.set(q, p, 0);

    for (let i = 0; i < n; i++) {
      if (i !== p && i !== q) {
        const aip = a.get(i, p);
        const aiq = a.get(i, q);
        a.set(i, p, c * aip - s * aiq);
        a.set(p, i, c * aip - s * aiq);
        a.set(i, q, s * aip + c * aiq);
        a.set(q, i, s * aip + c * aiq);
      }
      const vip = v.get(i, p);
      const viq = v.get(i, q);
      v.set(i, p, c * vip - s * viq);
      v.set(i, q, s * vip + c * viq);
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a.get(x, x) - a.get(y, y));
  return {
    values: order.map((k) => a.get(k, k)),
    vectors: order.map((k) => Array.from({ length: n }, (_, i) => v.get(i, k))),
  };
}

/**
 * Analyzes structural coupling of schema constraints using graph spectral methods.
 * Computes the Fiedler value (lambda_2) as a measure of algebraic connectivity
 * and splits the fields by the sign of the Fiedler vector.
 */
export class SpectralAnalyzer {
  /**
   * Analyze constraint coupling via graph Laplacian eigenvalues.
   * @param schema Schema candidate with property definitions
   * @param regoRules Array of Rego rule source strings
   * @returns SpectralAnalysis with Fiedler value, spectral gap and weakest cut
   */
  analyze(schema: SchemaCandidate, regoRules: string[]): SpectralAnalysis {
    const { fieldNames, adjacency } = buildConstraintGraph(schema, regoRules);
    const n = fieldNames.length;

    if (n <= 1) {
      return {
        fiedlerValue: 0,
        spectralGap: 0,
        spectralScore: 0,
        weakestCut: { clusterA: fieldNames, clusterB: [], missingCouplings: [] },
        eigenvalues: n === 1 ? [0] : [],
      };
    }

    // Graph Laplacian L = D - A.
    const laplacian = new SquareMatrix(n);
    for (let i = 0; i < n; i++) {
      let degree = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        laplacian.set(i, j, -adjacency.get(i, j));
        degree += adjacency.get(i, j);
      }
      laplacian.set(i, i, degree);
    }

    const eigen = symmetricEigen(laplacian);
    const eigenvalues = eigen.values;

    // lambda_1 is 0 for every Laplacian. lambda_2 is the Fiedler value.
    const fiedlerValue = Math.max(0, eigenvalues[1] ?? 0);
    const lambdaN = eigenvalues[eigenvalues.length - 1] ?? 0;
    const spectralGap = lambdaN > 0 ? fiedlerValue / lambdaN : 0;
    const spectralScore = fiedlerValue * spectralGap;

    // The sign of the Fiedler vector gives the weakest cut. The vector is
    // oriented so that its first non-zero entry is positive, which keeps the
    // split deterministic.
    const fiedlerVector = eigen.vectors[1] ?? fieldNames.map(() => 1);
    const pivot = fiedlerVector.find((x) => Math.abs(x) > 1e-9) ?? 1;
    const oriented = fiedlerVector.map((x) => (pivot < 0 ? -x : x));

    const clusterA: string[] = [];
    const clusterB: string[] = [];
    const indexA: number[] = [];
    const indexB: number[] = [];
    oriented.forEach((x, i) => {
      const name = fieldNames[i];
      if (name === undefined) return;
      if (x >= -1e-9) {
        clusterA.push(name);
        indexA.push(i);
      } else {
        clusterB.push(name);
        indexB.push(i);
      }
    });

    const missingCouplings: string[] = [];
    for (const ai of indexA) {
      for (const bi of indexB) {
        if (adjacency.get(ai, bi) === 0) {
          missingCouplings.push(`${fieldNames[ai] ?? ""} <-> ${fieldNames[bi] ?? ""}`);
        }
      }
    }

    return {
      fiedlerValue: ROUND(fiedlerValue),
      spectralGap: ROUND(spectralGap),
      spectralScore: ROUND(spectralScore),
      weakestCut: {
        clusterA,
        clusterB,
        missingCouplings: missingCouplings.slice(0, 10),
      },
      eigenvalues: eigenvalues.map(ROUND),
    };
  }

  /** Parse Rego source to extract field references per deny rule. */
  parseRegoForFieldReferences(regoSource: string): FieldReference[] {
    return parseRegoForFieldReferences(regoSource);
  }
}
