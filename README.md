# Shelve

Your browser remembers what you were doing, even when you don't.

One click: Shelve reads your open tabs and sorts them into named Chrome tab groups by *intent* — using your choice of OpenAI, Anthropic, Gemini, or local Ollama. Works in Chrome, Brave, Edge, Vivaldi — any Chromium browser with Manifest V3 tab groups.

**Try it in two minutes:** [download shelve.zip](https://github.com/prithvi-bharadwaj/shelve/releases/latest/download/shelve.zip) (~200 KB), unzip it, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and pick the unzipped folder. No build, no signup — just an API key from any provider (or a local Ollama).

## Why I made this

At any given moment I have somewhere between 20 and 40 tabs open. I noticed I'd started leaving tabs open *on purpose*, as a sort of memory state — stuff to come back to later. I was paying for that memory in navigation time, every single day.

The point isn't folder-by-domain sorting — Shelve groups by *intent*. Ten Twitter tabs won't collapse into one "entertainment" pile: the research thread goes to research, the self-improvement essay goes to self-improvement. Same site, different jobs, different groups.

And you can just talk to it:

- Forgot which hotel you liked? Describe it — "the one under $200 a night" — and it jumps to the tab, out of twenty other hotel tabs.
- Twenty LinkedIn profiles open and no memory of which name is which? Describe what you remember and it opens the right one.
- Done for the day? Shelve a whole project: its tabs close, and you get an AI "where you left off" brief when you pick it back up.

## Features

- **Organize** — one click groups loose tabs by task and intent, files new tabs into existing groups, and orders focused work before entertainment, as a visible cascade.
- **Command bar** — create, merge, rename, recolor, or dissolve groups with plain language; jump to a described tab; ask a question and get the answer from your open tabs.
- **Shelve + resume** — stash a group and its saveable tabs close behind an AI brief (prices, options, what was still unchecked). Resume reopens everything as a fresh group. Disabled in incognito by design.
- **Your stats** — a local-only count of tabs wrangled, shelved projects, and your streak. Nothing leaves your machine.
- **Review mode** — inspect proposed groups and apply only the ones you want.
- **Custom instructions** — your rules, e.g. keep work and personal in separate groups.
- **Quick actions** — merge windows, close duplicates, ungroup everything, undo the last action.
- **Budget cap** — estimates provider spend from token usage and stops at your limit. Ollama stays free.
- **Import/export** — groups as JSON, out and back in.

## Provider setup

Open the popup → gear → pick a provider and model:

- **OpenAI** — key from [platform.openai.com/api-keys](https://platform.openai.com/api-keys).
- **Anthropic** — key from [console.anthropic.com](https://console.anthropic.com).
- **Gemini** — key from [Google AI Studio](https://aistudio.google.com/app/apikey).
- **Ollama** — run a local model and allow extension origins:

  ```sh
  OLLAMA_ORIGINS="chrome-extension://*" ollama serve
  ```

Model lists are fetched live after you save provider settings, with built-in fallbacks.

## Build from source

Prerequisites: Node `^20.19.0` or `>=22.12.0`, pnpm 10.

```sh
pnpm install
pnpm build    # output in dist/
pnpm dev      # rebuild on changes
pnpm test     # vitest
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked.

## Privacy

- Your API keys live in `chrome.storage.local` in this browser and are never synced.
- Tab titles and URLs are sent only to the provider you selected — there is no Shelve backend, no analytics, no tracking. Page snippets are sent only for ambiguous or shelved tabs, only if you grant the optional page-access permission, and each feature asks you to acknowledge this once.
- Shelving is disabled in incognito windows: extension storage is shared with regular browsing, so nothing from private windows is ever saved.
- Stats are local-only counters. Group exports are created locally.

## License

[PolyForm Shield 1.0.0](LICENSE) — free to use, modify, and share; you just can't ship a competing product with it.
