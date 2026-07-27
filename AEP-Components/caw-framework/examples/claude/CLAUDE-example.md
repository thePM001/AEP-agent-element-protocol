# Command Execution via aep-caw

**All shell commands in this project MUST be executed through aep-caw.**

When using the Bash tool, wrap every command with `aep-caw exec`:

## Required Syntax

```bash
aep-caw exec SESSION_ID -- COMMAND [ARGS...]
```

The `--` separator is **required** between the session ID and the command.

## Examples

Instead of:
```bash
ls -la
npm install
go build ./...
```

Use:
```bash
aep-caw exec my-session -- ls -la
aep-caw exec my-session -- npm install
aep-caw exec my-session -- go build ./...
```

## Using Environment Variables (Recommended)

When `AEP_CAW_SESSION_ID` is set, pass all command arguments after `exec`:

```bash
export AEP_CAW_SESSION_ID=my-session
aep-caw exec -- ls -la
aep-caw exec -- npm install
```

## Auto-Creating Sessions

Use `--root` to auto-create a session if it doesn't exist:

```bash
aep-caw exec my-session --root /path/to/workspace -- ls -la
```

Or set the environment variable:

```bash
export AEP_CAW_SESSION_ROOT=/path/to/workspace
aep-caw exec my-session -- ls -la
```

## Common Flags

| Flag            | Description                          |
|-----------------|--------------------------------------|
| `--timeout 30s` | Command timeout (e.g., 30s, 5m)      |
| `--output json` | JSON structured output               |
| `--stream`      | Stream output as produced            |
| `--pty`         | Interactive PTY mode                 |

## Environment Variables

| Variable               | Description                                      |
|------------------------|--------------------------------------------------|
| `AEP_CAW_SESSION_ID`   | Default session ID (avoids passing as argument)  |
| `AEP_CAW_SESSION_ROOT` | Root directory for auto-creating sessions        |
| `AEP_CAW_SERVER`       | Server URL (default: `http://127.0.0.1:18080`)    |
