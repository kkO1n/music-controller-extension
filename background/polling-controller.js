(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;
  const {
    STORAGE_KEYS,
    TELEGRAM_POLL_TIMEOUT_SECONDS,
    TELEGRAM_RETRY_DELAY_MS,
    TELEGRAM_STATUS_REFRESH_INTERVAL_MS
  } = ns.constants;
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
    const currentOffset = await getTelegramOffset();
    const updates = await ns.telegramApiService.telegramApi(
      "getUpdates",
      {
        offset: currentOffset,
        timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
        allowed_updates: ["message", "callback_query"]
      },
      { signal }
    );

    let nextOffset = currentOffset;

    for (const update of updates) {
      nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
      await ns.telegramUpdateHandlers.handleTelegramUpdate(update);
    }

    if (nextOffset !== currentOffset) {
      await setTelegramOffset(nextOffset);
    }
  }

  async function maybeRefreshStatus(force = false) {
    const now = Date.now();
    const elapsedMs = now - ns.state.lastStatusRefreshAt;
    const shouldRefresh = force || elapsedMs >= TELEGRAM_STATUS_REFRESH_INTERVAL_MS;
    if (!shouldRefresh) {
      return;
    }

    ns.state.lastStatusRefreshAt = now;
    await ns.statusMessageService.refreshStoredStatusMessage();
  }

  function applyTransitionResult(result) {
    ns.state.lifecycleState = result.state;

    if (result.clearError) {
      ns.state.lastErrorCode = null;
    }

    if (result.errorCode) {
      ns.state.lastErrorCode = result.errorCode;
    }
  }

  async function transitionWithEffects(event, payload = {}) {
    const result = transition(ns.state.lifecycleState, event, payload);
    applyTransitionResult(result);
    await ns.actionIconService?.syncFromLifecycleState(ns.state.lifecycleState);

    for (const effect of result.effects) {
      await runEffect(effect, payload);
    }

    return result;
  }

  async function runEffect(effect) {
    switch (effect) {
      case EFFECTS.loadConfig: {
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

      case EFFECTS.startPolling:
        if (!ns.state.pollLoopRunning) {
          void pollLoop();
        }
        return;

      case EFFECTS.stopPolling:
        stopPolling();
        if (!ns.state.pollLoopRunning) {
          await transitionWithEffects(EVENTS.pollStopped);
        }
        return;

      case EFFECTS.notifyConnected:
        await ns.statusMessageService.notifyConnected();
        return;

      case EFFECTS.notifyDisconnected:
        await ns.statusMessageService.notifyDisconnected();
        return;

      default:
        return;
    }
  }

  async function syncTabAvailability() {
    const hasTab = await ns.playerGateway.hasOpenPlayerTab();
    await transitionWithEffects(hasTab ? EVENTS.tabAvailable : EVENTS.tabUnavailable, { hasTab });
  }

  async function pollLoop() {
    if (ns.state.pollLoopRunning) {
      return;
    }

    ns.state.pollLoopRunning = true;
    await transitionWithEffects(EVENTS.pollStarted);
    await maybeRefreshStatus(true);

    while (isUserEnabledState(ns.state.lifecycleState)) {
      const hasTab = await ns.playerGateway.hasOpenPlayerTab();
      if (!hasTab) {
        await transitionWithEffects(EVENTS.tabUnavailable);
        break;
      }

      ns.state.pollAbortController = new AbortController();

      try {
        await pollTelegramOnce(ns.state.pollAbortController.signal);
        await maybeRefreshStatus();
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
    const event = enabled ? EVENTS.enableRequest : EVENTS.disableRequest;
    await transitionWithEffects(event, {
      polling: ns.state.pollLoopRunning
    });

    const snapshot = await connectionState();
    const ok = snapshot.state !== STATES.error;
    return { ok, ...snapshot };
  }

  async function evaluatePollingState() {
    await syncTabAvailability();
  }

  async function bootstrap() {
    stopPolling();
    ns.state.lifecycleState = STATES.disconnected;
    ns.state.lastErrorCode = null;
    ns.state.lastStatusRefreshAt = 0;

    await transitionWithEffects(EVENTS.bootstrap);
    await syncTabAvailability();
  }

  ns.pollingController = {
    connectionState,
    setConnectionEnabled,
    evaluatePollingState,
    bootstrap,
    __test: {
      transitionWithEffects,
      maybeDispatchTabState: syncTabAvailability
    }
  };
})();
