#!/usr/bin/env python3
"""Language neutral runner for the UCM conformance vectors.

Any implementation passes when it reads JSON lines {"id", "program" or "program_json",
"inputs"} on stdin and writes JSON lines {"id", "result"} or {"id", "error": "<code>"} on
stdout, which is what `aep-ucm batch` does. The runner never starts the implementation itself:

    python3 -I AEP-Components/ucm/scripts/run_vectors.py emit cases.jsonl
    rust/target/release/aep-ucm batch < cases.jsonl > got.jsonl
    python3 -I AEP-Components/ucm/scripts/run_vectors.py check got.jsonl

check exits 0 only when every vector gives its expected result or error code.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VECTORS = os.path.join(HERE, "..", "vectors")


def cases():
    out = []
    for name in sorted(os.listdir(VECTORS)):
        if name.endswith(".json"):
            with open(os.path.join(VECTORS, name)) as fh:
                doc = json.load(fh)
            for c in doc["cases"]:
                out.append((f"{doc['suite']}/{c['id']}", c))
    return out


def emit(path):
    n = 0
    with open(path, "w") as fh:
        for key, c in cases():
            row = {"id": key, "inputs": c.get("inputs", {})}
            if isinstance(c["program"], str):
                row["program"] = c["program"]
            else:
                row["program_json"] = c["program"]
            fh.write(json.dumps(row) + "\n")
            n += 1
    print(json.dumps({"emitted": n}))


def check(path):
    got = {}
    with open(path) as fh:
        for line in fh:
            r = json.loads(line)
            got[r["id"]] = r
    all_cases = cases()
    fails = []
    for key, c in all_cases:
        r = got.get(key, {})
        if "expect" in c and r.get("result") != c["expect"]:
            fails.append(f"{key}: want {c['expect']} got {r}")
        if "error" in c and r.get("error") != c["error"]:
            fails.append(f"{key}: want error {c['error']} got {r}")
    for f in fails[:30]:
        print(f, file=sys.stderr)
    print(json.dumps({"vectors": len(all_cases), "failed": len(fails)}))
    sys.exit(1 if fails else 0)


def main():
    a = sys.argv[1:]
    if len(a) == 2 and a[0] == "emit":
        emit(a[1])
    elif len(a) == 2 and a[0] == "check":
        check(a[1])
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
