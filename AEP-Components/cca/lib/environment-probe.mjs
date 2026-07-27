#!/usr/bin/env node

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import os from "node:os";

function readMemInfo() {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const total = Number(raw.match(/MemTotal:\s+(\d+)/)?.[1] ?? 0) / 1024;
    const avail = Number(raw.match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0) / 1024;
    return { total_mb: Math.round(total), available_mb: Math.round(avail) };
  } catch {
    const total = os.totalmem() / (1024 * 1024);
    const free = os.freemem() / (1024 * 1024);
    return { total_mb: Math.round(total), available_mb: Math.round(free) };
  }
}

function readDiskFree() {
  try {
    const r = spawnSync("df", ["-m", "/"], { encoding: "utf8" });
    const line = r.stdout.trim().split("\n")[1];
    if (!line) return 0;
    const cols = line.split(/\s+/);
    return Number(cols[3] ?? 0);
  } catch {
    return 0;
  }
}

function probeGpu() {
  try {
    const r = spawnSync("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], {
      encoding: "utf8",
      timeout: 3000,
    });
    if (r.status !== 0) return { present: false, vram_mb: 0 };
    const vram = Number(r.stdout.trim().split("\n")[0] ?? 0);
    return { present: true, vram_mb: vram };
  } catch {
    return { present: false, vram_mb: 0 };
  }
}

function deriveConstraints(mem, gpu) {
  const constraints = [];
  if (mem.total_mb < 8192) constraints.push("memory_below_8gb");
  else if (mem.total_mb < 32768) constraints.push("memory_below_32gb");
  if (!gpu.present) constraints.push("no_gpu");
  if (process.env.AEP_IN_DOCKER === "1") constraints.push("docker_container");
  return constraints;
}

function recommendInference(mem, gpu, constraints) {
  if (gpu.present && gpu.vram_mb >= 16000) {
    return { provider: "llama_cpp", max_model_params_b: 70, model_hint: "llama-3.1-70b" };
  }
  if (mem.total_mb >= 16384) {
    return { provider: "llama_cpp", max_model_params_b: 13, model_hint: "llama-3.1-8b" };
  }
  if (constraints.includes("memory_below_8gb")) {
    return { provider: "openrouter", max_model_params_b: 8, model_hint: "cloud-api-small" };
  }
  return { provider: "llama_cpp", max_model_params_b: 8, model_hint: "llama-3.1-8b" };
}

/**
 * @returns {Promise<object>} EnvironmentProfile
 */
export async function probeEnvironment(env = process.env) {
  const mem = readMemInfo();
  const gpu = probeGpu();
  const constraints = deriveConstraints(mem, gpu);
  const recommended = recommendInference(mem, gpu, constraints);

  return {
    probe_version: "1",
    timestamp: new Date().toISOString(),
    cpu_cores: os.cpus().length,
    memory_total_mb: mem.total_mb,
    memory_available_mb: mem.available_mb,
    disk_free_mb: readDiskFree(),
    gpu,
    network: {
      internet_up: env.AEP_INTERNET_UP !== "0",
      docker: env.AEP_IN_DOCKER === "1",
      hostname: os.hostname(),
    },
    constraints,
    recommended_inference: recommended,
  };
}

/**
 * TCP probe for Postgres (no pg driver required).
 */
export function probeTcpHost(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port, timeout: timeoutMs }, () => {
      socket.end();
      resolve({ ok: true, host, port });
    });
    socket.on("error", (err) => resolve({ ok: false, host, port, error: err.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ok: false, host, port, error: "timeout" });
    });
  });
}