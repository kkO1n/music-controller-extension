(() => {
  const ns = globalThis.__ymr;
  const { api } = ns;
  const { ACTION_ICONS } = ns.constants;

  async function setConnectedIcon(connected) {
    if (!api.action?.setIcon) {
      return;
    }

    const path = connected ? ACTION_ICONS.connected : ACTION_ICONS.disconnected;

    try {
      await api.action.setIcon({ path });
    } catch {
      // Best effort only.
    }
  }

  async function syncFromLifecycleState(state) {
    const connected = ns.connectionFsm.isUserEnabledState(state);
    await setConnectedIcon(connected);
  }

  ns.actionIconService = {
    setConnectedIcon,
    syncFromLifecycleState
  };
})();
