import { html, svg } from "https://unpkg.com/lit-element@2.4.0/lit-element.js?module";
import { WEEKDAYS } from "./constants.js";

/**
 * Generate SVG path data for a 24-hour channel brightness ramp curve.
 */
function generateChannelPath(schedules, chIdx, width, height) {
  if (!schedules || schedules.length === 0) {
    return `M 0,${height} L ${width},${height}`;
  }

  // 1440 minutes in a day. Map minutes (0-1440) to x (0-width), brightness (0-100) to y (height-0).
  const points = [];
  points.push({ x: 0, y: height });

  // Sample every 10 minutes to build smooth curve
  for (let m = 0; m <= 1440; m += 10) {
    let maxB = 0;
    for (const sched of schedules) {
      const partsSunrise = (sched.sunrise || "00:00").split(":").map(Number);
      const partsSunset = (sched.sunset || "00:00").split(":").map(Number);
      const sunriseMin = partsSunrise[0] * 60 + partsSunrise[1];
      const sunsetMin = partsSunset[0] * 60 + partsSunset[1];
      const ramp = sched.ramp_up_minutes || 0;
      const peak = (sched.channels && sched.channels[chIdx]) || (sched.channel_brightness && sched.channel_brightness[chIdx]) || 0;

      if (sunsetMin > sunriseMin && m >= sunriseMin && m <= sunsetMin) {
        let b = peak;
        if (ramp > 0 && m < sunriseMin + ramp) {
          b = peak * ((m - sunriseMin) / ramp);
        } else if (ramp > 0 && m > sunsetMin - ramp) {
          b = peak * ((sunsetMin - m) / ramp);
        }
        if (b > maxB) maxB = b;
      }
    }
    const x = (m / 1440) * width;
    const y = height - (maxB / 100) * (height - 10);
    points.push({ x, y });
  }

  points.push({ x: width, y: height });

  return points.reduce((acc, p, i) => `${acc} ${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`, "");
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
  const currentX = (currentMinutes / 1440) * 360;

  return html`
    <div class="section">
      <div class="section-title">
        <ha-icon icon="mdi:chart-bell-curve-cumulative"></ha-icon>
        24-Hour Ramp Profile
      </div>
      <div class="timeline-container">
        <svg class="curve-svg" viewBox="0 0 360 120" preserveAspectRatio="none">
          <!-- Grid lines -->
          <g class="timeline-grid">
            <line x1="0" y1="30" x2="360" y2="30" />
            <line x1="0" y1="60" x2="360" y2="60" />
            <line x1="0" y1="90" x2="360" y2="90" />
            <!-- Hour markers (every 6h) -->
            <line x1="90" y1="0" x2="90" y2="120" />
            <line x1="180" y1="0" x2="180" y2="120" />
            <line x1="270" y1="0" x2="270" y2="120" />
          </g>

          <!-- Channel Curves -->
          ${card._channels.map((channel, idx) => svg`
            <path d="${generateChannelPath(schedules, idx, 360, 110)}" fill="none" stroke="${channel.hex}" stroke-width="2" />
          `)}

          <!-- Current Time Indicator -->
          <line class="time-marker-line" x1="${currentX}" y1="0" x2="${currentX}" y2="110" />

          <!-- Axis Labels -->
          <g class="timeline-axis">
            <text x="5" y="118">00:00</text>
            <text x="85" y="118">06:00</text>
            <text x="175" y="118">12:00</text>
            <text x="265" y="118">18:00</text>
            <text x="330" y="118">24:00</text>
          </g>
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
  const points = [...card._customPoints].sort((a, b) => a.time.localeCompare(b.time));
  const pathFor = (key) => points.map((point, index) => {
    const [hour, minute] = point.time.split(":").map(Number);
    const x = (hour * 60 + minute) / 1440 * 360;
    const y = 105 - (point.levels[key] || 0) * 0.95;
    return `${index ? "L" : "M"} ${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return html`
    <div class="section">
      <div class="section-title">
        <ha-icon icon="mdi:chart-line"></ha-icon>
        Custom 24-hour curve · Z Light Tiny
      </div>
      <p class="custom-help">Separate from Scene Auto. Set brightness for both white channels at each half-hour point; the lamp interpolates between points. Applied directly to the lamp by Bluetooth.</p>
      <div class="timeline-container">
        <svg class="curve-svg" viewBox="0 0 360 120" preserveAspectRatio="none">
          <g class="timeline-grid">
            <line x1="0" y1="30" x2="360" y2="30" />
            <line x1="0" y1="60" x2="360" y2="60" />
            <line x1="0" y1="90" x2="360" y2="90" />
            <line x1="90" y1="0" x2="90" y2="105" />
            <line x1="180" y1="0" x2="180" y2="105" />
            <line x1="270" y1="0" x2="270" y2="105" />
          </g>
          ${card._channels.map(channel => svg`
            <path d="${pathFor(channel.key)}" stroke="${channel.hex}" stroke-width="2.5" fill="none"/>
          `)}
          <g class="timeline-axis">
            <text x="2" y="118">00:00</text>
            <text x="85" y="118">06:00</text>
            <text x="175" y="118">12:00</text>
            <text x="265" y="118">18:00</text>
            <text x="329" y="118">24:00</text>
          </g>
        </svg>
      </div>
      ${points.map(point => {
        const idx = card._customPoints.indexOf(point);
        return html`
          <div class="custom-point">
            <div class="custom-point-header">
              <label>Time
                <input type="time" min="00:00" max="23:30" step="1800"
                  .value=${point.time}
                  ?disabled=${point.time === "00:00" || point.time === "23:30"}
                  @change=${e => card._updateCustomPoint(idx, "time", e.target.value)}/>
              </label>
              <span class="custom-kelvin">~${card._temperature([
                point.levels.white, point.levels.warm_white
              ])} K</span>
              <button class="icon-btn delete-btn" title="Remove point"
                ?disabled=${["00:00", "23:30"].includes(point.time)}
                @click=${() => card._removeCustomPoint(idx)}>
                <ha-icon icon="mdi:delete-outline"></ha-icon>
              </button>
            </div>
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
      <p class="custom-help">Note: Bluetooth writes do not confirm the firmware accepted every point. Check the lamp after applying. Scene Auto remains separate.</p>
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
