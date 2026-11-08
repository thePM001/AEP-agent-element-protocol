//! Property tests: algebraic laws of exact arithmetic, rounding laws, square root bounds,
//! unit laws and the text and JSON round trips of the program form.

use aep_ucm_core::{evaluate, load_program, parse::parse_program, Library, Limits, Program};
use proptest::prelude::*;
use serde_json::{json, Value};

fn lib() -> Library {
    Library::builtin().expect("library")
}

fn run(src: &str) -> Value {
    let p = load_program(Some(src), None).expect("parse");
    evaluate(&p, &json!({}), Limits::DEFAULT, &lib()).expect("eval").result_json()
}

fn run_bool(src: &str) -> bool {
    run(src)["value"] == "true"
}

/// An exact number literal in text form: an int, a fraction or a decimal.
fn num() -> impl Strategy<Value = String> {
    prop_oneof![
        (-1000i64..1000).prop_map(|n| format!("({n})")),
        (-1000i64..1000, 1i64..500).prop_map(|(n, d)| format!("(({n}) / {d})")),
        (-100_000i64..100_000, 1u32..5).prop_map(|(u, s)| {
            let neg = u < 0;
            let digits = format!("{:0width$}", u.unsigned_abs(), width = s as usize + 1);
            let (a, b) = digits.split_at(digits.len() - s as usize);
            format!("({}{a}.{b})", if neg { "-" } else { "" })
        }),
    ]
}

const MODES: [&str; 7] = ["half_even", "half_up", "half_down", "up", "down", "floor", "ceiling"];

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn addition_and_multiplication_commute(a in num(), b in num()) {
        { let ok = run_bool(&format!("{a} + {b} == {b} + {a}")); prop_assert!(ok, "law failed"); }
        { let ok = run_bool(&format!("{a} * {b} == {b} * {a}")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn addition_and_multiplication_associate(a in num(), b in num(), c in num()) {
        { let ok = run_bool(&format!("({a} + {b}) + {c} == {a} + ({b} + {c})")); prop_assert!(ok, "law failed"); }
        { let ok = run_bool(&format!("({a} * {b}) * {c} == {a} * ({b} * {c})")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn multiplication_distributes(a in num(), b in num(), c in num()) {
        { let ok = run_bool(&format!("{a} * ({b} + {c}) == {a} * {b} + {a} * {c}")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn subtraction_inverts_addition(a in num(), b in num()) {
        { let ok = run_bool(&format!("({a} + {b}) - {b} == {a}")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn division_inverts_multiplication(a in num(), b in num()) {
        prop_assume!(!run_bool(&format!("{b} == 0")));
        { let ok = run_bool(&format!("({a} * {b}) / {b} == {a}")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn rounding_brackets_the_value(a in num(), s in 0u32..6, m in 0usize..7) {
        let mode = MODES[m];
        { let ok = run_bool(&format!("round({a}, {s}, \"floor\") <= {a} and {a} <= round({a}, {s}, \"ceiling\")")); prop_assert!(ok, "law failed"); }
        // Every mode lands on floor or ceiling. A half mode lands within half a unit.
        let unit = format!("(1 / 10 ^ {s})");
        { let ok = run_bool(&format!("let r = round({a}, {s}, \"{mode}\");\nr == round({a}, {s}, \"floor\") or r == round({a}, {s}, \"ceiling\")")); prop_assert!(ok, "law failed"); }
        if mode.starts_with("half") {
            { let ok = run_bool(&format!("abs(round({a}, {s}, \"{mode}\") - {a}) <= {unit} / 2")); prop_assert!(ok, "law failed"); }
        }
    }

    #[test]
    fn rounding_is_idempotent(a in num(), s in 0u32..6, m in 0usize..7) {
        let mode = MODES[m];
        { let ok = run_bool(&format!("let r = round({a}, {s}, \"{mode}\");\nround(r, {s}, \"{mode}\") == r")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn sqrt_floor_bounds(n in 0u64..10_000_000, s in 0u32..8) {
        let unit = format!("(1 / 10 ^ {s})");
        { let ok = run_bool(&format!("let r = sqrt({n}, {s}, \"floor\");\nr * r <= {n} and (r + {unit}) * (r + {unit}) > {n}")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn unit_round_trip(a in num()) {
        { let ok = run_bool(&format!("to(q({a}, \"km\"), \"m\") == {a} * 1000")); prop_assert!(ok, "law failed"); }
        { let ok = run_bool(&format!("to(q({a}, \"mi\"), \"ft\") == {a} * 5280")); prop_assert!(ok, "law failed"); }
        { let ok = run_bool(&format!("to_celsius(fahrenheit({a} * 9 / 5 + 32)) == {a}")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn money_allocation_adds_up(cents in 0i64..10_000_000, parts in 1i64..40) {
        let whole = cents / 100;
        let frac = cents % 100;
        { let ok = run_bool(&format!("let m = money(\"{whole}.{frac:02}\", \"EUR\");\nsum(allocate(m, {parts}, 2)) == m")); prop_assert!(ok, "law failed"); }
    }

    #[test]
    fn program_round_trips(a in num(), b in num(), c in num()) {
        let src = format!("input x: rational;\nlet y = {a} * x + {b};\nif y > {c} then round(y, 2, \"half_even\") else round({c}, 2, \"half_even\")");
        let p = parse_program(&src).expect("parse");
        let again = parse_program(&p.to_text()).expect("reparse");
        prop_assert_eq!(&p, &again);
        let j = p.to_json();
        prop_assert_eq!(&Program::from_json(&j).expect("json"), &p);
        prop_assert_eq!(aep_ucm_core::program_hash(&p).expect("hash"), aep_ucm_core::program_hash(&again).expect("hash"));
    }
}
