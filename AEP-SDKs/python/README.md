# @PAD: aep28-env-060-python-sdk-readme-v1
# @GCDE: gaplune-decode hmac-sha256:6e28019aecf807c7b36efb74bcf2f8689d34a6ff75af3c893cf4510528c9747b

# AEP Python SDK

This tree is the advertised AEP-SDKs/python client and it ships aep-protocol plus dynaep as source-only packages with no PyPI publish. Set PYTHONPATH to AEP-SDKs/python/aep-protocol and AEP-SDKs/python/dynaep so aep.lattice_client and dynaep.DynAEPBridge import. The lattice client is fail-closed so AEP_LATTICE_STRICT=0 is refused unless AEP_LATTICE_STRICT_DEV=1 and the client does not self-assert trust_score 750. build_lattice_frame needs aep-lattice-log on PATH.
