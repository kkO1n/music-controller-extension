# Simple Firefox Popup Extension

Firefox WebExtension for Yandex Music with:
- popup now-playing display and playback controls
- Telegram bot remote controls (while Firefox is open)

## Setup

1. Install dependencies:
   - `npm install`

## Scripts

- Start in Firefox as a temporary add-on:
  - `npm run dev`
- Build package:
  - `npm run build`
- Validate manifest and extension files:
  - `npm run lint`

## Telegram Bridge Setup

1. Create a bot with `@BotFather` and copy its token.
2. Copy config template:
   - `cp config.example.json config.local.json`
3. Edit `config.local.json`:
   - set `botToken`
   - set `allowedUserId` to your Telegram user ID
4. Run extension:
   - `npm run dev`
5. Open `https://music.yandex.ru/` and play a song.
6. In Telegram, open your bot and send:
   - `/start` or `/now`

### Notes

- `config.local.json` is gitignored and must stay local.
- Remote Telegram control works only while Firefox is open and extension is running.
- Inline Telegram buttons: `Previous`, `Play/Pause`, `Next`, `Refresh`.
