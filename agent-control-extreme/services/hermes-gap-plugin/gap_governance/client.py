"""GAP Runtime HTTP client for Hermes governance enforcement."""

import json
import os
import time
from typing import Any, Dict, List, Optional

import requests


class GAPViolation(Exception):
    """Raised when GAP governance rejects an action."""
    def __init__(self, message: str, violations: List[Dict] = None):
        self.violations = violations or []
        super().__init__(message)


class GAPClient:
    """HTTP client to GAP Runtime server for validate/scan/execute."""

    def __init__(self, server_url: str = None, fail_closed: bool = True,
                 timeout: float = 10.0):
        self.server_url = server_url or os.environ.get(
            "GAP_SERVER_URL", "http://127.0.0.1:3200"
        )
        self.fail_closed = fail_closed
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers["Content-Type"] = "application/json"

    def health(self) -> bool:
        """Check if GAP server is reachable."""
        try:
            resp = self._session.get(
                f"{self.server_url}/health", timeout=2
            )
            return resp.status_code == 200
        except Exception:
            return False

    def validate(self, action_type: str, action_params: Dict,
                 session_id: str = "", prompt: str = "",
                 scanners: List[str] = None) -> Dict:
        """Validate an action through GAP governance.

        Returns GAP result dict. Raises GAPViolation if blocked.
        """
        if not self.health():
            if self.fail_closed:
                raise GAPViolation(
                    "GAP server unreachable (fail-closed mode)",
                    [{"scanner": "gap_client", "type": "connection_error"}]
                )
            return {"valid": True, "mode": "fail_open"}

        scanners = scanners or ["pii", "injection", "secrets", "jailbreak",
                                "toxicity"]

        instruction = {
            "name": f"hermes_{action_type}",
            "domain": "agent_governance",
            "id": f"act-{session_id}-{hash(str(action_params))}",
            "version": 1,
            "pattern": {"input": action_params},
            "action": {
                "steps": [{
                    "order": 1,
                    "action_type": action_type,
                    "prompt": prompt,
                    "parameters": action_params
                }]
            },
            "metadata": {
                "scanners": scanners,
                "covenants": [],
                "proof": True
            }
        }

        import yaml
        yaml_str = yaml.dump(instruction)
        resp = self._session.post(
            f"{self.server_url}/validate",
            json={"yaml": yaml_str, "output": json.dumps(action_params)},
            timeout=self.timeout
        )
        result = resp.json()

        if not result.get("valid", False):
            hard = result.get("hard_violations", [])
            raise GAPViolation(
                f"GAP blocked {action_type}: {', '.join(hard)}",
                result.get("scanner_violations", [])
            )

        return result

    def scan(self, text: str, scanners: List[str] = None) -> Dict:
        """Scan output text through GAP scanners."""
        if not self.health():
            return {"passed": True, "mode": "bypass"}

        scanners = scanners or ["pii", "secrets", "toxicity"]
        resp = self._session.post(
            f"{self.server_url}/scan",
            json={"text": text, "scanners": scanners},
            timeout=self.timeout
        )
        return resp.json()

    def execute(self, yaml_str: str, input_data: Dict,
                proof: bool = True) -> Dict:
        """Execute a GAP instruction."""
        resp = self._session.post(
            f"{self.server_url}/execute",
            json={"yaml": yaml_str, "input": input_data, "proof": proof},
            timeout=self.timeout
        )
        return resp.json()

    def scanners(self) -> List[Dict]:
        """List available GAP scanners."""
        if not self.health():
            return []
        resp = self._session.get(f"{self.server_url}/scanners", timeout=5)
        return resp.json()
