// AEP 2.5 -- ML Metrics Evaluator
// Computes standard ML evaluation metrics for classification, regression,
// retrieval and generation tasks. All methods are pure static functions.

export interface ClassificationReport {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  confusionMatrix: { tp: number; fp: number; tn: number; fn: number };
}

export interface RegressionReport {
  mse: number;
  rmse: number;
  mae: number;
  r2: number;
  mape: number;
}

export interface RetrievalReport {
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  ndcg: number;
}

export interface GenerationReport {
  exactMatch: number;
  avgLength: number;
  emptyRate: number;
}

export interface MLMetricsReport {
  classification?: ClassificationReport;
  regression?: RegressionReport;
  retrieval?: RetrievalReport;
  generation?: GenerationReport;
}

export class MLMetrics {
  /**
   * Compute binary classification metrics.
   * Labels: 1 = positive, 0 = negative.
   */
  static classification(actual: number[], predicted: number[]): ClassificationReport {
    if (actual.length !== predicted.length || actual.length === 0) {
      return { accuracy: 0, precision: 0, recall: 0, f1: 0, confusionMatrix: { tp: 0, fp: 0, tn: 0, fn: 0 } };
    }

    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;

    for (let i = 0; i < actual.length; i++) {
      const a = actual[i];
      const p = predicted[i];
      if (a === 1 && p === 1) tp++;
      else if (a === 0 && p === 1) fp++;
      else if (a === 0 && p === 0) tn++;
      else if (a === 1 && p === 0) fn++;
    }

    const accuracy = (tp + tn) / actual.length;
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      accuracy: round(accuracy),
      precision: round(precision),
      recall: round(recall),
      f1: round(f1),
      confusionMatrix: { tp, fp, tn, fn },
    };
  }

  /**
   * Compute regression metrics.
   */
  static regression(actual: number[], predicted: number[]): RegressionReport {
    if (actual.length !== predicted.length || actual.length === 0) {
      return { mse: 0, rmse: 0, mae: 0, r2: 0, mape: 0 };
    }

    const n = actual.length;
    let sumSquaredError = 0;
    let sumAbsError = 0;
    let sumPercentError = 0;
    let percentCount = 0;

    for (let i = 0; i < n; i++) {
      const error = actual[i] - predicted[i];
      sumSquaredError += error * error;
      sumAbsError += Math.abs(error);
      if (actual[i] !== 0) {
        sumPercentError += Math.abs(error / actual[i]);
        percentCount++;
      }
    }

    const mse = sumSquaredError / n;
    const rmse = Math.sqrt(mse);
    const mae = sumAbsError / n;

    // R-squared
    const meanActual = actual.reduce((a, b) => a + b, 0) / n;
    const ssTot = actual.reduce((sum, v) => sum + (v - meanActual) ** 2, 0);
    const r2 = ssTot > 0 ? 1 - sumSquaredError / ssTot : 0;

    const mape = percentCount > 0 ? (sumPercentError / percentCount) * 100 : 0;

    return {
      mse: round(mse),
      rmse: round(rmse),
      mae: round(mae),
      r2: round(r2),
      mape: round(mape),
    };
  }

  /**
   * Compute retrieval metrics.
   * relevantIds: ground truth relevant document IDs.
   * retrievedIds: ordered list of retrieved document IDs (ranked).
   * k: cutoff for precision@k and recall@k.
   */
  static retrieval(relevantIds: string[], retrievedIds: string[], k: number): RetrievalReport {
    if (relevantIds.length === 0 || retrievedIds.length === 0) {
      return { precisionAtK: 0, recallAtK: 0, mrr: 0, ndcg: 0 };
    }

    const relevantSet = new Set(relevantIds);
    const topK = retrievedIds.slice(0, k);

    // Precision@K
    const relevantInTopK = topK.filter((id) => relevantSet.has(id)).length;
    const precisionAtK = relevantInTopK / k;

    // Recall@K
    const recallAtK = relevantInTopK / relevantIds.length;

    // MRR (Mean Reciprocal Rank) -- reciprocal rank of first relevant result
    let mrr = 0;
    for (let i = 0; i < retrievedIds.length; i++) {
      if (relevantSet.has(retrievedIds[i])) {
        mrr = 1 / (i + 1);
        break;
      }
    }

    // NDCG (Normalised Discounted Cumulative Gain)
    const dcg = computeDCG(retrievedIds, relevantSet, k);
    const idealOrder = retrievedIds
      .slice(0, k)
      .sort((a, b) => {
        const aRel = relevantSet.has(a) ? 1 : 0;
        const bRel = relevantSet.has(b) ? 1 : 0;
        return bRel - aRel;
      });
    const idcg = computeDCG(idealOrder, relevantSet, k);
    const ndcg = idcg > 0 ? dcg / idcg : 0;

    return {
      precisionAtK: round(precisionAtK),
      recallAtK: round(recallAtK),
      mrr: round(mrr),
      ndcg: round(ndcg),
    };
  }

  /**
   * Compute generation quality metrics.
   * expected: ground truth strings.
   * generated: model output strings.
   */
  static generation(expected: string[], generated: string[]): GenerationReport {
    if (expected.length !== generated.length || expected.length === 0) {
      return { exactMatch: 0, avgLength: 0, emptyRate: 0 };
    }

    const n = expected.length;
    let exactMatchCount = 0;
    let totalLength = 0;
    let emptyCount = 0;

    for (let i = 0; i < n; i++) {
      if (expected[i] === generated[i]) exactMatchCount++;
      totalLength += generated[i].length;
      if (generated[i].trim() === "") emptyCount++;
    }

    return {
      exactMatch: round(exactMatchCount / n),
      avgLength: round(totalLength / n),
      emptyRate: round(emptyCount / n),
    };
  }

  /**
   * Compute a single composite ML score from available reports.
   * Returns a value between 0 and 1.
   */
  static compositeScore(report: MLMetricsReport): number {
    const scores: number[] = [];

    if (report.classification) {
      scores.push(report.classification.f1);
    }
    if (report.regression) {
      scores.push(Math.max(0, report.regression.r2));
    }
    if (report.retrieval) {
      scores.push(report.retrieval.ndcg);
    }
    if (report.generation) {
      scores.push(report.generation.exactMatch);
    }

    if (scores.length === 0) return 0;
    return round(scores.reduce((a, b) => a + b, 0) / scores.length);
  }
}

function computeDCG(ids: string[], relevantSet: Set<string>, k: number): number {
  let dcg = 0;
  const limit = Math.min(ids.length, k);
  for (let i = 0; i < limit; i++) {
    const rel = relevantSet.has(ids[i]) ? 1 : 0;
    dcg += rel / Math.log2(i + 2); // i+2 because log2(1)=0
  }
  return dcg;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
