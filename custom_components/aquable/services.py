"""Custom services (actions) for configuring AquaBle devices."""

from __future__ import annotations

import asyncio
import datetime
import logging
from typing import Any

import voluptuous as vol
from bleak import BleakClient
from bleak.exc import BleakError
from bleak_retry_connector import establish_connection
from homeassistant.components import bluetooth
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from .commands import encoder, generators
from .const import DEVICE_TYPE_DOSER, DOMAIN, DeviceModelInfo
from .coordinator import UART_TX_UUID, AquaBleCoordinator
from .domain.light.status import LightSchedule

_LOGGER = logging.getLogger(__name__)

SERVICE_SET_DOSER_SCHEDULE = "doser_set_daily_dose_sequence"
SERVICE_DOSER_MANUAL = "doser_manual_dose"
SERVICE_SET_LIGHT_MANUAL = "light_set_manual_mode"
SERVICE_SET_LIGHT_AUTO = "light_set_auto_schedule"
SERVICE_SET_LIGHT_CUSTOM = "light_set_custom_curve"
SERVICE_ENABLE_LIGHT_AUTO = "light_set_mode"
SERVICE_CLEAR_LIGHT_SCHEDULES = "light_clear_schedules"
SERVICE_DELETE_LIGHT_AUTO = "light_delete_auto_schedule"

DOSER_SCHEDULE_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Required("head_index"): vol.All(vol.Coerce(int), vol.Range(min=1, max=4)),
        vol.Required("volume_ml"): vol.All(vol.Coerce(float), vol.Range(min=0.0)),
        vol.Required("hour"): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
        vol.Required("minute"): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
        vol.Optional("weekdays"): cv.ensure_list,
    }
)

DOSER_MANUAL_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Required("head_index"): vol.All(vol.Coerce(int), vol.Range(min=1, max=4)),
        vol.Required("volume_ml"): vol.All(vol.Coerce(float), vol.Range(min=0.0)),
    }
)

LIGHT_MANUAL_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Optional("white", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("warm_white", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("red", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("green", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("blue", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
    }
)

LIGHT_AUTO_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Optional("schedule_index"): vol.All(vol.Coerce(int), vol.Range(min=0)),
        vol.Required("sunrise_hour"): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
        vol.Required("sunrise_minute"): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
        vol.Required("sunset_hour"): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
        vol.Required("sunset_minute"): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
        vol.Optional("ramp_up_minutes", default=1): vol.All(
            vol.Coerce(int), vol.Range(min=1, max=180)
        ),
        vol.Optional("white", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("warm_white", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("red", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("green", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("blue", default=0): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("weekdays"): cv.ensure_list,
    }
)

LIGHT_CUSTOM_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Required("points"): vol.All(cv.ensure_list, vol.Length(min=2, max=16)),
    }
)

LIGHT_DELETE_AUTO_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Optional("schedule_index"): vol.All(vol.Coerce(int), vol.Range(min=0)),
        vol.Optional("sunrise_hour"): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
        vol.Optional("sunrise_minute"): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
        vol.Optional("sunset_hour"): vol.All(vol.Coerce(int), vol.Range(min=0, max=23)),
        vol.Optional("sunset_minute"): vol.All(vol.Coerce(int), vol.Range(min=0, max=59)),
        # min 0 so schedules stored before the 1-minute minimum can still be deleted.
        vol.Optional("ramp_up_minutes"): vol.All(vol.Coerce(int), vol.Range(min=0, max=180)),
        vol.Optional("weekdays"): cv.ensure_list,
    }
)

LIGHT_MODE_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
        vol.Required("mode"): vol.In(["auto", "custom", "manual", "off"]),
    }
)

LIGHT_CLEAR_SCHEMA = vol.Schema(
    {
        vol.Required("device_id"): cv.string,
    }
)


async def _async_execute_commands(
    hass: HomeAssistant, address: str, commands: list[bytearray]
) -> None:
    """Helper to connect to a device and push a list of commands sequentially."""
    ble_device = bluetooth.async_ble_device_from_address(hass, address, connectable=True)
    if not ble_device:
        raise HomeAssistantError(f"Device {address} not found or not in range.")

    _LOGGER.debug("Connecting to %s to write %d commands", address, len(commands))

    client: BleakClient | None = None
    try:
        client = await establish_connection(
            BleakClient,
            ble_device,
            address,
            max_attempts=3,
            use_services_cache=True,
        )
        if not client or not client.is_connected:
            raise HomeAssistantError(f"Failed to connect to device {address}")

        for i, cmd in enumerate(commands):
            _LOGGER.debug("Writing command %d/%d: %s", i + 1, len(commands), cmd.hex())
            await client.write_gatt_char(UART_TX_UUID, cmd, response=False)
            await asyncio.sleep(0.1)

        _LOGGER.info("Successfully pushed configuration to %s", address)

    except BleakError as err:
        raise HomeAssistantError(f"Bluetooth error writing to {address}: {err}")
    finally:
        if client and client.is_connected:
            await client.disconnect()


def _get_coordinator(hass: HomeAssistant, device_id: str) -> AquaBleCoordinator:
    """Resolve a HA device_id, entity_id, or MAC address to its AquaBleCoordinator."""
    # 1. Direct MAC match
    for coord in hass.data.get(DOMAIN, {}).values():
        if isinstance(coord, AquaBleCoordinator) and coord.address.lower() == device_id.lower():
            return coord

    # 2. Entity ID match
    ent_reg = er.async_get(hass)
    entity = ent_reg.async_get(device_id)
    resolved_device_id = entity.device_id if entity and entity.device_id else device_id

    # 3. Device registry lookup
    dev_reg = dr.async_get(hass)
    device = dev_reg.async_get(resolved_device_id)
    if device:
        for identifier in device.identifiers:
            if identifier[0] == DOMAIN:
                mac_address = identifier[1]
                for coord in hass.data.get(DOMAIN, {}).values():
                    if isinstance(coord, AquaBleCoordinator) and coord.address == mac_address:
                        return coord

    # 4. Fallback if single coordinator active
    active_coords = [
        c for c in hass.data.get(DOMAIN, {}).values() if isinstance(c, AquaBleCoordinator)
    ]
    if len(active_coords) == 1:
        return active_coords[0]

    raise HomeAssistantError(f"Active coordinator not found for device or entity {device_id}")


def _extract_channel_levels(
    model_info: DeviceModelInfo | None, num_channels: int, data: dict[str, Any]
) -> list[int]:
    """Extract ordered channel brightness levels (0-100) from service call data."""
    red = data.get("red", 0)
    green = data.get("green", 0)
    blue = data.get("blue", 0)
    white = data.get("white", 0)

    if model_info and model_info.colors:
        num_ch = len(set(model_info.colors.values()))
        levels = [0] * num_ch
        for color_name, ch_idx in model_info.colors.items():
            if ch_idx < num_ch and color_name in data:
                levels[ch_idx] = data[color_name]
        # For single-channel white fixtures if red was passed or vice versa
        if num_ch == 1 and 0 in model_info.colors.values() and not levels[0]:
            levels[0] = white if "white" in data and data["white"] != 0 else red
        return levels

    # Fallback if model info is unavailable
    if num_channels == 1:
        return [white if "white" in data and data["white"] != 0 else red]
    if num_channels == 2:
        return [red, green]
    if num_channels == 3:
        return [red, green, blue]
    return [red, green, blue, white]


async def _execute_on_master_and_slaves(
    hass: HomeAssistant,
    master_coord: AquaBleCoordinator,
    commands: list[bytearray],
) -> None:
    """Execute commands on the master light and mirror them to any configured slave lights.

    Sync is for lights only; dosers are never mirrored.
    """
    await _async_execute_commands(hass, master_coord.address, commands)
    await master_coord.async_request_refresh()

    if not master_coord.entry or master_coord.device_type == DEVICE_TYPE_DOSER:
        return

    slave_device_ids = master_coord.entry.options.get("sync_devices", [])
    if not slave_device_ids:
        return

    master_schedules = master_coord.entry.options.get("schedules")

    for slave_id in slave_device_ids:
        try:
            slave_coord = _get_coordinator(hass, slave_id)
            if not slave_coord or not slave_coord.entry:
                _LOGGER.warning("Could not find slave coordinator for device_id: %s", slave_id)
                continue

            # Sync schedules in HA frontend if they exist
            new_options = dict(slave_coord.entry.options)
            if master_schedules is not None:
                new_options["schedules"] = master_schedules
            for key in ("custom_curve", "light_controller_mode"):
                if key in master_coord.entry.options:
                    new_options[key] = master_coord.entry.options[key]
            if new_options != slave_coord.entry.options:
                hass.config_entries.async_update_entry(slave_coord.entry, options=new_options)

            slave_commands = []
            for cmd in commands:
                # 0x5A (90) is cmd_id, 0x09 is mode for set_time_command
                if cmd and cmd[0] == 90 and len(cmd) >= 6 and cmd[5] == 9:
                    # Regenerate with a fresh timestamp but keep original msg_id
                    fresh_cmd = encoder.create_set_time_command((cmd[3], cmd[4]), dt_util.now())
                    slave_commands.append(fresh_cmd)
                else:
                    slave_commands.append(cmd)

            await _async_execute_commands(hass, slave_coord.address, slave_commands)
            await slave_coord.async_request_refresh()
        except Exception as e:
            _LOGGER.warning("Failed to sync commands to slave light %s: %s", slave_id, e)


async def async_setup_services(hass: HomeAssistant) -> None:
    """Register custom services for AquaBle."""

    if hass.data.get(f"{DOMAIN}_services_registered"):
        return
    hass.data[f"{DOMAIN}_services_registered"] = True

    async def handle_set_doser_schedule(call: ServiceCall) -> None:
        coord = _get_coordinator(hass, call.data["device_id"])
        volume_tenths_ml = round(call.data["volume_ml"] * 10)

        _, commands = generators.generate_doser_set_daily_dose_sequence(
            start_msg_id=(0, 0),
            head_index=call.data["head_index"],
            volume_tenths_ml=volume_tenths_ml,
            hour=call.data["hour"],
            minute=call.data["minute"],
            weekdays=call.data.get("weekdays"),
        )
        await _async_execute_commands(hass, coord.address, commands)

        # The doser only reports targets back in whole mL (0.5 mL reads as 0),
        # so persist the exact value sent for the target dose sensor to use.
        if coord.entry:
            new_options = dict(coord.entry.options)
            doser_targets = dict(new_options.get("doser_targets", {}))
            doser_targets[str(call.data["head_index"])] = volume_tenths_ml
            new_options["doser_targets"] = doser_targets
            hass.config_entries.async_update_entry(coord.entry, options=new_options)

        await coord.async_request_refresh()

    async def handle_doser_manual_dose(call: ServiceCall) -> None:
        coord = _get_coordinator(hass, call.data["device_id"])
        volume_tenths_ml = round(call.data["volume_ml"] * 10)

        _, commands = generators.generate_doser_manual_dose_sequence(
            start_msg_id=(0, 0),
            head_index=call.data["head_index"],
            volume_tenths_ml=volume_tenths_ml,
        )
        await _async_execute_commands(hass, coord.address, commands)
        await coord.async_request_refresh()

    async def handle_light_manual_mode(call: ServiceCall) -> None:
        coord = _get_coordinator(hass, call.data["device_id"])
        channel_levels = _extract_channel_levels(coord.model_info, coord.num_channels, call.data)
        colors = {ch_idx: val for ch_idx, val in enumerate(channel_levels)}
        _, commands = generators.generate_light_set_brightness_sequence((0, 0), colors)
        await _execute_on_master_and_slaves(hass, coord, commands)

    async def handle_light_auto_schedule(call: ServiceCall) -> None:
        coord = _get_coordinator(hass, call.data["device_id"])
        schedule_index = call.data.get("schedule_index")
        sunrise = datetime.time(call.data["sunrise_hour"], call.data["sunrise_minute"])
        sunset = datetime.time(call.data["sunset_hour"], call.data["sunset_minute"])
        channel_levels = _extract_channel_levels(coord.model_info, coord.num_channels, call.data)
        brightness = tuple(channel_levels)
        ramp_up_minutes = call.data["ramp_up_minutes"]
        weekdays = call.data.get("weekdays")

        commands_to_send: list[bytearray] = []

        new_start = call.data["sunrise_hour"] * 60 + call.data["sunrise_minute"]
        new_end = call.data["sunset_hour"] * 60 + call.data["sunset_minute"]
        new_mask = encoder.encode_weekdays(weekdays)

        if new_start >= new_end:
            raise HomeAssistantError("Sunrise time must be before sunset time.")

        # 1. Update persisted schedules in ConfigEntry options (primary source of truth)
        if coord.entry:
            existing = list(coord.entry.options.get("schedules", []))

            # Check for overlaps
            for idx, existing_s in enumerate(existing):
                if schedule_index is not None and idx == schedule_index:
                    continue
                old_mask = int(existing_s.get("weekday_mask", 127))
                if new_mask & old_mask:
                    old_start = int(existing_s.get("sunrise_hour", 12)) * 60 + int(
                        existing_s.get("sunrise_minute", 0)
                    )
                    old_end = int(existing_s.get("sunset_hour", 20)) * 60 + int(
                        existing_s.get("sunset_minute", 0)
                    )

                    if new_start <= old_end and new_end >= old_start:
                        raise HomeAssistantError(
                            f"Schedule overlaps with existing slot #{idx + 1}. "
                            "Please ensure at least a 1-minute difference between schedules."
                        )

            new_sched = LightSchedule(
                sunrise_hour=call.data["sunrise_hour"],
                sunrise_minute=call.data["sunrise_minute"],
                sunset_hour=call.data["sunset_hour"],
                sunset_minute=call.data["sunset_minute"],
                ramp_up_minutes=ramp_up_minutes,
                weekday_mask=encoder.encode_weekdays(weekdays),
                channel_brightness=list(channel_levels),
            )

            # If modifying an existing schedule, check if old hardware slot needs deletion
            if schedule_index is not None and 0 <= schedule_index < len(existing):
                old_sched = existing[schedule_index]
                old_sunrise = datetime.time(
                    old_sched.get("sunrise_hour", 12), old_sched.get("sunrise_minute", 0)
                )
                old_sunset = datetime.time(
                    old_sched.get("sunset_hour", 20), old_sched.get("sunset_minute", 0)
                )
                old_ramp = old_sched.get("ramp_up_minutes", 0)

                # Decode weekday_mask to weekdays list for the generator
                temp_sched = LightSchedule.from_dict(old_sched)
                old_weekdays = temp_sched.weekdays()

                # If timing/weekdays changed, delete the old slot on device hardware
                if (
                    old_sunrise != sunrise
                    or old_sunset != sunset
                    or old_ramp != ramp_up_minutes
                    or old_weekdays != weekdays
                ):
                    _, del_cmds = generators.generate_light_delete_auto_setting_sequence(
                        (0, 0), old_sunrise, old_sunset, old_ramp, weekdays=old_weekdays
                    )
                    commands_to_send.extend(del_cmds)

                existing[schedule_index] = new_sched.to_dict()
            else:
                existing.append(new_sched.to_dict())

            new_options = dict(coord.entry.options)
            new_options["schedules"] = existing
            hass.config_entries.async_update_entry(coord.entry, options=new_options)

        # 2. Keep the existing auto-before-write behavior for compatibility,
        # but sync the local clock first and re-arm auto after writing a slot.
        # This also covers a schedule added during an already-active time window.
        msg_id = (0, len(commands_to_send))
        msg_id, setup_cmds = generators.generate_light_enable_auto_mode_sequence(
            msg_id, dt_util.now()
        )
        commands_to_send.extend(setup_cmds)

        msg_id, add_cmds = generators.generate_light_add_auto_setting_sequence(
            msg_id, sunrise, sunset, brightness, ramp_up_minutes, weekdays=weekdays
        )
        commands_to_send.extend(add_cmds)
        msg_id = encoder.next_message_id(msg_id)
        commands_to_send.append(encoder.create_switch_to_auto_mode_command(msg_id))

        await _execute_on_master_and_slaves(hass, coord, commands_to_send)

    async def handle_light_custom_curve(call: ServiceCall) -> None:
        coord = _get_coordinator(hass, call.data["device_id"])
        if not coord.model_info or coord.model_info.name != "Z Light TINY":
            raise HomeAssistantError(
                "Custom curve editing is currently supported only for Z Light TINY."
            )

        channels = [
            name for name, _ in sorted(coord.model_info.colors.items(), key=lambda item: item[1])
        ]
        normalized: list[dict[str, Any]] = []
        seen: set[int] = set()
        for point in call.data["points"]:
            if not isinstance(point, dict):
                raise HomeAssistantError("Each custom curve point must be a mapping.")
            time_text = point.get("time")
            levels = point.get("levels")
            if not isinstance(time_text, str) or not isinstance(levels, dict):
                raise HomeAssistantError("Custom points require time HH:MM and levels.")
            try:
                time = datetime.time.fromisoformat(time_text)
            except ValueError as exc:
                raise HomeAssistantError(f"Invalid custom point time: {time_text}") from exc
            minute = 60 * time.hour + time.minute
            if time.second or time.microsecond or minute % 30 or minute in seen:
                raise HomeAssistantError("Custom curve times must be unique half-hour slots.")
            seen.add(minute)
            if set(levels) != set(channels):
                raise HomeAssistantError(
                    f"Expected exactly these light channels: {', '.join(channels)}"
                )
            if any(type(levels[key]) is not int or not 0 <= levels[key] <= 100 for key in channels):
                raise HomeAssistantError("Custom curve brightness must be integer 0–100%.")
            normalized.append({
                "time": f"{time.hour:02d}:{time.minute:02d}",
                "levels": {key: levels[key] for key in channels},
            })

        normalized.sort(key=lambda point: point["time"])
        if normalized[0]["time"] != "00:00" or normalized[-1]["time"] != "23:30":
            raise HomeAssistantError("Custom curves must start at 00:00 and end at 23:30.")

        frames = [
            (
                int(p["time"][:2]) * 60 + int(p["time"][3:]),
                tuple(p["levels"][key] for key in channels),
            )
            for p in normalized
        ]
        _, commands = generators.generate_light_set_custom_curve_sequence(
            (0, 0), frames, dt_util.now()
        )
        # Only persist after the Bluetooth transaction completes. BLE writes
        # without response still cannot guarantee that firmware accepted them.
        await _execute_on_master_and_slaves(hass, coord, commands)
        if coord.entry:
            options = dict(coord.entry.options)
            options["custom_curve"] = normalized
            options["light_controller_mode"] = "custom"
            hass.config_entries.async_update_entry(coord.entry, options=options)
            await coord.async_request_refresh()

    async def handle_light_delete_auto_schedule(call: ServiceCall) -> None:
        coord = _get_coordinator(hass, call.data["device_id"])
        schedule_index = call.data.get("schedule_index")

        sunrise_h = call.data.get("sunrise_hour")
        sunrise_m = call.data.get("sunrise_minute")
        sunset_h = call.data.get("sunset_hour")
        sunset_m = call.data.get("sunset_minute")
        # No default: the delete frame must repeat the slot's exact ramp, so an
        # omitted ramp falls back to the stored schedule's value below.
        ramp_up_minutes = call.data.get("ramp_up_minutes")
        weekdays = call.data.get("weekdays")

        if coord.entry:
            existing = list(coord.entry.options.get("schedules", []))
            if schedule_index is not None and 0 <= schedule_index < len(existing):
                target_sched = existing.pop(schedule_index)
                if sunrise_h is None:
                    sunrise_h = target_sched.get("sunrise_hour", 12)
                    sunrise_m = target_sched.get("sunrise_minute", 0)
                if sunset_h is None:
                    sunset_h = target_sched.get("sunset_hour", 20)
                    sunset_m = target_sched.get("sunset_minute", 0)
                if ramp_up_minutes is None and "ramp_up_minutes" in target_sched:
                    ramp_up_minutes = target_sched["ramp_up_minutes"]
                if weekdays is None:
                    from .domain.light.status import LightSchedule

                    temp_sched = LightSchedule.from_dict(target_sched)
                    weekdays = temp_sched.weekdays()

                new_options = dict(coord.entry.options)
                new_options["schedules"] = existing
                hass.config_entries.async_update_entry(coord.entry, options=new_options)

        if (
            sunrise_h is not None
            and sunrise_m is not None
            and sunset_h is not None
            and sunset_m is not None
        ):
            sunrise = datetime.time(sunrise_h, sunrise_m)
            sunset = datetime.time(sunset_h, sunset_m)
            _, commands = generators.generate_light_delete_auto_setting_sequence(
                (0, 0), sunrise, sunset, ramp_up_minutes or 0, weekdays=weekdays
            )
            await _execute_on_master_and_slaves(hass, coord, commands)

    async def handle_light_set_mode(call: ServiceCall) -> None:
        coord = _get_coordinator(hass, call.data["device_id"])
        mode = call.data["mode"]
        if mode == "auto":
            _, commands = generators.generate_light_enable_auto_mode_sequence((0, 0), dt_util.now())
        elif mode == "custom":
            _, commands = generators.generate_light_enable_custom_curve_sequence((0, 0), dt_util.now())
        elif mode == "off":
            _, commands = generators.generate_light_set_brightness_sequence(
                (0, 0), {0: 0, 1: 0, 2: 0, 3: 0}
            )
        else:  # Manual
            # We don't have a specific "enable manual" command other than setting a color,
            # so we just let light_set_manual_mode handle actual manual setting.
            return

        await _execute_on_master_and_slaves(hass, coord, commands)
        if coord.entry and mode in ("auto", "custom"):
            options = dict(coord.entry.options)
            options["light_controller_mode"] = mode
            hass.config_entries.async_update_entry(coord.entry, options=options)

    async def handle_light_clear_schedules(call: ServiceCall) -> None:
        coord = _get_coordinator(hass, call.data["device_id"])

        if coord.entry:
            new_options = dict(coord.entry.options)
            new_options["schedules"] = []
            hass.config_entries.async_update_entry(coord.entry, options=new_options)

        _, commands = generators.generate_light_clear_schedules_sequence((0, 0))
        await _execute_on_master_and_slaves(hass, coord, commands)

    # Register all services
    hass.services.async_register(
        DOMAIN, SERVICE_SET_DOSER_SCHEDULE, handle_set_doser_schedule, schema=DOSER_SCHEDULE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_DOSER_MANUAL, handle_doser_manual_dose, schema=DOSER_MANUAL_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_LIGHT_MANUAL, handle_light_manual_mode, schema=LIGHT_MANUAL_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_LIGHT_AUTO, handle_light_auto_schedule, schema=LIGHT_AUTO_SCHEMA
    )
    hass.services.async_register(
        DOMAIN, SERVICE_SET_LIGHT_CUSTOM, handle_light_custom_curve, schema=LIGHT_CUSTOM_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_DELETE_LIGHT_AUTO,
        handle_light_delete_auto_schedule,
        schema=LIGHT_DELETE_AUTO_SCHEMA,
    )
    hass.services.async_register(
        DOMAIN, SERVICE_ENABLE_LIGHT_AUTO, handle_light_set_mode, schema=LIGHT_MODE_SCHEMA
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_CLEAR_LIGHT_SCHEDULES,
        handle_light_clear_schedules,
        schema=LIGHT_CLEAR_SCHEMA,
    )
