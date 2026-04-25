import { describe, it, expect } from "vitest";
import { MLMetrics } from "../../src/eval/metrics.js";
import type { MLMetricsReport } from "../../src/eval/metrics.js";

describe("MLMetrics", () => {
  describe("classification", () => {
    it("computes perfect classification metrics", () => {
      const actual = [1, 1, 0, 0, 1, 0];
      const predicted = [1, 1, 0, 0, 1, 0];
      const report = MLMetrics.classification(actual, predicted);

      expect(report.accuracy).toBe(1);
      expect(report.precision).toBe(1);
      expect(report.recall).toBe(1);
      expect(report.f1).toBe(1);
      expect(report.confusionMatrix).toEqual({ tp: 3, fp: 0, tn: 3, fn: 0 });
    });

    it("computes imperfect classification metrics", () => {
      const actual = [1, 1, 0, 0, 1, 0];
      const predicted = [1, 0, 0, 1, 1, 0];
      const report = MLMetrics.classification(actual, predicted);

      expect(report.confusionMatrix).toEqual({ tp: 2, fp: 1, tn: 2, fn: 1 });
      expect(report.accuracy).toBeCloseTo(0.667, 2);
      expect(report.precision).toBeCloseTo(0.667, 2);
      expect(report.recall).toBeCloseTo(0.667, 2);
    });

    it("handles empty arrays", () => {
      const report = MLMetrics.classification([], []);
      expect(report.accuracy).toBe(0);
      expect(report.f1).toBe(0);
    });
  });

  describe("regression", () => {
    it("computes perfect regression metrics", () => {
      const actual = [1, 2, 3, 4, 5];
      const predicted = [1, 2, 3, 4, 5];
      const report = MLMetrics.regression(actual, predicted);

      expect(report.mse).toBe(0);
      expect(report.rmse).toBe(0);
      expect(report.mae).toBe(0);
      expect(report.r2).toBe(1);
      expect(report.mape).toBe(0);
    });

    it("computes imperfect regression metrics", () => {
      const actual = [3, -0.5, 2, 7];
      const predicted = [2.5, 0.0, 2, 8];
      const report = MLMetrics.regression(actual, predicted);

      expect(report.mse).toBeGreaterThan(0);
      expect(report.rmse).toBeGreaterThan(0);
      expect(report.mae).toBeGreaterThan(0);
      expect(report.r2).toBeLessThan(1);
      expect(report.r2).toBeGreaterThan(0);
    });

    it("handles empty arrays", () => {
      const report = MLMetrics.regression([], []);
      expect(report.mse).toBe(0);
      expect(report.r2).toBe(0);
    });
  });

  describe("retrieval", () => {
    it("computes perfect retrieval metrics", () => {
      const relevant = ["doc1", "doc2", "doc3"];
      const retrieved = ["doc1", "doc2", "doc3", "doc4", "doc5"];
      const report = MLMetrics.retrieval(relevant, retrieved, 3);

      expect(report.precisionAtK).toBe(1);
      expect(report.recallAtK).toBe(1);
      expect(report.mrr).toBe(1);
      expect(report.ndcg).toBe(1);
    });

    it("computes partial retrieval metrics", () => {
      const relevant = ["doc1", "doc3"];
      const retrieved = ["doc2", "doc1", "doc4", "doc3", "doc5"];
      const report = MLMetrics.retrieval(relevant, retrieved, 3);

      expect(report.precisionAtK).toBeCloseTo(0.333, 2);
      expect(report.recallAtK).toBe(0.5);
      expect(report.mrr).toBe(0.5);
    });

    it("handles no relevant results in top-k", () => {
      const relevant = ["doc1"];
      const retrieved = ["doc2", "doc3", "doc4"];
      const report = MLMetrics.retrieval(relevant, retrieved, 3);

      expect(report.precisionAtK).toBe(0);
      expect(report.recallAtK).toBe(0);
    });

    it("handles empty inputs", () => {
      const report = MLMetrics.retrieval([], ["doc1"], 5);
      expect(report.precisionAtK).toBe(0);
      expect(report.mrr).toBe(0);
    });
  });

  describe("generation", () => {
    it("computes exact match rate", () => {
      const expected = ["hello", "world", "foo"];
      const generated = ["hello", "world", "bar"];
      const report = MLMetrics.generation(expected, generated);

      expect(report.exactMatch).toBeCloseTo(0.667, 2);
      expect(report.avgLength).toBeGreaterThan(0);
      expect(report.emptyRate).toBe(0);
    });

    it("detects empty generations", () => {
      const expected = ["hello", "world"];
      const generated = ["hello", ""];
      const report = MLMetrics.generation(expected, generated);

      expect(report.emptyRate).toBe(0.5);
    });

    it("handles empty arrays", () => {
      const report = MLMetrics.generation([], []);
      expect(report.exactMatch).toBe(0);
    });
  });

  describe("compositeScore", () => {
    it("averages available metric scores", () => {
      const report: MLMetricsReport = {
        classification: { accuracy: 0.9, precision: 0.85, recall: 0.8, f1: 0.824, confusionMatrix: { tp: 80, fp: 14, tn: 86, fn: 20 } },
        regression: { mse: 0.5, rmse: 0.707, mae: 0.4, r2: 0.95, mape: 5.0 },
      };

      const score = MLMetrics.compositeScore(report);
      // Average of f1 (0.824) and r2 (0.95)
      expect(score).toBeCloseTo(0.887, 2);
    });

    it("returns 0 for empty report", () => {
      const score = MLMetrics.compositeScore({});
      expect(score).toBe(0);
    });
  });
});
