# Yandex Music Remote Control (Firefox Extension)

Firefox WebExtension for `music.yandex.ru` with two control surfaces:
- popup UI in the browser toolbar
- Telegram bot remote control (works while Firefox and the extension are running)

## Features

- Detects current track title, artists, playback status, and progress
- Playback controls in popup: `Previous`, `Play/Pause`, `Next`
- Telegram bot commands and inline buttons for remote control
- Access control by Telegram user ID (`allowedUserId`)

## Requirements

- Firefox 109+
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

4. Start the extension (`npm run dev`) and open `https://music.yandex.ru/`.
5. Start playback in Yandex Music.
6. Open your bot in Telegram and send `/start` or `/now`.

## Telegram Commands

- `/start` - sends or refreshes the control message
- `/now` - refreshes current player status

Inline buttons:
- `Previous`
- `Play` or `Pause` (depends on current state)
- `Next`
- `Refresh`

## Important Notes

- `config.local.json` is local-only and ignored by git.
- Remote Telegram control is unavailable when Firefox or the extension is not running.
- Popup controls are intended for tabs with `https://music.yandex.ru/*`.

## Persistent Installation in Firefox

For permanent installation on regular Firefox, use a signed `.xpi` package.
Unsigned extensions can only be loaded temporarily in standard Firefox.
