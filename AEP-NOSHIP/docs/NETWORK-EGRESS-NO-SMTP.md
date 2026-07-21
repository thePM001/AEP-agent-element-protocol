# Network egress: no SMTP (AEP 2.8)

**Added:** 2026-07-21 (21.07.2026)  
**Track:** AEP 2.8 intermittent updates / August 2026 patch (before AEP 2.9 in September)  
**Public policy:** `AEP-Policy-System/reference/network-egress-no-smtp.gap`  
**Operator YAML:** `AEP-Policy-System/network-egress-no-smtp.policy.yaml`

## Why

Agent hosts and product services must not become mail relays. SMTP and message-submission ports are a high-abuse class. AEP 2.8 standardizes a **network egress** control family for this.

## Vocabulary

- **Network egress** - live TCP/UDP connections from agents or product services
- **Artifact placement** - publishing code, policies or manifests into the deployment surface

Both matter. Clean artifact placement does not permit mail-port dials.

## Hard rules

1. No TCP **25 / 465 / 587** (listen or connect) for agents or product services
2. No mail transport libraries or clients in governed code (nodemailer, smtplib, sendmail, createTransport, PHPMailer, SES SendRawEmail clients)
3. No `smtp://` or `smtps://` schemes in governed actions or product config
4. Session completion should prove zero sockets on those ports

## Recommended operator host control

Drop host OUTPUT to TCP 25, 465 and 587 on multi-tenant agent hosts (nftables or equivalent). Log drops for incident review.

## Not in scope

- HTTPS CRM APIs that create tasks with type EMAIL
- User-agent `mailto:` links that open a local mail client
- Documentation that mentions port numbers without dialing them

## Validation

```bash
aep lint-policy AEP-Policy-System/reference/network-egress-no-smtp.gap
```
