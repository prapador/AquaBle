import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const code = readFileSync("custom_components/aquable/frontend/aquable-light-card.js", "utf8")
  .replace(/^import .*;\s*$/gm, "") + "\nglobalThis.TestCard = AquaBleLightCard;";
const context = {
  LitElement: class { updated() {} },
  customElements: {get: () => true},
  window: {customCards: []},
  localStorage: {getItem: () => null, setItem: () => {}},
  DOMAIN: "aquable",
  SERVICES: {SET_LIGHT_CUSTOM: "light_set_custom_curve"},
  cardStyles: {},
  renderCard: () => {},
  console,
};
runInNewContext(code, context);

const card = new context.TestCard();
const sent = [];
const curve = [
  {time: "00:00", levels: {white: 0, warm_white: 0}},
  {time: "23:30", levels: {white: 0, warm_white: 0}},
  {time: "23:30", levels: {white: 0, warm_white: 100}},
];
card.setConfig({entity: "sensor.tiny_active_schedules"});
card.hass = {
  states: {"sensor.tiny_active_schedules": {
    entity_id: "sensor.tiny_active_schedules",
    attributes: {channel_keys: ["white", "warm_white"], custom_curve: curve, schedules: []}
  }},
  callService: async (domain, service, data) => sent.push({domain, service, data}),
};
card.updated(new Set(["hass"]));
assert.deepEqual(Array.from(card._customPoints, p => p.anchor), ["00:00", "23:30", null]);

card._updateCustomPoint(1, "time", "21:30");
assert.equal(card._customPoints[1].time, "23:30", "fixed endpoint cannot be edited");
card._updateCustomPoint(2, "time", "23:30");
assert.match(card._customError, /two points/i);
await card._applyCustomCurve();
assert.equal(sent.length, 0, "duplicate hours must prevent all BLE service calls");

card._updateCustomPoint(2, "time", "22:30");
assert.equal(card._customError, "");
card._moveCustomPoint(2, -1);
assert.deepEqual(Array.from(card._customPoints, p => p.time), ["00:00", "22:30", "23:30"]);
card._moveCustomPoint(0, 1);
assert.deepEqual(Array.from(card._customPoints, p => p.time), ["22:30", "00:00", "23:30"]);
card._removeCustomPoint(1);
assert.equal(card._customPoints.length, 3, "fixed endpoint cannot be removed");

await card._applyCustomCurve();
assert.equal(sent.length, 1);
assert.equal(sent[0].service, "light_set_custom_curve");
assert.deepEqual(Array.from(sent[0].data.points, p => p.time), ["22:30", "00:00", "23:30"], "service preserves editing order");
assert.equal(card._customPoints[0].time, "22:30", "successful save preserves editing order");

card._removeCustomPoint(0);
assert.equal(card._customPoints.length, 2, "ordinary points can be removed");
console.log("Tiny Custom editor anchor, duplicate, ordering and save tests passed");
