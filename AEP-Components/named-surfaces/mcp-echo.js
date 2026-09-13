let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  while (true) {
    const nl = buf.indexOf("\n");
    if (nl < 0) {
      break;
    }
    const line = buf.slice(0, nl).replace(/\r$/, "").trim();
    buf = buf.slice(nl + 1);
    if (line.length === 0) {
      continue;
    }
    handle(JSON.parse(line));
  }
});

function reply(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handle(msg) {
  if (msg === null || typeof msg !== "object") {
    return;
  }
  if (msg.method === "initialize") {
    reply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mcp-echo", version: "1.0.0" },
      },
    });
    return;
  }
  if (msg.method === "notifications/initialized") {
    return;
  }
  if (msg.method === "tools/call") {
    const name = msg.params && msg.params.name ? String(msg.params.name) : "";
    const args = msg.params && msg.params.arguments ? msg.params.arguments : {};
    reply({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        content: [{ type: "text", text: JSON.stringify({ echo: name, arguments: args, forwarded: true }) }],
      },
    });
  }
}
