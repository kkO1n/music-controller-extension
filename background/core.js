(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const STORAGE_KEYS = {
    nowPlaying: "nowPlaying",
    lastPlayerTabId: "player.lastTabId",
    telegramOffset: "telegram.offset",
    statusMessage: "telegram.statusMessage"
  };

  const MESSAGE_TYPES = {
    control: "PLAYER_CONTROL",
    stateRequest: "PLAYER_STATE_REQUEST",
    nowPlayingUpdate: "NOW_PLAYING_UPDATE"
  };

  const CONNECTION_MESSAGE_TYPES = {
    getState: "TELEGRAM_CONNECTION_GET_STATE",
    setEnabled: "TELEGRAM_CONNECTION_SET_ENABLED"
  };

  const CALLBACK_ACTIONS = new Set(["previous", "playPause", "next", "refresh"]);
  const COMMANDS = {
    start: "/start",
    now: "/now"
  };

  const CALLBACK_PREFIX = "ctl:";
  const TELEGRAM_POLL_TIMEOUT_SECONDS = 25;
  const TELEGRAM_RETRY_DELAY_MS = 4000;
  const TELEGRAM_OK_DELAY_MS = 250;

  const state = {
    bridgeConfig: null,
    bridgeConfigError: null,
    telegramEnabled: false,
    pollLoopRunning: false,
    pollAbortController: null
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeUserId(value) {
    return String(value ?? "").trim();
  }

  function isCommand(command, expectedCommand) {
    return command === expectedCommand || command.startsWith(`${expectedCommand}@`);
  }

  function isMessageNotModifiedError(error) {
    return String(error?.message || "").toLowerCase().includes("message is not modified");
  }

  function isAbortError(error) {
    return error?.name === "AbortError";
  }

  function textCommand(messageText) {
    return String(messageText || "")
      .trim()
      .split(/\s+/, 1)[0]
      .toLowerCase();
  }

  globalThis.__ymr = {
    api,
    constants: {
      STORAGE_KEYS,
      MESSAGE_TYPES,
      CONNECTION_MESSAGE_TYPES,
      CALLBACK_ACTIONS,
      COMMANDS,
      CALLBACK_PREFIX,
      TELEGRAM_POLL_TIMEOUT_SECONDS,
      TELEGRAM_RETRY_DELAY_MS,
      TELEGRAM_OK_DELAY_MS
    },
    state,
    utils: {
      sleep,
      normalizeUserId,
      isCommand,
      isMessageNotModifiedError,
      isAbortError,
      textCommand
    }
  };
})();
