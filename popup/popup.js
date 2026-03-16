(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const STORAGE_KEY = "nowPlaying";

  const titleNode = document.getElementById("title");
  const artistsNode = document.getElementById("artists");
  const progressNode = document.getElementById("progress");
  const statusNode = document.getElementById("status");

  function renderProgress(currentTime, duration) {
    if (!currentTime && !duration) {
      return "";
    }
    if (!duration) {
      return currentTime;
    }
    return currentTime ? `${currentTime} / ${duration}` : `00:00 / ${duration}`;
  }

  function renderState(state) {
    if (!state || !state.found) {
      titleNode.textContent = "Open music.yandex.ru";
      artistsNode.textContent = "Play any song to start tracking.";
      progressNode.textContent = "";
      statusNode.textContent = "No active player detected.";
      statusNode.classList.remove("status-playing");
      return;
    }

    titleNode.textContent = state.title || "Unknown track";
    artistsNode.textContent = state.artists || "Unknown artist";
    progressNode.textContent = renderProgress(state.currentTime, state.duration);
    statusNode.textContent = state.isPlaying ? "Playing" : "Paused";
    statusNode.classList.toggle("status-playing", Boolean(state.isPlaying));
  }

  async function loadInitialState() {
    const result = await api.storage.local.get(STORAGE_KEY);
    renderState(result[STORAGE_KEY]);
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

  void loadInitialState();
})();
