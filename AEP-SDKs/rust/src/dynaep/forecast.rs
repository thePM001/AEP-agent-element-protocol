//! Coordinate anomaly check from a rolling mean/variance cache.
//! @PAD: aep-sdk-dynaep-forecast
//! @GCDE: gaplune.code.v1

use std::collections::HashMap;

pub struct ForecastCache {
    sums: HashMap<String, (f64, f64, u64)>,
    threshold: f64,
}

impl ForecastCache {
    pub fn new(threshold: f64) -> Self { Self { sums: HashMap::new(), threshold } }
    pub fn ingest(&mut self, id: &str, x: f64) {
        let e = self.sums.entry(id.to_string()).or_insert((0.0, 0.0, 0));
        e.0 += x;
        e.1 += x * x;
        e.2 += 1;
    }
    pub fn is_anomaly(&self, id: &str, x: f64) -> bool {
        let Some((sum, sq, n)) = self.sums.get(id) else { return false; };
        if *n < 8 { return false; }
        let mean = *sum / *n as f64;
        let var = (*sq / *n as f64) - mean * mean;
        let std = var.max(0.0).sqrt();
        if std < 1e-9 { return false; }
        ((x - mean) / std).abs() > self.threshold
    }
}
