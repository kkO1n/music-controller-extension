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

  const CALLBACK_ACTIONS = new Set(["previous", "playPause", "next", "refresh"]);
  const STATUS_COMMANDS = new Set(["/start", "/now"]);
  const COMMANDS = {
    start: "/start",
    now: "/now"
  };
  const CALLBACK_PREFIX = "ctl:";
  const TELEGRAM_POLL_TIMEOUT_SECONDS = 25;
  const TELEGRAM_RETRY_DELAY_MS = 4000;
  const TELEGRAM_OK_DELAY_MS = 250;

  let bridgeConfig = null;
  let pollLoopRunning = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeUserId(value) {
    return String(value ?? "").trim();
  }

  function isAuthorizedUser(fromId) {
    if (!bridgeConfig?.allowedUserId) {
      return false;
    }
    return normalizeUserId(fromId) === bridgeConfig.allowedUserId;
  }

  function hasTrack(nowPlaying) {
    return Boolean(nowPlaying?.found && (nowPlaying.title || nowPlaying.artists));
  }

  function formatProgress(nowPlaying) {
    if (!nowPlaying?.currentTime && !nowPlaying?.duration) {
      return "n/a";
    }
    if (!nowPlaying.duration) {
      return nowPlaying.currentTime;
    }
    if (!nowPlaying.currentTime) {
      return `00:00 / ${nowPlaying.duration}`;
    }
    return `${nowPlaying.currentTime} / ${nowPlaying.duration}`;
  }

  function formatStatusText(nowPlaying, note = "") {
    const lines = ["Yandex Music Remote"];

    if (!hasTrack(nowPlaying)) {
      lines.push("Status: no active player data.");
      lines.push("Open https://music.yandex.ru and play a track.");
    } else {
      lines.push(`Title: ${nowPlaying.title || "Unknown track"}`);
      lines.push(`Artists: ${nowPlaying.artists || "Unknown artist"}`);
      lines.push(`Playback: ${nowPlaying.isPlaying ? "playing" : "paused"}`);
      lines.push(`Progress: ${formatProgress(nowPlaying)}`);
      if (nowPlaying.trackUrl) {
        lines.push(`Link: ${nowPlaying.trackUrl}`);
      }
    }

    if (note) {
      lines.push(`Note: ${note}`);
    }

    return lines.join("\n");
  }

  function buildKeyboard(nowPlaying) {
    const playPauseLabel = nowPlaying?.isPlaying ? "Pause" : "Play";

    return {
      inline_keyboard: [
        [
          { text: "Previous", callback_data: `${CALLBACK_PREFIX}previous` },
          { text: playPauseLabel, callback_data: `${CALLBACK_PREFIX}playPause` },
          { text: "Next", callback_data: `${CALLBACK_PREFIX}next` }
        ],
        [{ text: "Refresh", callback_data: `${CALLBACK_PREFIX}refresh` }]
      ]
    };
  }

  function telegramUrl(method) {
    return `https://api.telegram.org/bot${bridgeConfig.botToken}/${method}`;
  }

  async function telegramApi(method, params = {}) {
    if (!bridgeConfig?.botToken) {
      throw new Error("Telegram bot token is not configured.");
    }

    const response = await fetch(telegramUrl(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params)
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const description = payload?.description || `HTTP ${response.status}`;
      throw new Error(`Telegram ${method} failed: ${description}`);
    }

    return payload.result;
  }

  function isMessageNotModifiedError(error) {
    return String(error?.message || "").toLowerCase().includes("message is not modified");
  }

  function textCommand(messageText) {
    return String(messageText || "")
      .trim()
      .split(/\s+/, 1)[0]
      .toLowerCase();
  }

  function isCommand(command, expectedCommand) {
    return command === expectedCommand || command.startsWith(`${expectedCommand}@`);
  }

  async function sendChatText(chatId, text) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text
    });
  }

  async function getNowPlaying() {
    const result = await api.storage.local.get(STORAGE_KEYS.nowPlaying);
    return result[STORAGE_KEYS.nowPlaying] || null;
  }

  async function saveStatusMessage(chatId, messageId) {
    await api.storage.local.set({
      [STORAGE_KEYS.statusMessage]: {
        chatId,
        messageId
      }
    });
  }

  async function getStoredStatusMessage() {
    const result = await api.storage.local.get(STORAGE_KEYS.statusMessage);
    return result[STORAGE_KEYS.statusMessage] || null;
  }

  async function clearStoredStatusMessage(chatId) {
    const stored = await getStoredStatusMessage();
    if (!stored || String(stored.chatId) !== String(chatId)) {
      return;
    }

    await api.storage.local.remove(STORAGE_KEYS.statusMessage);
  }

  async function upsertStatusMessage(
    chatId,
    preferredMessageId = null,
    note = "",
    options = {}
  ) {
    const forceNewMessage = Boolean(options.forceNewMessage);
    const nowPlaying = await getNowPlaying();
    const text = formatStatusText(nowPlaying, note);
    const replyMarkup = buildKeyboard(nowPlaying);

    const stored = await getStoredStatusMessage();
    const storedMessageId =
      stored && String(stored.chatId) === String(chatId) ? stored.messageId : null;
    const messageId = forceNewMessage ? null : preferredMessageId || storedMessageId;

    if (messageId) {
      try {
        await telegramApi("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text,
          reply_markup: replyMarkup,
          disable_web_page_preview: true
        });
        await saveStatusMessage(chatId, messageId);
        return { chatId, messageId };
      } catch (error) {
        if (!isMessageNotModifiedError(error)) {
          // Fallback to sending a new message below.
        } else {
          return { chatId, messageId };
        }
      }
    }

    const message = await telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
      disable_web_page_preview: true
    });

    await saveStatusMessage(chatId, message.message_id);
    return { chatId, messageId: message.message_id };
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

  async function answerCallback(callbackQueryId, text) {
    try {
      await telegramApi("answerCallbackQuery", {
        callback_query_id: callbackQueryId,
        text
      });
    } catch {
      // Best effort only.
    }
  }

  async function handleTextMessage(message) {
    const fromId = message.from?.id;
    const chatId = message.chat?.id;
    if (!chatId) {
      return;
    }

    if (!isAuthorizedUser(fromId)) {
      await sendChatText(chatId, "Access denied for this bot.");
      return;
    }

    const command = textCommand(message.text);
    if (isCommand(command, COMMANDS.start)) {
      await clearStoredStatusMessage(chatId);
      await upsertStatusMessage(chatId, null, "", { forceNewMessage: true });
      return;
    }

    if (isCommand(command, COMMANDS.now)) {
      await upsertStatusMessage(chatId);
      return;
    }

    await sendChatText(chatId, "Supported commands: /start, /now");
  }

  function parseCallbackAction(callbackData) {
    const raw = String(callbackData || "");
    if (!raw.startsWith(CALLBACK_PREFIX)) {
      return null;
    }

    const action = raw.slice(CALLBACK_PREFIX.length);
    return CALLBACK_ACTIONS.has(action) ? action : null;
  }

  async function maybeStartPolling() {
    if (!bridgeConfig) {
      await loadConfig();
    }
    if (bridgeConfig?.botToken && !pollLoopRunning) {
      void pollLoop();
    }
  }

  async function handleCallbackQuery(callbackQuery) {
    const fromId = callbackQuery.from?.id;
    const callbackQueryId = callbackQuery.id;
    const message = callbackQuery.message;
    const chatId = message?.chat?.id;
    const messageId = message?.message_id;

    if (!chatId || !messageId) {
      await answerCallback(callbackQueryId, "Invalid callback context.");
      return;
    }

    if (!isAuthorizedUser(fromId)) {
      await answerCallback(callbackQueryId, "Access denied.");
      return;
    }

    const action = parseCallbackAction(callbackQuery.data);
    if (!action) {
      await answerCallback(callbackQueryId, "Unknown action.");
      return;
    }

    if (action === "refresh") {
      const tabId = await resolvePlayerTabId();
      if (tabId !== null) {
        await requestFreshPlayerState(tabId);
      }
      await upsertStatusMessage(chatId, messageId);
      await answerCallback(callbackQueryId, "Updated.");
      return;
    }

    const result = await sendPlayerControl(action);
    await upsertStatusMessage(chatId, messageId, result.note);
    await answerCallback(callbackQueryId, result.ok ? "Done." : "Failed.");
  }

  async function handleTelegramUpdate(update) {
    if (update.message) {
      await handleTextMessage(update.message);
      return;
    }

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    }
  }

  async function getTelegramOffset() {
    const result = await api.storage.local.get(STORAGE_KEYS.telegramOffset);
    return Number(result[STORAGE_KEYS.telegramOffset] || 0);
  }

  async function setTelegramOffset(nextOffset) {
    await api.storage.local.set({ [STORAGE_KEYS.telegramOffset]: nextOffset });
  }

  async function pollTelegramOnce() {
    const offset = await getTelegramOffset();
    const updates = await telegramApi("getUpdates", {
      offset,
      timeout: TELEGRAM_POLL_TIMEOUT_SECONDS,
      allowed_updates: ["message", "callback_query"]
    });

    let nextOffset = offset;
    for (const update of updates) {
      nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
      await handleTelegramUpdate(update);
    }

    if (nextOffset !== offset) {
      await setTelegramOffset(nextOffset);
    }
  }

  async function pollLoop() {
    if (pollLoopRunning) {
      return;
    }

    pollLoopRunning = true;
    while (bridgeConfig?.botToken) {
      try {
        await pollTelegramOnce();
      } catch (error) {
        console.warn("[telegram-bridge]", error?.message || error);
        await sleep(TELEGRAM_RETRY_DELAY_MS);
      }
    }
    pollLoopRunning = false;
  }

  async function loadConfig() {
    try {
      const response = await fetch(api.runtime.getURL("config.local.json"), {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("config.local.json was not found.");
      }

      const payload = await response.json();
      const botToken = String(payload.botToken || "").trim();
      const allowedUserId = normalizeUserId(payload.allowedUserId);
      if (!botToken || !allowedUserId) {
        throw new Error("botToken and allowedUserId are required.");
      }

      bridgeConfig = { botToken, allowedUserId };
      return true;
    } catch (error) {
      bridgeConfig = null;
      console.warn(
        "[telegram-bridge] Telegram bridge disabled. Create config.local.json from config.example.json.",
        error?.message || error
      );
      return false;
    }
  }

  async function bootstrap() {
    const loaded = await loadConfig();
    if (!loaded) {
      return;
    }

    void pollLoop();
  }

  api.runtime.onInstalled.addListener(() => {
    void bootstrap();
  });

  api.runtime.onStartup.addListener(() => {
    void bootstrap();
  });

  api.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== MESSAGE_TYPES.nowPlayingUpdate) {
      return undefined;
    }

    const updates = {};
    if (message.payload) {
      updates[STORAGE_KEYS.nowPlaying] = message.payload;
    }
    if (typeof sender?.tab?.id === "number") {
      updates[STORAGE_KEYS.lastPlayerTabId] = sender.tab.id;
    }

    const keys = Object.keys(updates);
    if (!keys.length) {
      return Promise.resolve({ ok: true });
    }

    return api.storage.local.set(updates).then(async () => {
      await maybeStartPolling();
      return { ok: true };
    });
  });

  void bootstrap();
})();
