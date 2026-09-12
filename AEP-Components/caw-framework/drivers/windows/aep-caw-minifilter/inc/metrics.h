// metrics.h - Driver metrics collection
#ifndef _AEP_CAW_METRICS_H_
#define _AEP_CAW_METRICS_H_

#include <fltKernel.h>
#include "protocol.h"

// Initialize metrics
VOID AepCawInitializeMetrics(VOID);

// Increment counters (thread-safe)
VOID AepCawMetricsIncrementCacheHit(VOID);
VOID AepCawMetricsIncrementCacheMiss(VOID);
VOID AepCawMetricsIncrementCacheEviction(VOID);
VOID AepCawMetricsIncrementFilePolicyQuery(VOID);
VOID AepCawMetricsIncrementRegistryPolicyQuery(VOID);
VOID AepCawMetricsIncrementPolicyTimeout(VOID);
VOID AepCawMetricsIncrementPolicyFailure(VOID);
VOID AepCawMetricsIncrementAllowDecision(VOID);
VOID AepCawMetricsIncrementDenyDecision(VOID);

// Set/get values (thread-safe)
VOID AepCawMetricsSetActiveSessionCount(_In_ ULONG count);
VOID AepCawMetricsSetTrackedProcessCount(_In_ ULONG count);
VOID AepCawMetricsSetCacheEntryCount(_In_ ULONG count);
VOID AepCawMetricsSetFailOpenMode(_In_ BOOLEAN enabled);
VOID AepCawMetricsSetConsecutiveFailures(_In_ ULONG count);

// Get metrics snapshot
VOID AepCawMetricsGet(_Out_ PAEP_CAW_METRICS metrics);

// Reset counters
VOID AepCawMetricsReset(VOID);

#endif // _AEP_CAW_METRICS_H_
