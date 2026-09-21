/**
 * Display API client. Posts JSON with a sealed display frame and reads a JSON projection.
 * Sibling of the advertised lattice SDK at client/lattice.
 * Sealer is injected. This file does not open a PQC capsule.
 */
import net from "node:net"
import { homedir } from "node:os"
import { join } from "node:path"

export const DISPLAY_CONTRACT_ID = "aep-display-surface"
export const DISPLAY_KIND = "display"
export const ACTION_INGEST = "display:source:ingest"
export const ACTION_STAGE = "display:sector:stage"
export const ACTION_REQUEST = "display:view:request"
export const ACTION_PROJECT = "display:view:project"
export const SKIP_FRAME_REFUSED = "JSON body that skips the sealed frame is refused"

export type DisplayPlaintext = {
  kind: typeof DISPLAY_KIND
  action_path: string
  view: string
  source?: string
  sector?: string
  payload?: unknown
}

export type LatticeChannelFrame = Record<string, unknown>

export type SealMeta = {
  contractId: string
  dockingPort: "DisplaySurface"
  agentId: string
  channelId: string
  sessionId: string
}

export type SealedFrame = {
  frame: LatticeChannelFrame
  signer_public_hex?: string
}

export type DisplaySealer = (plaintext: DisplayPlaintext, meta: SealMeta) => Promise<SealedFrame>

export type DisplayTransport = {
  socketPath?: string
  host?: string
  port?: number
  sendLine?: (line: string) => Promise<string>
}

export type DisplayClientOptions = DisplayTransport & {
  sealer: DisplaySealer
  agentId?: string
  channelId?: string
  sessionId?: string
  signerPublicHex?: string
}

export type DockFrameResponse = {
  ok?: boolean
  error?: string
  pending?: boolean
  digest?: string
  event_id?: string
  projection?: unknown
}

function requireText(name: string, value: string): string {
  const trimmed = (value ? value : "").trim()
  if (trimmed.length === 0) {
    throw new Error(name + " must not be empty")
  }
  return trimmed
}

export function displayPlaintext(input: {
  action_path: string
  view: string
  source?: string
  sector?: string
  payload?: unknown
}): DisplayPlaintext {
  const body: DisplayPlaintext = {
    kind: DISPLAY_KIND,
    action_path: requireText("action_path", input.action_path),
    view: requireText("view", input.view),
  }
  const source = (input.source ? input.source : "").trim()
  const sector = (input.sector ? input.sector : "").trim()
  if (source.length > 0) {
    body.source = source
  }
  if (sector.length > 0) {
    body.sector = sector
  }
  if (input.payload !== undefined) {
    body.payload = input.payload
  }
  return body
}

export function displayEnvelope(frame: LatticeChannelFrame, signerPublicHex?: string): string {
  if (!frame) {
    throw new Error(SKIP_FRAME_REFUSED)
  }
  if (typeof frame !== "object") {
    throw new Error(SKIP_FRAME_REFUSED)
  }
  const body: { frame: LatticeChannelFrame, signer_public_hex?: string } = { frame: frame }
  const signer = (signerPublicHex ? signerPublicHex : "").trim()
  if (signer.length > 0) {
    body.signer_public_hex = signer
  }
  return JSON.stringify(body)
}

export function collectEnvelope(digest: string): string {
  return JSON.stringify({ collect: requireText("digest", digest) })
}

function parseDockResponse(line: string): DockFrameResponse {
  const trimmed = (line ? line : "").trim()
  if (trimmed.length === 0) {
    throw new Error("display dock returned an empty line")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error("display dock returned bytes that are not JSON")
  }
  if (!parsed) {
    throw new Error("display dock returned bytes that are not JSON")
  }
  if (typeof parsed !== "object") {
    throw new Error("display dock returned bytes that are not JSON")
  }
  return parsed as DockFrameResponse
}

function projectionFrom(resp: DockFrameResponse): unknown {
  if (resp.error) {
    throw new Error(resp.error)
  }
  if (resp.ok === false) {
    throw new Error("display dock refused the frame")
  }
  if (Object.prototype.hasOwnProperty.call(resp, "projection")) {
    return resp.projection
  }
  return null
}

function resolveSocketPath(socketPath?: string): string {
  if (socketPath) {
    if (socketPath.trim().length > 0) {
      return socketPath
    }
  }
  const envBase = process.env.AEP_SOCKET_BASE
  if (envBase) {
    return join(envBase, "display")
  }
  const envData = process.env.AEP_DATA
  let data = join(homedir(), ".aep")
  if (envData) {
    data = envData
  }
  return join(data, "sockets", "display")
}

function sendJsonLine(target: { path?: string, host?: string, port?: number }, line: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = target.path ? net.connect({ path: target.path }) : net.connect({ host: target.host, port: target.port as number })
    let buf = ""
    const timer = setTimeout(() => {
      socket.destroy(new Error("display dock timeout"))
    }, timeoutMs)
    socket.on("connect", () => {
      socket.write(line + "\n")
    })
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      if (buf.includes("\n")) {
        clearTimeout(timer)
        resolve(buf.split("\n")[0])
        socket.end()
      }
    })
    socket.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export async function postDisplayJson(transport: DisplayTransport, sealed: SealedFrame): Promise<unknown> {
  if (!sealed) {
    throw new Error(SKIP_FRAME_REFUSED)
  }
  if (!sealed.frame) {
    throw new Error(SKIP_FRAME_REFUSED)
  }
  if (typeof sealed.frame !== "object") {
    throw new Error(SKIP_FRAME_REFUSED)
  }
  let send = transport.sendLine
  if (!send) {
    send = function (wire: string): Promise<string> {
      if (transport.socketPath) {
        return sendJsonLine({ path: transport.socketPath }, wire, 8000)
      }
      if (transport.host) {
        if (transport.port) {
          return sendJsonLine({ host: transport.host, port: transport.port }, wire, 8000)
        }
      }
      return sendJsonLine({ path: resolveSocketPath() }, wire, 8000)
    }
  }
  const first = parseDockResponse(await send(displayEnvelope(sealed.frame, sealed.signer_public_hex)))
  if (first.pending) {
    if (first.digest) {
      const collected = parseDockResponse(await send(collectEnvelope(first.digest)))
      return projectionFrom(collected)
    }
  }
  return projectionFrom(first)
}

export class DisplayClient {
  private readonly options: DisplayClientOptions

  constructor(options: DisplayClientOptions) {
    this.options = options
  }

  ingest(input: { view: string, source: string, sector: string, payload?: unknown }): Promise<unknown> {
    return this.roundtrip(displayPlaintext({
      action_path: ACTION_INGEST,
      view: input.view,
      source: input.source,
      sector: input.sector,
      payload: input.payload,
    }))
  }

  stage(input: { view: string, source: string, sector: string, payload?: unknown }): Promise<unknown> {
    return this.roundtrip(displayPlaintext({
      action_path: ACTION_STAGE,
      view: input.view,
      source: input.source,
      sector: input.sector,
      payload: input.payload,
    }))
  }

  request(input: { view: string }): Promise<unknown> {
    return this.roundtrip(displayPlaintext({ action_path: ACTION_REQUEST, view: input.view }))
  }

  project(input: { view: string }): Promise<unknown> {
    return this.roundtrip(displayPlaintext({ action_path: ACTION_PROJECT, view: input.view }))
  }

  private async roundtrip(plaintext: DisplayPlaintext): Promise<unknown> {
    const sealed = await this.options.sealer(plaintext, {
      contractId: DISPLAY_CONTRACT_ID,
      dockingPort: "DisplaySurface",
      agentId: this.options.agentId ? this.options.agentId : "display-client",
      channelId: this.options.channelId ? this.options.channelId : "ch-display",
      sessionId: this.options.sessionId ? this.options.sessionId : "display-session",
    })
    return postDisplayJson(this.options, {
      frame: sealed.frame,
      signer_public_hex: sealed.signer_public_hex ? sealed.signer_public_hex : this.options.signerPublicHex,
    })
  }
}
