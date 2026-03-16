const test = require("node:test");
const assert = require("node:assert/strict");

const {
  STATES,
  EVENTS,
  EFFECTS,
  ERROR_CODES,
  transition
} = require("../background/connection-fsm.js");

test("connect -> poll -> disconnect sequence ends in DISCONNECTED", () => {
  const s1 = transition(STATES.disconnected, EVENTS.enableRequest);
  const s2 = transition(s1.state, EVENTS.enableSuccess, { hasTab: true });
  const s3 = transition(s2.state, EVENTS.pollStarted);
  const s4 = transition(s3.state, EVENTS.disableRequest);
  const s5 = transition(s4.state, EVENTS.pollStopped);

  assert.equal(s1.state, STATES.enabling);
  assert.equal(s2.state, STATES.connectedIdle);
  assert.deepEqual(s2.effects, [EFFECTS.notifyConnected, EFFECTS.startPolling]);
  assert.equal(s3.state, STATES.polling);
  assert.equal(s4.state, STATES.disabling);
  assert.equal(s5.state, STATES.disconnected);
});

test("poll error keeps POLLING state and reports POLL_FAILED", () => {
  const result = transition(STATES.polling, EVENTS.pollError);

  assert.equal(result.state, STATES.polling);
  assert.equal(result.errorCode, ERROR_CODES.pollFailed);
  assert.deepEqual(result.effects, []);
});

test("error state recovers on enable request", () => {
  const result = transition(STATES.error, EVENTS.enableRequest);

  assert.equal(result.state, STATES.enabling);
  assert.deepEqual(result.effects, [EFFECTS.loadConfig]);
  assert.equal(result.clearError, true);
});
