# Component Registry

Register every new component here before building it. Check here before
starting any work -- the component might already exist.

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
