"""Regression tests for local-time light clock commands and auto re-arming.

Run with: python -m unittest discover -s tests -v
These tests import the pure BLE command modules without loading Home Assistant.
"""

from __future__ import annotations

import datetime
import sys
import types
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

COMMANDS = Path(__file__).resolve().parents[1] / "custom_components" / "aquable" / "commands"
PKG = "aquable_commands_tests"
package = types.ModuleType(PKG)
package.__path__ = [str(COMMANDS)]
sys.modules.setdefault(PKG, package)

from aquable_commands_tests import encoder, generators  # noqa: E402


class TestLightClockAndAutoMode(unittest.TestCase):
    def test_auto_syncs_configured_local_clock_before_enabling(self) -> None:
        now = datetime.datetime(2026, 11, 19, 12, 16, 0, tzinfo=ZoneInfo("Europe/Madrid"))
        _, commands = generators.generate_light_enable_auto_mode_sequence(
            (0, 0), device_local_time=now
        )
        self.assertEqual([cmd[5] for cmd in commands], [0x09, 0x05])
        self.assertEqual(list(commands[0][6:12]), [26, 11, 4, 12, 16, 0])
        self.assertEqual(list(commands[1][6:9]), [18, 255, 255])

    def test_tiny_two_channel_auto_schedule_preserves_warm_white(self) -> None:
        _, commands = generators.generate_light_add_auto_setting_sequence(
            (0, 1),
            datetime.time(12, 0),
            datetime.time(18, 0),
            (0, 70),
            5,
            weekdays=["everyday"],
        )
        self.assertEqual(len(commands), 1)
        command = commands[0]
        self.assertEqual(command[:1], bytes([0xA5]))
        self.assertEqual(command[5], 0x19)
        self.assertEqual(list(command[6:14]), [12, 0, 18, 0, 5, 127, 0, 70])


if __name__ == "__main__":
    unittest.main()
