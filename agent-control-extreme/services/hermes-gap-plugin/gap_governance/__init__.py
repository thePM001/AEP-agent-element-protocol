"""GAP Governance Plugin - Hermes Agent integration."""

from gap_governance.client import GAPClient
from gap_governance.plugin import GAPGovernancePlugin
from gap_governance.policy_cache import PolicyCache

__version__ = "0.1.0"
__all__ = ["GAPClient", "GAPGovernancePlugin", "PolicyCache"]
