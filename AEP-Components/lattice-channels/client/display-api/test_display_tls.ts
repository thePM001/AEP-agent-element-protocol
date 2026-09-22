/**
 * Live TLS JSON HTTP test for the display client.
 *
 * Run with: node --experimental-strip-types test_display_tls.ts
 *
 * Environment:
 *   DISPLAY_HOST and DISPLAY_PORT point at a live display dock.
 *   AEP_LATTICE_TLS_CERT, AEP_LATTICE_TLS_KEY and AEP_LATTICE_TLS_CA carry the
 *   client identity, the client key and the mesh CA.
 *   AEP_BASE_NODE_BIN names the Base Node binary for the shipped seal path.
 *
 * Every call goes through HTTP JSON over TLS. A reply that is not HTTP JSON
 * makes the reader report that the dock returned bytes without an HTTP header
 * block.
 */
import { DisplayClient, DISPLAY_TLS_PORT, DEFAULT_AGENT_ID, MISSING_SEAL_MATERIAL } from "./index.ts"

const passes: string[] = []
const PACE_MS = 150

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/** Hold under the dock rate limit for agent_action frames. */
async function pace(): Promise<void> {
  await sleep(PACE_MS)
}

function check(name: string, condition: boolean): void {
  if (!condition) {
    throw new Error(name)
  }
  passes.push(name)
}

async function main(): Promise<number> {
  const host = process.env.DISPLAY_HOST ? process.env.DISPLAY_HOST : "127.0.0.1"
  const port = Number(process.env.DISPLAY_PORT ? process.env.DISPLAY_PORT : String(DISPLAY_TLS_PORT))
  const binary = process.env.AEP_BASE_NODE_BIN
  const client = new DisplayClient({ host: host, port: port, agentId: DEFAULT_AGENT_ID, binary: binary })

  const catalog = await client.listCatalog() as { views?: string[], sources?: string[] }
  await pace()
  const views = catalog.views ? catalog.views : []
  const sources = catalog.sources ? catalog.sources : []
  check("catalog lists view.alpha", views.includes("view.alpha"))
  check("catalog lists view.beta", views.includes("view.beta"))
  check("catalog lists source.alpha", sources.includes("source.alpha"))

  const alpha = await client.project({ view: "view.alpha" })
  await pace()
  const beta = await client.project({ view: "view.beta" })
  await pace()
  check("view.alpha projects the locator payload", JSON.stringify(alpha) === JSON.stringify({ label: "one" }))
  check("view.beta projects the locator payload", JSON.stringify(beta) === JSON.stringify({ label: "two" }))

  const broken = new DisplayClient({ host: host, port: port, agentId: DEFAULT_AGENT_ID, binary: "/nonexistent/aep-base-node" })
  let refused = false
  try {
    await broken.project({ view: "view.alpha" })
  } catch (err) {
    refused = String(err).includes(MISSING_SEAL_MATERIAL)
  }
  check("missing seal material DENY on miss", refused)

  console.log("display client TLS JSON HTTP test")
  for (const name of passes) {
    console.log("PASS " + name)
  }
  return 0
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("FAIL " + String(err))
  process.exit(1)
})
