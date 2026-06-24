// config.h - Driver configuration
#ifndef _AEP_CAW_CONFIG_H_
#define _AEP_CAW_CONFIG_H_

#include <fltKernel.h>
#include "protocol.h"

// Default configuration values
#define DEFAULT_FAIL_MODE               FAIL_MODE_OPEN
#define DEFAULT_POLICY_TIMEOUT_MS       5000
#define DEFAULT_MAX_CONSECUTIVE_FAIL    10
#define DEFAULT_CACHE_MAX_ENTRIES       4096
#define DEFAULT_CACHE_TTL_MS            5000

// Initialize configuration with defaults
VOID AgentshInitializeConfig(VOID);

// Get current configuration
VOID AgentshGetConfig(_Out_ PAEP_CAW_CONFIG config);

// Apply new configuration
NTSTATUS AgentshSetConfig(_In_ PAEP_CAW_CONFIG config);

// Query configuration values
AEP_CAW_FAIL_MODE AgentshGetFailMode(VOID);
ULONG AgentshGetPolicyTimeoutMs(VOID);
ULONG AgentshGetMaxConsecutiveFailures(VOID);
ULONG AgentshGetCacheMaxEntries(VOID);
ULONG AgentshGetCacheDefaultTTLMs(VOID);

#endif // _AEP_CAW_CONFIG_H_
