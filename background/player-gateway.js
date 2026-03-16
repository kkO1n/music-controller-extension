(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;
  const { STORAGE_KEYS, MESSAGE_TYPES, TELEGRAM_OK_DELAY_MS } = ns.constants;
  const { sleep } = ns.utils;

  async function hasOpenPlayerTab() {
    const tabs = await api.tabs.query({ url: ["https://music.yandex.ru/*"] });
    return tabs.length > 0;
  }

  async function resolvePlayerTabId() {
    const stored = await api.storage.local.get(STORAGE_KEYS.lastPlayerTabId);
    const lastTabId = stored[STORAGE_KEYS.lastPlayerTabId];

    if (typeof lastTabId === "number") {
      try {
        const tab = await api.tabs.get(lastTabId);
        if (tab?.url?.startsWith("https://music.yandex.ru/")) {
          return tab.id;
        }
      } catch {
        // Ignore stale tab IDs.
      }
    }

    const tabs = await api.tabs.query({ url: ["https://music.yandex.ru/*"] });
    if (!tabs.length) {
      return null;
    }

    const selectedTab = tabs[0];
    await api.storage.local.set({ [STORAGE_KEYS.lastPlayerTabId]: selectedTab.id });
    return selectedTab.id;
  }

  async function requestFreshPlayerState(tabId) {
    try {
      const result = await api.tabs.sendMessage(tabId, { type: MESSAGE_TYPES.stateRequest });
      if (!result?.ok || !result.payload) {
        return null;
      }

      await api.storage.local.set({ [STORAGE_KEYS.nowPlaying]: result.payload });
      return result.payload;
    } catch {
      return null;
    }
  }

  async function sendPlayerControl(action) {
    const tabId = await resolvePlayerTabId();
    if (tabId === null) {
      return { ok: false, note: "Open music.yandex.ru first." };
    }

    try {
      const response = await api.tabs.sendMessage(tabId, {
        type: MESSAGE_TYPES.control,
        action
      });

      if (!response?.ok) {
        return { ok: false, note: "Player controls were not found in the tab." };
      }

      await api.storage.local.set({ [STORAGE_KEYS.lastPlayerTabId]: tabId });
      await sleep(TELEGRAM_OK_DELAY_MS);
      await requestFreshPlayerState(tabId);
      return { ok: true, note: "Command sent." };
    } catch {
      return { ok: false, note: "Failed to reach Yandex Music tab." };
    }
  }

  ns.playerGateway = {
    hasOpenPlayerTab,
    resolvePlayerTabId,
    requestFreshPlayerState,
    sendPlayerControl
  };
})();
