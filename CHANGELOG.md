# Changelog

## [v4.1.6] — 2026-11-19 — prapador fork (experimental Custom diagnostics)

- Custom Curve uploads now prefer **GATT write-with-response** whenever the Tiny's transmit characteristic supports it, matching the transport used by My Chihiros. Other operations (manual/scene/doser) continue using their existing transport.
- When no acknowledged writes are supported, use the existing no-response transport and log a warning; reject oversized unacknowledged frames rather than silently treating them as saved.
- Improved Home Assistant logs: show frame count, whether GATT write responses were available, and explicitly state that successful transport does **not** verify execution by the lamp firmware.
- Custom Curve card now distinguishes **unsent edits**, **loaded Home Assistant settings**, and the **last successful send time**. Updating a slider or a time never silently uploads the curve.
- Does not alter the existing Custom Curve controller commands, curve timing/interpolation or channel mapping, which require physical testing before further changes.

**Diagnostic:** A curve changed after its scheduled switch-off time might not be reevaluated immediately by the lamp firmware. To test, program a future half-hour switch-off point, apply the curve, and observe the actual lamp at that time.


## [v4.1.5] — 2026-11-19 — prapador fork

- Tiny Custom Curve: **move editing blocks up/down** with accessible arrow controls. Their visual order is independent of the chronologically sorted curve graph and Bluetooth commands.
- Preserve the editor's chosen block order in Home Assistant config entries when pressing **Apply Custom Curve**, including synchronized slave devices.
- Mark **00:00 and 23:30 as fixed daily anchor points**. These required endpoints cannot be edited or removed, but can be moved visually.
- Fix duplicate-time editing: only the first actual anchor is locked; a second accidentally duplicated `23:30` remains editable/removable. Duplicate time blocks are highlighted and rejected before sending to the lamp.
- No changes to the working Tiny Custom Curve BLE command format.


## [v4.1.4] — 2026-11-19 — prapador fork

- **Tiny Custom Curve UX:** Every control point now shows approximate color temperature (2800–8000 K), combined brightness and individual cool/warm white channel levels. Values update together when Kelvin or brightness changes; only physical channel levels are sent to the lamp.
- Both Auto and Custom preview charts now have a labeled **0–100% vertical axis**.
- **Tiny Scene Auto** now has a single daily sunrise/sunset form and plot in one tab. Saving replaces all older scene slots with one fresh scene; other models retain multi-schedule support.
- Scene replacement writes a scene-specific reset and keeps Custom controller data separate. Existing Custom curves are not deleted when saving a Scene Auto schedule.
- All functionality remains experimental until physically checked on the Tiny. In particular, the Scene Auto firmware behavior has not yet been confirmed, whereas Custom was reported working in the previous version.


## [v4.1.3] — 2026-11-19 — prapador fork (experimental)

**Z Light Tiny Custom Curve controller**, separate from the existing Scene Auto controller.

- New **Custom Curve** Lovelace tab for Tiny with a 24-hour curve preview, per-channel white/warm-white levels and 30-minute keyframe times.
- New `aquable.light_set_custom_curve` action, accepting 2–16 `{time: HH:MM, levels: {white, warm_white}}` points.
- BLE sequence: local clock sync → custom reset (`0x5A/0x05 [5,FF,FF]`) → custom enable (`[3,FF,FF]`) → per-channel custom keyframe writes (`0x5A/0x06`).
- Separate Custom and Scene Auto buttons. Correct scene schedule deletion reset (`[40,FF,FF]`), rather than accidentally clearing Custom curves.
- Preserve 90% intensity bytes in Custom curve writes and store submitted curve data for dashboard editing.
- BLE encoding regressions added, with CI compiling the integration and running protocol unit tests.

**Important:** Physical Tiny compatibility is not confirmed; Custom curve writes use BLE writes without acknowledgment. Test at low intensity and confirm the light switches on within an active interval. The green SYNCED badge checks device time, not actual curve activation.


## [v4.1.2] — 2026-11-19 — prapador fork

**Fix: automatic light schedules may stay off while manual brightness works.**

- Use Home Assistant's configured local time when syncing light clocks, rather than naive system `datetime.now()` (which can be UTC on HA OS).
- When switching to Auto, synchronize the device clock **before** re-enabling the scheduler.
- After adding or editing a hardware schedule, send commands in the order **set local time → enable Auto → write schedule → re-enable Auto**, so the device can reevaluate the active time window.
- Use the local timezone also when regenerating time commands for synchronized secondary lights.
- Include regression tests for clock frames, auto-mode order and the Tiny warm-white schedule payload.

**Hardware validation pending:** This release addresses two plausible causes found in source review. Device firmware behavior must still be verified with a Chihiros Tiny. Back up your Home Assistant configuration before updating.

## [v4.1.1] — 2026-11-19 — prapador fork

**Chihiros Z Light Tiny two-channel support (fork-only release candidate).**

- Add `warm_white` to manual mode and automatic-schedule Home Assistant actions.
- Expose channel order through the active-schedules sensor and render model-specific channel sliders on the light card.
- Add approximate 2800–8000 K mixing and combined brightness controls for the Tiny's cool and warm-white channels.
- Fix SVG curve generation for dynamic channels using Lit's SVG template helper.
- Keep the same `aquable` integration domain and device identifiers; no configuration-entry migration is required by the code itself.

**Limitations:** Kelvin conversion has not been calibrated; the latest SVG correction and schedule persistence still require confirmation on real hardware. Switching Marketplace repository ownership on Home Assistant 2026.11 might require removing existing integration config entries; see [FORK.md](./FORK.md) and back up first.


All notable changes to AquaBle are documented here.

---

## [v4.1.0] — 2026-11-15

**Light master/slave sync, decimal doser targets, and schedule fixes.**

**Feat:**
- **Light sync (master/slave):** a light can now mirror its commands to other lights of the same model. Set it up under **Configure** on the master light's AquaBle entry. Schedules, manual brightness, mode changes and schedule deletes/clears sent to the master are repeated on each selected light, and the master's stored schedules are copied to them. Lights only; dosers are not synced. See [Light Sync](README.md#light-sync-optional).
- Pushing a light schedule now also syncs the light's clock and switches it to auto mode, so a new schedule runs straight away.
- Added translations (`translations/en.json`), so the config flow, the light sync options screen and the "refresh your browser" repair issue show proper text instead of raw keys.

**Fix:**
- **Doser decimal targets (#9):** a daily target such as 0.5 mL read back as 0, and the doser card then fell back to 5 mL. The pump only reports targets in whole mL, so AquaBle now stores the exact target it sends and the Target Dose sensor shows it while it still agrees with the pump. If the target is changed in the Chihiros app, the sensor falls back to the pump's value.
  - Targets set before this update show the whole-mL value until they are saved again from Home Assistant.
- **Doser card:** no longer replaces a 0 reading with a 5 mL default when editing or re-enabling a head, and refuses to save a blank or negative target.
- **Doser card:** the manual dose input now accepts 0.1 mL steps (e.g. 0.3 mL was previously rejected).
- Doser volumes are rounded rather than truncated when converted to tenths of a mL.
- Lights that never send the `0xFE` status packet (e.g. WRGB II Pro firmware v21) no longer fail setup on a fresh install (#5).
- Deleting a light schedule now sends the schedule's stored ramp time, so the delete matches the slot on the light.

**Changed:**
- Light schedule ramp time now has a **minimum of 1 minute** (was 0) in `aquable.light_set_auto_schedule`. Existing schedules with a 0-minute ramp can still be deleted, and get 1 minute when edited.
- The light card's ramp slider now starts at 5 minutes.

**Docs:**
- `BLE_Protocol.md`: the `0xFE` tail target is whole mL (truncated), not tenths; `0x22` is the scheduled dosed-today totals, not a target ACK; added notes on how manual doses are counted.

---

## [v4.0.3] — 2026-08-31

**Improve light device command & control logic.**

**Fix:**
- Resolve bug in update schedule feature (variable name mismatch)

**Feat:**
- Prevent schedule collisions by checking for overlaps in the service handler.
- Manual setting on light device card should persist until altered. (last command sent)

---

## [v4.0.2] — 2026-08-28

**Fix:** 
- Resolve bug in **Light Device**->*Add Schedule*: If a schedule command was sent with Red = 0 and White > 0 on a 4 channel device, Red would inherit White brightness value; Red = White > 0.

**Feat:** 
- *Expand supported devices:*
  - Update prefix mappings for supported devices. 
  - Implement dynamic sensor labelling in sensor.py

---

## [v4.0.1] — 2026-08-27

**docs**: fix README rendering issue when view in HACS 
- remove inline html 
- replace with table formatting

---

## [v4.0.0] — 2026-08-27

> ⚠️ **Breaking change**: Configuration will need to be re-entered after upgrading. See [README](README.md) for setup instructions.

### Dashboard Cards (New)

Two purpose-built Lovelace cards are now automatically registered on installation — no manual resource setup needed.

**Light Card** (`aquable-light-card`):
- Interactive 24-hour SVG ramp curve visualiser across all active schedules with a live time-of-day marker.
- Add, edit, and delete individual schedule slots directly from the card.
- Per-channel peak brightness sliders (Red, Green, Blue, White), ramp duration, and active weekday selection.
- Instant manual brightness override and mode switcher (Auto, Manual, Off).

**Doser Card** (`aquable-doser-card`):
- 4-head monitoring grid with live progress bars (dosed today vs daily target).
- Per-head active/disabled toggle and quick manual dose buttons.
- Per-head schedule configuration (target volume, run time, weekday filter).

### Architecture
- Stateless functional architecture — Home Assistant is the source of truth for all schedule configuration.
- Real-time channel brightness sensors interpolated locally every second with zero BLE polling overhead.

### Sensors
- **Dosing Pump**: Dosed Today, Target Dose, Schedule Time, Mode, and Lifetime Total per head (1–4).
- **LED Light**: Active Schedules (with full definitions in attributes), Hardware Sync status, and Live Channel Brightness per channel.

### Services / Actions
- `aquable.light_set_auto_schedule` — add or update a schedule slot.
- `aquable.light_delete_auto_schedule` — delete an individual schedule slot from hardware.
- `aquable.light_clear_schedules` — wipe all schedules from device memory.
- `aquable.light_set_manual_mode` — set static channel brightness levels.
- `aquable.light_set_mode` — switch between Auto, Manual, and Off.
- `aquable.doser_set_daily_dose_sequence` — configure a full daily dosing schedule per head.
- `aquable.doser_manual_dose` — trigger an immediate one-shot dose.

### Device Support
- Added `DYNT90` support (Chihiros WRGB II) — thanks to [@dmitry-puchkov](https://github.com/dmitry-puchkov).

---

## [v2.2.6] — Prior Release

See [GitHub Releases](https://github.com/caleb-venner/AquaBle/releases) for earlier version history.
