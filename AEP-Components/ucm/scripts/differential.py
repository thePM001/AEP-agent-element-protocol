#!/usr/bin/env python3
"""Differential test: random exact arithmetic programs, evaluated by aep-ucm batch and by an
independent Python reference (fractions and decimal semantics from gen_vectors.py).

The script never starts the engine itself. It writes the cases, the engine runs as a pipe and
the script compares the answers:

    python3 -I AEP-Components/ucm/scripts/differential.py generate 1000000 cases.jsonl expect.jsonl
    rust/target/release/aep-ucm batch < cases.jsonl > got.jsonl
    python3 -I AEP-Components/ucm/scripts/differential.py compare expect.jsonl got.jsonl

compare exits 0 only when every program agrees, including on which programs fail with
division_by_zero.
"""
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_vectors as g  # noqa: E402

MODES = ["half_even", "half_up", "half_down", "up", "down", "floor", "ceiling"]
SEED = 20261107


def case(rng):
    form = rng.random()
    try:
        t, k = g.gen(rng, rng.randint(1, 3))
        t2, k2 = g.gen(rng, 2)
    except g.DivZero:
        return None
    if form < 0.15:
        op = rng.choice(["<", "<=", ">", ">=", "==", "!="])
        res = {"<": k.v < k2.v, "<=": k.v <= k2.v, ">": k.v > k2.v, ">=": k.v >= k2.v, "==": k.v == k2.v, "!=": k.v != k2.v}[op]
        return f"{t} {op} {t2}", g.r_bool(res)
    if form < 0.35:
        s = rng.randint(0, 4)
        m = rng.choice(MODES)
        return f"round({t}, {s}, \"{m}\")", g.r_dec(g.round_scale(k.v, s, m), s)
    if form < 0.40:
        return f"({t}) / (({t2}) - ({t2}))", "division_by_zero"
    return t, g.result_of(k)


def generate(count, cases_path, expect_path):
    rng = random.Random(SEED)
    n = 0
    with open(cases_path, "w") as cf, open(expect_path, "w") as ef:
        while n < count:
            c = case(rng)
            if c is None:
                continue
            prog, exp = c
            cf.write(json.dumps({"id": str(n), "program": prog}) + "\n")
            ef.write(json.dumps({"id": str(n), "expect": exp}) + "\n")
            n += 1
    print(json.dumps({"generated": n}))


def compare(expect_path, got_path):
    expected = {}
    with open(expect_path) as ef:
        for line in ef:
            r = json.loads(line)
            expected[r["id"]] = r["expect"]
    seen = 0
    bad = 0
    with open(got_path) as gf:
        for line in gf:
            r = json.loads(line)
            want = expected.pop(r["id"], None)
            got = r.get("result", r.get("error"))
            if got != want:
                bad += 1
                if bad <= 20:
                    print(f"DIFF id {r['id']}: want {want} got {got}", file=sys.stderr)
            seen += 1
    missing = len(expected)
    print(json.dumps({"programs": seen, "differences": bad, "missing": missing}))
    sys.exit(0 if bad == 0 and missing == 0 else 1)


def main():
    a = sys.argv[1:]
    if len(a) == 4 and a[0] == "generate":
        generate(int(a[1]), a[2], a[3])
    elif len(a) == 3 and a[0] == "compare":
        compare(a[1], a[2])
    else:
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
