// communication.c - Filter port communication
#include "driver.h"

// Forward declarations
NTSTATUS
AgentshConnectNotify(
    _In_ PFLT_PORT ClientPort,
    _In_opt_ PVOID ServerPortCookie,
    _In_reads_bytes_opt_(SizeOfContext) PVOID ConnectionContext,
    _In_ ULONG SizeOfContext,
    _Outptr_result_maybenull_ PVOID *ConnectionPortCookie
    );

VOID
AgentshDisconnectNotify(
    _In_opt_ PVOID ConnectionCookie
    );

NTSTATUS
AgentshMessageNotify(
    _In_opt_ PVOID PortCookie,
    _In_reads_bytes_opt_(InputBufferLength) PVOID InputBuffer,
    _In_ ULONG InputBufferLength,
    _Out_writes_bytes_to_opt_(OutputBufferLength, *ReturnOutputBufferLength) PVOID OutputBuffer,
    _In_ ULONG OutputBufferLength,
    _Out_ PULONG ReturnOutputBufferLength
    );

// Initialize communication port
NTSTATUS
AgentshInitializeCommunication(
    _In_ PFLT_FILTER Filter
    )
{
    NTSTATUS status;
    UNICODE_STRING portName;
    PSECURITY_DESCRIPTOR sd = NULL;
    OBJECT_ATTRIBUTES oa;

    // Create security descriptor allowing all access
    status = FltBuildDefaultSecurityDescriptor(&sd, FLT_PORT_ALL_ACCESS);
    if (!NT_SUCCESS(status)) {
        return status;
    }

    RtlInitUnicodeString(&portName, AEP_CAW_PORT_NAME);

    InitializeObjectAttributes(
        &oa,
        &portName,
        OBJ_KERNEL_HANDLE | OBJ_CASE_INSENSITIVE,
        NULL,
        sd
        );

    // Create communication port
    status = FltCreateCommunicationPort(
        Filter,
        &AgentshData.ServerPort,
        &oa,
        NULL,                       // ServerPortCookie
        AgentshConnectNotify,
        AgentshDisconnectNotify,
        AgentshMessageNotify,
        1                           // MaxConnections
        );

    FltFreeSecurityDescriptor(sd);

    return status;
}

// Shutdown communication
VOID
AgentshShutdownCommunication(
    VOID
    )
{
    if (AgentshData.ServerPort != NULL) {
        FltCloseCommunicationPort(AgentshData.ServerPort);
        AgentshData.ServerPort = NULL;
    }
}

// Client connect notification
NTSTATUS
AgentshConnectNotify(
    _In_ PFLT_PORT ClientPort,
    _In_opt_ PVOID ServerPortCookie,
    _In_reads_bytes_opt_(SizeOfContext) PVOID ConnectionContext,
    _In_ ULONG SizeOfContext,
    _Outptr_result_maybenull_ PVOID *ConnectionPortCookie
    )
{
    PAEP_CAW_CONNECTION_CONTEXT ctx;

    UNREFERENCED_PARAMETER(ServerPortCookie);

    // Validate connection context
    if (ConnectionContext == NULL ||
        SizeOfContext < sizeof(AEP_CAW_CONNECTION_CONTEXT)) {
        return STATUS_INVALID_PARAMETER;
    }

    ctx = (PAEP_CAW_CONNECTION_CONTEXT)ConnectionContext;

    // Store client info
    AgentshData.ClientPort = ClientPort;
    AgentshData.ClientPid = ctx->ClientPid;
    AgentshData.ClientConnected = TRUE;

    *ConnectionPortCookie = NULL;

    DbgPrint("AepCaw: Client connected (PID: %u, Version: 0x%08X)\n",
             ctx->ClientPid, ctx->ClientVersion);

    return STATUS_SUCCESS;
}

// Client disconnect notification
VOID
AgentshDisconnectNotify(
    _In_opt_ PVOID ConnectionCookie
    )
{
    UNREFERENCED_PARAMETER(ConnectionCookie);

    DbgPrint("AepCaw: Client disconnected\n");

    // Clear client state
    FltCloseClientPort(AgentshData.FilterHandle, &AgentshData.ClientPort);
    AgentshData.ClientPort = NULL;
    AgentshData.ClientPid = 0;
    AgentshData.ClientConnected = FALSE;
}

// Message notification from user-mode
NTSTATUS
AgentshMessageNotify(
    _In_opt_ PVOID PortCookie,
    _In_reads_bytes_opt_(InputBufferLength) PVOID InputBuffer,
    _In_ ULONG InputBufferLength,
    _Out_writes_bytes_to_opt_(OutputBufferLength, *ReturnOutputBufferLength) PVOID OutputBuffer,
    _In_ ULONG OutputBufferLength,
    _Out_ PULONG ReturnOutputBufferLength
    )
{
    NTSTATUS status = STATUS_SUCCESS;
    PAEP_CAW_MESSAGE_HEADER header;

    UNREFERENCED_PARAMETER(PortCookie);

    *ReturnOutputBufferLength = 0;

    if (InputBuffer == NULL || InputBufferLength < sizeof(AEP_CAW_MESSAGE_HEADER)) {
        return STATUS_INVALID_PARAMETER;
    }

    header = (PAEP_CAW_MESSAGE_HEADER)InputBuffer;

    switch (header->Type) {
        case MSG_PONG:
            DbgPrint("AepCaw: Received PONG from client\n");
            break;

        case MSG_REGISTER_SESSION:
            if (InputBufferLength >= sizeof(AEP_CAW_SESSION_REGISTER)) {
                PAEP_CAW_SESSION_REGISTER reg = (PAEP_CAW_SESSION_REGISTER)InputBuffer;
                status = AgentshRegisterSession(
                    reg->SessionToken,
                    ULongToHandle(reg->RootProcessId),
                    reg->WorkspacePath[0] != L'\0' ? reg->WorkspacePath : NULL
                    );
                if (!NT_SUCCESS(status)) {
                    DbgPrint("AepCaw: Session registration failed: 0x%08X\n", status);
                }
            } else {
                status = STATUS_BUFFER_TOO_SMALL;
            }
            break;

        case MSG_UNREGISTER_SESSION:
            if (InputBufferLength >= sizeof(AEP_CAW_SESSION_UNREGISTER)) {
                PAEP_CAW_SESSION_UNREGISTER unreg = (PAEP_CAW_SESSION_UNREGISTER)InputBuffer;
                status = AgentshUnregisterSession(unreg->SessionToken);
                if (!NT_SUCCESS(status)) {
                    DbgPrint("AepCaw: Session unregistration failed: 0x%08X\n", status);
                }
            } else {
                status = STATUS_BUFFER_TOO_SMALL;
            }
            break;

        case MSG_SET_CONFIG:
            if (InputBufferLength >= sizeof(AEP_CAW_CONFIG)) {
                PAEP_CAW_CONFIG config = (PAEP_CAW_CONFIG)InputBuffer;
                status = AgentshSetConfig(config);
                if (!NT_SUCCESS(status)) {
                    DbgPrint("AepCaw: Config update failed: 0x%08X\n", status);
                }
            } else {
                status = STATUS_BUFFER_TOO_SMALL;
            }
            break;

        case MSG_GET_METRICS:
            if (OutputBufferLength >= sizeof(AEP_CAW_METRICS)) {
                PAEP_CAW_METRICS metrics = (PAEP_CAW_METRICS)OutputBuffer;
                RtlZeroMemory(metrics, sizeof(AEP_CAW_METRICS));
                metrics->Header.Type = MSG_METRICS_REPLY;
                metrics->Header.Size = sizeof(AEP_CAW_METRICS);
                AgentshMetricsGet(metrics);
                *ReturnOutputBufferLength = sizeof(AEP_CAW_METRICS);
            } else {
                status = STATUS_BUFFER_TOO_SMALL;
            }
            break;

        case MSG_EXCLUDE_PROCESS:
            {
                PAEP_CAW_EXCLUDE_PROCESS excludeMsg = (PAEP_CAW_EXCLUDE_PROCESS)InputBuffer;
                if (InputBufferLength >= sizeof(AEP_CAW_EXCLUDE_PROCESS)) {
                    AgentshSetExcludedProcess(excludeMsg->ProcessId);
                    DbgPrint("AepCaw: Set excluded process: %u\n", excludeMsg->ProcessId);
                    status = STATUS_SUCCESS;
                } else {
                    status = STATUS_BUFFER_TOO_SMALL;
                }
            }
            break;

        default:
            DbgPrint("AepCaw: Unknown message type: %d\n", header->Type);
            break;
    }

    return status;
}

// Send ping to user-mode client
NTSTATUS
AgentshSendPing(
    VOID
    )
{
    NTSTATUS status;
    AEP_CAW_PING ping = {0};
    AEP_CAW_PONG pong = {0};
    ULONG replyLength = sizeof(pong);
    LARGE_INTEGER timeout;

    if (!AgentshData.ClientConnected || AgentshData.ClientPort == NULL) {
        return STATUS_PORT_DISCONNECTED;
    }

    // Build ping message
    ping.Header.Type = MSG_PING;
    ping.Header.Size = sizeof(ping);
    ping.Header.RequestId = InterlockedIncrement(&AgentshData.MessageId);
    ping.DriverVersion = AEP_CAW_DRIVER_VERSION;
    KeQuerySystemTimePrecise((PLARGE_INTEGER)&ping.Timestamp);

    // 5 second timeout
    timeout.QuadPart = -50000000LL;  // 100ns units, negative = relative

    status = FltSendMessage(
        AgentshData.FilterHandle,
        &AgentshData.ClientPort,
        &ping,
        sizeof(ping),
        &pong,
        &replyLength,
        &timeout
        );

    if (NT_SUCCESS(status)) {
        DbgPrint("AepCaw: Ping successful, client version: 0x%08X\n",
                 pong.ClientVersion);
    }

    return status;
}
