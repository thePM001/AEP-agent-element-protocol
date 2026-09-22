address:
  domain: aep.display.spec
  id: display-api.v1
pattern:
  A frontend names a view on display-api:view:request and a source adapter lands JSON on display-api:source:ingest so a sector can stage on display-api:sector:stage and a projection can leave on display-api:view:project after Admit. A granted agent lists the loaded views sources and sectors on display-api:catalog:list. Each named source in the catalog carries a locator that Base Node loads into pre-staging at boot for each named sector of that source. Unknown view source and sector DENY on miss and a missing locator DENY on miss. One grant names one agent one source and one sector and an empty grant list refuses. JSON is the public wire for an HTTP body and for a JSON line and a body that skips the sealed frame is refused. Spec lives outside AEP-Base-Node.
action:
  type: reference
  content: Named display views, source locators and GAP grant walls for AEP 2.8.6.
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
