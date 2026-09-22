/**
 * Display API client. Posts JSON with a sealed display frame and reads a JSON projection.
 * Sibling of the advertised lattice SDK at client/lattice.
 * The seal path ships with this file, so a frontend author supplies no seal code.
 * Missing seal material DENY on miss.
 */
import net from "node:net"
import tls from "node:tls"
import { execFileSync } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

export const DISPLAY_CONTRACT_ID = "aep-display-api"
export const DISPLAY_KIND = "display"
export const ACTION_INGEST = "display-api:source:ingest"
export const ACTION_STAGE = "display-api:sector:stage"
export const ACTION_REQUEST = "display-api:view:request"
export const ACTION_PROJECT = "display-api:view:project"
export const ACTION_LIST = "display-api:catalog:list"
export const DISPLAY_TLS_PORT = 28429
export const DISPLAY_HTTP_PATH = "/display"
export const DEFAULT_AGENT_ID = "display-client"
export const DEFAULT_SEAL_BINARY = "aep-base-node"
export const DISPLAY_ENVELOPE_TYPE = "CUSTOM"
export const DEFAULT_SCENE_ID = "display-api"
export const SKIP_FRAME_REFUSED = "JSON body that skips the sealed frame is refused"
export const MISSING_SEAL_MATERIAL = "missing seal material DENY on miss"

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
  dockingPort: "DisplayApi"
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
  tls?: boolean
  http?: boolean
  sendLine?: (line: string) => Promise<string>
}

export type DisplaySealOptions = {
  agentId?: string
  binary?: string
  dataDir?: string
  latticeDb?: string
}

export type DisplayClientOptions = DisplayTransport & DisplaySealOptions & {
  sealer?: DisplaySealer
  channelId?: string
  sessionId?: string
  signerPublicHex?: string
  sceneId?: string
}

export type DockFrameResponse = {
  ok?: boolean
  error?: string
  pending?: boolean
  digest?: string
  event_id?: string
  projection?: unknown
}

/**
 * Sequence number that never steps back for this agent.
 *
 * The dock refuses an agent clock regression, so a fresh client process takes
 * the wall clock in milliseconds and keeps the larger of that and its own last
 * number.
 */
function monotonicSequence(previous: number): number {
  const nowMs = Date.now()
  if (nowMs > previous) {
    return nowMs
  }
  return previous + 1
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

export function httpRequestBytes(body: string, path?: string): Buffer {
  let target = (path ? path : DISPLAY_HTTP_PATH).trim()
  if (target.startsWith("/") === false) {
    target = "/" + target
  }
  const payload = Buffer.from(body, "utf8")
  const head = "POST " + target + " HTTP/1.1\r\n"
    + "Host: aep-display-dock\r\n"
    + "Content-Type: application/json\r\n"
    + "Content-Length: " + String(payload.length) + "\r\n"
    + "Connection: close\r\n"
    + "\r\n"
  return Buffer.concat([Buffer.from(head, "utf8"), payload])
}

export function httpResponseBody(raw: string): string {
  const marker = raw.indexOf("\r\n\r\n")
  if (marker >= 0) {
    return raw.slice(marker + 4).trim()
  }
  const bare = raw.indexOf("\n\n")
  if (bare >= 0) {
    return raw.slice(bare + 2).trim()
  }
  throw new Error("display dock returned bytes without an HTTP header block")
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
  return join(resolveDataDir(), "sockets", "display")
}

export function resolveDataDir(dataDir?: string): string {
  if (dataDir) {
    if (dataDir.trim().length > 0) {
      return dataDir
    }
  }
  const envData = process.env.AEP_DATA
  if (envData) {
    return envData
  }
  return join(homedir(), ".aep")
}

export function resolveLatticeDb(dataDir?: string): string {
  if (dataDir) {
    if (dataDir.trim().length > 0) {
      return join(dataDir, "action-lattice.db")
    }
  }
  const envDb = process.env.AEP_LATTICE_DB
  if (envDb) {
    return envDb
  }
  return join(resolveDataDir(), "action-lattice.db")
}

export function displayUsesTls(transport: DisplayTransport): boolean {
  if (transport.tls === false) {
    return false
  }
  if (transport.tls === true) {
    return true
  }
  if (transport.port === DISPLAY_TLS_PORT) {
    return true
  }
  if (process.env.AEP_LATTICE_TRANSPORT === "tls") {
    if (transport.host) {
      return true
    }
  }
  return false
}

function displayUsesHttp(transport: DisplayTransport): boolean {
  if (transport.http === false) {
    return false
  }
  if (transport.http === true) {
    return true
  }
  if (transport.host) {
    return true
  }
  return false
}

function loadTlsMaterial(): { ca: string, cert: string, key: string, servername: string } {
  const cert = process.env.AEP_LATTICE_TLS_CERT
  const key = process.env.AEP_LATTICE_TLS_KEY
  const ca = process.env.AEP_LATTICE_TLS_CA
  if (!cert) {
    throw new Error("AEP_LATTICE_TRANSPORT=tls requires AEP_LATTICE_TLS_CERT, AEP_LATTICE_TLS_KEY, AEP_LATTICE_TLS_CA")
  }
  if (!key) {
    throw new Error("AEP_LATTICE_TRANSPORT=tls requires AEP_LATTICE_TLS_CERT, AEP_LATTICE_TLS_KEY, AEP_LATTICE_TLS_CA")
  }
  if (!ca) {
    throw new Error("AEP_LATTICE_TRANSPORT=tls requires AEP_LATTICE_TLS_CERT, AEP_LATTICE_TLS_KEY, AEP_LATTICE_TLS_CA")
  }
  const servername = process.env.AEP_LATTICE_TLS_SERVERNAME
  return {
    ca: ca,
    cert: cert,
    key: key,
    servername: servername ? servername : "aep-dock-server",
  }
}

function connectSocket(target: { path?: string, host?: string, port?: number, tls?: boolean }): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    if (target.tls) {
      if (target.host) {
        if (target.port) {
          const material = loadTlsMaterial()
          const socket = tls.connect({
            host: target.host,
            port: target.port,
            servername: material.servername,
            cert: material.cert,
            key: material.key,
            ca: material.ca,
            rejectUnauthorized: true,
          })
          socket.on("secureConnect", () => { resolve(socket) })
          socket.on("error", (err) => { reject(err) })
          return
        }
      }
    }
    const socket = target.path ? net.connect({ path: target.path }) : net.connect({ host: target.host, port: target.port as number })
    socket.on("connect", () => { resolve(socket) })
    socket.on("error", (err) => { reject(err) })
  })
}

function contentLength(head: string): number {
  for (const raw of head.split("\r\n")) {
    const line = raw.toLowerCase()
    if (line.startsWith("content-length:")) {
      const value = Number(raw.split(":")[1])
      if (Number.isFinite(value)) {
        return value
      }
    }
  }
  return -1
}

export async function postDisplayHttpJson(transport: DisplayTransport, line: string, timeoutMs: number): Promise<string> {
  const socket = await connectSocket({
    path: transport.socketPath,
    host: transport.host,
    port: transport.port,
    tls: displayUsesTls(transport),
  })
  const body = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("display dock timeout"))
    }, timeoutMs)
    let buf = ""
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      const at = buf.indexOf("\r\n\r\n")
      if (at < 0) {
        return
      }
      const size = contentLength(buf.slice(0, at))
      const rest = buf.slice(at + 4)
      if (size >= 0) {
        if (Buffer.byteLength(rest, "utf8") >= size) {
          clearTimeout(timer)
          socket.end()
          resolve(rest.slice(0, size))
        }
        return
      }
      if (buf.includes("\r\n\r\n") && rest.length > 0) {
        clearTimeout(timer)
        socket.end()
        resolve(rest)
      }
    })
    socket.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    socket.write(httpRequestBytes(line))
  })
  return body
}

async function sendJsonLine(target: DisplayTransport, line: string, timeoutMs: number): Promise<string> {
  const socket = await connectSocket({
    path: target.socketPath ? target.socketPath : resolveSocketPath(),
    host: target.host,
    port: target.port,
    tls: displayUsesTls(target),
  })
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("display dock timeout"))
    }, timeoutMs)
    let buf = ""
    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8")
      if (buf.includes("\n")) {
        clearTimeout(timer)
        const first = buf.split("\n")[0]
        socket.end()
        resolve(first)
      }
    })
    socket.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
    socket.write(line + String.fromCharCode(10))
  })
}

async function sendWith(transport: DisplayTransport, line: string, timeoutMs: number): Promise<string> {
  const send = transport.sendLine
  if (send) {
    return send(line)
  }
  if (displayUsesHttp(transport)) {
    return postDisplayHttpJson(transport, line, timeoutMs)
  }
  return sendJsonLine(transport, line, timeoutMs)
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
  const first = parseDockResponse(await sendWith(transport, displayEnvelope(sealed.frame, sealed.signer_public_hex), 8000))
  if (first.pending) {
    if (first.digest) {
      const collected = parseDockResponse(await sendWith(transport, collectEnvelope(first.digest), 8000))
      return projectionFrom(collected)
    }
  }
  return projectionFrom(first)
}

export function cliSealer(options?: DisplaySealOptions): DisplaySealer {
  const agentId = (options?.agentId ? options.agentId : DEFAULT_AGENT_ID).trim()
  const binary = (options?.binary ? options.binary : (process.env.AEP_BASE_NODE_BIN ? process.env.AEP_BASE_NODE_BIN : DEFAULT_SEAL_BINARY)).trim()
  const dataDir = resolveDataDir(options?.dataDir)
  const latticeDb = options?.latticeDb ? options.latticeDb : resolveLatticeDb(options?.dataDir)
  return async (plaintext: DisplayPlaintext): Promise<SealedFrame> => {
    if (!plaintext) {
      throw new Error(SKIP_FRAME_REFUSED)
    }
    let out = ""
    try {
      out = execFileSync(binary, ["--seal-display", "--agent-id", agentId, "--lattice-db", latticeDb], {
        input: JSON.stringify(plaintext),
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        env: Object.assign({}, process.env, { AEP_DATA: dataDir, AEP_LATTICE_DB: latticeDb }),
      })
    } catch {
      throw new Error(MISSING_SEAL_MATERIAL)
    }
    const text = (out ? out : "").trim()
    if (text.length === 0) {
      throw new Error(MISSING_SEAL_MATERIAL)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error(MISSING_SEAL_MATERIAL)
    }
    if (!parsed) {
      throw new Error(MISSING_SEAL_MATERIAL)
    }
    const sealed = parsed as SealedFrame
    if (!sealed.frame) {
      throw new Error(MISSING_SEAL_MATERIAL)
    }
    if (typeof sealed.frame !== "object") {
      throw new Error(MISSING_SEAL_MATERIAL)
    }
    return sealed
  }
}

export class DisplayClient {
  private readonly options: DisplayClientOptions
  private readonly sealer: DisplaySealer
  private sequence = 0
  private readonly requested = new Set<string>()

  constructor(options: DisplayClientOptions) {
    this.options = options
    this.sealer = options.sealer ? options.sealer : cliSealer(options)
  }

  ingest(input: { view: string, source: string, sector: string, payload?: unknown }): Promise<unknown> {
    return this.roundtrip(displayPlaintext({
      action_path: ACTION_INGEST,
      view: input.view,
      source: input.source,
      sector: input.sector,
      payload: input.payload ? input.payload : {},
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

  async request(input: { view: string }): Promise<unknown> {
    const result = await this.roundtrip(displayPlaintext({ action_path: ACTION_REQUEST, view: input.view }))
    this.requested.add(input.view)
    return result
  }

  async project(input: { view: string }): Promise<unknown> {
    if (this.requested.has(input.view) === false) {
      this.requested.add(input.view)
      await this.roundtrip(displayPlaintext({ action_path: ACTION_REQUEST, view: input.view }))
    }
    return this.roundtrip(displayPlaintext({ action_path: ACTION_PROJECT, view: input.view }))
  }

  listCatalog(input?: { view?: string }): Promise<unknown> {
    const view = input?.view ? input.view : "view.alpha"
    return this.roundtrip(displayPlaintext({ action_path: ACTION_LIST, view: view }))
  }

  seal(plaintext: DisplayPlaintext): Promise<SealedFrame> {
    return this.sealer(plaintext, {
      contractId: DISPLAY_CONTRACT_ID,
      dockingPort: "DisplayApi",
      agentId: this.options.agentId ? this.options.agentId : DEFAULT_AGENT_ID,
      channelId: this.options.channelId ? this.options.channelId : "ch-display",
      sessionId: this.options.sessionId ? this.options.sessionId : "display-session",
    })
  }

  private async roundtrip(plaintext: DisplayPlaintext): Promise<unknown> {
    const body = Object.assign({}, plaintext) as DisplayPlaintext & Record<string, unknown>
    body.type = DISPLAY_ENVELOPE_TYPE
    body.agent_id = this.options.agentId ? this.options.agentId : DEFAULT_AGENT_ID
    body.target_id = this.options.sceneId ? this.options.sceneId : DEFAULT_SCENE_ID
    this.sequence = monotonicSequence(this.sequence)
    body._sequenceNumber = this.sequence
    const sealed = await this.seal(body)
    return postDisplayJson(this.options, {
      frame: sealed.frame,
      signer_public_hex: sealed.signer_public_hex ? sealed.signer_public_hex : this.options.signerPublicHex,
    })
  }
}
