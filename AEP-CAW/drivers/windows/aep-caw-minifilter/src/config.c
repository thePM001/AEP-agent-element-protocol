// config.c - Driver configuration
#include "driver.h"
#include "config.h"

// Configuration (protected by lock)
static EX_PUSH_LOCK gConfigLock;
static AEP_CAW_CONFIG gConfig;

VOID AepCawInitializeConfig(VOID)
{
    ExInitializePushLock(&gConfigLock);

    RtlZeroMemory(&gConfig, sizeof(gConfig));
    gConfig.FailMode = DEFAULT_FAIL_MODE;
    gConfig.PolicyQueryTimeoutMs = DEFAULT_POLICY_TIMEOUT_MS;
    gConfig.MaxConsecutiveFailures = DEFAULT_MAX_CONSECUTIVE_FAIL;
    gConfig.CacheMaxEntries = DEFAULT_CACHE_MAX_ENTRIES;
    gConfig.CacheDefaultTTLMs = DEFAULT_CACHE_TTL_MS;

    DbgPrint("AepCaw: Configuration initialized (FailMode=%d, Timeout=%lu)\n",
             gConfig.FailMode, gConfig.PolicyQueryTimeoutMs);
}

VOID AepCawGetConfig(_Out_ PAEP_CAW_CONFIG config)
{
    ExAcquirePushLockShared(&gConfigLock);
    RtlCopyMemory(config, &gConfig, sizeof(AEP_CAW_CONFIG));
    ExReleasePushLockShared(&gConfigLock);
}

NTSTATUS AepCawSetConfig(_In_ PAEP_CAW_CONFIG config)
{
    // Validate FailMode enum
    if (config->FailMode != FAIL_MODE_OPEN && config->FailMode != FAIL_MODE_CLOSED) {
        return STATUS_INVALID_PARAMETER;
    }

    // Validate configuration values
    if (config->PolicyQueryTimeoutMs < 100 || config->PolicyQueryTimeoutMs > 60000) {
        return STATUS_INVALID_PARAMETER;
    }
    if (config->MaxConsecutiveFailures < 1 || config->MaxConsecutiveFailures > 1000) {
        return STATUS_INVALID_PARAMETER;
    }
    if (config->CacheMaxEntries < 100 || config->CacheMaxEntries > 100000) {
        return STATUS_INVALID_PARAMETER;
    }
    if (config->CacheDefaultTTLMs < 100 || config->CacheDefaultTTLMs > 3600000) {
        return STATUS_INVALID_PARAMETER;
    }

    ExAcquirePushLockExclusive(&gConfigLock);

    gConfig.FailMode = config->FailMode;
    gConfig.PolicyQueryTimeoutMs = config->PolicyQueryTimeoutMs;
    gConfig.MaxConsecutiveFailures = config->MaxConsecutiveFailures;
    gConfig.CacheMaxEntries = config->CacheMaxEntries;
    gConfig.CacheDefaultTTLMs = config->CacheDefaultTTLMs;

    ExReleasePushLockExclusive(&gConfigLock);

    DbgPrint("AepCaw: Configuration updated (FailMode=%d, Timeout=%lu, MaxFail=%lu)\n",
             config->FailMode, config->PolicyQueryTimeoutMs, config->MaxConsecutiveFailures);

    return STATUS_SUCCESS;
}

AEP_CAW_FAIL_MODE AepCawGetFailMode(VOID)
{
    AEP_CAW_FAIL_MODE mode;
    ExAcquirePushLockShared(&gConfigLock);
    mode = gConfig.FailMode;
    ExReleasePushLockShared(&gConfigLock);
    return mode;
}

ULONG AepCawGetPolicyTimeoutMs(VOID)
{
    ULONG timeout;
    ExAcquirePushLockShared(&gConfigLock);
    timeout = gConfig.PolicyQueryTimeoutMs;
    ExReleasePushLockShared(&gConfigLock);
    return timeout;
}

ULONG AepCawGetMaxConsecutiveFailures(VOID)
{
    ULONG maxFail;
    ExAcquirePushLockShared(&gConfigLock);
    maxFail = gConfig.MaxConsecutiveFailures;
    ExReleasePushLockShared(&gConfigLock);
    return maxFail;
}

ULONG AepCawGetCacheMaxEntries(VOID)
{
    ULONG maxEntries;
    ExAcquirePushLockShared(&gConfigLock);
    maxEntries = gConfig.CacheMaxEntries;
    ExReleasePushLockShared(&gConfigLock);
    return maxEntries;
}

ULONG AepCawGetCacheDefaultTTLMs(VOID)
{
    ULONG ttl;
    ExAcquirePushLockShared(&gConfigLock);
    ttl = gConfig.CacheDefaultTTLMs;
    ExReleasePushLockShared(&gConfigLock);
    return ttl;
}
