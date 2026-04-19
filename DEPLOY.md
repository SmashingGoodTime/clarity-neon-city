# Deploying CLARITY to GitHub Pages

Clarity is a static site — no build step. Any static file host works. These steps are the fastest path for sharing with friends.

## Option A — GitHub Pages (recommended for sharing)

### 1. Initialize a repo inside `Clarity/`

```bash
cd Clarity
git init
git add .
git commit -m "Initial commit"
```

The included `.gitignore` already excludes Python cache files, logs, editor junk, and the `_clarity_alts/` folder (which sits a level up anyway).

### 2. Create a GitHub repo and push

Go to https://github.com/new, create an empty repo (e.g. `clarity-neon-city`), then from inside `Clarity/`:

```bash
git remote add origin https://github.com/YOUR-USERNAME/clarity-neon-city.git
git branch -M main
git push -u origin main
```

### 3. Enable Pages

- Repo → **Settings** → **Pages**
- **Source:** Deploy from a branch
- **Branch:** `main`, folder `/ (root)`
- Save. Wait ~1 minute.

Your game will be live at:
```
https://YOUR-USERNAME.github.io/clarity-neon-city/
```

Share that URL with friends. That's it.

### 4. If you want a cleaner URL

A repo literally named `YOUR-USERNAME.github.io` gets served at `https://YOUR-USERNAME.github.io/` (no repo name suffix). If that domain isn't taken, use it. Otherwise the `/clarity-neon-city/` suffix is fine.

---

## Option B — Netlify / Vercel / Cloudflare Pages

Drag the `Clarity/` folder onto https://app.netlify.com/drop — done in 10 seconds, no git needed. Gives you a `https://random-name.netlify.app/` URL.

Same drag-drop works for [Cloudflare Pages](https://pages.cloudflare.com/) and (with a repo) Vercel.

---

## Option C — itch.io

itch.io hosts HTML5 games natively and gives you a nice storefront page.

1. Zip the contents of `Clarity/` (not the folder itself — the contents, with `index.html` at the zip root).
2. Create a project on https://itch.io/game/new
3. **Kind of project:** HTML
4. Upload the zip, check **"This file will be played in the browser"**
5. Set viewport to **1280 × 800** (it scales down fine)
6. Publish

You get itch.io's comments, ratings, and discoverability.

---

## Before you share — quick checklist

- [ ] Open the public URL in a **private / incognito window** to verify it works without your local cache or localStorage.
- [ ] Click **NEW RUN** to confirm the title theme plays after the click (autoplay gates need a user gesture).
- [ ] Walk through one contract, one vendor, then sleep — just to verify no path errors.
- [ ] Check console for 404s (missing assets).

## Known friendly-ops notes

- **Saves are per-device** — they live in browser localStorage. Friends won't see your save.
- **First visit includes an orientation card** — it explains memory-as-currency, then writes `clarity.introSeen` to localStorage so it never appears again.
- **Total site size** is ~45 MB (most of it images and audio). GitHub Pages has a 1 GB repo limit, so you're fine.
- **No analytics, no network calls** beyond loading local assets. It's genuinely a pure static game.

## Updating later

Edit files locally, commit, push. GitHub Pages rebuilds in ~1 minute. There is a cache-bust query string on the `game.js` import in `index.html` — bump it (e.g. `?v=1` → `?v=2`) any time you ship a JS change and want to force visitors to re-download rather than use their cached copy.

```html
<script src="game.js?v=2"></script>
```

---

## Attribution block for your share post

> **CLARITY** — a cyberpunk immersive sim where memory is the inventory.
> Play: https://YOUR-URL-HERE
> Cold open: pick NEW RUN. ~30 min per ending. Three endings.
> Made in a weekend with Suno + Gemini + Claude. No installs, no account.
