(function initConnectionFsm(globalScope) {
  const STATES = {
    disconnected: "DISCONNECTED",
    enabling: "ENABLING",
    connectedIdle: "CONNECTED_IDLE",
    polling: "POLLING",
    disabling: "DISABLING",
    error: "ERROR"
  };

  const EVENTS = {
    bootstrap: "BOOTSTRAP",
    enableRequest: "ENABLE_REQUEST",
    enableSuccess: "ENABLE_SUCCESS",
    enableFailure: "ENABLE_FAILURE",
    disableRequest: "DISABLE_REQUEST",
    tabAvailable: "TAB_AVAILABLE",
    tabUnavailable: "TAB_UNAVAILABLE",
    pollStarted: "POLL_STARTED",
    pollStopped: "POLL_STOPPED",
    pollError: "POLL_ERROR"
  };

  const EFFECTS = {
    loadConfig: "LOAD_CONFIG",
    notifyConnected: "NOTIFY_CONNECTED",
    notifyDisconnected: "NOTIFY_DISCONNECTED",
    startPolling: "START_POLLING",
    stopPolling: "STOP_POLLING"
  };

  const ERROR_CODES = {
    configInvalid: "CONFIG_INVALID",
    pollFailed: "POLL_FAILED"
  };

  function unchanged(state) {
    return { state, effects: [] };
  }

  function transition(state, event, payload = {}) {
    switch (state) {
      case STATES.disconnected:
        if (event === EVENTS.bootstrap) {
          return unchanged(state);
        }
        if (event === EVENTS.enableRequest) {
          return {
            state: STATES.enabling,
            effects: [EFFECTS.loadConfig],
            clearError: true
          };
        }
        return unchanged(state);

      case STATES.enabling:
        if (event === EVENTS.enableSuccess) {
          return {
            state: STATES.connectedIdle,
            effects: payload.hasTab
              ? [EFFECTS.notifyConnected, EFFECTS.startPolling]
              : [EFFECTS.notifyConnected],
            clearError: true
          };
        }
        if (event === EVENTS.enableFailure) {
          return {
            state: STATES.error,
            effects: [EFFECTS.stopPolling],
            errorCode: payload.errorCode || ERROR_CODES.configInvalid
          };
        }
        if (event === EVENTS.disableRequest) {
          return {
            state: STATES.disconnected,
            effects: [EFFECTS.stopPolling],
            clearError: true
          };
        }
        return unchanged(state);

      case STATES.connectedIdle:
        if (event === EVENTS.disableRequest) {
          return {
            state: STATES.disconnected,
            effects: [EFFECTS.stopPolling, EFFECTS.notifyDisconnected],
            clearError: true
          };
        }
        if (event === EVENTS.tabAvailable) {
          return {
            state,
            effects: [EFFECTS.startPolling]
          };
        }
        if (event === EVENTS.pollStarted) {
          return {
            state: STATES.polling,
            effects: []
          };
        }
        return unchanged(state);

      case STATES.polling:
        if (event === EVENTS.disableRequest) {
          return {
            state: STATES.disabling,
            effects: [EFFECTS.stopPolling, EFFECTS.notifyDisconnected],
            clearError: true
          };
        }
        if (event === EVENTS.tabUnavailable) {
          return {
            state: STATES.connectedIdle,
            effects: [EFFECTS.stopPolling]
          };
        }
        if (event === EVENTS.pollStopped) {
          return {
            state: STATES.connectedIdle,
            effects: []
          };
        }
        if (event === EVENTS.pollError) {
          return {
            state,
            effects: [],
            errorCode: payload.errorCode || ERROR_CODES.pollFailed
          };
        }
        return unchanged(state);

      case STATES.disabling:
        if (event === EVENTS.pollStopped) {
          return {
            state: STATES.disconnected,
            effects: [],
            clearError: true
          };
        }
        return unchanged(state);

      case STATES.error:
        if (event === EVENTS.enableRequest) {
          return {
            state: STATES.enabling,
            effects: [EFFECTS.loadConfig],
            clearError: true
          };
        }
        if (event === EVENTS.disableRequest || event === EVENTS.bootstrap) {
          return {
            state: STATES.disconnected,
            effects: [EFFECTS.stopPolling],
            clearError: true
          };
        }
        return unchanged(state);

      default:
        return unchanged(state);
    }
  }

  function isUserEnabledState(state) {
    return (
      state === STATES.enabling ||
      state === STATES.connectedIdle ||
      state === STATES.polling
    );
  }

  const api = {
    STATES,
    EVENTS,
    EFFECTS,
    ERROR_CODES,
    transition,
    isUserEnabledState
  };

  const ns = globalScope.__ymr;
  if (ns) {
    ns.connectionFsm = api;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
