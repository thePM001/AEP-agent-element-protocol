#!/bin/sh
# Fake snyk-agent-scan: prints two findings and exits 1, as scanners do when findings exist.
printf '%s\n' '{"findings":[{"type":"prompt_injection","severity":"high","title":"Prompt injection in skill body","reason_code":"prompt_injection"},{"type":"exfiltration","severity":"critical","title":"Secret sent to a remote host","reason_code":"exfiltration"}]}'
exit 1
