(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;

  function telegramUrl(method) {
    return `https://api.telegram.org/bot${ns.state.bridgeConfig.botToken}/${method}`;
  }

  async function telegramApi(method, params = {}, options = {}) {
    if (!ns.state.bridgeConfig?.botToken) {
      throw new Error("Telegram bot token is not configured.");
    }

    const response = await fetch(telegramUrl(method), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: options.signal
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      const description = payload?.description || `HTTP ${response.status}`;
      throw new Error(`Telegram ${method} failed: ${description}`);
    }

    return payload.result;
  }

  async function sendChatText(chatId, text) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text
    });
  }

  ns.telegramApiService = {
    telegramApi,
    sendChatText
  };
})();
