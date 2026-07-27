import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function uploadDir(dataDir) {
  return join(dataDir, "cca-uploads");
}

function safeFileName(name) {
  return String(name || "upload.bin")
    .split(/[/\\]/)
    .pop()
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 180) || "upload.bin";
}

function parseMultipartSingleFile(body, boundary) {
  const marker = `--${boundary}`;
  const parts = body.toString("binary").split(marker);
  for (const part of parts) {
    if (!part || part === "--\r\n" || part === "--") continue;
    const chunk = part.startsWith("\r\n") ? part.slice(2) : part;
    const headerEnd = chunk.indexOf("\r\n\r\n");
    if (headerEnd < 0) continue;
    const headers = chunk.slice(0, headerEnd);
    if (!/name="file"/i.test(headers)) continue;
    const fileMatch = headers.match(/filename="([^"]*)"/i);
    const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    let data = chunk.slice(headerEnd + 4);
    if (data.endsWith("\r\n")) data = data.slice(0, -2);
    return {
      name: fileMatch?.[1] || "upload.bin",
      mime: contentTypeMatch?.[1]?.trim() || "application/octet-stream",
      data: Buffer.from(data, "binary"),
    };
  }
  return null;
}

export function readMultipartUpload(req, { dataDir }) {
  return new Promise((resolve, reject) => {
    const contentType = String(req.headers["content-type"] || "");
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      reject(new Error("multipart boundary required"));
      return;
    }
    const boundary = boundaryMatch[1].trim();
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES + 64 * 1024) {
        reject(new Error("file exceeds 4MB limit"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const body = Buffer.concat(chunks);
        const parsed = parseMultipartSingleFile(body, boundary);
        if (!parsed) {
          reject(new Error("no file field in upload"));
          return;
        }
        if (parsed.data.length > MAX_UPLOAD_BYTES) {
          reject(new Error("file exceeds 4MB limit"));
          return;
        }
        const dir = uploadDir(dataDir);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        const fileId = randomUUID();
        const safeName = safeFileName(parsed.name);
        const path = join(dir, `${fileId}_${safeName}`);
        writeFileSync(path, parsed.data);
        resolve({
          file_id: fileId,
          name: parsed.name,
          size: parsed.data.length,
          mime: parsed.mime,
          path,
        });
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}