const { spawn } = require("node:child_process");
const echo = process.argv[2];
const child = spawn("node", [echo], { stdio: ["pipe", "pipe", "pipe"] });
function frame(obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  return Buffer.concat([Buffer.from("Content-Length: " + String(body.length) + "\r\n\r\n", "utf8"), body]);
}
child.stdout.on("data", (c) => process.stdout.write("OUT " + JSON.stringify(c.toString("utf8")) + "\n"));
child.stderr.on("data", (c) => process.stdout.write("ERR " + JSON.stringify(c.toString("utf8")) + "\n"));
child.on("close", (code, sig) => process.stdout.write("CLOSE code=" + String(code) + " sig=" + String(sig) + "\n"));
child.on("error", (e) => process.stdout.write("SPAWNERR " + e.message + "\n"));
child.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } }));
setTimeout(() => {
  child.stdin.write(frame({ jsonrpc: "2.0", method: "notifications/initialized" }));
  child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { ping: "pong" } } }));
}, 300);
setTimeout(() => child.kill("SIGTERM"), 2000);
