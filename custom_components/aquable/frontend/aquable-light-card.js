/**
 * AquaBle Light Schedule & Control Card
 *
 * A Lovelace card for managing auto-schedules, 24h ramp curves, and manual
 * brightness for Chihiros LED lights via AquaBle.
 */

import { LitElement } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";
import { DOMAIN, SERVICES } from "./constants.js";
import { cardStyles } from "./light-card-styles.js";
import { renderCard } from "./light-card-render.js";

class AquaBleLightCard extends LitElement {
  static get properties() {
    return {
      hass: { type: Object },
      _config: { type: Object },
      _activeTab: { type: String },
      _loading: { type: Boolean },
      _newSchedule: { type: Object },
      _manualLevels: { type: Object },
      _customPoints: { type: Array },
      _customError: { type: String },
      _editingIndex: { type: Number },
    };
  }

  constructor() {
    super();
    this._activeTab = "schedules";
    this._loading = false;
    this._editingIndex = null;
    this._newSchedule = {
      sunriseHour: 12,
      sunriseMinute: 0,
      sunsetHour: 20,
      sunsetMinute: 0,
      rampMinutes: 30,
      weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
      channels: [50, 50, 50, 50],
    };
    this._manualLevels = [0, 0, 0, 0];
    this._manualLevelsLoaded = false;
    this._manualKelvin = 5400;
    this._scheduleKelvin = 5400;
    this._customPoints = [];
    this._customLoadedFor = null;
    this._customError = "";
  }

  setConfig(config) {
    this._config = { ...config };
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (changedProperties.has("hass") || changedProperties.has("_config")) {
      const deviceId = this._deviceId;
      if (deviceId && !this._manualLevelsLoaded) {
        const stored = localStorage.getItem(`aquable_manual_${deviceId}`);
        if (stored) {
          try {
            this._manualLevels = JSON.parse(stored);
          } catch (e) {
            console.error("Failed to parse stored manual levels", e);
          }
        }
        this._manualLevelsLoaded = true;
      }
      if (this._editingIndex === null && this._newSchedule.channels.length !== this._channels.length) this._resetNewSchedule();
      if (deviceId && this._customLoadedFor !== deviceId && this._isTunableWhite) {
        const stored = this._activeSchedulesEntity?.attributes?.custom_curve;
        this._customPoints = Array.isArray(stored) && stored.length
          ? stored.map(point => ({time: point.time, levels: {...point.levels}}))
          : this._defaultCustomPoints();
        this._customLoadedFor = deviceId;
      }
    }
  }

  static get styles() {
    return cardStyles;
  }

  render() {
    return renderCard(this);
  }

  // --- Entity & Device Resolution ---

  get _activeSchedulesEntity() {
    if (!this.hass) return null;
    if (this._config && this._config.entity) {
      return this.hass.states[this._config.entity] || null;
    }
    // Auto-discover active schedules sensor
    const entityId = Object.keys(this.hass.states).find(
      (id) => id.startsWith("sensor.") && id.includes("active_schedules")
    );
    return entityId ? this.hass.states[entityId] : null;
  }

  get _syncState() {
    if (!this.hass) return null;
    const activeEntity = this._activeSchedulesEntity;
    if (activeEntity) {
      const syncEntityId = activeEntity.entity_id.replace("active_schedules", "hardware_sync");
      if (this.hass.states[syncEntityId]) {
        return this.hass.states[syncEntityId];
      }
    }
    const fallbackId = Object.keys(this.hass.states).find(
      (id) => id.startsWith("sensor.") && id.includes("hardware_sync")
    );
    return fallbackId ? this.hass.states[fallbackId] : null;
  }

  get _deviceName() {
    const active = this._activeSchedulesEntity;
    if (active && active.attributes && active.attributes.friendly_name) {
      return active.attributes.friendly_name.replace(" Active Schedules", "");
    }
    return "AquaBle Light";
  }

  get _schedules() {
    const active = this._activeSchedulesEntity;
    if (active && active.attributes && Array.isArray(active.attributes.schedules)) {
      return active.attributes.schedules;
    }
    return [];
  }

  get _channels() {
    const keys = this._activeSchedulesEntity?.attributes?.channel_keys;
    const names = Array.isArray(keys) && keys.length ? keys : ["red", "green", "blue", "white"];
    const colors = { red: ["Red", "#f44336"], green: ["Green", "#4caf50"], blue: ["Blue", "#2196f3"], white: ["White", "#d6eaff"], warm_white: ["Warm White", "#ffbd67"] };
    return names.map(key => ({ key, name: colors[key]?.[0] ?? key, hex: colors[key]?.[1] ?? "#aaa" }));
  }

  get _isTunableWhite() {
    return this._channels.length === 2 && this._channels[0].key === "white" && this._channels[1].key === "warm_white";
  }

  get _deviceId() {
    if (this._config && this._config.device_id) {
      return this._config.device_id;
    }
    // Find device ID via entity registry / hass devices if available
    const active = this._activeSchedulesEntity;
    return active ? (active.attributes.device_id || active.entity_id) : "";
  }

  // --- UI Event Handlers ---

  _setTab(tab) {
    if (tab !== "add" && this._editingIndex !== null) {
      this._editingIndex = null;
      this._resetNewSchedule();
    }
    this._activeTab = tab;
  }

  _resetNewSchedule() {
    this._newSchedule = {
      sunriseHour: 12,
      sunriseMinute: 0,
      sunsetHour: 20,
      sunsetMinute: 0,
      rampMinutes: 30,
      weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
      channels: this._channels.map(() => 50),
    };
  }

  _startEditSchedule(index) {
    const schedules = this._schedules;
    if (index < 0 || index >= schedules.length) return;
    const sched = schedules[index];

    const partsSunrise = (sched.sunrise || "12:00").split(":").map(Number);
    const partsSunset = (sched.sunset || "20:00").split(":").map(Number);
    const channels = sched.channels || sched.channel_brightness || [50, 50, 50, 50];
    const weekdays = Array.isArray(sched.weekdays)
      ? [...sched.weekdays]
      : ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

    this._editingIndex = index;
    this._newSchedule = {
      sunriseHour: partsSunrise[0] ?? 12,
      sunriseMinute: partsSunrise[1] ?? 0,
      sunsetHour: partsSunset[0] ?? 20,
      sunsetMinute: partsSunset[1] ?? 0,
      // Older schedules may have a 0-minute ramp; the service now requires >= 1.
      rampMinutes: Math.max(1, sched.ramp_up_minutes ?? 30),
      weekdays: weekdays,
      channels: [...channels],
    };
    this._scheduleKelvin = this._temperature(channels, 5400);
    this._activeTab = "add";
  }

  _cancelEdit() {
    this._editingIndex = null;
    this._resetNewSchedule();
    this._activeTab = "schedules";
  }

  _updateNewSchedule(key, value) {
    this._newSchedule = {
      ...this._newSchedule,
      [key]: value,
    };
  }

  _updateChannelLevel(index, value) {
    const updated = [...this._newSchedule.channels];
    updated[index] = value;
    this._newSchedule = {
      ...this._newSchedule,
      channels: updated,
    };
  }

  _toggleWeekday(key) {
    const current = this._newSchedule.weekdays;
    let next;
    if (current.includes(key)) {
      next = current.filter((d) => d !== key);
    } else {
      next = [...current, key];
    }
    this._newSchedule = {
      ...this._newSchedule,
      weekdays: next,
    };
  }

  _temperature(levels, fallback = 5400) {
    const total = (levels[0] || 0) + (levels[1] || 0);
    return total ? Math.round(2800 + 5200 * levels[0] / total) : fallback;
  }

  _setWhiteMix(mode, { kelvin, brightness } = {}) {
    if (!this._isTunableWhite) return;
    const manual = mode === "manual";
    const levels = manual ? this._manualLevels : this._newSchedule.channels;
    const fallback = manual ? this._manualKelvin : this._scheduleKelvin;
    const temperature = Math.max(2800, Math.min(8000, kelvin ?? this._temperature(levels, fallback)));
    const intensity = Math.max(0, Math.min(100, brightness ?? ((levels[0] || 0) + (levels[1] || 0))));
    const cool = Math.round(intensity * (temperature - 2800) / 5200);
    const updated = [cool, Math.round(intensity - cool)];
    if (manual) {
      this._manualKelvin = temperature;
      this._manualLevels = updated;
      if (this._deviceId) localStorage.setItem(`aquable_manual_${this._deviceId}`, JSON.stringify(updated));
    } else {
      this._scheduleKelvin = temperature;
      this._newSchedule = { ...this._newSchedule, channels: updated };
    }
  }

  _updateManualLevel(index, value) {
    const updated = [...this._manualLevels];
    updated[index] = value;
    this._manualLevels = updated;
    const deviceId = this._deviceId;
    if (deviceId) {
      localStorage.setItem(`aquable_manual_${deviceId}`, JSON.stringify(updated));
    }
  }

  _defaultCustomPoints() {
    const values = (warm) => Object.fromEntries(
      this._channels.map(({key}) => [key, key === "warm_white" ? warm : 0])
    );
    return [
      {time: "00:00", levels: values(0)},
      {time: "12:00", levels: values(35)},
      {time: "20:00", levels: values(35)},
      {time: "23:30", levels: values(0)},
    ];
  }

  _updateCustomPoint(index, field, value) {
    this._customPoints = this._customPoints.map((point, idx) => idx === index
      ? field === "time"
        ? {...point, time: value}
        : {...point, levels: {...point.levels, [field]: value}}
      : point
    );
    this._customError = "";
  }

  _addCustomPoint() {
    if (this._customPoints.length >= 16) return;
    const occupied = new Set(this._customPoints.map(point => point.time));
    const time = Array.from({length: 46}, (_, idx) => {
      const minute = (idx + 1) * 30;
      return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    }).find(t => !occupied.has(t));
    if (time) {
      this._customPoints = [...this._customPoints, {
        time, levels: Object.fromEntries(this._channels.map(({key}) => [key, 0]))
      }].sort((a, b) => a.time.localeCompare(b.time));
    }
  }

  _removeCustomPoint(index) {
    if (this._customPoints.length <= 2 || ["00:00", "23:30"].includes(this._customPoints[index]?.time)) return;
    this._customPoints = this._customPoints.filter((_, i) => i !== index);
  }

  async _applyCustomCurve() {
    if (!this.hass || !this._isTunableWhite) return;
    const points = [...this._customPoints].sort((a, b) => a.time.localeCompare(b.time));
    const times = points.map(point => {
      const match = /^(\d{2}):(\d{2})$/.exec(point.time);
      return match ? Number(match[1]) * 60 + Number(match[2]) : -1;
    });
    if (points.length < 2 || points.length > 16 ||
        points[0]?.time !== "00:00" || points.at(-1)?.time !== "23:30" ||
        times.some(t => t < 0 || t > 1410 || t % 30) ||
        new Set(times).size !== times.length) {
      this._customError = "Use unique 30-minute times between 00:00 and 23:30, including both endpoints.";
      return;
    }
    this._loading = true;
    this._customError = "";
    try {
      await this.hass.callService(DOMAIN, SERVICES.SET_LIGHT_CUSTOM, {
        device_id: this._deviceId,
        points,
      });
      this._customPoints = points;
    } catch (error) {
      this._customError = error?.message || "Could not send custom curve";
      console.error("Failed to send custom curve:", error);
    } finally {
      this._loading = false;
    }
  }

  // --- Service Actions ---

  async _saveSchedule() {
    if (!this.hass) return;
    this._loading = true;
    try {
      const active = this._activeSchedulesEntity;
      const deviceId = this._config?.device_id || active?.entity_id;

      const payload = {
        device_id: deviceId,
        sunrise_hour: this._newSchedule.sunriseHour,
        sunrise_minute: this._newSchedule.sunriseMinute,
        sunset_hour: this._newSchedule.sunsetHour,
        sunset_minute: this._newSchedule.sunsetMinute,
        ramp_up_minutes: this._newSchedule.rampMinutes,
        ...Object.fromEntries(this._channels.map((channel, idx) => [channel.key, this._newSchedule.channels[idx] ?? 0])),
        weekdays: this._newSchedule.weekdays,
      };

      if (this._editingIndex !== null) {
        payload.schedule_index = this._editingIndex;
      }

      await this.hass.callService(DOMAIN, SERVICES.SET_LIGHT_AUTO, payload);
      this._editingIndex = null;
      this._resetNewSchedule();
      this._activeTab = "schedules";
    } catch (err) {
      console.error("Failed to push auto schedule:", err);
    } finally {
      this._loading = false;
    }
  }

  async _deleteSchedule(index) {
    if (!this.hass) return;
    const schedules = this._schedules;
    if (index < 0 || index >= schedules.length) return;
    const sched = schedules[index];
    const label = `Slot #${sched.slot || index + 1} (${sched.sunrise} - ${sched.sunset})`;
    if (!confirm(`Are you sure you want to delete ${label}?`)) {
      return;
    }
    this._loading = true;
    try {
      const active = this._activeSchedulesEntity;
      const deviceId = this._config?.device_id || active?.entity_id;

      await this.hass.callService(DOMAIN, SERVICES.DELETE_LIGHT_AUTO, {
        device_id: deviceId,
        schedule_index: index,
      });
      if (this._editingIndex === index) {
        this._editingIndex = null;
        this._resetNewSchedule();
        this._activeTab = "schedules";
      }
    } catch (err) {
      console.error("Failed to delete auto schedule:", err);
    } finally {
      this._loading = false;
    }
  }

  async _clearSchedules() {
    if (!this.hass) return;
    if (!confirm("Are you sure you want to clear all auto-schedules from this light?")) {
      return;
    }
    this._loading = true;
    try {
      const active = this._activeSchedulesEntity;
      const deviceId = this._config?.device_id || active?.entity_id;

      await this.hass.callService(DOMAIN, SERVICES.CLEAR_LIGHT_SCHEDULES, {
        device_id: deviceId,
      });
    } catch (err) {
      console.error("Failed to clear schedules:", err);
    } finally {
      this._loading = false;
    }
  }

  async _setLightMode(mode) {
    if (!this.hass) return;
    this._loading = true;
    try {
      const active = this._activeSchedulesEntity;
      const deviceId = this._config?.device_id || active?.entity_id;

      await this.hass.callService(DOMAIN, SERVICES.ENABLE_LIGHT_AUTO, {
        device_id: deviceId,
        mode: mode,
      });
    } catch (err) {
      console.error("Failed to set light mode:", err);
    } finally {
      this._loading = false;
    }
  }

  async _applyManualBrightness() {
    if (!this.hass) return;
    this._loading = true;
    try {
      const active = this._activeSchedulesEntity;
      const deviceId = this._config?.device_id || active?.entity_id;

      await this.hass.callService(DOMAIN, SERVICES.SET_LIGHT_MANUAL, {
        device_id: deviceId,
        ...Object.fromEntries(this._channels.map((channel, idx) => [channel.key, this._manualLevels[idx] ?? 0])),
      });
    } catch (err) {
      console.error("Failed to set manual brightness:", err);
    } finally {
      this._loading = false;
    }
  }
}

if (!customElements.get("aquable-light-card")) {
  customElements.define("aquable-light-card", AquaBleLightCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "aquable-light-card")) {
  window.customCards.push({
    type: "aquable-light-card",
    name: "AquaBle Light Schedule Card",
    description: "Visualise 24h ramp curves and configure auto-schedules for Chihiros LED lights.",
  });
}
