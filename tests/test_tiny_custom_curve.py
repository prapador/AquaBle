"""BLE-level regression tests for Tiny custom-curve and scene controllers."""

from __future__ import annotations

import datetime
import sys
import types
import unittest
from pathlib import Path
from zoneinfo import ZoneInfo

COMMANDS = Path(__file__).resolve().parents[1] / "custom_components" / "aquable" / "commands"
PKG = "aquable_custom_curve_tests"
package = types.ModuleType(PKG)
package.__path__ = [str(COMMANDS)]
sys.modules.setdefault(PKG, package)

from aquable_custom_curve_tests import encoder, generators  # noqa: E402


class TestTinyCustomCurveProtocol(unittest.TestCase):
    def setUp(self):
        self.time = datetime.datetime(
            2026, 11, 19, 12, 40, tzinfo=ZoneInfo("Europe/Madrid")
        )

    def test_full_custom_curve_sequence(self):
        points = [
            (0, (0, 0)),
            (12 * 60, (0, 35)),
            (20 * 60, (0, 35)),
            (23 * 60 + 30, (0, 0)),
        ]
        _, frames = generators.generate_light_set_custom_curve_sequence(
            (0, 0), points, self.time
        )
        self.assertEqual(len(frames), 3 + len(points) * 2)
        self.assertEqual([frame[5] for frame in frames[:3]], [9, 5, 5])
        self.assertEqual(list(frames[0][6:12]), [26, 11, 4, 12, 40, 0])
        self.assertEqual(list(frames[1][6:9]), [5, 255, 255])
        self.assertEqual(list(frames[2][6:9]), [3, 255, 255])
        for index, (minute, levels) in enumerate(points):
            for channel, level in enumerate(levels):
                frame = frames[3 + index * 2 + channel]
                self.assertEqual(frame[5], 6)
                self.assertEqual(list(frame[6:9]), [channel, minute // 30, level])
                self.assertEqual(
                    frame[-1], encoder._calculate_checksum(frame[:-1])
                )

    def test_brightness_ninety_is_not_altered(self):
        frame = encoder.create_auto_curve_point_command((0, 1), 1, 720, 90)
        self.assertEqual(frame[8], 90)

    def test_unaligned_times_rejected(self):
        with self.assertRaises(ValueError):
            encoder.create_auto_curve_point_command((0, 1), 1, 721, 35)

    def test_scene_and_custom_reset_are_distinct(self):
        custom = encoder.create_reset_auto_settings_command((0, 1))
        scene = encoder.create_reset_scene_settings_command((0, 2))
        self.assertEqual(custom[6], 5)
        self.assertEqual(scene[6], 40)

    def test_resuming_custom_does_not_clear_points(self):
        _, frames = generators.generate_light_enable_custom_curve_sequence(
            (0, 0), self.time
        )
        self.assertEqual([frame[5] for frame in frames], [9, 5])
        self.assertEqual(frames[-1][6], 3)


if __name__ == "__main__":
    unittest.main()
