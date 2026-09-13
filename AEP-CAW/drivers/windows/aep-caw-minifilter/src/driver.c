// driver.c - Main driver entry point
#include "driver.h"

// Global data
AEP_CAW_GLOBAL_DATA AepCawData = {0};

// Filter callbacks
CONST FLT_OPERATION_REGISTRATION FilterCallbacks[] = {
    { IRP_MJ_CREATE, 0, AepCawPreCreate, NULL },
    { IRP_MJ_WRITE, 0, AepCawPreWrite, NULL },
    { IRP_MJ_SET_INFORMATION, 0, AepCawPreSetInfo, NULL },
    { IRP_MJ_OPERATION_END }
};

// Filter registration
CONST FLT_REGISTRATION FilterRegistration = {
    sizeof(FLT_REGISTRATION),           // Size
    FLT_REGISTRATION_VERSION,           // Version
    0,                                  // Flags
    NULL,                               // Context registration
    FilterCallbacks,                    // Operation callbacks
    AepCawFilterUnload,                // FilterUnload
    AepCawInstanceSetup,               // InstanceSetup
    AepCawInstanceQueryTeardown,       // InstanceQueryTeardown
    NULL,                               // InstanceTeardownStart
    NULL,                               // InstanceTeardownComplete
    NULL,                               // GenerateFileName
    NULL,                               // NormalizeNameComponent
    NULL                                // NormalizeContextCleanup
};

// Instance setup - attach to all NTFS volumes
NTSTATUS
AepCawInstanceSetup(
    _In_ PCFLT_RELATED_OBJECTS FltObjects,
    _In_ FLT_INSTANCE_SETUP_FLAGS Flags,
    _In_ DEVICE_TYPE VolumeDeviceType,
    _In_ FLT_FILESYSTEM_TYPE VolumeFilesystemType
    )
{
    UNREFERENCED_PARAMETER(FltObjects);
    UNREFERENCED_PARAMETER(Flags);
    UNREFERENCED_PARAMETER(VolumeDeviceType);

    // Only attach to NTFS
    if (VolumeFilesystemType != FLT_FSTYPE_NTFS) {
        return STATUS_FLT_DO_NOT_ATTACH;
    }

    return STATUS_SUCCESS;
}

// Instance query teardown - allow detach
NTSTATUS
AepCawInstanceQueryTeardown(
    _In_ PCFLT_RELATED_OBJECTS FltObjects,
    _In_ FLT_INSTANCE_QUERY_TEARDOWN_FLAGS Flags
    )
{
    UNREFERENCED_PARAMETER(FltObjects);
    UNREFERENCED_PARAMETER(Flags);

    return STATUS_SUCCESS;
}

// Filter unload
NTSTATUS
AepCawFilterUnload(
    _In_ FLT_FILTER_UNLOAD_FLAGS Flags
    )
{
    UNREFERENCED_PARAMETER(Flags);

    // Shutdown registry filter
    AepCawShutdownRegistryFilter();

    // Shutdown policy cache
    AepCawShutdownCache();

    // Shutdown process tracking
    AepCawShutdownProcessTracking();

    // Shutdown communication
    AepCawShutdownCommunication();

    // Unregister filter
    if (AepCawData.FilterHandle != NULL) {
        FltUnregisterFilter(AepCawData.FilterHandle);
        AepCawData.FilterHandle = NULL;
    }

    return STATUS_SUCCESS;
}

// Driver entry point
NTSTATUS
DriverEntry(
    _In_ PDRIVER_OBJECT DriverObject,
    _In_ PUNICODE_STRING RegistryPath
    )
{
    NTSTATUS status;

    UNREFERENCED_PARAMETER(RegistryPath);

    // Initialize global data
    RtlZeroMemory(&AepCawData, sizeof(AepCawData));

    // Initialize configuration
    AepCawInitializeConfig();

    // Initialize metrics
    AepCawInitializeMetrics();

    // Register with filter manager
    status = FltRegisterFilter(
        DriverObject,
        &FilterRegistration,
        &AepCawData.FilterHandle
        );

    if (!NT_SUCCESS(status)) {
        return status;
    }

    // Initialize communication port
    status = AepCawInitializeCommunication(AepCawData.FilterHandle);
    if (!NT_SUCCESS(status)) {
        FltUnregisterFilter(AepCawData.FilterHandle);
        return status;
    }

    // Initialize process tracking
    status = AepCawInitializeProcessTracking();
    if (!NT_SUCCESS(status)) {
        AepCawShutdownCommunication();
        FltUnregisterFilter(AepCawData.FilterHandle);
        return status;
    }

    // Initialize policy cache
    status = AepCawInitializeCache();
    if (!NT_SUCCESS(status)) {
        AepCawShutdownProcessTracking();
        AepCawShutdownCommunication();
        FltUnregisterFilter(AepCawData.FilterHandle);
        return status;
    }

    // Initialize registry filter
    status = AepCawInitializeRegistryFilter(DriverObject);
    if (!NT_SUCCESS(status)) {
        AepCawShutdownCache();
        AepCawShutdownProcessTracking();
        AepCawShutdownCommunication();
        FltUnregisterFilter(AepCawData.FilterHandle);
        return status;
    }

    // Start filtering
    status = FltStartFiltering(AepCawData.FilterHandle);
    if (!NT_SUCCESS(status)) {
        AepCawShutdownRegistryFilter();
        AepCawShutdownCache();
        AepCawShutdownProcessTracking();
        AepCawShutdownCommunication();
        FltUnregisterFilter(AepCawData.FilterHandle);
        return status;
    }

    return STATUS_SUCCESS;
}
