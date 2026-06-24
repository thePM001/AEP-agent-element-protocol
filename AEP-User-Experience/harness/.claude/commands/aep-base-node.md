# /aep-base-node

## AEP 2.8 Base Node Check

### Health

```bash
node harness/aep-base-node-preflight.mjs
```

Or with explicit config:

```bash
AEP_DATA=/data/aep node harness/aep-base-node-preflight.mjs
```

### Activate (first install)

```bash
node setup-agent/setup-agent.mjs
```

Docker:

```bash
docker compose -f docker-compose.public.yml exec aep aep-setup-agent
```

### Enable compliance LRP

Re-run setup-agent interactively or edit `base_node.lrps` in config and restart daemon.

### Component registry

```bash
cat AEP-Base-Node/registry/catalog.json
```

Composer Lite: `GET /api/registry` on port 8424.