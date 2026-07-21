# Focused

One click: understands your open tabs and sorts them into named Chrome tab groups using your choice of OpenAI, Anthropic, Gemini, or local Ollama.

Works in Chrome, Brave, Edge, Arc, Vivaldi — any Chromium browser that supports Manifest V3 tab groups.

**Just want to try it?** [Download focused.zip](https://github.com/prithvi-bharadwaj/focused-source/releases/latest/download/focused.zip) (~200 KB), unzip it, open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select the unzipped `focused` folder — no clone, no build. Full steps in the [public repo README](https://github.com/prithvi-bharadwaj/focused-source#try-it-in-two-minutes).

## Why I made this

At any given moment I have somewhere between 20 and 40 tabs open. It got annoying — I was burning real time going back and forth working out which tab had what, where the audio was coming from, or where I'd saved that one thing I needed for later.

Then I noticed I'd started leaving tabs open *on purpose*, as a sort of memory state — stuff to come back to later. So I was paying for that memory in navigation time, every single day. I wanted a fix I had full control over the UX of, which meant building it myself.

The point isn't folder-by-domain sorting — Focused groups by *intent*. Ten Twitter tabs won't collapse into one "entertainment" pile: the research thread you had open goes to research, the self-improvement essay goes to self-improvement. Same site, different jobs, different groups.

And you can just talk to it:

- Forgot which hotel you liked? Describe it — mine was "the one under $200 a night" — and it finds the tab among twenty other hotel tabs.
- Twenty LinkedIn profiles open for investor research and no memory of which name is which? Describe what you remember and it opens the right one.
- Stash a whole task and get an AI "where you left off" brief when you resume it — or export your groups and drop the file into ChatGPT or Claude to see where your attention actually went.

## Shaped by user feedback

Everyone I showed this to said they needed it — and then told me what was broken. Each round of feedback shipped:

- "I don't like the groups it made" → one-click undo, plus custom instructions so it follows your rules.
- "My browser is eating RAM" → per-group loaded-tab counts, so you can see which group to stash or close.
- "I have four windows open at once" and "I'm too lazy to click the button" → window merging and a tab-count auto-sort trigger both shipped too; I later removed them in a cleanup pass (`b8cd783`) to keep the core a single predictable click.

Around thirty people use it so far, and I haven't posted about it anywhere yet. Up next: a Chrome Web Store release, session memory so grouping gets better the more you use it, and a hosted option so an API key isn't required.

## How this was built (for Build Week judges)

This is the private development repo — the real history, not a curated snapshot. What you're looking at: 71 commits on `main`, ten merged feature branches, and a [`plans/`](plans/) directory that came out of a Codex audit (more on that below). The clean public mirror for end users lives at [focused-source](https://github.com/prithvi-bharadwaj/focused-source).

I built Focused during OpenAI Build Week in a loop between GPT-5.6 Codex (`gpt-5.6-sol` in the session metadata) and Claude, running in parallel Conductor workspaces — 24 workspaces and 42 sessions by the end. I used the two interchangeably, but a pattern emerged fast: one agent implements, the other reviews the diff, and I make the product call. Nothing merged just because an agent said it was done.

Where Codex did the heavy lifting:

- **The core build.** One Codex session read `SPEC.md` and implemented essentially the whole v0.3 platform in a single run — the OpenAI/Anthropic/Gemini/Ollama adapters, settings migration, spend caps, snapshot undo, duplicate cleanup, review mode, import/export, and the popup/options UI. 83 tool calls, two builds, and four edge cases it caught in its own final diff re-read. That session maps to commit `53fa138` (+1,706/−355) and is the one I submitted via `/feedback`.
- **The mid-hackathon audit.** The code was getting fast and loose, so I pointed a max-reasoning Codex session at it. It produced the seven executor-ready plans in [`plans/`](plans/): consent gating, incognito isolation, transactional stash resume, retryable partial undo, async races. Claude executed the big one (PR #7: +6,394/−2,788, zero → 94 tests), then Codex came back to review and integrate.
- **Catching real bugs.** A high-effort Codex review of the command engine found an incognito metadata leak, a swallowed post-mutation error, and broken cascade timing — all fixed before merge. I wouldn't have caught any of those by eyeballing the diff.
- **Later features.** The natural-language command actions (PRs #8 and #9, which also split the ~2,090-line service worker into 12 modules), targeted prompt-created groups, and the toolbar-to-page overlay (PR #10).

What stayed mine: the product idea and spec, the bring-your-own-key/no-backend privacy architecture, the stash/resume and command-bar interactions, the visual direction, what got cut, and every merge and licensing decision.

Final state: 124 tests in 17 files, TypeScript and production build green.

**Codex `/feedback` session ID (majority of core functionality):** `019f7252-7505-75d3-8b9a-17edff07b4b3`

## Features

- **Organize tabs** — groups loose tabs by task and intent, adds relevant tabs to existing groups, and orders focused work before entertainment. Tabs file into their groups as a visible ~2.5s cascade.
- **Command bar** — create or extract a targeted group, move tabs into an existing group, rename or recolor a group, ungroup one or every group, remove duplicates, and merge related groups with natural-language prompts. It can also jump to a described tab or answer a question from your open tabs with a Go-to-tab button.
- **Stash + resume briefs** — stash a whole group: its saveable web tabs close and Focused writes an AI "where you left off" brief (prices, options, what was still unchecked). Resume later to reopen those URLs as a fresh Chrome group — browser history, page and form state, and non-web tabs aren't restored. Unavailable in incognito because extension storage is shared.
- **Hybrid context** — optionally reads a short page snippet when a title and URL are too ambiguous to classify. Declining page access still leaves title/URL organization fully usable.
- **Quick actions** — ungroup everything, close duplicate URLs, or undo the last organize/ungroup/cleanup action from the popup.
- **Duplicate protection** — keeps pinned tabs and the active tab, otherwise retaining the most recently accessed copy. Cleanup can run automatically before organization.
- **Review mode** — inspect proposed groups and choose which ones to apply.
- **Custom instructions** — save personal grouping and naming rules, such as keeping work and personal tabs in separate groups.
- **Persistent progress** — close and reopen the popup without losing the active organize state or result.
- **Budget cap** — estimates provider spend from reported token usage and stops requests at your configured limit. Ollama remains free.
- **Import and export** — copy/download the current window's groups as JSON and recreate them later.
- **Flexible grouping** — choose a minimum group size or group every loose tab.

## Provider setup

Open the extension popup, choose the gear, then select a provider and model:

- **OpenAI** — create an API key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys) and paste it into Settings. The default is `gpt-5.6-luna` with low reasoning effort.
- **Anthropic** — create an API key at [console.anthropic.com](https://console.anthropic.com), then paste it into Settings. The default is `claude-haiku-4-5`.
- **Gemini** — create an API key in [Google AI Studio](https://aistudio.google.com/app/apikey), then paste it into Settings. The default is `gemini-3.1-flash-lite`.
- **Ollama** — install a model locally, set the Ollama URL (default `http://localhost:11434`), and allow extension origins when starting the server:

  ```sh
  OLLAMA_ORIGINS="chrome-extension://*" ollama serve
  ```

  Focused selects the first installed model if none has been chosen. If Ollama is already running as a desktop app or service, restart it with the same `OLLAMA_ORIGINS` environment setting.

Model lists are fetched live after provider settings are saved, with built-in fallbacks for hosted providers.

## Install

The easiest way to try Focused is the [packed zip](https://github.com/prithvi-bharadwaj/focused-source/releases/latest/download/focused.zip) — see the note at the top. To build from source instead:

Prerequisites: Node `^20.19.0` or `>=22.12.0` and pnpm 10.

```sh
pnpm install
pnpm build
```

Then in your browser:

1. Open `chrome://extensions` (or your browser's equivalent).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin **Focused** from the extensions menu.

## Development

```sh
pnpm dev
```

This rebuilds on changes. Reload the extension from the browser's extensions page to pick up a new build.

Stack: React 19, TypeScript, Tailwind v4, shadcn-style components, Radix primitives, and Vite. The service worker (`public/background.js`) is dependency-free plain JavaScript.

## Privacy

- API keys are stored in `chrome.storage.local` in this browser and are never synced.
- When you organize, use the command bar, or stash a group (for its brief), tab titles and URLs are sent only to the provider selected in Settings. Page snippets are sent only for ambiguous or stashed tabs, only if you grant the optional page-access permission. Each of these features asks you to acknowledge this once before the first request.
- Stashing is disabled in incognito windows: extension storage is shared with regular browsing, so nothing from private windows is ever saved.
- Ollama requests stay on the configured Ollama server, which is local by default.
- Group exports are created locally. There is no Focused backend, analytics, or tracking.

## License

This private repo is shared for hackathon judging only. The public source-available release is licensed under [PolyForm Shield 1.0.0](https://github.com/prithvi-bharadwaj/focused-source/blob/main/LICENSE); the `LICENSE` file here predates that decision. Licensing and third-party attribution live in [focused-source](https://github.com/prithvi-bharadwaj/focused-source).
