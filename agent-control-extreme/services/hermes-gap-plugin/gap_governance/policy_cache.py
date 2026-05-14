"""Policy cache - syncs NLA policies from control hub to local cache.

Auto-polls agent-control-extreme/policies/ from NLA-PLATFORM Gitea repo.
Provides policy data to GAP client for covenant enforcement.
"""

import json
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

import requests


class PolicyCache:
    """Cached policy store synced from NLA control hub."""

    def __init__(self, cache_dir: str = None,
                 hub_url: str = None, hub_token: str = None,
                 sync_interval: int = 300):
        self.cache_dir = Path(cache_dir or os.path.expanduser(
            "~/.hermes/plugins/gap-governance/policies"
        ))
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.hub_url = hub_url or os.environ.get(
            "CONTROL_HUB_URL", "http://100.118.184.18:3003"
        )
        self.hub_token = hub_token or os.environ.get("CONTROL_HUB_TOKEN", "")
        self.sync_interval = sync_interval
        self._last_sync = 0
        self._policies: Dict[str, str] = {}

    def sync(self, force: bool = False) -> int:
        """Sync policies from control hub. Returns count synced."""
        now = time.time()
        if not force and (now - self._last_sync) < self.sync_interval:
            return len(self._policies)

        if not self.hub_token:
            return self._load_local()

        api_base = f"{self.hub_url}/api/v1"
        owner = os.environ.get("CONTROL_REPO_OWNER", "thePM001")
        repo = os.environ.get("CONTROL_REPO_NAME", "NLA-PLATFORM")
        headers = {"Authorization": f"token {self.hub_token}"}

        count = 0
        # Fetch from agent-control-extreme/policies/
        for path in ["agent-control-extreme/policies", "agent-control-hub/policies"]:
            try:
                resp = requests.get(
                    f"{api_base}/repos/{owner}/{repo}/contents/{path}",
                    headers=headers, timeout=10
                )
                if resp.status_code != 200:
                    continue
                for item in resp.json():
                    if not item["name"].endswith((".policy", ".gap")):
                        continue
                    content_resp = requests.get(
                        item["url"], headers=headers, timeout=10
                    )
                    if content_resp.status_code == 200:
                        content = content_resp.json().get("content", "")
                        import base64
                        decoded = base64.b64decode(content).decode()
                        self._policies[item["name"]] = decoded
                        local_path = self.cache_dir / item["name"]
                        local_path.write_text(decoded)
                        count += 1
            except Exception:
                pass

        self._last_sync = now
        self.save()
        return count

    def _load_local(self) -> int:
        """Load policies from local cache."""
        count = 0
        if self.cache_dir.is_dir():
            for f in self.cache_dir.glob("*.policy"):
                self._policies[f.name] = f.read_text()
                count += 1
            for f in self.cache_dir.glob("*.gap"):
                self._policies[f.name] = f.read_text()
                count += 1
        return count

    def save(self):
        """Save policy index."""
        index = {
            "last_sync": self._last_sync,
            "hub_url": self.hub_url,
            "policies": list(self._policies.keys())
        }
        (self.cache_dir / "index.json").write_text(json.dumps(index, indent=2))

    def get(self, name: str) -> Optional[str]:
        """Get a policy by filename."""
        return self._policies.get(name)

    def all(self) -> Dict[str, str]:
        """Get all policies."""
        return dict(self._policies)

    def count(self) -> int:
        return len(self._policies)
