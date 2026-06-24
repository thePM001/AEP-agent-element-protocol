// driver.h - Main driver definitions
#ifndef _AEP_CAW_DRIVER_H_
#define _AEP_CAW_DRIVER_H_

#include <fltKernel.h>
#include <dontuse.h>
#include <suppress.h>
#include "protocol.h"
#include "process.h"
#include "cache.h"
#include "filesystem.h"
#include "registry.h"
#include "config.h"
#include "metrics.h"

// Driver version
#define AEP_CAW_DRIVER_VERSION 0x00010000  // 1.0.0.0

// Pool tags
#define AEP_CAW_TAG_GENERAL 'hsGA'
#define AEP_CAW_TAG_MESSAGE 'smGA'

// Global driver data
typedef struct _AEP_CAW_GLOBAL_DATA {
    PFLT_FILTER FilterHandle;
    PFLT_PORT ServerPort;
    PFLT_PORT ClientPort;
    BOOLEAN ClientConnected;
    ULONG ClientPid;
    LONG MessageId;
} AEP_CAW_GLOBAL_DATA, *PAEP_CAW_GLOBAL_DATA;

extern AEP_CAW_GLOBAL_DATA AgentshData;

// Communication functions (communication.c)
NTSTATUS
AgentshInitializeCommunication(
    _In_ PFLT_FILTER Filter
    );

VOID
AgentshShutdownCommunication(
    VOID
    );

NTSTATUS
AgentshSendPing(
    VOID
    );

NTSTATUS
AgentshInstanceSetup(
    _In_ PCFLT_RELATED_OBJECTS FltObjects,
    _In_ FLT_INSTANCE_SETUP_FLAGS Flags,
    _In_ DEVICE_TYPE VolumeDeviceType,
    _In_ FLT_FILESYSTEM_TYPE VolumeFilesystemType
    );

NTSTATUS
AgentshInstanceQueryTeardown(
    _In_ PCFLT_RELATED_OBJECTS FltObjects,
    _In_ FLT_INSTANCE_QUERY_TEARDOWN_FLAGS Flags
    );

NTSTATUS
AgentshFilterUnload(
    _In_ FLT_FILTER_UNLOAD_FLAGS Flags
    );

#endif // _AEP_CAW_DRIVER_H_
