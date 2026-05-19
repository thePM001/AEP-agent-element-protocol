# Component Registry

Register every new component here before building it. Check here before
starting any work - the component might already exist.

## Registered Components

### Core System
- **ID**: control-hub
- **Type**: repository
- **Path**: agent-control-hub/
- **Status**: Active
- **Description**: Central agent control repository

### Bootstrap
- **ID**: agent-bootstrap
- **Type**: script
- **Path**: bootstrap/agent-bootstrap.sh
- **Status**: Active
- **Description**: First command on every agent spawn

### Session Registry
- **ID**: session-registry
- **Type**: data
- **Path**: registry/agent-sessions.json
- **Status**: Active
- **Description**: Live tracking of all agent sessions

### Policy Violation Reporting System
- **ID**: violation-reporting
- **Type**: enforcement / error-registry
- **Path**: scanners/violation-scanner.py, api/report-api.py, plugins/violation_reporter.py
- **Policy**: policies/11-violation-reporting.policy
- **Status**: Active
- **Description**: Central agent error registry. Nine policy scanners auto-scan all agent tool outputs via governance plugin hook. Violations POSTed to centralized HTTP API. Zero suppression allowed. Failure to report is a violation.
- **Scanners** (9): gray_text, em_dash, double_hyphen, oxford_comma, non_english_output, staging_url_leak, circumvention_attempt, direct_code_write, missing_harness_boot
