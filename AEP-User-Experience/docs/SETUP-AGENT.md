# Setup agent (install plan + validation engine)

`aep-setup-agent` asks interactively:

1. **Where/how to install AEP + dynAEP** - Docker Compose, docker run, local source, npm package or already installed
2. **Validation engine plan** - acquire NLA-built engine, build your own or try without

Non-interactive environment variables:

| Variable | Purpose |
|----------|---------|
| `AEP_INSTALL_METHOD` | `docker-compose`, `docker-run`, `local`, `npm`, `existing` |
| `AEP_VALIDATION_ENGINE` | `nla`, `self`, `none` |
| `AEP_DATA` | Data directory (default `/data/aep` in Docker) |
| `AEP_AUTO_SETUP` | Set `1` for non-interactive first-boot activation |

Docker deploy: copy `.env.example` to `.env`, then `docker compose up -d --build`. Open `http://localhost:8424/install`.

Remote setup requires `COMPOSER_LITE_SETUP_TOKEN` in `.env` and `?setup_token=` on the install URL.