# JSON display API
A frontend binds the display API and reads a JSON projection. The dock serves HTTP JSON and the JSON line protocol on the same socket. Every request carries a sealed channel frame. Display mutation runs on collect after the Apply beat. pulse_beat Applies held capsules and does not apply display on that ready loop.
## Bind path
Public compose publishes two host ports:
- UCB on 8412
- Display API TLS on 28429
Set DISPLAY_PORT if you need a different host port. Inside the container the display TLS dock listens on 28429 when AEP_LATTICE_TRANSPORT is tls and AEP_LATTICE_TLS_BIND is 0.0.0.0.
The unix socket bind is AEP_SOCKET_BASE/display. Public compose sets AEP_SOCKET_BASE to /data/aep/sockets so the socket is /data/aep/sockets/display.
The image entrypoint copies lattice.yaml by that file name only. It also copies display-grants.gap, the two source locator files and the packaged client manifest into AEP_DATA. On a TLS boot it provisions the default client agent, issues the AgentMesh client identity and prints the certificate path, so a frontend on the host has its material without a second step. A boot with a missing catalog, a missing grant wall or a missing source locator is refused at the miss. The ready wait holds until the validation socket and the display socket both exist.
Copy .env.example to .env then run docker compose -f docker-compose.public.yml up -d --build
## Two wires on one dock
HTTP JSON is the public wire for a frontend. Post one JSON body that carries a sealed LatticeChannelFrame in the frame field and the dock replies with HTTP JSON. A JSON body that skips the sealed frame is refused.
The JSON line protocol stays for a unix socket caller. One JSON line in and one JSON line out.
Both wires run the same gate path. Admit is still required, and a projection is returned after collect.
## Actions
Inner plaintext names kind display, action_path and view. Name source and sector when a source or a sector is involved. Include payload JSON on an ingest.
Action paths:
- display-api:source:ingest
- display-api:sector:stage
- display-api:view:request
- display-api:view:project
- display-api:catalog:list
A display-api:view:project read returns a JSON projection after collect. If the first reply is pending with a digest, post a collect line with that digest. Collect runs pulse_beat then apply_display_after_admit and returns the projection. Display work is not on the Apply ready loop.
The plaintext also carries the envelope fields the live entry reads. The shipped seal path fills type, agent_id, timestamp, target_id and a sequence number when the caller left them out. The dock freezes the bridge clock at the seal stamp inside the frame, and the frame freshness walls still bound that frame.
## Catalog and source locators
The packaged catalog is AEP-Components/display-api/lattice.yaml. Every named source in that catalog carries a locator. Base Node loads the JSON at that locator into pre-staging at boot for each named sector of that source, so a frontend does not post those payloads. A client ingest stays as a second path. A missing locator or a missing sector key is refused at the miss.
The shipped catalog names view.alpha and view.beta, the sources source.alpha and source.beta and the sectors sector.one and sector.two. view.alpha maps to source.alpha with sector.one and view.beta maps to source.alpha with sector.two. A grant reaches a named pair, so an operator grows the catalog with one locator file per source and one grant per agent.
A granted agent lists the loaded views, sources and sectors on the same wire through display-api:catalog:list.
## Grants and permissions
An empty grant list is refused. One grant names one agent, one source and one sector.
The wall at AEP-Components/display-api/display-grants.gap grants agent-a the pair source.alpha with sector.one. The default client agent display-client holds every source and sector pair that the packaged catalog maps for it, so both packaged views project for that agent. The wall stays open so a named grant can pass.
The packaged action grant for the display family lives at AEP-Components/gap/policies/reference/caw-display-api.gap, because the control hub reads the permission rows of the gap reference tree. A boot without that grant refuses every display action with the capability wall, so an operator who ships a new display agent adds its row there.
At boot the dock loads the catalog and marks attach, source ingest and sector stage satisfied for each agent the grant wall names, because the kernel performed that load. The window between the clock and the beat is the freshness of the frame, so a frontend keeps its own sequence monotonic and paces its reads under the agent action rate wall.
## Reference clients and the seal path
A TypeScript client lives at AEP-Components/lattice-channels/client/display-api/index.ts. A Python client lives at AEP-Components/lattice-channels/client/display-api/display.py.
Each client ships a seal path that runs the Base Node seal command for the default client agent, so a frontend author writes no seal code. A caller may still inject its own sealer. Missing seal material is refused at the miss.
Both clients accept a unix socket path or a host plus a port. Against a host plus port they use HTTP JSON over TLS, and against a unix socket they use the JSON line protocol. Each client carries a list call for the catalog and asks for a view before it projects that view.
Each client carries a live test beside it, test_display_tls.py and test_display_tls.ts, and each test opens a TLS JSON HTTP session for the default client agent. Run the TypeScript test with node and the type stripping flag, and run the Python test with the interpreter.
## Run the staging demonstration
A demonstration script ships beside the reference clients at AEP-Components/lattice-channels/client/display-api/display_staging_demo.py. Run it from the repository root with the base node binary named in the environment. It builds a small data directory, boots a base node on the TLS transport, issues the client identity and prints five checks: the catalog list, the two sectors of one source staged at boot from their locators, the same client staging two sections side by side, the staged files under the AEP data dir and the same projections after a daemon restart.
## Independent check
Boot the public compose image. Post HTTP JSON with a sealed frame on TLS 28429 and read an HTTP JSON projection. Load two sectors of one named source through a catalog locator without the client posting those payloads. List the loaded catalog. Project both packaged views as display-client. Confirm a missing locator is refused and confirm a body that skips the sealed frame is refused. Run the Python and TypeScript client tests, which open a TLS session.
