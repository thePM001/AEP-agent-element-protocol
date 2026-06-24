# AEP Port Policy

All AEP 2.8 public tier services MUST bind to the **84xx service mesh** range (`8400`-`8499`) unless explicitly documented as an infrastructure exception in this file.

## Disallowed ports

| Port | Reason |
|------|--------|
| `28780` | Prohibited; never assign to AEP 2.8 services |

## AEP 2.8 public tier

| Service | Port | Env override | Health |
|---------|------|--------------|--------|
| **Composer Lite** | **`8424`** | **`COMPOSER_LITE_PORT`** | **`GET /api/health`** |
| **UCB** | **`8412`** | **`UCB_PORT`** | **`GET /health`** |
| WASM sandbox | Unix socket `wasm_sandbox` | `WASM_SANDBOX_SOCKET` | Composer Lite `GET /api/wasm-sandbox/health` |

Docker maps host ports via `.env`; container internals stay at `8424` and `8412`.
