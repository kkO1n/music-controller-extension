# Yandex Music Remote Control (Firefox Extension)

Firefox WebExtension for `music.yandex.ru` with two control surfaces:
- popup Telegram connection toggle in the browser toolbar
- Telegram bot remote control (works while Firefox and the extension are running)

## Features

- Detects current track title, artists, playback status, and progress
- Popup button to connect/disconnect Telegram polling
- Telegram bot commands and inline buttons for remote control
- Access control by Telegram user ID (`allowedUserId`)

## Architecture Overview

- `content/yandex-music-tracker.js`: reads player state on `music.yandex.ru`, stores `nowPlaying`, and accepts control/state requests from background.
- `background/*`: modular Telegram bridge:
  - `core.js`: shared constants/state/utilities
  - `telegram-api-service.js`: Telegram HTTP client
  - `config-service.js`: local config loading and user auth checks
  - `player-gateway.js`: Yandex tab lookup and player command forwarding
  - `status-message-service.js`: Telegram status message formatting/updating
  - `telegram-update-handlers.js`: `/start`, `/now`, and callback button handling
  - `polling-controller.js`: connect toggle state + long-poll lifecycle
  - `main.js`: event wiring (`runtime`, `tabs`) and orchestration
- `popup/*`: connection toggle UI only (connect/disconnect + status text).

## Requirements

- Firefox 140+ (regular desktop Firefox)
- Node.js 18+ and npm

## Install Dependencies

```bash
npm install
```

## Local Development (Temporary Add-on)

```bash
npm run dev
```

This opens Firefox with the extension loaded as a temporary add-on.

## Build Package

```bash
npm run build
```

Build artifacts are written to `web-ext-artifacts/`.

## Build And Install In Firefox (Persistent)

Use this flow when you want the extension installed in the browser, not as a temporary dev add-on.

1. Build the package:
```bash
npm run build
```
2. Sign the extension (required for persistent install on regular Firefox):
```bash
npx web-ext sign --source-dir . --channel unlisted --artifacts-dir web-ext-artifacts
```
3. Open Firefox `about:addons`.
4. Click the gear icon -> `Install Add-on From File...`.
5. Select the signed `.xpi` from `web-ext-artifacts/`.

### Update Installed Add-on

1. Increase `"version"` in `manifest.json`.
2. Rebuild and re-sign the extension.
3. Install the new signed `.xpi` from file again.

Firefox updates the existing add-on in place when add-on ID is the same and version is higher.

## Lint Extension

```bash
npm run lint
```

## Telegram Bridge Setup

1. Create a bot with `@BotFather` and copy the bot token.
2. Create local config:
```bash
cp config.example.json config.local.json
```
3. Edit `config.local.json`:
- `botToken`: Telegram bot token
- `allowedUserId`: your Telegram numeric user ID (as string)
  - You can get your user ID by messaging `@userinfobot` in Telegram.

4. Run the extension (temporary dev mode or installed `.xpi`) and open `https://music.yandex.ru/`.
5. In the extension popup, click `Connect to Telegram`.
6. Start playback in Yandex Music.
7. Open your bot in Telegram and send `/start` or `/now`.

## Telegram Commands

- `/start` - sends or refreshes the control message
- `/now` - refreshes current player status

Inline buttons:
- `Previous`
- `Play` or `Pause` (depends on current state)
- `Next`
- `Refresh`

### Extending Telegram Commands

- Add or update slash-command behavior in `background/telegram-update-handlers.js` (`handleTextMessage`).
- Add new inline callback actions by updating:
  - `CALLBACK_ACTIONS` in `background/core.js`
  - keyboard layout in `background/status-message-service.js`
  - callback handling in `background/telegram-update-handlers.js`.
- Keep player-side actions in `background/player-gateway.js` and `content/yandex-music-tracker.js` aligned.

## Important Notes

- `config.local.json` is local-only and ignored by git.
- Remote Telegram control is unavailable when Firefox or the extension is not running.
- Telegram polling starts only after you press `Connect to Telegram` in popup.
- Telegram polling stops when you press `Disconnect Telegram` or no Yandex Music tab is open.

## Important Firefox Note

Unsigned extensions can only be loaded temporarily in regular Firefox.
