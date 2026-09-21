# JSON display API
A frontend author binds the display surface and posts JSON with a sealed frame. These operator docs name the bind path, JSON display reads and pre-staging grants. Display mutation stays on the Admit pulse. This note does not move mutation out of Admit.
## Bind path
Public compose publishes two host ports:
- UCB on 8412
- Display surface TLS on 28429
Set DISPLAY_PORT if you need a different host port. Inside the container the display TLS dock listens on 28429 when AEP_LATTICE_TRANSPORT is tls and AEP_LATTICE_TLS_BIND is 0.0.0.0.
The unix socket bind is AEP_SOCKET_BASE/display. Public compose sets AEP_SOCKET_BASE to /data/aep/sockets so the socket is /data/aep/sockets/display.
A TypeScript client lives at AEP-Components/lattice-channels/client/display/index.ts. A Python client lives at AEP-Components/lattice-channels/client/display/display.py. Both accept a unix socket path or host plus port.
Copy .env.example to .env then run docker compose -f docker-compose.public.yml up -d --build
## JSON display reads
JSON is the public wire. Post one JSON line that carries a sealed LatticeChannelFrame in the frame field.
A JSON body that skips the sealed frame is refused.
Inner plaintext names kind display, action_path and view. Name source and sector when ingesting or staging. Include payload JSON when ingesting.
Action paths:
- display:source:ingest
- display:sector:stage
- display:view:request
- display:view:project
A display:view:project read returns a JSON projection after Admit. If the first reply is pending with a digest, post a collect line with that digest. Collect waits on the Admit pulse then returns the projection. Display mutation stays in that pulse.
Known views are view.alpha and view.beta. Known sources are source.alpha and source.beta. Known sectors are sector.one and sector.two. view.alpha maps to source.alpha and sector.one. view.beta maps to source.alpha and sector.two.
Unknown view, source and sector ids DENY on miss.
## Pre-staging grants
An empty grant list refuses. One grant names one agent, one source and one sector.
The grant wall at AEP-Components/display-grant-walls/display-grants.gap binds agent-a to source.alpha and sector.one. agent-a may ingest and stage that pair and may project view.alpha. view.beta needs a grant on sector.two.
Closed walls refuse unknown view, unknown source, unknown sector, an empty grant list and a JSON body that skips the sealed frame. The grant wall itself stays open so a named grant can pass.
## Independent check
Read this file for JSON display and pre-staging. Confirm docker-compose.public.yml publishes DISPLAY_PORT 28429 and healthchecks /data/aep/sockets/display. Diff AEP-Base-Node is empty on this change.
