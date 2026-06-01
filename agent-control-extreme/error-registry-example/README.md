# Error Registry Example

This directory contains example error registry configurations for AEP-governed agents.

## Purpose

The error registry maps common agent errors to:
- Error codes for structured logging
- Severity levels (info, warn, error, critical)
- Recovery strategies (retry, fallback, escalate, terminate)
- Trust score impact (penalty points)

## Example

See `agent-control-extreme/profiles/` for GAP-based capability profiles that reference error categories.

## Integration

Error registries are loaded by the AEP harness at boot and consulted by the recovery engine when violations are detected.
