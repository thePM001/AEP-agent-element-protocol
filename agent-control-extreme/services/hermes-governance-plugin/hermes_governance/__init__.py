"""Hermes Governance Plugin - standalone policy enforcement."""

from hermes_governance.plugin import GovernancePlugin
from hermes_governance.checks import PolicyChecks
from hermes_governance.deploy_gate import DeployGate

__version__ = "0.1.0"
__all__ = ["GovernancePlugin", "PolicyChecks", "DeployGate"]
