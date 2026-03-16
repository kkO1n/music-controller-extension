const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STATES,
  EVENTS,
  EFFECTS,
  ERROR_CODES,
  transition,
  isUserEnabledState
} = require("../background/connection-fsm.js");

test("enable request moves from DISCONNECTED to ENABLING and loads config", () => {
  const result = transition(STATES.disconnected, EVENTS.enableRequest);

  assert.equal(result.state, STATES.enabling);
  assert.deepEqual(result.effects, [EFFECTS.loadConfig]);
  assert.equal(result.clearError, true);
});

test("enable success with open tab notifies and starts polling", () => {
  const result = transition(STATES.enabling, EVENTS.enableSuccess, { hasTab: true });

  assert.equal(result.state, STATES.connectedIdle);
  assert.deepEqual(result.effects, [EFFECTS.notifyConnected, EFFECTS.startPolling]);
});

test("enable failure enters ERROR with CONFIG_INVALID code", () => {
  const result = transition(STATES.enabling, EVENTS.enableFailure);

  assert.equal(result.state, STATES.error);
  assert.equal(result.errorCode, ERROR_CODES.configInvalid);
  assert.deepEqual(result.effects, [EFFECTS.stopPolling]);
});

test("disable while polling enters DISABLING and emits stop + notify", () => {
  const result = transition(STATES.polling, EVENTS.disableRequest);

  assert.equal(result.state, STATES.disabling);
  assert.deepEqual(result.effects, [EFFECTS.stopPolling, EFFECTS.notifyDisconnected]);
});

test("poll stopped while disabling finalizes to DISCONNECTED", () => {
  const result = transition(STATES.disabling, EVENTS.pollStopped);

  assert.equal(result.state, STATES.disconnected);
  assert.deepEqual(result.effects, []);
  assert.equal(result.clearError, true);
});

test("tab unavailable while polling transitions to CONNECTED_IDLE and stops polling", () => {
  const result = transition(STATES.polling, EVENTS.tabUnavailable);

  assert.equal(result.state, STATES.connectedIdle);
  assert.deepEqual(result.effects, [EFFECTS.stopPolling]);
});

test("no-op transition keeps state and emits no effects", () => {
  const result = transition(STATES.disconnected, EVENTS.tabAvailable);

  assert.equal(result.state, STATES.disconnected);
  assert.deepEqual(result.effects, []);
});

test("rapid enable then disable returns to DISCONNECTED", () => {
  const step1 = transition(STATES.disconnected, EVENTS.enableRequest);
  const step2 = transition(step1.state, EVENTS.disableRequest);

  assert.equal(step1.state, STATES.enabling);
  assert.equal(step2.state, STATES.disconnected);
  assert.deepEqual(step2.effects, [EFFECTS.stopPolling]);
});

test("enabled-state helper matches expected lifecycle states", () => {
  assert.equal(isUserEnabledState(STATES.disconnected), false);
  assert.equal(isUserEnabledState(STATES.error), false);
  assert.equal(isUserEnabledState(STATES.disabling), false);
  assert.equal(isUserEnabledState(STATES.enabling), true);
  assert.equal(isUserEnabledState(STATES.connectedIdle), true);
  assert.equal(isUserEnabledState(STATES.polling), true);
});
