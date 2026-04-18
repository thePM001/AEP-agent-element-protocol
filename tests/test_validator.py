"""
Tests for sdk-aep-python.py (Core Validator).
Run: python -m pytest tests/test_validator.py -v
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk"))

from importlib.util import spec_from_file_location, module_from_spec

sdk_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sdk")
py_spec = spec_from_file_location("sdk_aep_python", os.path.join(sdk_dir, "sdk-aep-python.py"))
py_mod = module_from_spec(py_spec)
sys.modules["sdk_aep_python"] = py_mod
py_spec.loader.exec_module(py_mod)

Z_BANDS = py_mod.Z_BANDS
z_band_for_prefix = py_mod.z_band_for_prefix
prefix_from_id = py_mod.prefix_from_id
AEPIDError = py_mod.AEPIDError

import pytest


# ---------------------------------------------------------------------------
# Z-Band Constants
# ---------------------------------------------------------------------------

class TestZBands:
    def test_shell_band(self):
        assert Z_BANDS["SH"] == (0, 9)

    def test_panel_band(self):
        assert Z_BANDS["PN"] == (10, 19)

    def test_component_band(self):
        assert Z_BANDS["CP"] == (20, 29)

    def test_cell_zone_band(self):
        assert Z_BANDS["CZ"] == (30, 39)

    def test_toolbar_band(self):
        assert Z_BANDS["TB"] == (40, 49)

    def test_widget_band(self):
        assert Z_BANDS["WD"] == (50, 59)

    def test_overlay_band(self):
        assert Z_BANDS["OV"] == (60, 69)

    def test_modal_band(self):
        assert Z_BANDS["MD"] == (70, 79)

    def test_tooltip_band(self):
        assert Z_BANDS["TT"] == (80, 89)

    def test_dropdown_band(self):
        assert Z_BANDS["DD"] == (70, 79)

    def test_navigation_band(self):
        assert Z_BANDS["NV"] == (10, 19)

    def test_form_band(self):
        assert Z_BANDS["FM"] == (20, 29)

    def test_icon_band(self):
        assert Z_BANDS["IC"] == (20, 29)


# ---------------------------------------------------------------------------
# z_band_for_prefix
# ---------------------------------------------------------------------------

class TestZBandForPrefix:
    def test_known_prefix(self):
        assert z_band_for_prefix("CP") == (20, 29)

    def test_unknown_prefix_fallback(self):
        assert z_band_for_prefix("XX") == (0, 99)


# ---------------------------------------------------------------------------
# prefix_from_id
# ---------------------------------------------------------------------------

class TestPrefixFromId:
    def test_valid_id(self):
        assert prefix_from_id("CP-00001") == "CP"

    def test_valid_short_id(self):
        assert prefix_from_id("SH") == "SH"

    def test_too_short_raises(self):
        with pytest.raises(AEPIDError):
            prefix_from_id("A")

    def test_empty_raises(self):
        with pytest.raises(AEPIDError):
            prefix_from_id("")

    def test_none_raises(self):
        with pytest.raises(AEPIDError):
            prefix_from_id(None)


# ---------------------------------------------------------------------------
# Z-band invariant: modals always above grids
# ---------------------------------------------------------------------------

class TestZBandInvariants:
    def test_modal_always_above_grid(self):
        modal_min, _ = Z_BANDS["MD"]
        _, grid_max = Z_BANDS["CZ"]
        assert modal_min > grid_max, "Modal z-band must be entirely above grid z-band"

    def test_tooltip_always_above_modal(self):
        tooltip_min, _ = Z_BANDS["TT"]
        _, modal_max = Z_BANDS["MD"]
        assert tooltip_min > modal_max, "Tooltip z-band must be entirely above modal z-band"

    def test_overlay_above_widget(self):
        overlay_min, _ = Z_BANDS["OV"]
        _, widget_max = Z_BANDS["WD"]
        assert overlay_min > widget_max, "Overlay z-band must be above widget z-band"
