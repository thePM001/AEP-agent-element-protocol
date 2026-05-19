"""
Policy Violation Reporter - Governance Plugin Hook

Called by the governance plugin after every agent tool call.
Runs all 9 policy scanners against the tool output and POSTs
any detected violations to the central error registry.

Non-blocking: failures are logged but never raised to the agent.

Part of the Agent Control Hub - open source reference implementation.
Apache 2.0 License.
"""

import json
import logging
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger("governance.violation-reporter")

# ── Configuration ────────────────────────────────────────────────────────
# Customize these for your deployment

VIOLATION_API = "http://127.0.0.1:<PORT>/violation"  # Replace <PORT> with your API port
SCANNER_PATH = "<INSTALL_DIR>/scanners/violation-scanner.py"  # Replace with scanner path

# Rate limit: max 1 POST per 30 seconds to avoid flooding
_last_post_time = 0.0
_MIN_POST_INTERVAL = 30.0


def _load_scanner():
    """Import the violation scanner module from its configured path."""
    scanner_dir = os.path.dirname(SCANNER_PATH)
    if scanner_dir not in sys.path:
        sys.path.insert(0, scanner_dir)

    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "violation_scanner", SCANNER_PATH
    )
    if spec is None or spec.loader is None:
        log.warning("Cannot load violation scanner from %s", SCANNER_PATH)
        return None

    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
        return module
    except Exception as e:
        log.warning("Failed to load violation scanner: %s", e)
        return None


def scan_output(text: str, source_file: str = None) -> List[Dict]:
    """Run all 9 policy scanners against text. Returns list of violations."""
    scanner = _load_scanner()
    if scanner is None:
        return []

    try:
        violations = scanner.scan_all(text, source_file=source_file)
        return violations
    except Exception as e:
        log.warning("Scanner execution failed: %s", e)
        return []


def post_violations(agent: str, agent_id: str, violations: List[Dict],
                    tool: str = "") -> bool:
    """POST violations to the central agent error registry."""
    global _last_post_time

    now = time.time()
    if now - _last_post_time < _MIN_POST_INTERVAL:
        log.debug("Rate-limited: skipping violation POST (%.1fs since last)",
                  now - _last_post_time)
        return False

    payload = {
        "agent": agent,
        "agent_id": agent_id,
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tool": tool,
        "violations": violations,
    }

    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            VIOLATION_API,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=5)
        result = json.loads(resp.read())
        _last_post_time = now
        log.info("Reported %d violation(s) to registry: %s",
                 len(violations), result.get("report_id", "?"))
        return True
    except urllib.error.URLError as e:
        log.warning("Violation API unreachable: %s", e)
        return False
    except Exception as e:
        log.warning("Failed to POST violations: %s", e)
        return False


def report_violations(tool_name: str, output: Any,
                      session_id: str = "unknown") -> None:
    """Main entry point: scan tool output and report any violations.

    Called by the governance plugin after every tool call.
    Non-blocking: failures are logged but never raised.
    """
    if not output:
        return

    # Convert output to string for scanning
    if isinstance(output, (dict, list)):
        try:
            text = json.dumps(output)
        except (TypeError, ValueError):
            text = str(output)
    else:
        text = str(output)

    # Skip very short outputs (unlikely to contain violations)
    if len(text) < 10:
        return

    # Truncate very long outputs to keep scanning fast
    if len(text) > 50000:
        text = text[:50000]

    violations = scan_output(text)

    if violations:
        agent_name = os.environ.get("AGENT_NAME", "agent")
        log.info("Detected %d policy violation(s) in %s output",
                 len(violations), tool_name)

        # Add tool context to each violation
        for v in violations:
            if "tool" not in v:
                v["tool"] = tool_name

        post_violations(agent_name, session_id, violations, tool=tool_name)
