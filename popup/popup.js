(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const MESSAGE_TYPES = {
    getState: "TELEGRAM_CONNECTION_GET_STATE",
    setEnabled: "TELEGRAM_CONNECTION_SET_ENABLED"
  };

  const statusNode = document.getElementById("status");
  const toggleBtn = document.getElementById("toggleBtn");
  const feedbackNode = document.getElementById("feedback");

  const state = {
    enabled: false,
    polling: false,
    hasYandexTab: false,
    error: null
  };

  function setFeedback(message, isError = false) {
    feedbackNode.textContent = message;
    feedbackNode.classList.toggle("feedback-error", isError);
  }

  function normalizeState(payload) {
    state.enabled = Boolean(payload?.enabled);
    state.polling = Boolean(payload?.polling);
    state.hasYandexTab = Boolean(payload?.hasYandexTab);
    state.error = payload?.error ? String(payload.error) : null;
  }

  function statusText() {
    if (state.enabled && state.polling) {
      return "Connected. Telegram control is active.";
    }

    if (state.enabled && !state.hasYandexTab) {
      return "Connected. Open music.yandex.ru to start polling.";
    }

    if (state.enabled) {
      return "Connected. Waiting for player tab.";
    }

    return "Disconnected. Telegram control is off.";
  }

  function render() {
    statusNode.textContent = statusText();
    statusNode.classList.toggle("status-connected", state.enabled && state.polling);
    toggleBtn.textContent = state.enabled ? "Disconnect Telegram" : "Connect to Telegram";
  }

  async function sendMessage(message) {
    try {
      return await api.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }

  async function refreshState() {
    const response = await sendMessage({ type: MESSAGE_TYPES.getState });
    if (!response) {
      setFeedback("Failed to read connection state.", true);
      return;
    }

    normalizeState(response);
    render();
  }

  async function onToggleClick() {
    toggleBtn.disabled = true;
    setFeedback("");

    const nextEnabled = !state.enabled;
    const response = await sendMessage({
      type: MESSAGE_TYPES.setEnabled,
      enabled: nextEnabled
    });

    if (!response) {
      setFeedback("Failed to change Telegram connection state.", true);
      toggleBtn.disabled = false;
      return;
    }

    normalizeState(response);
    render();

    if (!response.ok) {
      setFeedback(state.error || "Telegram is not configured.", true);
    } else {
      setFeedback(nextEnabled ? "Telegram connected." : "Telegram disconnected.");
    }

    toggleBtn.disabled = false;
  }

  toggleBtn.addEventListener("click", () => {
    void onToggleClick();
  });

  void refreshState();
})();
