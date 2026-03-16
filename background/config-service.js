(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;
  const { normalizeUserId } = ns.utils;

  function isAuthorizedUser(fromId) {
    if (!ns.state.bridgeConfig?.allowedUserId) {
      return false;
    }
    return normalizeUserId(fromId) === ns.state.bridgeConfig.allowedUserId;
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

      ns.state.bridgeConfig = { botToken, allowedUserId };
      ns.state.bridgeConfigError = null;
      return true;
    } catch (error) {
      ns.state.bridgeConfig = null;
      ns.state.bridgeConfigError = error?.message || "Telegram config is invalid.";
      console.warn(
        "[telegram-bridge] Telegram bridge disabled. Create config.local.json from config.example.json.",
        ns.state.bridgeConfigError
      );
      return false;
    }
  }

  ns.configService = {
    isAuthorizedUser,
    loadConfig
  };
})();
