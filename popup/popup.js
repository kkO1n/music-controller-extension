(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const STORAGE_KEY = "nowPlaying";
  const CONTROL_MESSAGE_TYPE = "PLAYER_CONTROL";

  const titleNode = document.getElementById("title");
  const artistsNode = document.getElementById("artists");
  const progressNode = document.getElementById("progress");
  const statusNode = document.getElementById("status");
  const feedbackNode = document.getElementById("feedback");
  const previousBtn = document.getElementById("previousBtn");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const nextBtn = document.getElementById("nextBtn");
  const CONTROL_BINDINGS = [
    [previousBtn, "previous"],
    [playPauseBtn, "playPause"],
    [nextBtn, "next"]
  ];

  function renderProgress(currentTime, duration) {
    if (!currentTime && !duration) {
      return "";
    }
    if (!duration) {
      return currentTime;
    }
    return currentTime ? `${currentTime} / ${duration}` : `00:00 / ${duration}`;
  }

  function setFeedback(message, isError = false) {
    feedbackNode.textContent = message;
    feedbackNode.classList.toggle("feedback-error", isError);
  }

  function setControlsDisabled(disabled) {
    previousBtn.disabled = disabled;
    playPauseBtn.disabled = disabled;
    nextBtn.disabled = disabled;
  }

  function playPauseLabel(state) {
    return state?.isPlaying ? "Pause" : "Play";
  }

  function renderState(state) {
    if (!state || !state.found) {
      titleNode.textContent = "Open music.yandex.ru";
      artistsNode.textContent = "Play any song to start tracking.";
      progressNode.textContent = "";
      statusNode.textContent = "No active player detected.";
      statusNode.classList.remove("status-playing");
      playPauseBtn.textContent = "Play/Pause";
      setControlsDisabled(false);
      return;
    }

    titleNode.textContent = state.title || "Unknown track";
    artistsNode.textContent = state.artists || "Unknown artist";
    progressNode.textContent = renderProgress(state.currentTime, state.duration);
    statusNode.textContent = state.isPlaying ? "Playing" : "Paused";
    statusNode.classList.toggle("status-playing", Boolean(state.isPlaying));
    playPauseBtn.textContent = playPauseLabel(state);
    setControlsDisabled(false);
  }

  async function loadInitialState() {
    const result = await api.storage.local.get(STORAGE_KEY);
    renderState(result[STORAGE_KEY]);
  }

  async function activeTabId() {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0]?.id ?? null;
  }

  async function sendControl(action) {
    setFeedback("");
    const tabId = await activeTabId();
    if (tabId === null) {
      setFeedback("No active tab found.", true);
      return;
    }

    try {
      const response = await api.tabs.sendMessage(tabId, {
        type: CONTROL_MESSAGE_TYPE,
        action
      });

      if (!response?.ok) {
        setFeedback("Player control not found on this tab.", true);
        return;
      }

      setFeedback("Command sent.");
    } catch {
      setFeedback("Open music.yandex.ru in the active tab first.", true);
    }
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") {
      return;
    }

    if (!changes[STORAGE_KEY]) {
      return;
    }

    renderState(changes[STORAGE_KEY].newValue);
  });

  for (const [button, action] of CONTROL_BINDINGS) {
    button.addEventListener("click", () => {
      void sendControl(action);
    });
  }

  setControlsDisabled(true);
  void loadInitialState();
})();
