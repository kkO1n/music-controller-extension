(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const MESSAGE_TYPES = {
    getState: "TELEGRAM_CONNECTION_GET_STATE",
    setEnabled: "TELEGRAM_CONNECTION_SET_ENABLED"
  };

  const statusNode = document.getElementById("status");
  const toggleBtn = document.getElementById("toggleBtn");
  const feedbackNode = document.getElementById("feedback");
  const popupNode = document.querySelector(".popup");
  const DEFAULT_FEEDBACK = "Tip: Use /start in Telegram after connecting.";

  const viewState = {
    enabled: false,
    polling: false,
    hasYandexTab: false,
    error: null
  };

  function setFeedback(message, isError = false) {
    feedbackNode.textContent = message;
    feedbackNode.classList.toggle("feedback-error", isError);
  }

  function applyConnectionState(payload) {
    viewState.enabled = Boolean(payload?.enabled);
    viewState.polling = Boolean(payload?.polling);
    viewState.hasYandexTab = Boolean(payload?.hasYandexTab);
    viewState.error = payload?.error ? String(payload.error) : null;
  }

  function buildStatusText() {
    if (viewState.enabled && viewState.polling) {
      return "Connected. Telegram control is active.";
    }

    if (viewState.enabled && !viewState.hasYandexTab) {
      return "Connected. Open music.yandex.ru to start polling.";
    }

    if (viewState.enabled) {
      return "Connected. Waiting for player tab.";
    }

    return "Disconnected. Telegram control is off.";
  }

  function render() {
    const active = viewState.enabled && viewState.polling;
    statusNode.textContent = buildStatusText();
    statusNode.classList.toggle("status-connected", active);
    toggleBtn.textContent = viewState.enabled ? "Disconnect Telegram" : "Connect to Telegram";
    popupNode?.classList.toggle("popup-enabled", viewState.enabled);
    popupNode?.classList.toggle("popup-active", active);
  }

  async function requestBackground(message) {
    try {
      return await api.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }

  async function refreshConnectionState() {
    const response = await requestBackground({ type: MESSAGE_TYPES.getState });
    if (!response) {
      setFeedback("Failed to read connection state.", true);
      return;
    }

    applyConnectionState(response);
    render();
  }

  async function toggleConnection() {
    toggleBtn.disabled = true;
    setFeedback("");

    const nextEnabled = !viewState.enabled;
    const response = await requestBackground({
      type: MESSAGE_TYPES.setEnabled,
      enabled: nextEnabled
    });

    if (!response) {
      setFeedback("Failed to change Telegram connection state.", true);
      toggleBtn.disabled = false;
      return;
    }

    applyConnectionState(response);
    render();

    if (!response.ok) {
      setFeedback(viewState.error || "Telegram is not configured.", true);
    } else {
      setFeedback(nextEnabled ? "Telegram connected." : "Telegram disconnected.");
    }

    toggleBtn.disabled = false;
  }

  toggleBtn.addEventListener("click", () => {
    void toggleConnection();
  });

  void refreshConnectionState();
  setFeedback(DEFAULT_FEEDBACK);
})();
