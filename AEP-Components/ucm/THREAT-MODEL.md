# UCM threat model

This section belongs in the root THREAT_MODEL.md once that file lands. Every mitigation names the test that holds it.

## Assets

- The signing key of a UCM node (UCM_DATA/ucm-sign.key, mode 0600).
- The trust list of Admit (AEP_UCM_TRUSTED_KEYS).
- The truth of a number that an action reports as computed.

## Trust boundaries

- Agent to UCM service: programs and inputs are untrusted.
- Agent to UCB: action payloads and their receipts are untrusted. The task manifest names the computed fields.
- UCM service to Admit: only the signed receipt crosses. Admit trusts no field of a receipt before the checks of UCM-R-082.

## Threats and mitigations

| Threat | Mitigation | Test |
|--------|------------|------|
| Agent reports a guessed number | Admit under strict needs a valid receipt per computed field | ucm_redteam: no receipt, receipts missing, wrong pointer |
| Receipt result edited | receipt_id and signature cover every field | ucm_redteam: result edited, resealed without key; ucm-receipt tampering_is_refused |
| Receipt from another calculation reused | The field must equal the signed result | ucm_redteam: stale receipt, receipts swapped |
| Forged receipt with a fresh key | Signer must be in AEP_UCM_TRUSTED_KEYS | ucm_redteam: untrusted signer, public key swapped |
| Agent narrows the computed fields | UCB replaces ucm.computed_fields of the foreign payload with the manifest list | ucb bridge computed_fields_come_from_the_manifest_only, computed_fields_bind_on_the_translated_foreign_payload |
| Text hidden from the PII and writing rules inside a receipt | Only a receipt signed by a trusted key is read as its agent view, which keeps literals, names, inputs and result. Any other receipt is read whole | ucm_claims findings_cover_every_kind |
| Trivial program that echoes the number | A text result never backs a field. For wraps that need more, AEP_UCM_LIBRARY_ONLY_WRAPS accepts reviewed library formulas only | ucm_redteam: text echo, library only wrap |
| Budget exhaustion of the service | Step, size, length and time budget, 1 MiB body limit, four evaluations at a time | props, http limits_and_errors |
| Budget exhaustion of Admit by replay | Replay is opt in and capped at 1000000 steps | ucm_redteam replay |
| Deep nesting to exhaust the stack | Nesting above 64 is refused | parse errors_have_positions |
| Path traversal through receipt ids | Ids must match ucmr_ plus 32 lowercase hex digits | http eval_verify_and_auth |
| Key theft from the host | Key file mode 0600 under UCM_DATA; the trust list names keys, so a replaced key is untrusted until the operator lists it | ucm-receipt key_file_round_trip |
| Model in the lookup writes a result | Only catalog ids from the tier one shortlist survive | lookup ranker_output_is_filtered, reply_holds_catalog_entries_only |
| Wrong library entry | Every constant cites its source, every formula ships vectors, the library digest is in every receipt that used it | library_vectors |
| Silent float error | Floats only in float { } and float_used in the receipt | float vectors |

## Residual risk

- A receipt proves that UCM computed a number from a program and inputs. It does not prove that the program models the task correctly. Reviewers read the program in the receipt. Library only wraps narrow this to reviewed formulas.
- A stolen node key signs anything until the operator removes it from the trust list.
- Inputs such as exchange rates come from the caller. The receipt records them and does not vouch for them.
