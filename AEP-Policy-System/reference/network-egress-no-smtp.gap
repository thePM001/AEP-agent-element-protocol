{
  "address": {
    "domain": "aep.reference.security",
    "id": "network-egress-no-smtp.v1"
  },
  "pattern": {
    "guard": "true",
    "input": {
      "type": "object",
      "schema": "aep.reference.security.network-egress-scan-schema.v1"
    },
    "output": {
      "type": "object",
      "schema": "aep.reference.security.scan-result-schema.v1"
    },
    "constraints": [
      "forbid_smtp_transport",
      "forbid_mail_submission_ports",
      "forbid_mail_client_libraries",
      "require_runtime_mail_port_proof"
    ],
    "invariants": [
      {
        "expr": "no_smtp_client_in_code",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "mail_transport_scanner",
        "description": "Code and agent tooling must not introduce SMTP clients or mail transport libraries (for example nodemailer, smtplib, sendmail, createTransport, PHPMailer, SES SendRawEmail)."
      },
      {
        "expr": "no_mail_submission_ports",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "network_port_scanner",
        "description": "Agents and product services must not open TCP ports 25, 465 or 587 (SMTP and message submission)."
      },
      {
        "expr": "no_smtp_url_scheme",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "mail_transport_scanner",
        "description": "smtp:// and smtps:// URL schemes are forbidden in governed agent actions and product configuration."
      },
      {
        "expr": "runtime_no_mail_port_sockets",
        "lang": "gapdsl",
        "severity": "hard",
        "validator": "runtime_socket_scanner",
        "description": "Before session completion, runtime must show no listeners or established sockets on TCP 25, 465 or 587."
      }
    ]
  },
  "action": {
    "type": "reference",
    "address": {
      "domain": "aep.reference.security",
      "id": "network-egress-scan-engine.v1"
    }
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "AEP 2.8 Policy Lattice Reference",
    "version": "1.0.0",
    "stability": "stable",
    "trust_ring": "system",
    "aspect": "objective",
    "control_family": "network_egress",
    "aep_version": "2.8",
    "added": "2026-07-21",
    "added_display": "21.07.2026",
    "patch_track": "2.8 intermittent / August 2026 patch (pre-2.9 September)",
    "title": "Network egress: no SMTP or mail submission ports",
    "summary": "Standard security enhancement for AEP 2.8. Separates network egress (live TCP) from artifact placement. Blocks SMTP and message-submission ports 25/465/587 and common mail client libraries.",
    "pairs_with": [
      "aep.reference.security.policy-lattice.v1",
      "aep.reference.deployment"
    ],
    "notes": [
      "CRM task types labeled EMAIL over HTTPS APIs are not SMTP.",
      "mailto: browser handoff is not server-side SMTP.",
      "Operators should also drop host OUTPUT to 25/465/587 when running multi-tenant agent hosts."
    ]
  }
}
