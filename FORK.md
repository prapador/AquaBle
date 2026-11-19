# AquaBle Tiny fork — installation and migration notes

This is a personal fork of [caleb-venner/AquaBle](https://github.com/caleb-venner/AquaBle).
Keep the original project's attribution and license. The fork uses the same Home Assistant integration domain, `aquable`.

## Added in v4.1.1 and fixed in v4.1.2

- The `warm_white` parameter is accepted by `aquable.light_set_manual_mode` and `aquable.light_set_auto_schedule`.
- The Active Schedules sensor exposes ordered `channel_keys`; the custom card presents the correct sliders for each supported model.
- For the Chihiros Z Light Tiny (cool white / warm white), the card includes an **approximate** 2800–8000 K slider and a combined brightness control for manual and schedule settings.
- Two-channel SVG ramp curves use Lit's `svg` tag, instead of an HTML template inside SVG.
- v4.1.2 synchronizes the light's RTC with Home Assistant's configured local timezone and re-arms Auto after schedule writes. This needs physical verification on the Tiny.

**Caution:** The Kelvin calculation is a *linear mixer between two LED channels*, not a calibrated spectral or CCT conversion. Test low manual intensities first. The final curve fix and persistence of scheduled two-channel commands still need physical verification.

## Install on a new Home Assistant setup (2026.11+)

1. Open **Settings → Marketplace**.
2. Choose **Add from link** and enter `https://github.com/prapador/AquaBle`.
3. Connect **GitHub in Home Assistant Marketplace** when requested (this is separate from connecting GitHub to ChatGPT).
4. Choose the custom integration repository, install the latest default branch, and restart Home Assistant.
5. Add AquaBle from **Settings → Devices & services** and configure the Chihiros device.

There are currently no GitHub releases for this fork; Marketplace can install/update the latest default branch without releases. It checks custom repositories for updates periodically, and the installed manifest version is set to `4.1.1`.

## Existing official AquaBle installation — IMPORTANT

The official repo and this fork have the **same `aquable` domain**. Home Assistant Marketplace 2026.11 does not support installing both simultaneously. Its uninstall flow can require **removing the configured integration entry**, which removes devices and entities. This problem has been reported upstream in Home Assistant [issue #190454](https://github.com/home-assistant/core/issues/190454).

**Do not select “Delete and uninstall” without a complete Home Assistant backup and a migration plan.** Installing the fork in Marketplace is not automatically safe just because the files work when copied manually.

**Non-destructive interim option:**

1. Keep the existing Marketplace installation and its configuration entry.
2. Disable or ignore official AquaBle automatic updates.
3. Make a backup of `/config/custom_components/aquable`.
4. Download the default branch of this fork, then copy only `custom_components/aquable/` over `/config/custom_components/aquable/` (do not delete `.storage` or any integration entries).
5. Restart Home Assistant and refresh the frontend. This **runs fork code but does not transfer update ownership** to the fork; reapply after official Marketplace updates.

**Full Marketplace ownership switch (destructive unless devices/entities are restored):**

1. Take a full Home Assistant backup and export/document existing AquaBle device IDs, configuration, entities, schedule settings, and dependent dashboards/automations.
2. In Settings → Marketplace, uninstall the official repository. If Home Assistant requires deleting active AquaBle configuration entries, understand that this deletes associated devices and entities and can affect automation references. Stop unless you can restore and validate these.
3. Add `https://github.com/prapador/AquaBle` using **Add from link**, install, restart, and add/reconfigure AquaBle.
4. Verify all entity IDs and restore/relink devices, schedules, dashboards, and scripts from backups as needed.

This fork does not yet provide a lossless automatic Marketplace-ownership migration.

## Bringing upstream changes into the fork

The fork retains GitHub's upstream relationship. Review upstream changes on a temporary branch/PR, test for conflicts with Tiny channel handling, then merge into `main` and increment `manifest.json`'s version. Do not blindly overwrite Tiny changes from upstream.

## References

- [Home Assistant Marketplace documentation](https://www.home-assistant.io/integrations/marketplace)
- [Marketplace repository format and updates](https://contributors.home-assistant.io/marketplace/how-it-works/)
- [Home Assistant same-domain migration issue](https://github.com/home-assistant/core/issues/190454)
