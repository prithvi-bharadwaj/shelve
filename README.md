# Tab Organizer AI

One click: understands your open tabs and sorts them into named Chrome tab groups using Claude.

Works in Chrome, Brave, Edge, Arc, Vivaldi — any Chromium browser (Manifest V3).

## Features

- **Organize tabs** — sends tab titles + URLs to Claude, which groups them by what you're actually doing (two YouTube tabs about different topics land in different groups). Groups get short, specific names and colors.
- **Hybrid context** — if a title/URL is too ambiguous (e.g. `twitter.com/home`), the extension reads a snippet of that page's content for a second pass. Page access is an *optional* permission; decline it and everything still works on titles/URLs.
- **Merge windows** — pulls every window's tabs into the current one, keeping existing tab groups and pinned tabs intact.
- **Review mode** (optional) — see proposed groups with checkboxes before anything moves.
- Loose one-off tabs (messaging, random browsing) are left alone by default. Configurable.

## Setup

1. Get an Anthropic API key at [console.anthropic.com](https://console.anthropic.com).
2. Install the extension (below), click the puzzle-piece icon → pin **Tab Organizer AI**.
3. Click the icon → gear → paste your API key → Save. The model list loads live from your account.

## Install from source

```sh
pnpm install
pnpm build
```

Then in your browser:

1. Open `chrome://extensions` (or `brave://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** → select the `dist/` folder.

## Development

```sh
pnpm dev   # rebuilds on change; click the reload icon on chrome://extensions to pick up changes
```

Stack: React 19, TypeScript, Tailwind v4, shadcn-style components, Vite. The service worker (`public/background.js`) is dependency-free plain JS.

## Privacy

- Your API key is stored in `chrome.storage.local` (this browser only, never synced) and sent only to `api.anthropic.com`.
- Tab titles and URLs are sent to the Anthropic API when you click **Organize** — the popup discloses this and asks once before the first run. Page content is only read for tabs the model flags as ambiguous, and only if you granted the optional permission.
- Nothing is sent anywhere else. There is no backend, no analytics, no tracking.

## License

MIT
