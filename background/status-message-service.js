(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;
  const { STORAGE_KEYS, CALLBACK_PREFIX } = ns.constants;
  const { isMessageNotModifiedError } = ns.utils;

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

  function formatDisconnectedText() {
    return [
      "Yandex Music Remote",
      "Status: disconnected.",
      "Open the extension popup and press Connect to Telegram to enable remote control."
    ].join("\n");
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
        await ns.telegramApiService.telegramApi("editMessageText", {
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

    const message = await ns.telegramApiService.telegramApi("sendMessage", {
      chat_id: chatId,
      text,
      reply_markup: replyMarkup,
      disable_web_page_preview: true
    });

    await saveStatusMessage(chatId, message.message_id);
    return { chatId, messageId: message.message_id };
  }

  async function notifyDisconnected() {
    if (!ns.state.bridgeConfig?.botToken) {
      return;
    }

    const stored = await getStoredStatusMessage();
    if (!stored?.chatId) {
      return;
    }

    const chatId = stored.chatId;
    const text = formatDisconnectedText();
    const emptyKeyboard = { inline_keyboard: [] };

    if (stored.messageId) {
      try {
        await ns.telegramApiService.telegramApi("editMessageText", {
          chat_id: chatId,
          message_id: stored.messageId,
          text,
          reply_markup: emptyKeyboard,
          disable_web_page_preview: true
        });
        return;
      } catch {
        // Fallback to sending a new message below.
      }
    }

    try {
      const message = await ns.telegramApiService.telegramApi("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: emptyKeyboard,
        disable_web_page_preview: true
      });
      await saveStatusMessage(chatId, message.message_id);
    } catch {
      // Best effort notification.
    }
  }

  async function notifyConnected() {
    if (!ns.state.bridgeConfig?.botToken) {
      return;
    }

    const stored = await getStoredStatusMessage();
    if (!stored?.chatId) {
      return;
    }

    const tabId = await ns.playerGateway.resolvePlayerTabId();
    if (tabId !== null) {
      await ns.playerGateway.requestFreshPlayerState(tabId);
    }

    const note = tabId === null ? "Connection enabled. Open music.yandex.ru." : "Connection enabled.";

    try {
      await upsertStatusMessage(stored.chatId, stored.messageId || null, note);
    } catch {
      // Best effort notification.
    }
  }

  async function refreshStoredStatusMessage(note = "") {
    const stored = await getStoredStatusMessage();
    if (!stored?.chatId) {
      return false;
    }

    const tabId = await ns.playerGateway.resolvePlayerTabId();
    if (tabId !== null) {
      await ns.playerGateway.requestFreshPlayerState(tabId);
    }

    try {
      await upsertStatusMessage(stored.chatId, stored.messageId || null, note);
      return true;
    } catch {
      return false;
    }
  }

  ns.statusMessageService = {
    upsertStatusMessage,
    clearStoredStatusMessage,
    notifyDisconnected,
    notifyConnected,
    getStoredStatusMessage,
    refreshStoredStatusMessage
  };
})();
