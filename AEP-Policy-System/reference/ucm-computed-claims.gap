{
  "address": {
    "domain": "aep.reference.ucm",
    "id": "ucm-computed-claims.v1"
  },
  "pattern": {
    "guard": "true",
    "input": {
      "type": "object",
      "schema": "aep.reference.ucm.computed-claims-input.v1"
    },
    "constraints": [
      "every_computed_field_carries_a_ucm_receipt",
      "every_ucm_receipt_is_signed_by_a_trusted_node",
      "every_computed_field_equals_its_receipt_result"
    ],
    "invariants": [
      {
        "expr": "ucm_receipt_present",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "ucm_receipt",
        "description": "Every field that payload.ucm.computed_fields names carries a receipt in payload.ucm.receipts. A missing receipt is deny kind UcmReceiptMissing."
      },
      {
        "expr": "ucm_receipt_valid",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "ucm_receipt",
        "description": "Every receipt has a valid ML-DSA-65 signature from a key in AEP_UCM_TRUSTED_KEYS and passes replay when AEP_UCM_RECEIPT_VERIFY is replay. A failure is deny kind UcmReceiptInvalid."
      },
      {
        "expr": "ucm_result_matches",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "ucm_receipt",
        "description": "Every computed field equals the result its receipt signs. A difference is deny kind UcmResultMismatch."
      }
    ]
  },
  "action": {
    "type": "template",
    "content": "Check every computed field of an action against its signed UCM receipt. Write DENY on a missing, invalid or mismatched receipt."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.ucm",
    "version": "1.0.0",
    "stability": "stable",
    "aep_version": "2.9.0"
  },
  "extensions": {
    "aep": {
      "profile_env": "AEP_UCM_RECEIPT_PROFILE",
      "profiles": "off (default), warn, strict",
      "trusted_keys_env": "AEP_UCM_TRUSTED_KEYS",
      "verify_env": "AEP_UCM_RECEIPT_VERIFY",
      "library_only_wraps_env": "AEP_UCM_LIBRARY_ONLY_WRAPS",
      "component": "ucm"
    }
  }
}
