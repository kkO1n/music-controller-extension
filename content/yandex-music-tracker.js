(() => {
  const api = globalThis.browser ?? globalThis.chrome;

  const STORAGE_KEY = "nowPlaying";
  const UPDATE_INTERVAL_MS = 1000;
  const PUBLISH_DEBOUNCE_MS = 150;

  const CONTROL_ACTIONS = new Set(["previous", "playPause", "next"]);

  const MESSAGE_TYPES = {
    control: "PLAYER_CONTROL",
    stateRequest: "PLAYER_STATE_REQUEST",
    nowPlayingUpdate: "NOW_PLAYING_UPDATE"
  };

  const SELECTORS = {
    playerRoot: [
      '[class*="PlayerBarDesktopWithBackgroundProgressBar_playerBar"]',
      '[class*="PlayerBarDesktopWithBackgroundProgressBar_player"]'
    ],
    title: ['[class*="Meta_title"]', 'a[href*="/track/"] span', 'a[href*="/track/"]'],
    artists: '[class*="Meta_artists"] a, [class*="Meta_artists"] span',
    currentTime: ['[class*="Timecode_root_start"] [aria-hidden="true"]', '[class*="Timecode_root_start"]'],
    duration: ['[class*="Timecode_root_end"] [aria-hidden="true"]', '[class*="Timecode_root_end"]'],
    trackLink: 'a[href*="/track/"]',
    playingMarker: '[class*="ChangeTimecodeBackground_root_isPlayingTrack"]'
  };

  let lastSerialized = "";
  let publishTimer = null;

  function readText(node) {
    return node?.textContent?.trim() ?? "";
  }

  function queryFirst(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) {
        return node;
      }
    }

    return null;
  }

  function queryPlayerRoot() {
    return queryFirst(document, SELECTORS.playerRoot);
  }

  function buttonIconHref(button) {
    const useNode = button.querySelector("use");
    return useNode?.getAttribute("href") || useNode?.getAttribute("xlink:href") || "";
  }

  function buttonAriaLabel(button) {
    return (button.getAttribute("aria-label") || "").toLowerCase();
  }

  function isMatchingControlButton(button, action) {
    const href = buttonIconHref(button);
    const ariaLabel = buttonAriaLabel(button);

    switch (action) {
      case "next":
        return href.includes("#next_xxs") || ariaLabel.includes("next") || ariaLabel.includes("следующ");

      case "previous":
        return (
          href.includes("#previous_xxs") ||
          ariaLabel.includes("previous") ||
          ariaLabel.includes("предыдущ")
        );

      case "playPause":
        return (
          href.includes("#play_filled_l") ||
          href.includes("#pause_filled_l") ||
          ariaLabel.includes("play") ||
          ariaLabel.includes("pause") ||
          ariaLabel.includes("воспроиз") ||
          ariaLabel.includes("пауз")
        );

      default:
        return false;
    }
  }

  function clickControl(action) {
    const root = queryPlayerRoot() || document;
    const buttons = Array.from(root.querySelectorAll("button"));
    const target = buttons.find((button) => isMatchingControlButton(button, action));

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

    return {
      title: metadata.title ?? "",
      artists: metadata.artist ?? "",
      coverUrl: metadata.artwork?.[0]?.src ?? "",
      isPlaying: navigator.mediaSession?.playbackState === "playing"
    };
  }

  function collectArtists(playerRoot) {
    const artistNodes = playerRoot ? playerRoot.querySelectorAll(SELECTORS.artists) : [];

    return Array.from(artistNodes)
      .map((node) => readText(node))
      .filter(Boolean)
      .join(", ");
  }

  function buildTrackSnapshot(playerRoot, mediaSession) {
    const titleNode = playerRoot ? queryFirst(playerRoot, SELECTORS.title) : null;
    const currentTimeNode = playerRoot ? queryFirst(playerRoot, SELECTORS.currentTime) : null;
    const durationNode = playerRoot ? queryFirst(playerRoot, SELECTORS.duration) : null;

    const trackLink = playerRoot?.querySelector(SELECTORS.trackLink) || null;
    const coverNode = playerRoot?.querySelector("img") || null;

    const domPlaying = playerRoot
      ? Boolean(playerRoot.querySelector(SELECTORS.playingMarker))
      : false;

    return {
      found: true,
      isPlaying: mediaSession?.isPlaying ?? domPlaying,
      title: readText(titleNode) || mediaSession?.title || "",
      artists: collectArtists(playerRoot) || mediaSession?.artists || "",
      currentTime: readText(currentTimeNode),
      duration: readText(durationNode),
      trackUrl: trackLink ? new URL(trackLink.getAttribute("href"), location.origin).href : "",
      coverUrl: coverNode?.src ?? mediaSession?.coverUrl ?? "",
      pageUrl: location.href,
      updatedAt: Date.now()
    };
  }

  function collectTrackInfo() {
    const playerRoot = queryPlayerRoot();
    const mediaSession = mediaSessionSnapshot();

    if (!playerRoot && !mediaSession) {
      return null;
    }

    const snapshot = buildTrackSnapshot(playerRoot, mediaSession);
    if (!snapshot.title && !snapshot.artists) {
      return null;
    }

    return snapshot;
  }

  function buildFallbackSnapshot() {
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
    const payload = collectTrackInfo() ?? buildFallbackSnapshot();
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

  function schedulePublish() {
    if (publishTimer !== null) {
      return;
    }

    publishTimer = setTimeout(async () => {
      publishTimer = null;
      await publish();
    }, PUBLISH_DEBOUNCE_MS);
  }

  function handleStateRequest() {
    return Promise.resolve({
      ok: true,
      payload: collectTrackInfo() ?? buildFallbackSnapshot()
    });
  }

  function handleControlRequest(message) {
    if (!CONTROL_ACTIONS.has(message.action)) {
      return Promise.resolve({ ok: false, error: "Unsupported action." });
    }

    const ok = clickControl(message.action);
    if (ok) {
      schedulePublish();
    }

    return Promise.resolve({ ok });
  }

  function onRuntimeMessage(message) {
    if (!message) {
      return undefined;
    }

    if (message.type === MESSAGE_TYPES.stateRequest) {
      return handleStateRequest();
    }

    if (message.type === MESSAGE_TYPES.control) {
      return handleControlRequest(message);
    }

    return undefined;
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

  api.runtime.onMessage.addListener(onRuntimeMessage);

  void publish();
})();
