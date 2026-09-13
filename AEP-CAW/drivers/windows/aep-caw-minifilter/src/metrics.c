// metrics.c - Driver metrics collection
#include "driver.h"
#include "metrics.h"

// Metrics
static struct {
    volatile LONG CacheHitCount;
    volatile LONG CacheMissCount;
    volatile LONG CacheEvictionCount;
    volatile LONG FilePolicyQueries;
    volatile LONG RegistryPolicyQueries;
    volatile LONG PolicyQueryTimeouts;
    volatile LONG PolicyQueryFailures;
    volatile LONG AllowDecisions;
    volatile LONG DenyDecisions;
    volatile LONG ActiveSessions;
    volatile LONG TrackedProcesses;
    volatile LONG CacheEntryCount;
    volatile BOOLEAN FailOpenMode;
    volatile LONG ConsecutiveFailures;
} gMetrics;

VOID AepCawInitializeMetrics(VOID)
{
    RtlZeroMemory(&gMetrics, sizeof(gMetrics));
}

VOID AepCawMetricsIncrementCacheHit(VOID)
{
    InterlockedIncrement(&gMetrics.CacheHitCount);
}

VOID AepCawMetricsIncrementCacheMiss(VOID)
{
    InterlockedIncrement(&gMetrics.CacheMissCount);
}

VOID AepCawMetricsIncrementCacheEviction(VOID)
{
    InterlockedIncrement(&gMetrics.CacheEvictionCount);
}

VOID AepCawMetricsIncrementFilePolicyQuery(VOID)
{
    InterlockedIncrement(&gMetrics.FilePolicyQueries);
}

VOID AepCawMetricsIncrementRegistryPolicyQuery(VOID)
{
    InterlockedIncrement(&gMetrics.RegistryPolicyQueries);
}

VOID AepCawMetricsIncrementPolicyTimeout(VOID)
{
    InterlockedIncrement(&gMetrics.PolicyQueryTimeouts);
}

VOID AepCawMetricsIncrementPolicyFailure(VOID)
{
    InterlockedIncrement(&gMetrics.PolicyQueryFailures);
}

VOID AepCawMetricsIncrementAllowDecision(VOID)
{
    InterlockedIncrement(&gMetrics.AllowDecisions);
}

VOID AepCawMetricsIncrementDenyDecision(VOID)
{
    InterlockedIncrement(&gMetrics.DenyDecisions);
}

VOID AepCawMetricsSetActiveSessionCount(ULONG count)
{
    InterlockedExchange(&gMetrics.ActiveSessions, count);
}

VOID AepCawMetricsSetTrackedProcessCount(ULONG count)
{
    InterlockedExchange(&gMetrics.TrackedProcesses, count);
}

VOID AepCawMetricsSetCacheEntryCount(ULONG count)
{
    InterlockedExchange(&gMetrics.CacheEntryCount, count);
}

VOID AepCawMetricsSetFailOpenMode(BOOLEAN enabled)
{
    // Direct assignment is safe for BOOLEAN on x86/x64 - single byte write is atomic.
    // InterlockedExchange8 would add unnecessary overhead for this status flag.
    gMetrics.FailOpenMode = enabled;
}

VOID AepCawMetricsSetConsecutiveFailures(ULONG count)
{
    InterlockedExchange(&gMetrics.ConsecutiveFailures, count);
}

VOID AepCawMetricsGet(_Out_ PAEP_CAW_METRICS metrics)
{
    metrics->CacheHitCount = gMetrics.CacheHitCount;
    metrics->CacheMissCount = gMetrics.CacheMissCount;
    metrics->CacheEntryCount = gMetrics.CacheEntryCount;
    metrics->CacheEvictionCount = gMetrics.CacheEvictionCount;
    metrics->FilePolicyQueries = gMetrics.FilePolicyQueries;
    metrics->RegistryPolicyQueries = gMetrics.RegistryPolicyQueries;
    metrics->PolicyQueryTimeouts = gMetrics.PolicyQueryTimeouts;
    metrics->PolicyQueryFailures = gMetrics.PolicyQueryFailures;
    metrics->AllowDecisions = gMetrics.AllowDecisions;
    metrics->DenyDecisions = gMetrics.DenyDecisions;
    metrics->ActiveSessions = gMetrics.ActiveSessions;
    metrics->TrackedProcesses = gMetrics.TrackedProcesses;
    metrics->FailOpenMode = gMetrics.FailOpenMode;
    metrics->ConsecutiveFailures = gMetrics.ConsecutiveFailures;
}

VOID AepCawMetricsReset(VOID)
{
    InterlockedExchange(&gMetrics.CacheHitCount, 0);
    InterlockedExchange(&gMetrics.CacheMissCount, 0);
    InterlockedExchange(&gMetrics.CacheEvictionCount, 0);
    InterlockedExchange(&gMetrics.FilePolicyQueries, 0);
    InterlockedExchange(&gMetrics.RegistryPolicyQueries, 0);
    InterlockedExchange(&gMetrics.PolicyQueryTimeouts, 0);
    InterlockedExchange(&gMetrics.PolicyQueryFailures, 0);
    InterlockedExchange(&gMetrics.AllowDecisions, 0);
    InterlockedExchange(&gMetrics.DenyDecisions, 0);
}
