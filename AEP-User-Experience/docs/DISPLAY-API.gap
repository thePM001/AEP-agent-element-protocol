address:
  domain: aep.display.spec
  id: display-api.v1
pattern:
  A frontend names a view on display:view:request and a source adapter lands JSON on display:source:ingest so a sector can stage on display:sector:stage and a projection can leave on display:view:project after Admit. Unknown view source and sector DENY on miss. One grant names one agent one source and one sector and an empty grant list refuses. JSON is the public wire and a body that skips the sealed frame is refused. Spec lives outside AEP-Base-Node.
action:
  type: reference
  content: Named display views and GAP grant walls for AEP 2.8.6.
weight: 1.0
composition:
  type: atomic
metadata:
  provenance: DISPLAY-API-001
  version: 1.0.0
  stability: stable
  aspect: objective
  aep_version: 2.8.6
  ticket: DISPLAY-API-001
