(() => {
  const ns = globalThis.__ymr;
  const { CALLBACK_ACTIONS, CALLBACK_PREFIX, COMMANDS } = ns.constants;
  const { textCommand, isCommand } = ns.utils;

  function parseCallbackAction(callbackData) {
    const raw = String(callbackData || "");
    if (!raw.startsWith(CALLBACK_PREFIX)) {
      return null;
    }

    const action = raw.slice(CALLBACK_PREFIX.length);
    return CALLBACK_ACTIONS.has(action) ? action : null;
  }

  async function answerCallback(callbackQueryId, text) {
    try {
      await ns.telegramApiService.telegramApi("answerCallbackQuery", {
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

    if (!ns.configService.isAuthorizedUser(fromId)) {
      await ns.telegramApiService.sendChatText(chatId, "Access denied for this bot.");
      return;
    }

    const command = textCommand(message.text);
    if (isCommand(command, COMMANDS.start)) {
      await ns.statusMessageService.clearStoredStatusMessage(chatId);
      await ns.statusMessageService.upsertStatusMessage(chatId, null, "", { forceNewMessage: true });
      return;
    }

    if (isCommand(command, COMMANDS.now)) {
      await ns.statusMessageService.upsertStatusMessage(chatId);
      return;
    }

    await ns.telegramApiService.sendChatText(chatId, "Supported commands: /start, /now");
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

    if (!ns.configService.isAuthorizedUser(fromId)) {
      await answerCallback(callbackQueryId, "Access denied.");
      return;
    }

    const action = parseCallbackAction(callbackQuery.data);
    if (!action) {
      await answerCallback(callbackQueryId, "Unknown action.");
      return;
    }

    if (action === "refresh") {
      const tabId = await ns.playerGateway.resolvePlayerTabId();
      if (tabId !== null) {
        await ns.playerGateway.requestFreshPlayerState(tabId);
      }
      await ns.statusMessageService.upsertStatusMessage(chatId, messageId);
      await answerCallback(callbackQueryId, "Updated.");
      return;
    }

    const result = await ns.playerGateway.sendPlayerControl(action);
    await ns.statusMessageService.upsertStatusMessage(chatId, messageId, result.note);
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

  ns.telegramUpdateHandlers = {
    handleTelegramUpdate
  };
})();
