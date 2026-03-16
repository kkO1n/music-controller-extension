(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;
  const { STORAGE_KEYS, TELEGRAM_POLL_TIMEOUT_SECONDS, TELEGRAM_RETRY_DELAY_MS } = ns.constants;
  const { sleep, isAbortError } = ns.utils;
  const { STATES, EVENTS, EFFECTS, ERROR_CODES, transition, isUserEnabledState } = ns.connectionFsm;

  ns.state.lifecycleState = STATES.disconnected;
  ns.state.lastErrorCode = null;

  async function getTelegramOffset() {
    const result = await api.storage.local.get(STORAGE_KEYS.telegramOffset);
    return Number(result[STORAGE_KEYS.telegramOffset] || 0);
  }

  async function setTelegramOffset(nextOffset) {
    await api.storage.local.set({ [STORAGE_KEYS.telegramOffset]: nextOffset });
  }

  function stopPolling() {
    if (ns.state.pollAbortController) {
      ns.state.pollAbortController.abort();
    }
  }

  async function pollTelegramOnce(signal) {
    const offset = await getTelegramOffset();
    const updates = await ns.telegramApiService.telegramApi(
      "getUpdates",
      {
        offset,
        timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
        allowed_updates: ["message", "callback_query"]
      },
      { signal }
    );

    let nextOffset = offset;
    for (const update of updates) {
      nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
      await ns.telegramUpdateHandlers.handleTelegramUpdate(update);
    }

    if (nextOffset !== offset) {
      await setTelegramOffset(nextOffset);
    }
  }

  async function transitionWithEffects(event, payload = {}) {
    const current = ns.state.lifecycleState;
    const result = transition(current, event, payload);
    ns.state.lifecycleState = result.state;

    if (result.clearError) {
      ns.state.lastErrorCode = null;
    }
    if (result.errorCode) {
      ns.state.lastErrorCode = result.errorCode;
    }

    for (const effect of result.effects) {
      await runEffect(effect, payload);
    }

    return result;
  }

  async function runEffect(effect, payload = {}) {
    if (effect === EFFECTS.loadConfig) {
      const loaded = await ns.configService.loadConfig();
      const hasTab = await ns.playerGateway.hasOpenPlayerTab();
      if (loaded) {
        await transitionWithEffects(EVENTS.enableSuccess, { hasTab });
      } else {
        await transitionWithEffects(EVENTS.enableFailure, {
          errorCode: ERROR_CODES.configInvalid
        });
      }
      return;
    }

    if (effect === EFFECTS.startPolling) {
      if (!ns.state.pollLoopRunning) {
        void pollLoop();
      }
      return;
    }

    if (effect === EFFECTS.stopPolling) {
      stopPolling();
      if (!ns.state.pollLoopRunning) {
        await transitionWithEffects(EVENTS.pollStopped);
      }
      return;
    }

    if (effect === EFFECTS.notifyConnected) {
      await ns.statusMessageService.notifyConnected();
      return;
    }

    if (effect === EFFECTS.notifyDisconnected) {
      await ns.statusMessageService.notifyDisconnected();
    }
  }

  async function maybeDispatchTabState() {
    const hasTab = await ns.playerGateway.hasOpenPlayerTab();
    await transitionWithEffects(hasTab ? EVENTS.tabAvailable : EVENTS.tabUnavailable, { hasTab });
  }

  async function pollLoop() {
    if (ns.state.pollLoopRunning) {
      return;
    }

    ns.state.pollLoopRunning = true;
    await transitionWithEffects(EVENTS.pollStarted);

    while (isUserEnabledState(ns.state.lifecycleState)) {
      const hasTab = await ns.playerGateway.hasOpenPlayerTab();
      if (!hasTab) {
        await transitionWithEffects(EVENTS.tabUnavailable);
        break;
      }

      ns.state.pollAbortController = new AbortController();
      try {
        await pollTelegramOnce(ns.state.pollAbortController.signal);
      } catch (error) {
        if (isAbortError(error)) {
          continue;
        }

        await transitionWithEffects(EVENTS.pollError, {
          errorCode: ERROR_CODES.pollFailed
        });

        if (!isUserEnabledState(ns.state.lifecycleState)) {
          break;
        }

        console.warn("[telegram-bridge]", error?.message || error);
        await sleep(TELEGRAM_RETRY_DELAY_MS);
      } finally {
        ns.state.pollAbortController = null;
      }
    }

    ns.state.pollLoopRunning = false;
    await transitionWithEffects(EVENTS.pollStopped);
  }

  async function connectionState() {
    return {
      enabled: isUserEnabledState(ns.state.lifecycleState),
      polling: ns.state.pollLoopRunning,
      hasYandexTab: await ns.playerGateway.hasOpenPlayerTab(),
      error: ns.state.bridgeConfigError,
      state: ns.state.lifecycleState,
      errorCode: ns.state.lastErrorCode
    };
  }

  async function setConnectionEnabled(enabled) {
    await transitionWithEffects(enabled ? EVENTS.enableRequest : EVENTS.disableRequest, {
      polling: ns.state.pollLoopRunning
    });

    const snapshot = await connectionState();
    const ok = snapshot.state !== STATES.error;

    return {
      ok,
      ...snapshot
    };
  }

  async function evaluatePollingState() {
    await maybeDispatchTabState();
  }

  async function bootstrap() {
    stopPolling();
    ns.state.lifecycleState = STATES.disconnected;
    ns.state.lastErrorCode = null;
    await transitionWithEffects(EVENTS.bootstrap);
    await maybeDispatchTabState();
  }

  ns.pollingController = {
    connectionState,
    setConnectionEnabled,
    evaluatePollingState,
    bootstrap,
    __test: {
      transitionWithEffects,
      maybeDispatchTabState
    }
  };
})();
