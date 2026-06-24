# Fix: Agentsh CLI Self-Deadlock Through Shim

## Problem

When `shim.conf force=true` is set, any `aep-caw` CLI command (`detect`, `debug policy-test`, `--version`, `trash list`) executed through the shell shim deadlocks. The shim routes the command to the server via `aep-caw exec`, the server spawns the CLI, and the CLI connects back to the same server - which is blocked handling the shim's exec request.

This affects operators running diagnostic commands and test infrastructure in shim-enforced environments like exe.dev.

## Solution

Add an aep-caw binary bypass to the shim. Before the force/config logic, check if the command being executed IS the aep-caw binary. If so, exec the real shell directly (same mechanism as the `AEP_CAW_IN_SESSION` recursion guard).

### Detection logic

The shim is invoked as `sh -c "aep-caw detect"`. The detection:

1. Check if args contain `-c` followed by a command string (same pattern as existing `isMCPCommand`)
2. Extract the first word from the command string via `strings.Fields`
3. Resolve it via `exec.LookPath` to get a path
4. Resolve symlinks via `filepath.EvalSymlinks` on both the command path and the aep-caw binary path
5. Compare the resolved paths - if they match, bypass to real shell

```go
if isAgentshCommand(os.Args[1:]) {
    debugLog("aep-caw CLI bypass: command is aep-caw itself, executing real shell %s", realShell)
    execOrExit(realShell, append([]string{argv0}, os.Args[1:]...), os.Environ())
    return
}
```

### Placement in main.go

The check goes after the `AEP_CAW_IN_SESSION` recursion guard and after the `realShell, err := resolveRealShell(shellName)` block, but before the `conf, confErr := shim.ReadShimConf(...)` call. This ensures aep-caw CLI commands are always bypassed regardless of `force=true`.

### `isAgentshCommand` implementation

```go
func isAgentshCommand(args []string) bool {
    if len(args) < 2 || args[0] != "-c" {
        return false
    }
    cmdParts := strings.Fields(args[1])
    if len(cmdParts) == 0 {
        return false
    }
    cmdPath, err := exec.LookPath(cmdParts[0])
    if err != nil {
        return false
    }
    aep-cawPath, err := resolveAgentshBin()
    if err != nil {
        return false
    }
    // Resolve symlinks to handle installations where aep-caw is symlinked
    // (e.g., /usr/local/bin/aep-caw -> /opt/aep-caw/bin/aep-caw).
    cmdResolved, err := filepath.EvalSymlinks(cmdPath)
    if err != nil {
        cmdResolved = cmdPath
    }
    aep-cawResolved, err := filepath.EvalSymlinks(aep-cawPath)
    if err != nil {
        aep-cawResolved = aep-cawPath
    }
    return cmdResolved == aep-cawResolved
}
```

**Fail-safe direction:** If either `LookPath`, `resolveAgentshBin`, or symlink resolution fails, the check returns false (no bypass). The worst case is the existing deadlock behavior - never a security bypass. This is the correct fail-safe direction: over-enforce rather than under-enforce.

**Relationship to `isMCPCommand`:** The existing `isMCPCommand` function (main.go:110-123) uses the same `-c` parsing pattern. Both extract the command from shell args. A shared helper `extractCommandFromShellArgs` could reduce duplication, but is not required for this fix.

### Known limitations

- **Wrapper commands:** `sudo aep-caw detect`, `env aep-caw detect`, `nice aep-caw detect` will NOT be bypassed (first word is the wrapper, not aep-caw). Operators should run aep-caw diagnostics without wrappers in shim-enforced environments. This is acceptable because sudo changes the security context anyway, and the workaround is trivial.
- **Shell quoting:** `'aep-caw' detect` (quoted binary name) will not be detected because `LookPath("'aep-caw'")` fails. This is an unlikely invocation pattern.

## Files to modify

1. `cmd/aep-caw-shell-shim/main.go` - Add `isAgentshCommand` function and bypass check
2. `cmd/aep-caw-shell-shim/main_test.go` - Unit tests and integration test

## Test plan

**Unit tests for `isAgentshCommand`:**
- `-c "aep-caw detect"` → true
- `-c "aep-caw --version"` → true
- `-c "echo hello"` → false
- `-c "/usr/bin/aep-caw trash list"` → true (absolute path resolves to aep-caw)
- `-c "sudo aep-caw detect"` → false (first word is sudo)
- No `-c` flag → false
- Empty command string → false
- Agentsh binary is a symlink → true (symlinks resolved before comparison)
- `AEP_CAW_BIN` override points to custom path → true (resolveAgentshBin uses it)

**Integration tests (build shim, run as subprocess):**
- Shim with `force=true` + `aep-caw` command → bypasses (exits via real shell, no server needed)
- Shim with `force=true` + non-aep-caw command → enforces (tries to find aep-caw server)
