(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;
  const { MESSAGE_TYPES, CONNECTION_MESSAGE_TYPES, STORAGE_KEYS } = ns.constants;

  function shouldReevaluatePolling(changeInfo) {
    return typeof changeInfo.url === "string" || changeInfo.status === "complete";
  }

  async function handleNowPlayingUpdate(message, sender) {
    const updates = {};

    if (message.payload) {
      updates[STORAGE_KEYS.nowPlaying] = message.payload;
    }

    if (typeof sender?.tab?.id === "number") {
      updates[STORAGE_KEYS.lastPlayerTabId] = sender.tab.id;
    }

    if (!Object.keys(updates).length) {
      return { ok: true };
    }

    await api.storage.local.set(updates);
    await ns.pollingController.evaluatePollingState();
    return { ok: true };
  }

  function handleConnectionMessage(message) {
    if (message?.type === CONNECTION_MESSAGE_TYPES.getState) {
      return ns.pollingController.connectionState();
    }

    if (message?.type === CONNECTION_MESSAGE_TYPES.setEnabled) {
      return ns.pollingController.setConnectionEnabled(Boolean(message.enabled));
    }

    return null;
  }

  function onRuntimeMessage(message, sender) {
    const connectionResponse = handleConnectionMessage(message);
    if (connectionResponse) {
      return connectionResponse;
    }

    if (!message || message.type !== MESSAGE_TYPES.nowPlayingUpdate) {
      return undefined;
    }

    return handleNowPlayingUpdate(message, sender);
  }

  function registerLifecycleListeners() {
    api.runtime.onInstalled.addListener(() => {
      void ns.pollingController.bootstrap();
    });

    api.runtime.onStartup.addListener(() => {
      void ns.pollingController.bootstrap();
    });

    api.tabs.onCreated.addListener(() => {
      void ns.pollingController.evaluatePollingState();
    });

    api.tabs.onRemoved.addListener(() => {
      void ns.pollingController.evaluatePollingState();
    });

    api.tabs.onUpdated.addListener((_tabId, changeInfo) => {
      if (shouldReevaluatePolling(changeInfo)) {
        void ns.pollingController.evaluatePollingState();
      }
    });
  }

  function registerRuntimeHandlers() {
    api.runtime.onMessage.addListener(onRuntimeMessage);
  }

  registerLifecycleListeners();
  registerRuntimeHandlers();
  void ns.pollingController.bootstrap();
})();
