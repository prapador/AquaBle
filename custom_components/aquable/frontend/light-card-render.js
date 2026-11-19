import { html, svg } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";
import { WEEKDAYS } from "./constants.js";

// Both charts share the same 0–100% Y scale and 24-hour X scale.
const PLOT = {left: 36, right: 352, top: 10, bottom: 104};
const plotX = minutes => PLOT.left + minutes / 1440 * (PLOT.right - PLOT.left);
const plotY = percent => PLOT.bottom - Math.max(0, Math.min(100, percent)) / 100 * (PLOT.bottom - PLOT.top);

function renderChartAxes() {
  return svg`
    <g class="timeline-grid">
      ${[0, 25, 50, 75, 100].map(percent => svg`
        <line x1="${PLOT.left}" y1="${plotY(percent)}" x2="${PLOT.right}" y2="${plotY(percent)}" />
      `)}
      ${[6, 12, 18].map(hour => svg`
        <line x1="${plotX(hour * 60)}" y1="${PLOT.top}" x2="${plotX(hour * 60)}" y2="${PLOT.bottom}" />
      `)}
    </g>
    <g class="timeline-axis">
      ${[0, 25, 50, 75, 100].map(percent => svg`
        <text x="31" y="${plotY(percent) + 3}" text-anchor="end">${percent}%</text>
      `)}
      ${[0, 6, 12, 18, 24].map(hour => svg`
        <text x="${plotX(hour * 60)}" y="120"
          text-anchor="${hour === 0 ? 'start' : hour === 24 ? 'end' : 'middle'}">
          ${String(hour).padStart(2, '0')}:00
        </text>
      `)}
    </g>
  `;
}

/** Generate a sampled 24-hour ramp at the shared chart coordinates. */
function generateChannelPath(schedules, chIdx) {
  const points = [];
  for (let m = 0; m <= 1440; m += 10) {
    let peakBrightness = 0;
    for (const sched of schedules || []) {
      const [sh, sm] = (sched.sunrise || '00:00').split(':').map(Number);
      const [eh, em] = (sched.sunset || '00:00').split(':').map(Number);
      const from = sh * 60 + sm, to = eh * 60 + em;
      const ramp = sched.ramp_up_minutes || 0;
      const brightness = (sched.channels || sched.channel_brightness || [])[chIdx] ?? 0;
      if (to <= from || m < from || m > to) continue;
      let level = brightness;
      if (ramp && m < from + ramp) level *= (m - from) / ramp;
      else if (ramp && m > to - ramp) level *= (to - m) / ramp;
      peakBrightness = Math.max(peakBrightness, level);
    }
    points.push(`${points.length ? 'L' : 'M'} ${plotX(m).toFixed(1)},${plotY(peakBrightness).toFixed(1)}`);
  }
  return points.join(' ');
}

export function renderCard(card) {
  const syncState = card._syncState;
  const syncStatus = syncState ? syncState.state : "unavailable";
  const deviceTime = syncState && syncState.attributes ? syncState.attributes.device_time : null;

  return html`
    <ha-card>
      <div class="card-header">
        <div class="card-title">
          <ha-icon icon="mdi:lightbulb-group"></ha-icon>
          <span>${card._deviceName || "AquaBle Light"}</span>
        </div>
        <div class="sync-badge ${syncStatus === 'synced' ? 'synced' : 'unavailable'}">
          ${syncStatus === "synced" ? `Clock reported ${deviceTime || ""}` : "Clock unavailable"}
        </div>
      </div>

      <div class="tabs">
        <div
          class="tab ${card._activeTab === 'schedules' ? 'active' : ''}"
          @click=${() => card._setTab('schedules')}
        >
          ${card._isTunableWhite ? "Auto" : "Schedules & Curve"}
        </div>
        ${!card._isTunableWhite ? html`
          <div class="tab ${card._activeTab === 'add' ? 'active' : ''}"
            @click=${() => card._setTab('add')}>
            ${card._editingIndex !== null ? `Edit Slot #${card._editingIndex + 1}` : "Add Schedule"}
          </div>
        ` : ''}
        ${card._isTunableWhite ? html`
          <div class="tab ${card._activeTab === 'custom' ? 'active' : ''}"
            @click=${() => card._setTab('custom')}>Custom Curve</div>
        ` : ''}
        <div
          class="tab ${card._activeTab === 'manual' ? 'active' : ''}"
          @click=${() => card._setTab('manual')}
        >
          Manual Control
        </div>
      </div>

      ${card._activeTab === 'schedules' ? renderSchedulesTab(card) : ''}
      ${card._activeTab === 'add' && !card._isTunableWhite ? renderAddTab(card) : ''}
      ${card._activeTab === 'custom' && card._isTunableWhite ? renderCustomTab(card) : ''}
      ${card._activeTab === 'manual' ? renderManualTab(card) : ''}
    </ha-card>
  `;
}

function renderSchedulesTab(card) {
  const schedules = card._schedules;
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentX = plotX(currentMinutes);

  return html`
    <div class="section">
      <div class="section-title">
        <ha-icon icon="mdi:chart-bell-curve-cumulative"></ha-icon>
        24-Hour Ramp Profile
      </div>
      <div class="timeline-container">
        <svg class="curve-svg" viewBox="0 0 360 124" preserveAspectRatio="none">
          ${renderChartAxes()}

          <!-- Channel Curves -->
          ${card._channels.map((channel, idx) => svg`
            <path d="${generateChannelPath(schedules, idx)}" fill="none" stroke="${channel.hex}" stroke-width="2" />
          `)}

          <!-- Current Time Indicator -->
          <line class="time-marker-line" x1="${currentX}" y1="${PLOT.top}" x2="${currentX}" y2="${PLOT.bottom}" />

        </svg>
      </div>

      ${card._isTunableWhite ? html`
        <div class="section-title"><ha-icon icon="mdi:calendar-clock"></ha-icon>Auto · One schedule</div>
        <p class="custom-help">A single sunrise/sunset schedule, as in My Chihiros. Saving replaces previous Scene Auto slots; Custom curves remain untouched.</p>
        ${schedules.length > 1 ? html`<p class="custom-help">This device has ${schedules.length} legacy scenes. Saving will replace them with one schedule.</p>` : ''}
        ${renderAddTab(card)}
        ${card._sceneError ? html`<p class="custom-error">${card._sceneError}</p>` : ''}
        <div class="button-row"><mwc-button outlined class="danger-btn"
          @click=${() => card._clearSchedules()}
          ?disabled=${card._loading || !schedules.length}>Clear Auto Schedule</mwc-button></div>
      ` : html`
      <div class="section-title">
        <ha-icon icon="mdi:calendar-clock"></ha-icon>
        Configured Schedules (${schedules.length})
      </div>

      ${schedules.length === 0
        ? html`<div class="empty-state">No auto-schedules configured. Use the 'Add Schedule' tab to create one.</div>`
        : html`
            <div class="schedule-list">
              ${schedules.map(
                (sched, idx) => html`
                  <div
                    class="schedule-item clickable"
                    @click=${() => card._startEditSchedule(idx)}
                    title="Click to edit schedule"
                  >
                    <div class="schedule-item-header">
                      <div class="schedule-times">
                        <span>${sched.sunrise}</span>
                        <ha-icon icon="mdi:arrow-right-thin"></ha-icon>
                        <span>${sched.sunset}</span>
                      </div>
                      <div class="schedule-actions">
                        <span class="sync-badge synced">Slot #${sched.slot || idx + 1}</span>
                        <button
                          class="icon-btn edit-btn"
                          title="Edit Schedule"
                          @click=${(e) => {
                            e.stopPropagation();
                            card._startEditSchedule(idx);
                          }}
                        >
                          <ha-icon icon="mdi:pencil-outline"></ha-icon>
                        </button>
                        <button
                          class="icon-btn delete-btn"
                          title="Delete Schedule"
                          @click=${(e) => {
                            e.stopPropagation();
                            card._deleteSchedule(idx);
                          }}
                        >
                          <ha-icon icon="mdi:delete-outline"></ha-icon>
                        </button>
                      </div>
                    </div>
                    <div class="schedule-meta">
                      <span><strong>Ramp:</strong> ${sched.ramp_up_minutes} min</span>
                      <span><strong>Days:</strong> ${Array.isArray(sched.weekdays) ? sched.weekdays.join(", ") : "Everyday"}</span>
                    </div>
                    <div class="channel-pills">
                      ${(sched.channels || sched.channel_brightness || []).map(
                        (b, cIdx) => html`
                          <div class="channel-pill ${card._channels[cIdx]?.key || 'white'}">
                            ${card._channels[cIdx]?.name || `Ch${cIdx}`}: ${b}%
                          </div>
                        `
                      )}
                    </div>
                  </div>
                `
              )}
            </div>
          `}

      <div class="button-row">
        <mwc-button
          class="danger-btn"
          outlined
          @click=${() => card._clearSchedules()}
          ?disabled=${card._loading || schedules.length === 0}
        >
          <ha-icon icon="mdi:trash-can-outline" slot="icon"></ha-icon>
          Clear All Schedules
        </mwc-button>
      </div>
      `}
    </div>
  `;
}

function renderAddTab(card) {
  const isEditing = card._editingIndex !== null && !card._isTunableWhite;

  return html`
    <div class="section">
      <div class="section-title">
        <ha-icon icon="${isEditing ? 'mdi:calendar-edit' : 'mdi:clock-outline'}"></ha-icon>
        ${card._isTunableWhite ? "Daily Auto Schedule" : isEditing ? `Edit Schedule (Slot #${card._editingIndex + 1})` : "Schedule Timing"}
      </div>
      <div class="form-grid">
        <div class="time-input-group">
          <label>Sunrise / Dawn Start</label>
          <div class="time-pickers">
            <input
              type="number"
              min="0"
              max="23"
              .value=${card._newSchedule.sunriseHour}
              @change=${(e) => card._updateNewSchedule('sunriseHour', parseInt(e.target.value, 10))}
            />
            <span>:</span>
            <input
              type="number"
              min="0"
              max="59"
              .value=${card._newSchedule.sunriseMinute}
              @change=${(e) => card._updateNewSchedule('sunriseMinute', parseInt(e.target.value, 10))}
            />
          </div>
        </div>

        <div class="time-input-group">
          <label>Sunset / Dusk End</label>
          <div class="time-pickers">
            <input
              type="number"
              min="0"
              max="23"
              .value=${card._newSchedule.sunsetHour}
              @change=${(e) => card._updateNewSchedule('sunsetHour', parseInt(e.target.value, 10))}
            />
            <span>:</span>
            <input
              type="number"
              min="0"
              max="59"
              .value=${card._newSchedule.sunsetMinute}
              @change=${(e) => card._updateNewSchedule('sunsetMinute', parseInt(e.target.value, 10))}
            />
          </div>
        </div>
      </div>

      <div class="slider-row">
        <span class="slider-label">Ramp Duration</span>
        <ha-slider
          min="5"
          max="120"
          step="5"
          pin
          .value=${card._newSchedule.rampMinutes}
          @change=${(e) => card._updateNewSchedule('rampMinutes', parseInt(e.target.value, 10))}
        ></ha-slider>
        <span class="slider-val">${card._newSchedule.rampMinutes}m</span>
      </div>

      ${!card._isTunableWhite ? html`
        <div class="section-title" style="margin-top: 16px;">
          <ha-icon icon="mdi:calendar-week"></ha-icon>
          Active Weekdays
        </div>
        <div class="weekday-row">
          ${WEEKDAYS.map(d => html`
            <div class="weekday-btn ${card._newSchedule.weekdays.includes(d.key) ? 'selected' : ''}"
              @click=${() => card._toggleWeekday(d.key)}>${d.label}</div>
          `)}
        </div>
      ` : html`<p class="custom-help">Applies every day.</p>`}

      <div class="section-title">
        <ha-icon icon="mdi:palette"></ha-icon>
        Peak Channel Levels
      </div>
      ${card._isTunableWhite ? renderTemperatureControl(card, "schedule") : ''}
      ${card._channels.map(
        (channel, idx) => html`
          <div class="slider-row">
            <span class="slider-label" style="color: ${channel.hex}">${channel.name}</span>
            <ha-slider
              min="0"
              max="100"
              pin
              .value=${card._newSchedule.channels[idx]}
              @change=${(e) => card._updateChannelLevel(idx, parseInt(e.target.value, 10))}
            ></ha-slider>
            <span class="slider-val">${card._newSchedule.channels[idx]}%</span>
          </div>
        `
      )}

      <div class="button-row">
        ${card._isTunableWhite ? html`
            <mwc-button raised @click=${() => card._saveSchedule()}
              ?disabled=${card._loading}>Save Auto Schedule</mwc-button>
          ` : isEditing
          ? html`
              <mwc-button
                class="danger-btn"
                outlined
                @click=${() => card._deleteSchedule(card._editingIndex)}
                ?disabled=${card._loading}
              >
                <ha-icon icon="mdi:trash-can-outline" slot="icon"></ha-icon>
                Delete Slot
              </mwc-button>
              <mwc-button
                outlined
                @click=${() => card._cancelEdit()}
                ?disabled=${card._loading}
              >
                <ha-icon icon="mdi:close" slot="icon"></ha-icon>
                Cancel
              </mwc-button>
              <mwc-button
                raised
                @click=${() => card._saveSchedule()}
                ?disabled=${card._loading}
              >
                <ha-icon icon="mdi:content-save-check" slot="icon"></ha-icon>
                Update Schedule
              </mwc-button>
            `
          : html`
              <mwc-button
                raised
                @click=${() => card._saveSchedule()}
                ?disabled=${card._loading}
              >
                <ha-icon icon="mdi:content-save-check" slot="icon"></ha-icon>
                Push Schedule to Light
              </mwc-button>
            `}
      </div>
    </div>
  `;
}


function renderCustomTab(card) {
  const points = card._customPoints;
  const chronological = [...points].sort((a, b) => a.time.localeCompare(b.time));
  const pathFor = (key) => chronological.map((point, index) => {
    const [hour, minute] = point.time.split(":").map(Number);
    const x = plotX(hour * 60 + minute);
    const y = plotY(point.levels[key] || 0);
    return `${index ? "L" : "M"} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return html`
    <div class="section">
      <div class="section-title">
        <ha-icon icon="mdi:chart-line"></ha-icon>
        Custom 24-hour curve · Z Light Tiny
      </div>
      <p class="custom-help">Custom curves run independently of Scene Auto. The 00:00 and 23:30 points are fixed daily anchors; other times are editable. Use the arrows to move blocks for easier editing. The graph and lamp still follow chronological order.</p>
      <div class="timeline-container">
        <svg class="curve-svg" viewBox="0 0 360 124" preserveAspectRatio="none">
          ${renderChartAxes()}
          ${card._channels.map(channel => svg`
            <path d="${pathFor(channel.key)}" stroke="${channel.hex}" stroke-width="2.5" fill="none"/>
          `)}
        </svg>
      </div>
      ${points.map(point => {
        const idx = card._customPoints.indexOf(point);
        const temperature = point.kelvin ?? card._temperature([point.levels.white, point.levels.warm_white]);
        const brightness = Math.min(100, (point.levels.white || 0) + (point.levels.warm_white || 0));
        return html`
          <div class="custom-point ${points.some((other, otherIndex) => otherIndex !== idx && other.time === point.time) ? 'duplicate' : ''}">
            <div class="custom-point-header">
              <label>Time
                <input type="time" min="00:00" max="23:30" step="1800"
                  title="${point.anchor ? 'Fixed daily endpoint' : 'Choose a unique half-hour time'}"
                  .value=${point.time}
                  ?disabled=${Boolean(point.anchor)}
                  @change=${e => card._updateCustomPoint(idx, "time", e.target.value)}/>
                ${point.anchor ? html`<span class="custom-anchor" title="Required start/end point">Fixed</span>` : ''}
              </label>
              <span class="custom-kelvin">${brightness ? `~${temperature} K · ${brightness}%` : "Off · 0%"}</span>
              <div class="custom-point-actions">
                <button class="icon-btn" title="Move block up" aria-label="Move block up"
                  ?disabled=${card._loading || idx === 0}
                  @click=${() => card._moveCustomPoint(idx, -1)}>
                  <ha-icon icon="mdi:arrow-up"></ha-icon>
                </button>
                <button class="icon-btn" title="Move block down" aria-label="Move block down"
                  ?disabled=${card._loading || idx === points.length - 1}
                  @click=${() => card._moveCustomPoint(idx, 1)}>
                  <ha-icon icon="mdi:arrow-down"></ha-icon>
                </button>
                <button class="icon-btn delete-btn" title="Remove point" aria-label="Remove point"
                  ?disabled=${card._loading || Boolean(point.anchor)}
                  @click=${() => card._removeCustomPoint(idx)}>
                  <ha-icon icon="mdi:delete-outline"></ha-icon>
                </button>
              </div>
            </div>
            ${points.some((other, otherIndex) => otherIndex !== idx && other.time === point.time)
              ? html`<p class="custom-error">Duplicate time: change one of these points.</p>` : ''}
            <div class="slider-row">
              <span class="slider-label">Temperature</span>
              <ha-slider min="2800" max="8000" step="100" pin
                .value=${temperature}
                @change=${e => card._updateCustomMix(idx, {kelvin: Number(e.target.value)})}>
              </ha-slider>
              <span class="slider-val">${temperature} K</span>
            </div>
            <div class="slider-row">
              <span class="slider-label">Brightness</span>
              <ha-slider min="0" max="100" step="1" pin
                .value=${brightness}
                @change=${e => card._updateCustomMix(idx, {brightness: Number(e.target.value)})}>
              </ha-slider>
              <span class="slider-val">${brightness}%</span>
            </div>
            <div class="custom-help">Approximate white balance · individual channels</div>
            ${card._channels.map(channel => html`
              <div class="slider-row">
                <span class="slider-label" style="color:${channel.hex}">${channel.name}</span>
                <ha-slider min="0" max="100" step="1" pin
                  .value=${point.levels[channel.key] ?? 0}
                  @change=${e => card._updateCustomPoint(idx, channel.key, Number(e.target.value))}
                ></ha-slider>
                <span class="slider-val">${point.levels[channel.key] ?? 0}%</span>
              </div>
            `)}
          </div>
        `;
      })}
      <p class="custom-upload-status ${card._customUnsaved ? 'unsaved' : ''}">
        ${card._loading
          ? "Sending curve points to the lamp…"
          : card._customUnsaved
            ? "Unsaved changes · click Apply Custom Curve to send to the lamp"
            : card._customLastUploadAt
              ? `Sent at ${card._customLastUploadAt} · firmware application not verified`
              : "Loaded from Home Assistant · lamp configuration not verified"}
      </p>
      ${card._customError ? html`<p class="custom-error">${card._customError}</p>` : ''}
      <div class="button-row">
        <mwc-button outlined @click=${() => card._addCustomPoint()}
          ?disabled=${card._loading || card._customPoints.length >= 16}>
          <ha-icon icon="mdi:plus" slot="icon"></ha-icon>Add Point
        </mwc-button>
        <mwc-button raised @click=${() => card._applyCustomCurve()}
          ?disabled=${card._loading || !card._customPoints.length}>
          <ha-icon icon="mdi:send" slot="icon"></ha-icon>Apply Custom Curve
        </mwc-button>
      </div>
      <p class="custom-help">Use Apply Custom Curve to save this editing order in Home Assistant and send the points in chronological order to the lamp. Bluetooth writes do not confirm firmware acceptance.</p>
    </div>
  `;
}

function renderManualTab(card) {
  return html`
    <div class="section">
      <div class="section-title">
        <ha-icon icon="mdi:tune-vertical"></ha-icon>
        Operational Mode
      </div>
      <div class="button-row" style="justify-content: flex-start; margin-bottom: 16px;">
        <mwc-button
          unelevated
          @click=${() => card._setLightMode('auto')}
          ?disabled=${card._loading}
        >
          <ha-icon icon="mdi:autorenew" slot="icon"></ha-icon>
          Scene Auto
        </mwc-button>
        ${card._isTunableWhite ? html`
          <mwc-button outlined @click=${() => card._setLightMode("custom")}
            ?disabled=${card._loading}>
            <ha-icon icon="mdi:chart-line" slot="icon"></ha-icon>
            Custom Mode
          </mwc-button>
        ` : ''}
        <mwc-button
          outlined
          @click=${() => card._setLightMode('off')}
          ?disabled=${card._loading}
        >
          <ha-icon icon="mdi:power" slot="icon"></ha-icon>
          Turn Off
        </mwc-button>
      </div>

      <div class="section-title">
        <ha-icon icon="mdi:tune"></ha-icon>
        Instant Manual Brightness
      </div>
      ${card._isTunableWhite ? renderTemperatureControl(card, "manual") : ''}
      ${card._channels.map(
        (channel, idx) => html`
          <div class="slider-row">
            <span class="slider-label" style="color: ${channel.hex}">${channel.name}</span>
            <ha-slider
              min="0"
              max="100"
              pin
              .value=${card._manualLevels[idx]}
              @change=${(e) => card._updateManualLevel(idx, parseInt(e.target.value, 10))}
            ></ha-slider>
            <span class="slider-val">${card._manualLevels[idx]}%</span>
          </div>
        `
      )}

      <div class="button-row">
        <mwc-button
          raised
          @click=${() => card._applyManualBrightness()}
          ?disabled=${card._loading}
        >
          <ha-icon icon="mdi:send" slot="icon"></ha-icon>
          Apply Manual Levels
        </mwc-button>
      </div>
    </div>
  `;
}

/** Kelvin is an approximate two-channel mix, not a calibrated spectral measurement. */
function renderTemperatureControl(card, mode) {
  const levels = mode === "manual" ? card._manualLevels : card._newSchedule.channels;
  const fallback = mode === "manual" ? card._manualKelvin : card._scheduleKelvin;
  const kelvin = card._temperature(levels, fallback);
  const brightness = Math.min(100, (levels[0] || 0) + (levels[1] || 0));
  return html`
    <div class="slider-row">
      <span class="slider-label">Temperature (approx.)</span>
      <ha-slider min="2800" max="8000" step="100" pin
        .value=${kelvin}
        @change=${(e) => card._setWhiteMix(mode, { kelvin: Number(e.target.value) })}
      ></ha-slider>
      <span class="slider-val">${kelvin} K</span>
    </div>
    <div class="slider-row">
      <span class="slider-label">Combined brightness</span>
      <ha-slider min="0" max="100" step="1" pin
        .value=${brightness}
        @change=${(e) => card._setWhiteMix(mode, { brightness: Number(e.target.value) })}
      ></ha-slider>
      <span class="slider-val">${brightness}%</span>
    </div>
    <div class="schedule-meta">Approximate two-channel mix; adjust individual channels below for finer control.</div>
  `;
}
