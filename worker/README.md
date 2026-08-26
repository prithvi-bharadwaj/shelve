# Shelve free-actions proxy

A zero-logging Cloudflare Worker that gives every new install 25 free AI actions with no API key, so the first organize happens in minute one. After the meter runs out, the extension falls back to bring-your-own-key (free forever) or the hosted paid tier.

**Privacy contract:** request bodies pass through to Gemini and are never stored. The only persisted state is `installToken → count` (KV, 90-day TTL). No URLs, titles, or IPs are written. This file is the public documentation of that promise.

## Deploy (one-time, ~10 min)

1. `npm i -g wrangler && wrangler login` (Cloudflare account, free tier is fine)
2. `cd worker && wrangler kv namespace create METER` → paste the id into `wrangler.toml`
3. `wrangler secret put GEMINI_API_KEY` (a billing-capped key from AI Studio)
4. `wrangler deploy` → note the workers.dev URL (or bind `api.tryshelve.com`)

## API

`POST /v1/generate` with `Authorization: Bearer <installToken>` (UUID minted by the extension at install) and a Gemini `generateContent` JSON body. Responses pass through verbatim plus `x-shelve-actions-remaining`. `402 {"error":"free_actions_exhausted"}` when the meter is done. Failed provider calls don't burn actions.

## Extension wiring (not yet done — do this when deploying)

- Mint and store an install token (`crypto.randomUUID()`) on `onInstalled`.
- Add a "shelve-free" pseudo-provider in `public/background/providers.js` that targets this Worker and reads `x-shelve-actions-remaining` into settings for the popup to show ("18 free actions left").
- On 402, surface the two paths: paste your own key (free) or go hosted.
- Cost reality: 25 actions × flash-lite ≈ well under $0.05 per install.

## Paid tier (blocked on the CWS listing existing)

[ExtensionPay](https://extensionpay.com) is the payment rail (wraps Stripe, no backend of ours, works with license-free login). It needs the published extension ID, so wire it only after the store listing is live: register the extension on extensionpay.com, `extpay.getUser()` gates the hosted tier, price $5/mo or $39/yr. The free meter, BYOK, and all manual features stay free — the paywall sits exactly on "hosted AI actions beyond 25."
