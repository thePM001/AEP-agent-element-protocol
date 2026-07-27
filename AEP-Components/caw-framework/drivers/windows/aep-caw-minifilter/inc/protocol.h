// protocol.h - Communication protocol between driver and user-mode
#ifndef _AEP_CAW_PROTOCOL_H_
#define _AEP_CAW_PROTOCOL_H_

#define AEP_CAW_PORT_NAME L"\\AgentshPort"
#define AEP_CAW_MAX_PATH 520

// Message types
typedef enum _AEP_CAW_MSG_TYPE {
    // Driver -> User-mode (requests)
    MSG_PING = 0,
    MSG_POLICY_CHECK_FILE = 1,
    MSG_POLICY_CHECK_REGISTRY = 2,
    MSG_PROCESS_CREATED = 3,
    MSG_PROCESS_TERMINATED = 4,

    // User-mode -> Driver (commands)
    MSG_PONG = 50,
    MSG_REGISTER_SESSION = 100,
    MSG_UNREGISTER_SESSION = 101,
    MSG_UPDATE_CACHE = 102,
    MSG_SHUTDOWN = 103,
    MSG_SET_CONFIG = 104,
    MSG_GET_METRICS = 105,
    MSG_METRICS_REPLY = 106,
    MSG_EXCLUDE_PROCESS = 107,
} AEP_CAW_MSG_TYPE;

// Policy decisions
typedef enum _AEP_CAW_DECISION {
    DECISION_ALLOW = 0,
    DECISION_DENY = 1,
    DECISION_PENDING = 2,
} AEP_CAW_DECISION, *PAEP_CAW_DECISION;

// Message header (all messages start with this)
typedef struct _AEP_CAW_MESSAGE_HEADER {
    AEP_CAW_MSG_TYPE Type;
    ULONG Size;
    ULONG64 RequestId;
} AEP_CAW_MESSAGE_HEADER, *PAEP_CAW_MESSAGE_HEADER;

// Ping message (driver -> user-mode)
typedef struct _AEP_CAW_PING {
    AEP_CAW_MESSAGE_HEADER Header;
    ULONG DriverVersion;
    ULONG64 Timestamp;
} AEP_CAW_PING, *PAEP_CAW_PING;

// Pong response (user-mode -> driver)
typedef struct _AEP_CAW_PONG {
    AEP_CAW_MESSAGE_HEADER Header;
    ULONG ClientVersion;
    ULONG64 Timestamp;
} AEP_CAW_PONG, *PAEP_CAW_PONG;

// Connection context passed during FilterConnectCommunicationPort
typedef struct _AEP_CAW_CONNECTION_CONTEXT {
    ULONG ClientVersion;
    ULONG ClientPid;
} AEP_CAW_CONNECTION_CONTEXT, *PAEP_CAW_CONNECTION_CONTEXT;

// Session registration (user-mode -> driver)
typedef struct _AEP_CAW_SESSION_REGISTER {
    AEP_CAW_MESSAGE_HEADER Header;
    ULONG64 SessionToken;           // Unique session identifier
    ULONG RootProcessId;            // Initial session process PID
    WCHAR WorkspacePath[AEP_CAW_MAX_PATH]; // Session workspace root
} AEP_CAW_SESSION_REGISTER, *PAEP_CAW_SESSION_REGISTER;

// Session unregistration (user-mode -> driver)
typedef struct _AEP_CAW_SESSION_UNREGISTER {
    AEP_CAW_MESSAGE_HEADER Header;
    ULONG64 SessionToken;
} AEP_CAW_SESSION_UNREGISTER, *PAEP_CAW_SESSION_UNREGISTER;

// Process event (driver -> user-mode, notification only)
typedef struct _AEP_CAW_PROCESS_EVENT {
    AEP_CAW_MESSAGE_HEADER Header;
    ULONG64 SessionToken;
    ULONG ProcessId;
    ULONG ParentProcessId;
    ULONG64 CreateTime;             // FILETIME
} AEP_CAW_PROCESS_EVENT, *PAEP_CAW_PROCESS_EVENT;

// File operation types
typedef enum _AEP_CAW_FILE_OP {
    FILE_OP_CREATE = 1,
    FILE_OP_READ = 2,
    FILE_OP_WRITE = 3,
    FILE_OP_DELETE = 4,
    FILE_OP_RENAME = 5
} AEP_CAW_FILE_OP;

// File policy check request (driver -> user-mode)
typedef struct _AEP_CAW_FILE_REQUEST {
    AEP_CAW_MESSAGE_HEADER Header;
    ULONG64 SessionToken;
    ULONG ProcessId;
    ULONG ThreadId;
    AEP_CAW_FILE_OP Operation;
    ULONG CreateDisposition;        // For creates: CREATE_NEW, OPEN_EXISTING, etc.
    ULONG DesiredAccess;            // FILE_READ_DATA, FILE_WRITE_DATA, DELETE, etc.
    WCHAR Path[AEP_CAW_MAX_PATH];
    WCHAR RenameDest[AEP_CAW_MAX_PATH]; // Only for FILE_OP_RENAME
} AEP_CAW_FILE_REQUEST, *PAEP_CAW_FILE_REQUEST;

// Policy response (user-mode -> driver)
typedef struct _AEP_CAW_POLICY_RESPONSE {
    AEP_CAW_MESSAGE_HEADER Header;
    AEP_CAW_DECISION Decision;
    ULONG CacheTTLMs;               // How long to cache this decision
} AEP_CAW_POLICY_RESPONSE, *PAEP_CAW_POLICY_RESPONSE;

// Registry operation types
typedef enum _AEP_CAW_REGISTRY_OP {
    REG_OP_CREATE_KEY = 1,
    REG_OP_SET_VALUE = 2,
    REG_OP_DELETE_KEY = 3,
    REG_OP_DELETE_VALUE = 4,
    REG_OP_RENAME_KEY = 5,
    REG_OP_QUERY_VALUE = 6
} AEP_CAW_REGISTRY_OP;

// Registry value types (subset of REG_* constants)
#define AEP_CAW_REG_NONE      0
#define AEP_CAW_REG_SZ        1
#define AEP_CAW_REG_DWORD     4
#define AEP_CAW_REG_BINARY    3
#define AEP_CAW_REG_MULTI_SZ  7
#define AEP_CAW_REG_QWORD     11

// Maximum value name length
#define AEP_CAW_MAX_VALUE_NAME 256

// Registry policy check request (driver -> user-mode)
typedef struct _AEP_CAW_REGISTRY_REQUEST {
    AEP_CAW_MESSAGE_HEADER Header;
    ULONG64 SessionToken;
    ULONG ProcessId;
    ULONG ThreadId;
    AEP_CAW_REGISTRY_OP Operation;
    ULONG ValueType;                // REG_SZ, REG_DWORD, etc.
    ULONG DataSize;                 // Size of value data
    WCHAR KeyPath[AEP_CAW_MAX_PATH];
    WCHAR ValueName[AEP_CAW_MAX_VALUE_NAME];
} AEP_CAW_REGISTRY_REQUEST, *PAEP_CAW_REGISTRY_REQUEST;

// Fail mode configuration
typedef enum _AEP_CAW_FAIL_MODE {
    FAIL_MODE_OPEN = 0,     // Allow operations on failure (default)
    FAIL_MODE_CLOSED = 1,   // Deny operations on failure
} AEP_CAW_FAIL_MODE;

// Driver configuration (user-mode -> driver)
typedef struct _AEP_CAW_CONFIG {
    AEP_CAW_MESSAGE_HEADER Header;
    AEP_CAW_FAIL_MODE FailMode;
    ULONG PolicyQueryTimeoutMs;     // Default: 5000
    ULONG MaxConsecutiveFailures;   // Default: 10
    ULONG CacheMaxEntries;          // Default: 4096
    ULONG CacheDefaultTTLMs;        // Default: 5000
} AEP_CAW_CONFIG, *PAEP_CAW_CONFIG;

// Driver metrics (driver -> user-mode)
typedef struct _AEP_CAW_METRICS {
    AEP_CAW_MESSAGE_HEADER Header;
    // Cache metrics
    ULONG CacheHitCount;
    ULONG CacheMissCount;
    ULONG CacheEntryCount;
    ULONG CacheEvictionCount;
    // Query metrics
    ULONG FilePolicyQueries;
    ULONG RegistryPolicyQueries;
    ULONG PolicyQueryTimeouts;
    ULONG PolicyQueryFailures;
    // Decision metrics
    ULONG AllowDecisions;
    ULONG DenyDecisions;
    // Session metrics
    ULONG ActiveSessions;
    ULONG TrackedProcesses;
    // Status
    BOOLEAN FailOpenMode;
    ULONG ConsecutiveFailures;
} AEP_CAW_METRICS, *PAEP_CAW_METRICS;

// Process exclusion (user-mode -> driver)
typedef struct _AEP_CAW_EXCLUDE_PROCESS {
    AEP_CAW_MESSAGE_HEADER Header;
    ULONG ProcessId;
} AEP_CAW_EXCLUDE_PROCESS, *PAEP_CAW_EXCLUDE_PROCESS;

#endif // _AEP_CAW_PROTOCOL_H_
