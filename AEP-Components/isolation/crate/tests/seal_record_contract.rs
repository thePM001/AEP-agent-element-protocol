// The seal record contract test for the aep-isolation crate.
//
// This crate records one process against one isolation specification and it
// applies no restriction of its own, because it makes no system call. The host
// sandbox under AEP-CAW carries the real restrictions and it is the only
// enforcer in the shipped stack. A seal on its own is a record and not
// confinement.

use aep_isolation::{isolation_spec_digest, seal_holds, seal_once, seal_process, IsolationSpec};

#[test]
fn a_seal_records_the_process_and_the_specification() {
    let spec = IsolationSpec::default();
    let sealed = seal_process(5100, &spec, 7).expect("seal");
    assert_eq!(sealed.pid, 5100);
    assert_eq!(sealed.spec_digest.as_str(), isolation_spec_digest(&spec).as_str());
    assert_eq!(seal_holds(&sealed, 5100, &spec), true);
    assert_eq!(seal_holds(&sealed, 5101, &spec), false);
}

#[test]
fn the_contract_records_a_seal_and_it_does_not_confine() {
    let spec = IsolationSpec::default();
    let mut seen = Vec::new();
    let sealed = seal_once(&mut seen, 5200, &spec, 11).expect("one seal");
    assert_eq!(sealed.is_sealed(), true);
    assert_eq!(seal_once(&mut seen, 5200, &spec, 12).is_err(), true);
    // Nothing in this crate applies the specification. The host sandbox applies
    // it at run time, so this crate stays a record.
    assert_eq!(seen.len(), 1);
}
