# AEP Python SDK (`aep`)

Lattice-gated Python client for AEP config loading, validation, and memory.

## Layout

- `aep/__init__.py` - core loader, validator, types
- `aep/memory.py` - memory fabric
- `aep/resolver.py` - basic resolver
- `aep/lattice_client.py` - `build_lattice_frame`, `lattice_gated_fetch`

## Usage

```bash
export PYTHONPATH="AEP-SDKs/python/aep-protocol:AEP-SDKs/python/dynaep"
python3 -c "from aep import load_aep_configs; from aep.lattice_client import build_lattice_frame; print(build_lattice_frame({'event_type':'PING'}))"
```

No PyPI publish. Source-only distribution.