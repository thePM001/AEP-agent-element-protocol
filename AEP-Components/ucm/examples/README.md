# UCM examples

## Claude Code and other MCP clients

Add UCM as an MCP server that runs on stdio:

```bash
claude mcp add-json ucm '{"command": "/path/to/aep-ucm", "args": ["mcp"]}'
```

or in an MCP client configuration:

```json
{
  "mcpServers": {
    "ucm": {
      "command": "/path/to/aep-ucm",
      "args": ["mcp"],
      "env": { "UCM_DATA": "/path/to/ucm-data" }
    }
  }
}
```

The server tells the agent how to use it: look up the tool with ucm_lookup, compute with ucm_eval and quote the receipt_id.

## LangGraph and any Python agent

```python
import json
import os
import urllib.request

# Address of the aep-ucm service, for example the loopback address on port 8414.
UCM = os.environ["UCM_URL"]


def ucm(path, body):
    req = urllib.request.Request(UCM + path, json.dumps(body).encode(), {"content-type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def calculate(program: str, inputs: dict) -> dict:
    """Tool for the agent: exact calculation with a signed receipt."""
    out = ucm("/ucm/v1/eval", {"program": program, "inputs": inputs})
    return {"result": out["result"], "receipt_id": out["receipt_id"]}


def find_tool(task: str) -> list:
    """Tool for the agent: which UCM function or formula fits the task."""
    return [e["entry"] for e in ucm("/ucm/v1/lookup", {"query": task})["entries"]]
```

Register calculate and find_tool as tools of the graph. A LangGraph ToolNode takes plain Python functions.

## Native AEP component

```ts
import { UcmClient } from "../clients/ts/ucm-client";

const ucm = new UcmClient({ baseUrl: process.env.UCM_URL ?? "" });
const total = await ucm.evaluate(
  'input p: money[EUR];\ninput n: int;\nround(p * n * 1.081, 2, "half_even")',
  { p: "19.90 EUR", n: "3" },
);

// The task manifest of this agent declares "computed_fields": ["/total"].
const payload = UcmClient.attachReceipts(
  { total: (total.result as { decimal: string }).decimal },
  { "/total": total.receipt },
);
// Send payload through UCB or the lattice channel as usual. Admit checks the receipt.
```

## Library formulas

```bash
aep-ucm lookup loan payment
```

Copy the example program of formula.finance.annuity_payment unchanged and send it with "library_formula": "finance.annuity_payment". The receipt then says program_source library, which wraps listed in AEP_UCM_LIBRARY_ONLY_WRAPS require.
