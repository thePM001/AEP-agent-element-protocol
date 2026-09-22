"""Live TLS JSON HTTP test for the display client.

Environment:
  DISPLAY_HOST and DISPLAY_PORT point at a live display dock.
  AEP_LATTICE_TLS_CERT, AEP_LATTICE_TLS_KEY and AEP_LATTICE_TLS_CA carry the
  client identity, the client key and the mesh CA.
  AEP_BASE_NODE_BIN names the Base Node binary for the shipped seal path.

Every call goes through HTTP JSON over TLS. A reply that is not HTTP JSON makes
the reader report that the dock returned bytes without an HTTP header block.
"""

from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import display as d  # noqa: E402

PASSES = []
PACE_SECONDS = 0.15


def pace() -> None:
    """Hold under the dock rate limit for agent_action frames."""
    time.sleep(PACE_SECONDS)


def check(name: str, condition: bool) -> None:
    if not condition:
        raise AssertionError(name)
    PASSES.append(name)


def main() -> int:
    host = os.environ.get("DISPLAY_HOST", "127.0.0.1")
    port = int(os.environ.get("DISPLAY_PORT", str(d.DISPLAY_TLS_PORT)))
    binary = os.environ.get("AEP_BASE_NODE_BIN")
    client = d.DisplayClient(host=host, port=port, agent_id=d.DEFAULT_AGENT_ID, seal_binary=binary)

    catalog = client.list_catalog()
    pace()
    views = catalog.get("views") or []
    sources = catalog.get("sources") or []
    check("catalog lists view.alpha", "view.alpha" in views)
    check("catalog lists view.beta", "view.beta" in views)
    check("catalog lists source.alpha", "source.alpha" in sources)

    alpha = client.project("view.alpha")
    pace()
    beta = client.project("view.beta")
    pace()
    check("view.alpha projects the locator payload", alpha == {"label": "one"})
    check("view.beta projects the locator payload", beta == {"label": "two"})

    raw = d.post_display_http(d._compact({"kind": d.DISPLAY_KIND}), host=host, port=port)
    pace()
    refused = json.loads(raw)
    check("a body that skips the sealed frame is refused", refused.get("ok") is False)

    broken = d.DisplayClient(host=host, port=port, agent_id=d.DEFAULT_AGENT_ID, seal_binary="/nonexistent/aep-base-node")
    try:
        broken.project("view.alpha")
        raise AssertionError("missing seal material must be refused")
    except ValueError as err:
        check("missing seal material DENY on miss", str(err) == d.MISSING_SEAL_MATERIAL)

    print("display client TLS JSON HTTP test")
    for name in PASSES:
        print("PASS " + name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
