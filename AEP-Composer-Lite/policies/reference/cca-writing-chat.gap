{
  "address": {
    "domain": "aep.cca.writing",
    "id": "chat-release.v1"
  },
  "pattern": {
    "guard": "true",
    "constraints": [
      "no_em_dashes",
      "no_en_dashes",
      "no_dash_substitutes",
      "no_double_hyphen",
      "no_oxford_comma",
      "space_before_spaced_signs",
      "spaced_sign_word_space",
      "attach_comma_semicolon",
      "attach_double_colon",
      "cca_declarative_closing",
      "cca_greeting_length",
      "cca_greeting_no_slang_echo",
      "cca_greeting_no_canvas_inventory",
      "cca_greeting_no_deployment_slogan"
    ],
    "invariants": [
      {
        "expr": "no_em_dashes",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Zero em-dashes U+2014"
      },
      {
        "expr": "no_en_dashes",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Zero en-dashes U+2013"
      },
      {
        "expr": "no_oxford_comma",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Zero Oxford commas"
      },
      {
        "expr": "space_before_spaced_signs",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Single space before ? ! [ ] ( ) (write building ? or word [ note ] not building? or word[note])"
      },
      {
        "expr": "spaced_sign_word_space",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Space after ? ! [ ] ( ) before the next word or bracket content"
      },
      {
        "expr": "attach_comma_semicolon",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Comma and semicolon attach directly (foo, bar not foo , bar)"
      },
      {
        "expr": "attach_double_colon",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "Double colon attaches directly (word::field not word ::field)"
      },
      {
        "expr": "cca_declarative_closing",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "range_check",
        "description": "CCA chat ends with declarative prose not a closing question"
      }
    ]
  },
  "action": {
    "type": "template",
    "content": "Enforce EPSCOM writing.gap on all CCA chat output before hyperlattice release."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "gapc-validated",
    "version": "1.0.0",
    "stability": "stable",
    "aspect": "objective",
    "trust_ring": "system"
  }
}