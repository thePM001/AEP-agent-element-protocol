// A test dock that runs on a worker thread, so it answers while the main thread waits in
// the blocking send of lattice-transport.mjs. It answers each line it reads with the next
// canned answer and writes every line it reads to a file.
import { appendFileSync } from "node:fs";
import { createServer } from "node:net";
import { parentPort, workerData } from "node:worker_threads";

const answers = [...workerData.answers];
const server = createServer((sock) => {
  let buf = "";
  sock.setEncoding("utf8");
  sock.on("data", (chunk) => {
    buf += chunk;
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      appendFileSync(workerData.lines, `${buf.slice(0, nl)}\n`);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      const answer = answers.shift();
      if (answer) sock.write(`${JSON.stringify(answer)}\n`);
    }
  });
  sock.on("error", () => undefined);
});

server.listen(workerData.socket, () => parentPort.postMessage("ready"));
parentPort.on("message", (message) => {
  if (message === "stop") server.close(() => parentPort.close());
});
