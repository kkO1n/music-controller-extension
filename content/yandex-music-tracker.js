(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const STORAGE_KEY = "nowPlaying";
  const UPDATE_INTERVAL_MS = 1000;
  const CONTROL_ACTIONS = new Set(["previous", "playPause", "next"]);
  const MESSAGE_TYPES = {
    control: "PLAYER_CONTROL",
    stateRequest: "PLAYER_STATE_REQUEST",
    nowPlayingUpdate: "NOW_PLAYING_UPDATE"
  };
  let lastSerialized = "";

  function text(node) {
    return node?.textContent?.trim() ?? "";
  }

  function first(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) {
        return node;
      }
    }
    return null;
  }

  function queryPlayerRoot() {
    return (
      document.querySelector('[class*="PlayerBarDesktopWithBackgroundProgressBar_playerBar"]') ||
      document.querySelector('[class*="PlayerBarDesktopWithBackgroundProgressBar_player"]')
    );
  }

  function iconHref(button) {
    const useNode = button.querySelector("use");
    return useNode?.getAttribute("href") || useNode?.getAttribute("xlink:href") || "";
  }

  function label(button) {
    return (button.getAttribute("aria-label") || "").toLowerCase();
  }

  function matchByAction(button, action) {
    const href = iconHref(button);
    const ariaLabel = label(button);

    if (action === "next") {
      return href.includes("#next_xxs") || ariaLabel.includes("next") || ariaLabel.includes("следующ");
    }

    if (action === "previous") {
      return (
        href.includes("#previous_xxs") ||
        ariaLabel.includes("previous") ||
        ariaLabel.includes("предыдущ")
      );
    }

    if (action === "playPause") {
      return (
        href.includes("#play_filled_l") ||
        href.includes("#pause_filled_l") ||
        ariaLabel.includes("play") ||
        ariaLabel.includes("pause") ||
        ariaLabel.includes("воспроиз") ||
        ariaLabel.includes("пауз")
      );
    }

    return false;
  }

  function clickControl(action) {
    const playerRoot = queryPlayerRoot() || document;
    const buttons = Array.from(playerRoot.querySelectorAll("button"));
    const target = buttons.find((button) => matchByAction(button, action));

    if (!target) {
      return false;
    }

    target.click();
    return true;
  }

  function mediaSessionSnapshot() {
    const metadata = navigator.mediaSession?.metadata;
    if (!metadata) {
      return null;
    }

    const bestArtwork = metadata.artwork?.[0]?.src ?? "";
    const playbackState = navigator.mediaSession?.playbackState;

    return {
      title: metadata.title ?? "",
      artists: metadata.artist ?? "",
      coverUrl: bestArtwork,
      isPlaying: playbackState === "playing"
    };
  }

  function collectTrackInfo() {
    const playerRoot = queryPlayerRoot();
    const mediaSession = mediaSessionSnapshot();

    if (!playerRoot && !mediaSession) {
      return null;
    }

    const titleNode = playerRoot
      ? first(playerRoot, [
      '[class*="Meta_title"]',
      'a[href*="/track/"] span',
      'a[href*="/track/"]'
        ])
      : null;

    const artistNodes = playerRoot
      ? playerRoot.querySelectorAll('[class*="Meta_artists"] a, [class*="Meta_artists"] span')
      : [];

    const artists = Array.from(artistNodes)
      .map((node) => text(node))
      .filter(Boolean)
      .join(", ");

    const currentTimeNode = playerRoot
      ? first(playerRoot, [
      '[class*="Timecode_root_start"] [aria-hidden="true"]',
      '[class*="Timecode_root_start"]'
        ])
      : null;

    const durationNode = playerRoot
      ? first(playerRoot, [
      '[class*="Timecode_root_end"] [aria-hidden="true"]',
      '[class*="Timecode_root_end"]'
        ])
      : null;

    const coverNode = playerRoot?.querySelector("img");
    const trackLink = playerRoot?.querySelector('a[href*="/track/"]');
    const domPlaying = playerRoot
      ? Boolean(playerRoot.querySelector('[class*="ChangeTimecodeBackground_root_isPlayingTrack"]'))
      : false;

    const nowPlaying = {
      found: true,
      isPlaying: mediaSession?.isPlaying ?? domPlaying,
      title: text(titleNode) || mediaSession?.title || "",
      artists: artists || mediaSession?.artists || "",
      currentTime: text(currentTimeNode),
      duration: text(durationNode),
      trackUrl: trackLink ? new URL(trackLink.getAttribute("href"), location.origin).href : "",
      coverUrl: coverNode?.src ?? mediaSession?.coverUrl ?? "",
      pageUrl: location.href,
      updatedAt: Date.now()
    };

    if (!nowPlaying.title && !nowPlaying.artists) {
      return null;
    }

    return nowPlaying;
  }

  function buildFallback() {
    return {
      found: false,
      title: "",
      artists: "",
      currentTime: "",
      duration: "",
      trackUrl: "",
      coverUrl: "",
      pageUrl: location.href,
      updatedAt: Date.now()
    };
  }

  async function publish() {
    const payload = collectTrackInfo() ?? buildFallback();
    const serialized = JSON.stringify(payload);
    if (serialized === lastSerialized) {
      return;
    }

    lastSerialized = serialized;
    await api.storage.local.set({ [STORAGE_KEY]: payload });

    try {
      await api.runtime.sendMessage({
        type: MESSAGE_TYPES.nowPlayingUpdate,
        payload
      });
    } catch {
      // Ignore when background is unavailable.
    }
  }

  let publishTimer = null;
  function schedulePublish() {
    if (publishTimer !== null) {
      return;
    }

    publishTimer = setTimeout(async () => {
      publishTimer = null;
      await publish();
    }, 150);
  }

  const observer = new MutationObserver(() => {
    schedulePublish();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
  });

  setInterval(() => {
    void publish();
  }, UPDATE_INTERVAL_MS);

  api.runtime.onMessage.addListener((message) => {
    if (!message) {
      return undefined;
    }

    if (message.type === MESSAGE_TYPES.stateRequest) {
      return Promise.resolve({
        ok: true,
        payload: collectTrackInfo() ?? buildFallback()
      });
    }

    if (message.type !== MESSAGE_TYPES.control) {
      return undefined;
    }

    if (!CONTROL_ACTIONS.has(message.action)) {
      return Promise.resolve({ ok: false, error: "Unsupported action." });
    }

    const ok = clickControl(message.action);
    if (ok) {
      schedulePublish();
    }

    return Promise.resolve({ ok });
  });

  void publish();
})();
