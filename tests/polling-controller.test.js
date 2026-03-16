const test = require("node:test");
const assert = require("node:assert/strict");

const connectionFsm = require("../background/connection-fsm.js");
const POLLING_CONTROLLER_PATH = require.resolve("../background/polling-controller.js");

function createStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    local: {
      async get(key) {
        if (typeof key === "string") {
          return { [key]: data[key] };
        }
        const result = {};
        for (const item of key) {
          result[item] = data[item];
        }
        return result;
      },
      async set(updates) {
        Object.assign(data, updates);
      }
    }
  };
}

function createHarness(overrides = {}) {
  const storage = createStorage();
  const counters = {
    notifyConnected: 0,
    notifyDisconnected: 0,
    loadConfig: 0
  };

  const ns = {
    api: {
      storage,
      tabs: {
        async query() {
          return [];
        }
      }
    },
    constants: {
      STORAGE_KEYS: {
        telegramOffset: "telegram.offset"
      },
      TELEGRAM_POLL_TIMEOUT_SECONDS: 25,
      TELEGRAM_RETRY_DELAY_MS: 1
    },
    utils: {
      sleep: async () => {},
      isAbortError: (error) => error?.name === "AbortError"
    },
    connectionFsm,
    state: {
      bridgeConfig: null,
      bridgeConfigError: null,
      lifecycleState: "DISCONNECTED",
      lastErrorCode: null,
      pollLoopRunning: false,
      pollAbortController: null
    },
    configService: {
      async loadConfig() {
        counters.loadConfig += 1;
        if (overrides.loadConfig === false) {
          ns.state.bridgeConfig = null;
          ns.state.bridgeConfigError = "botToken and allowedUserId are required.";
          return false;
        }
        ns.state.bridgeConfig = { botToken: "token", allowedUserId: "1" };
        ns.state.bridgeConfigError = null;
        return true;
      }
    },
    playerGateway: {
      async hasOpenPlayerTab() {
        return Boolean(overrides.hasOpenPlayerTab);
      }
    },
    telegramApiService: {
      async telegramApi() {
        return [];
      }
    },
    telegramUpdateHandlers: {
      async handleTelegramUpdate() {}
    },
    statusMessageService: {
      async notifyConnected() {
        counters.notifyConnected += 1;
      },
      async notifyDisconnected() {
        counters.notifyDisconnected += 1;
      }
    }
  };

  delete require.cache[POLLING_CONTROLLER_PATH];
  global.__ymr = ns;
  require(POLLING_CONTROLLER_PATH);

  return {
    controller: ns.pollingController,
    state: ns.state,
    counters
  };
}

test.afterEach(() => {
  delete global.__ymr;
  delete require.cache[POLLING_CONTROLLER_PATH];
});

test(
  "enable success enters CONNECTED_IDLE and returns standardized envelope",
  { concurrency: false },
  async () => {
  const { controller, state, counters } = createHarness({
    loadConfig: true,
    hasOpenPlayerTab: false
  });

  const result = await controller.setConnectionEnabled(true);

  assert.equal(result.ok, true);
  assert.equal(result.state, "CONNECTED_IDLE");
  assert.equal(result.errorCode, null);
  assert.equal(result.enabled, true);
  assert.equal(result.polling, false);
  assert.equal(counters.loadConfig, 1);
  assert.equal(counters.notifyConnected, 1);
  assert.equal(state.lifecycleState, "CONNECTED_IDLE");
  }
);

test("enable failure enters ERROR and returns error envelope", { concurrency: false }, async () => {
  const { controller, state } = createHarness({
    loadConfig: false,
    hasOpenPlayerTab: false
  });

  const result = await controller.setConnectionEnabled(true);

  assert.equal(result.ok, false);
  assert.equal(result.state, "ERROR");
  assert.equal(result.errorCode, "CONFIG_INVALID");
  assert.equal(result.enabled, false);
  assert.equal(result.error, "botToken and allowedUserId are required.");
  assert.equal(state.lifecycleState, "ERROR");
});

test(
  "disable transitions to DISCONNECTED and sends disconnect notification",
  { concurrency: false },
  async () => {
  const { controller, counters } = createHarness({
    loadConfig: true,
    hasOpenPlayerTab: false
  });

  await controller.setConnectionEnabled(true);
  const result = await controller.setConnectionEnabled(false);

  assert.equal(result.ok, true);
  assert.equal(result.state, "DISCONNECTED");
  assert.equal(result.enabled, false);
  assert.equal(counters.notifyDisconnected, 1);
  }
);
