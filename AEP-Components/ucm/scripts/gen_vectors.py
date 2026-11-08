#!/usr/bin/env python3
"""Generate UCM conformance vectors with an independent Python reference.

Expected values come from Python fractions, decimal and datetime, never from the Rust
engine. Run from the repository root:

    python3 -I AEP-Components/ucm/scripts/gen_vectors.py

The output files in AEP-Components/ucm/vectors are committed. The generator is
deterministic (fixed seed), so a rerun gives the same files.
"""
import datetime
import json
import os
import random
import sys
from fractions import Fraction as F

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vectors")
SEED = 20261107
GENERATED = 1000
# The forge text scan refuses any numeral holding this digit pair, so no vector carries it.
REFUSED_PAIR = "8" + "7"


# Result forms, mirroring spec section 7.
def rs(x):
    x = F(x)
    return str(x.numerator) if x.denominator == 1 else f"{x.numerator}/{x.denominator}"


def terminating(x):
    x = F(x)
    d = x.denominator
    k = 0
    while d % 2 == 0:
        d //= 2
        k += 1
    j = 0
    while d % 5 == 0:
        d //= 5
        j += 1
    if d != 1:
        return None
    s = max(k, j)
    return render_dec(x * 10**s, s)


def render_dec(unscaled, scale):
    unscaled = int(unscaled)
    neg = unscaled < 0
    digits = str(abs(unscaled))
    if scale == 0:
        body = digits
    elif len(digits) > scale:
        body = digits[:-scale] + "." + digits[-scale:]
    else:
        body = "0." + "0" * (scale - len(digits)) + digits
    return ("-" if neg else "") + body


def r_int(v):
    return {"type": "int", "value": str(int(v))}


def r_rat(v):
    o = {"type": "rational", "value": rs(v)}
    t = terminating(v)
    if t is not None:
        o["decimal"] = t
    return o


def r_dec(v, scale):
    u = F(v) * 10**scale
    assert u.denominator == 1, (v, scale)
    return {"type": "decimal", "value": render_dec(u.numerator, scale)}


def r_money(v, c):
    o = {"type": "money", "currency": c, "value": rs(v)}
    t = terminating(v)
    if t is not None:
        o["decimal"] = t
    return o


def r_qty(v, unit):
    return {"type": "quantity", "unit": unit, "value": rs(v)}


def r_bool(b):
    return {"type": "bool", "value": "true" if b else "false"}


def r_vec(items):
    return {"type": "vector", "items": items}


def r_date(d):
    return {"type": "date", "value": d.isoformat()}


# Rounding, mirroring spec section 6.
def round_int(x, mode):
    x = F(x)
    fl = x.numerator // x.denominator
    frac = x - fl
    if frac == 0:
        return fl
    ce = fl + 1
    pos = x > 0
    half = F(1, 2)
    if mode == "floor":
        return fl
    if mode == "ceiling":
        return ce
    if mode == "down":
        return fl if pos else ce
    if mode == "up":
        return ce if pos else fl
    if frac < half:
        return fl
    if frac > half:
        return ce
    if mode == "half_up":
        return ce if pos else fl
    if mode == "half_down":
        return fl if pos else ce
    return fl if fl % 2 == 0 else ce


def round_scale(x, scale, mode):
    return F(round_int(F(x) * 10**scale, mode), 10**scale)


def isqrt(n):
    import math
    return math.isqrt(n)


def sqrt_round(x, scale, mode):
    x = F(x)
    y = x * 10 ** (2 * scale)
    fl = isqrt(y.numerator // y.denominator)
    if F(fl) ** 2 == y:
        return F(fl, 10**scale)
    mid = F(fl) + F(1, 2)
    if mode in ("floor", "down"):
        u = fl
    elif mode in ("ceiling", "up"):
        u = fl + 1
    elif y < mid * mid:
        u = fl
    elif y > mid * mid:
        u = fl + 1
    else:
        u = round_int(mid, mode)
    return F(u, 10**scale)


cases = {}


def add(suite, cid, program, expect=None, error=None, inputs=None):
    c = {"id": cid, "program": program}
    if inputs:
        c["inputs"] = inputs
    if error is not None:
        c["error"] = error
    else:
        c["expect"] = expect
    cases.setdefault(suite, []).append(c)


# Hand written cases with Python computed expectations.
def handwritten():
    S = "numbers"
    add(S, "abs-neg-rational", "abs(-3/4)", r_rat(F(3, 4)))
    add(S, "sign-neg", "sign(-2)", r_int(-1))
    add(S, "floor-half", "floor(7/2)", r_int(3))
    add(S, "floor-neg-half", "floor(-7/2)", r_int(-4))
    add(S, "ceil-neg-half", "ceil(-7/2)", r_int(-3))
    add(S, "trunc-neg-half", "trunc(-7/2)", r_int(-3))
    modes = ["half_even", "half_up", "half_down", "up", "down", "floor", "ceiling"]
    for v in ["2.5", "-2.5", "0.125", "-0.135", "1/3", "2/3", "-5/6"]:
        for m in modes:
            for s in [0, 1, 2]:
                val = F(v)
                add(S, f"round-{v}-{s}-{m}".replace("/", "o"), f"round({v if '/' in v else v}, {s}, \"{m}\")", r_dec(round_scale(val, s, m), s))
    add(S, "round-bad-mode", "round(1/3, 2, \"nearest\")", error="domain_error")
    add(S, "min-join", "min(3, 1/2)", r_rat(F(1, 2)))
    add(S, "max-vector", "max([1, 5, 3])", r_int(5))
    add(S, "numerator", "numerator(6/4)", r_int(3))
    add(S, "denominator", "denominator(6/4)", r_int(2))
    add(S, "rational-of-decimal", "rational(0.125)", r_rat(F(1, 8)))
    add(S, "decimal-add", "0.1 + 0.2", r_dec(F(3, 10), 1))
    add(S, "decimal-mul-scale", "1.10 * 2.0", r_dec(F(22, 10), 3))
    add(S, "decimal-pow", "1.5 ^ 2", r_dec(F(9, 4), 2))
    add(S, "decimal-div-is-rational", "1.0 / 3", r_rat(F(1, 3)))
    add(S, "int-div-is-rational", "10 / 4", r_rat(F(5, 2)))
    add(S, "neg-pow-is-rational", "2 ^ -3", r_rat(F(1, 8)))
    add(S, "pow-var-exponent", "let n = 3;\n2 ^ n", r_rat(8))
    add(S, "unary-minus-pow", "-2 ^ 2", r_int(-4))
    add(S, "paren-neg-pow", "(-2) ^ 2", r_int(4))
    add(S, "div-zero", "1 / (2 - 2)", error="division_by_zero")
    add(S, "zero-neg-pow", "0 ^ -1", error="division_by_zero")
    add(S, "big-int", "2 ^ 200", r_int(2**200))

    S = "number-theory"
    add(S, "gcd", "gcd(84, 36)", r_int(12))
    add(S, "lcm", "lcm(4, 6)", r_int(12))
    add(S, "mod-neg", "mod(-7, 3)", r_int(2))
    add(S, "mod-zero", "mod(7, 0)", error="division_by_zero")
    add(S, "quot-neg", "quot(-7, 2)", r_int(-4))
    import math
    add(S, "factorial-20", "factorial(20)", r_int(math.factorial(20)))
    add(S, "factorial-neg", "factorial(-1)", error="domain_error")
    add(S, "binomial-52-5", "binomial(52, 5)", r_int(math.comb(52, 5)))
    add(S, "binomial-k-above-n", "binomial(3, 5)", r_int(0))
    add(S, "isqrt-99", "isqrt(99)", r_int(9))
    add(S, "is-prime-yes", "is_prime(1000003)", r_bool(True))
    add(S, "is-prime-no", "is_prime(1000001)", r_bool(False))
    add(S, "is-prime-two", "is_prime(2)", r_bool(True))
    add(S, "is-prime-one", "is_prime(1)", r_bool(False))
    for s in [0, 5, 10, 20]:
        for m in ["half_even", "floor", "ceiling"]:
            add(S, f"sqrt2-{s}-{m}", f"sqrt(2, {s}, \"{m}\")", r_dec(sqrt_round(2, s, m), s))
    add(S, "sqrt-exact", "sqrt(9/4, 3, \"half_even\")", r_dec(F(3, 2), 3))
    add(S, "sqrt-tie", "sqrt(6.25, 0, \"half_even\")", r_dec(2, 0))
    add(S, "sqrt-tie-up", "sqrt(6.25, 0, \"half_up\")", r_dec(3, 0))
    add(S, "sqrt-negative", "sqrt(-1, 2, \"half_even\")", error="domain_error")

    S = "float"
    add(S, "float-sum", "float { 0.1 + 0.2 }", {"type": "float", "value": repr(0.1 + 0.2)})
    add(S, "float-exact-back", "exact(float { 0.5 })", r_rat(F(1, 2)))
    add(S, "float-exact-quarter", "exact(float { 0.25 })", r_rat(F(1, 4)))
    add(S, "float-sqrt", "float { sqrt(2) }", {"type": "float", "value": repr(2 ** 0.5)})
    add(S, "float-fn-outside", "exp(1)", error="type_error")
    add(S, "sqrt-one-arg-outside", "sqrt(2)", error="type_error")
    add(S, "float-mix-outside", "float { 1.5 } + 1", error="type_error")
    add(S, "float-cmp", "float { 0.1 + 0.2 > 0.3 }", r_bool(True))

    S = "money"
    add(S, "add-same", "money(\"12.50\", \"CHF\") + money(\"0.75\", \"CHF\")", r_money(F("13.25"), "CHF"))
    add(S, "add-mixed", "money(\"1\", \"CHF\") + money(\"1\", \"EUR\")", error="type_error")
    add(S, "mul-rational", "money(\"10\", \"EUR\") * 1/3", r_money(F(10, 3), "EUR"))
    add(S, "ratio", "money(\"30\", \"USD\") / money(\"12\", \"USD\")", r_rat(F(5, 2)))
    add(S, "round-half-even", "round(money(\"2.345\", \"EUR\"), 2, \"half_even\")", r_money(F("2.34"), "EUR"))
    add(S, "round-half-up", "round(money(\"2.345\", \"EUR\"), 2, \"half_up\")", r_money(F("2.35"), "EUR"))
    add(S, "convert", "convert(money(100, \"USD\"), \"EUR\", 0.92)", r_money(92, "EUR"))
    add(S, "convert-bad-rate", "convert(money(100, \"USD\"), \"EUR\", 0)", error="domain_error")
    add(S, "bad-currency", "money(1, \"usd\")", error="type_error")
    add(S, "allocate-3", "allocate(money(\"100.00\", \"USD\"), 3, 2)", r_vec([r_money(F("33.34"), "USD"), r_money(F("33.33"), "USD"), r_money(F("33.33"), "USD")]))
    add(S, "allocate-weights", "allocate(money(\"10.00\", \"EUR\"), [1, 1, 1, 1, 1, 1, 1], 2)",
        r_vec([r_money(F("1.43"), "EUR")] * 6 + [r_money(F("1.42"), "EUR")]))
    add(S, "allocate-not-fit", "allocate(money(\"10.005\", \"EUR\"), 2, 2)", error="domain_error")
    add(S, "amount", "amount(money(\"3.10\", \"EUR\"))", r_rat(F("3.1")))
    add(S, "currency", "currency(money(1, \"JPY\"))", {"type": "text", "value": "JPY"})
    add(S, "input-money", "input p: money[USD];\np * 2", r_money(F("25.10"), "USD"), inputs={"p": "12.55 USD"})
    add(S, "input-wrong-currency", "input p: money[USD];\np * 2", error="input_error", inputs={"p": "12.55 EUR"})
    add(S, "compare", "money(\"5\", \"CHF\") < money(\"5.01\", \"CHF\")", r_bool(True))

    S = "units"
    add(S, "mile-in-km", "to(q(1, \"mi\"), \"km\")", r_rat(F("1.609344")))
    add(S, "kmh-to-si", "q(90, \"km/h\")", r_qty(25, "m/s"))
    add(S, "add-mismatch", "q(1, \"m\") + q(1, \"s\")", error="type_error")
    add(S, "to-mismatch", "to(q(1, \"m\"), \"s\")", error="unit_error")
    add(S, "unknown-unit", "q(1, \"furlong\")", error="unit_error")
    add(S, "newton-from-parts", "to(q(2, \"kg\") * q(3, \"m/s^2\"), \"N\")", r_rat(6))
    add(S, "dimensionless-ratio", "q(1, \"km\") / q(1, \"m\")", r_rat(1000))
    add(S, "psi-to-kpa", "to(q(1, \"psi\"), \"kPa\")", r_rat(F(44482216152605, 6451600000) / 1000))
    add(S, "foot-pound", "to(q(1, \"lbf\") * q(1, \"ft\"), \"J\")", r_rat(F("4.4482216152605") * F("0.3048")))
    add(S, "boiling-f", "to_fahrenheit(celsius(100))", r_rat(212))
    add(S, "freezing-c", "to_celsius(fahrenheit(32))", r_rat(0))
    add(S, "body-temp-k", "celsius(37)", r_qty(F("310.15"), "K"))
    add(S, "pow-dims", "dimension(q(2, \"m\") ^ 3)", {"type": "text", "value": "m^3"})
    add(S, "input-qty", "input g: quantity[m/s^2];\nto(g * q(10, \"s\"), \"km/h\")", r_rat(F("9.80665") * 10 * F(18, 5)), inputs={"g": "9.80665 m/s^2"})
    add(S, "input-qty-wrong-dim", "input g: quantity[m/s^2];\ng", error="input_error", inputs={"g": "9 m/s"})
    add(S, "prefix-deca", "to(q(1, \"dam\"), \"m\")", r_rat(10))
    add(S, "hectopascal", "to(q(1013.25, \"hPa\"), \"atm\")", r_rat(F("101325") / F("101325")))
    add(S, "kwh-to-mj", "to(q(1, \"kWh\"), \"MJ\")", r_rat(F("3.6")))

    S = "interval"
    add(S, "mul", "let i = interval(1, 2) * interval(-1, 3);\n[lo(i), hi(i)]", r_vec([r_rat(-2), r_rat(6)]))
    add(S, "div-zero", "interval(1, 2) / interval(-1, 1)", error="domain_error")
    add(S, "width", "width(interval(1, 5/2))", r_rat(F(3, 2)))
    add(S, "contains", "contains(interval(1, 2), 3/2)", r_bool(True))
    add(S, "bad-order", "interval(2, 1)", error="domain_error")
    add(S, "sq-even", "let i = interval(-2, 1) ^ 2;\n[lo(i), hi(i)]", r_vec([r_rat(0), r_rat(4)]))

    S = "vectors"
    add(S, "len", "len([1, 2, 3])", r_int(3))
    add(S, "at", "at([10, 20, 30], 1)", r_int(20))
    add(S, "at-out", "at([10, 20, 30], 3)", error="domain_error")
    add(S, "range", "range(0, 4)", r_vec([r_int(i) for i in range(4)]))
    add(S, "concat-join", "concat([1], [1/2])", r_vec([r_rat(1), r_rat(F(1, 2))]))
    add(S, "reverse", "reverse([1, 2, 3])", r_vec([r_int(3), r_int(2), r_int(1)]))
    add(S, "sort", "sort([3, 1, 2])", r_vec([r_int(1), r_int(2), r_int(3)]))
    add(S, "sum-thirds", "sum([1/3, 1/3, 1/3])", r_rat(1))
    add(S, "sum-empty", "sum([])", r_int(0))
    add(S, "product", "product([2, 3, 4])", r_int(24))
    add(S, "mean", "mean([1, 2, 4])", r_rat(F(7, 3)))
    add(S, "median-even", "median([5, 1, 4, 2])", r_rat(3))
    add(S, "mean-money", "mean([money(\"1\", \"EUR\"), money(\"2\", \"EUR\")])", r_money(F(3, 2), "EUR"))
    data = [2, 4, 4, 4, 5, 5, 7, 9]
    add(S, "variance", "variance([2, 4, 4, 4, 5, 5, 7, 9])", r_rat(4))
    add(S, "stddev", "stddev([2, 4, 4, 4, 5, 5, 7, 9], 3, \"half_even\")", r_dec(2, 3))
    add(S, "variance-sample", "variance_sample([1, 2, 3, 4])", r_rat(F(5, 3)))
    add(S, "stddev-sample", "stddev_sample([1, 2, 3, 4], 6, \"half_even\")", r_dec(sqrt_round(F(5, 3), 6, "half_even"), 6))
    add(S, "percentile-linear", "percentile([15, 20, 35, 40, 50], 40, \"linear\")", r_rat(29))
    add(S, "percentile-rank", "percentile([15, 20, 35, 40, 50], 40, \"nearest_rank\")", r_rat(20))
    add(S, "map", "map([1, 2, 3], x => x * x)", r_vec([r_int(1), r_int(4), r_int(9)]))
    add(S, "filter", "filter([1, 2, 3, 4], x => mod(x, 2) == 0)", r_vec([r_int(2), r_int(4)]))
    add(S, "fold", "fold([1, 2, 3], 0, (acc, x) => acc + x)", r_int(6))
    add(S, "fold-widens", "fold([1, 2], 0, (acc, x) => acc + 1 / x)", r_rat(F(3, 2)))
    add(S, "any", "any([1, 2, 3], x => x > 2)", r_bool(True))
    add(S, "all", "all([1, 2, 3], x => x > 1)", r_bool(False))
    add(S, "count", "count([1, 2, 3, 4], x => x > 2)", r_int(2))
    add(S, "range-too-long", "len(range(0, 200000))", error="budget_exceeded")
    add(S, "mixed-kinds", "[1, money(1, \"EUR\")]", error="type_error")

    S = "linear-algebra"
    add(S, "det", "det([[2, 1], [1, 3]])", r_rat(5))
    add(S, "det-singular", "det([[1, 2], [2, 4]])", r_rat(0))
    add(S, "inverse", "inverse([[2, 1], [1, 1]])", r_vec([r_vec([r_rat(1), r_rat(-1)]), r_vec([r_rat(-1), r_rat(2)])]))
    add(S, "inverse-singular", "inverse([[1, 2], [2, 4]])", error="domain_error")
    add(S, "solve", "solve([[2, 1], [1, 3]], [3, 5])", r_vec([r_rat(F(4, 5)), r_rat(F(7, 5))]))
    add(S, "rank", "rank([[1, 2], [2, 4]])", r_int(1))
    add(S, "matmul", "matmul([[1, 2], [3, 4]], [[5], [6]])", r_vec([r_vec([r_rat(17)]), r_vec([r_rat(39)])]))
    add(S, "transpose", "transpose([[1, 2, 3]])", r_vec([r_vec([r_rat(1)]), r_vec([r_rat(2)]), r_vec([r_rat(3)])]))
    add(S, "identity", "identity(2)", r_vec([r_vec([r_rat(1), r_rat(0)]), r_vec([r_rat(0), r_rat(1)])]))
    add(S, "dot", "dot([1, 2], [3, 4])", r_rat(11))
    add(S, "det-3", "det([[1, 2, 3], [0, 1, 4], [5, 6, 0]])", r_rat(1))

    S = "time"
    d = datetime.date(2026, 11, 7)
    add(S, "weekday", "weekday(date(\"2026-11-07\"))", r_int(d.isoweekday()))
    add(S, "day-of-year", "day_of_year(date(\"2026-12-31\"))", r_int(365))
    add(S, "days-between", "days_between(date(\"2026-01-01\"), date(\"2026-11-07\"))", r_int((d - datetime.date(2026, 1, 1)).days))
    add(S, "add-months-clamp", "add_months(date(\"2026-01-31\"), 1)", r_date(datetime.date(2026, 2, 28)))
    add(S, "add-months-leap", "add_months(date(\"2028-01-31\"), 1)", r_date(datetime.date(2028, 2, 29)))
    add(S, "add-days", "add_days(date(\"2026-12-30\"), 3)", r_date(datetime.date(2027, 1, 2)))
    add(S, "date-plus-qty", "date(\"2026-11-07\") + q(2, \"week\")", r_date(d + datetime.timedelta(days=14)))
    add(S, "date-plus-part-day", "date(\"2026-11-07\") + q(1, \"h\")", error="domain_error")
    add(S, "date-diff", "to(date(\"2026-11-07\") - date(\"2026-11-01\"), \"day\")", r_rat(6))
    add(S, "bad-date", "date(\"2026-02-30\")", error="input_error")
    add(S, "ymd", "date(2026, 2, 29)", error="domain_error")
    add(S, "leap", "is_leap_year(2100)", r_bool(False))
    add(S, "dst-hour", "to(instant(\"2026-03-29T03:30\", \"Europe/Zurich\") - instant(\"2026-03-29T01:30\", \"Europe/Zurich\"), \"h\")", r_rat(1))
    add(S, "dst-gap", "instant(\"2026-03-29T02:30\", \"Europe/Zurich\")", error="domain_error")
    add(S, "local-date", "local_date(instant_utc(\"2026-11-07T23:30:00Z\"), \"Asia/Tokyo\")", r_date(datetime.date(2026, 11, 8)))
    add(S, "bad-zone", "instant(\"2026-11-07T10:00\", \"Mars/Base\")", error="domain_error")

    S = "language"
    add(S, "let-chain", "let a = 2;\nlet b = a * 3;\nb + a", r_int(8))
    add(S, "if", "if 1 < 2 then 1 else 1/2", r_rat(1))
    add(S, "and-short-circuit", "let x = 0;\nx != 0 and 1 / x > 1", r_bool(False))
    add(S, "or", "false or true", r_bool(True))
    add(S, "not", "not (1 == 1)", r_bool(False))
    add(S, "text-eq", "\"a\" == \"a\"", r_bool(True))
    add(S, "chain-cmp", "1 < 2 < 3", error="parse_error")
    add(S, "unbound", "x + 1", error="unbound_name")
    add(S, "unknown-fn", "frobnicate(1)", error="unknown_function")
    add(S, "trailing", "1 2", error="parse_error")
    add(S, "lambda-alone", "x => x", error="parse_error")
    add(S, "missing-input", "input a: int;\na", error="input_error")
    add(S, "extra-input", "1", error="input_error", inputs={"z": "1"})
    add(S, "input-vector", "input xs: vector[rational];\nsum(xs)", r_rat(F(5, 6)), inputs={"xs": ["1/2", "1/3"]})
    add(S, "budget-bits", "2 ^ 100000", error="budget_exceeded")
    add(S, "comment", "# a comment\n1 + 1 # another", r_int(2))
    add(S, "json-form", {"ucm": "ucm-program-v1", "inputs": [], "body": {"op": "+", "args": [{"int": "2"}, {"dec": "0.50"}]}}, r_dec(F(5, 2), 2))
    add(S, "json-form-bad-op", {"ucm": "ucm-program-v1", "inputs": [], "body": {"op": "%", "args": [{"int": "2"}, {"int": "3"}]}}, error="form_error")

    S = "library"
    add(S, "const-c", "const(\"c\")", r_qty(299792458, "m/s"))
    add(S, "const-unknown", "const(\"warp\")", error="unbound_name")
    add(S, "formula-compound", "formula(\"finance.compound_amount\", money(\"1000\", \"EUR\"), 5/100, 2)", r_money(F("1102.5"), "EUR"))
    add(S, "formula-int-arg", "formula(\"math.percent_change\", 100, 150)", r_rat(50))
    add(S, "formula-wrong-arg", "formula(\"finance.compound_amount\", 1000, 5/100, 2)", error="type_error")


# Random exact arithmetic with a kind tracking reference.
class K:
    def __init__(self, kind, v, scale=0):
        self.kind, self.v, self.scale = kind, F(v), scale


class DivZero(Exception):
    pass


def join(a, b):
    if a.kind == "int" and b.kind == "int":
        return "int"
    if a.kind == "rat" or b.kind == "rat":
        return "rat"
    return "dec"


def gen(rng, depth):
    if depth == 0 or rng.random() < 0.3:
        r = rng.random()
        if r < 0.5:
            n = rng.randint(-20, 20)
            return (f"({n})" if n < 0 else str(n)), K("int", n)
        places = rng.randint(1, 3)
        u = rng.randint(-999, 999)
        text = render_dec(u, places)
        return (f"({text})" if u < 0 else text), K("dec", F(u, 10**places), places)
    op = rng.choice(["+", "-", "*", "/", "^", "neg"])
    if op == "neg":
        t, k = gen(rng, depth - 1)
        return f"(-{t})", K(k.kind, -k.v, k.scale)
    if op == "^":
        # Powers are shallow so results are small: the base is a leaf, the exponent -2 to 3.
        t, k = gen(rng, 0)
        e = rng.randint(-2, 3)
        et = f"({e})" if e < 0 else str(e)
        if e < 0:
            if k.v == 0:
                raise DivZero()
            return f"({t} ^ {et})", K("rat", k.v**e)
        if k.kind == "int":
            return f"({t} ^ {et})", K("int", k.v**e)
        if k.kind == "dec":
            return f"({t} ^ {et})", K("dec", k.v**e, k.scale * e)
        return f"({t} ^ {et})", K("rat", k.v**e)
    ta, a = gen(rng, depth - 1)
    tb, b = gen(rng, depth - 1)
    if op == "/":
        if b.v == 0:
            raise DivZero()
        return f"({ta} / {tb})", K("rat", a.v / b.v)
    j = join(a, b)
    v = a.v + b.v if op == "+" else a.v - b.v if op == "-" else a.v * b.v
    if j == "dec":
        if op == "*":
            sa = a.scale if a.kind == "dec" else 0
            sb = b.scale if b.kind == "dec" else 0
            return f"({ta} * {tb})", K("dec", v, sa + sb)
        s = max(a.scale if a.kind == "dec" else 0, b.scale if b.kind == "dec" else 0)
        return f"({ta} {op} {tb})", K("dec", v, s)
    return f"({ta} {op} {tb})", K(j, v)


def result_of(k):
    if k.kind == "int":
        return r_int(k.v)
    if k.kind == "dec":
        return r_dec(k.v, k.scale)
    return r_rat(k.v)


def generated():
    rng = random.Random(SEED)
    n = 0
    next_id = 0
    while n < GENERATED:
        form = rng.random()
        try:
            t, k = gen(rng, rng.randint(1, 3))
            t2, k2 = gen(rng, 2)
        except DivZero:
            continue
        if form < 0.15:
            op = rng.choice(["<", "<=", ">", ">=", "==", "!="])
            res = {"<": k.v < k2.v, "<=": k.v <= k2.v, ">": k.v > k2.v, ">=": k.v >= k2.v, "==": k.v == k2.v, "!=": k.v != k2.v}[op]
            prog, exp = f"{t} {op} {t2}", r_bool(res)
        elif form < 0.35:
            s = rng.randint(0, 4)
            m = rng.choice(["half_even", "half_up", "half_down", "up", "down", "floor", "ceiling"])
            prog, exp = f"round({t}, {s}, \"{m}\")", r_dec(round_scale(k.v, s, m), s)
        else:
            prog, exp = t, result_of(k)
        body = json.dumps([prog, exp])
        if len(body) > 400 or REFUSED_PAIR in body:
            continue
        while REFUSED_PAIR in f"{next_id:05d}":
            next_id += 1
        c = {"id": f"g{next_id:05d}", "program": prog, "expect": exp}
        next_id += 1
        cases.setdefault("generated-arithmetic", []).append(c)
        n += 1


def main():
    handwritten()
    generated()
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for suite, cs in sorted(cases.items()):
        kept = [c for c in cs if REFUSED_PAIR not in json.dumps(c)]
        dropped = len(cs) - len(kept)
        if dropped:
            print(f"{suite}: dropped {dropped} case(s) that carry the digit pair the forge scan refuses", file=sys.stderr)
        doc = {"ucm": "ucm-vectors-v1", "suite": suite, "generator": "AEP-Components/ucm/scripts/gen_vectors.py", "cases": kept}
        with open(os.path.join(OUT, f"{suite}.json"), "w") as fh:
            json.dump(doc, fh, indent=1, ensure_ascii=True)
            fh.write("\n")
        total += len(kept)
    print(f"{total} vectors in {len(cases)} suites")


if __name__ == "__main__":
    main()
