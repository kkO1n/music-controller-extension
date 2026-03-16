(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;
  const { STORAGE_KEYS, TELEGRAM_POLL_TIMEOUT_SECONDS, TELEGRAM_RETRY_DELAY_MS } = ns.constants;
  const { sleep, isAbortError } = ns.utils;

  async function getTelegramOffset() {
    const result = await api.storage.local.get(STORAGE_KEYS.telegramOffset);
    return Number(result[STORAGE_KEYS.telegramOffset] || 0);
  }

  async function setTelegramOffset(nextOffset) {
    await api.storage.local.set({ [STORAGE_KEYS.telegramOffset]: nextOffset });
  }

  async function shouldPoll() {
    if (!ns.state.telegramEnabled || !ns.state.bridgeConfig?.botToken) {
      return false;
    }
    return ns.playerGateway.hasOpenPlayerTab();
  }

  function stopPolling() {
    if (ns.state.pollAbortController) {
      ns.state.pollAbortController.abort();
    }
  }

  async function connectionState() {
    return {
      enabled: ns.state.telegramEnabled,
      polling: ns.state.pollLoopRunning,
      hasYandexTab: await ns.playerGateway.hasOpenPlayerTab(),
      error: ns.state.bridgeConfigError
    };
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

  async function pollLoop() {
    if (ns.state.pollLoopRunning) {
      return;
    }

    ns.state.pollLoopRunning = true;
    while (await shouldPoll()) {
      ns.state.pollAbortController = new AbortController();
      try {
        await pollTelegramOnce(ns.state.pollAbortController.signal);
      } catch (error) {
        if (isAbortError(error)) {
          continue;
        }
        if (!(await shouldPoll())) {
          break;
        }
        console.warn("[telegram-bridge]", error?.message || error);
        await sleep(TELEGRAM_RETRY_DELAY_MS);
      } finally {
        ns.state.pollAbortController = null;
      }
    }
    ns.state.pollLoopRunning = false;
  }

  async function evaluatePollingState() {
    if (await shouldPoll()) {
      if (!ns.state.pollLoopRunning) {
        void pollLoop();
      }
      return;
    }

    stopPolling();
  }

  async function setConnectionEnabled(enabled) {
    if (!enabled) {
      ns.state.telegramEnabled = false;
      stopPolling();
      await ns.statusMessageService.notifyDisconnected();
      return {
        ok: true,
        ...(await connectionState())
      };
    }

    const loaded = await ns.configService.loadConfig();
    if (!loaded) {
      ns.state.telegramEnabled = false;
      stopPolling();
      return {
        ok: false,
        ...(await connectionState())
      };
    }

    ns.state.telegramEnabled = true;
    await ns.statusMessageService.notifyConnected();
    await evaluatePollingState();
    return {
      ok: true,
      ...(await connectionState())
    };
  }

  async function bootstrap() {
    ns.state.telegramEnabled = false;
    stopPolling();
    await evaluatePollingState();
  }

  ns.pollingController = {
    connectionState,
    setConnectionEnabled,
    evaluatePollingState,
    bootstrap
  };
})();
