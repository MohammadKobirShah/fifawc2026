# Saoodify Player — KaiOS Edition

A cursor-free, **full-keypad-controlled** streaming player for KaiOS 2.5.3 (Gecko 48) screens.
Plays DASH/MPD (ClearKey DRM via Shaka Player) and HLS/M3U8 (hls.js). Built with
React + Vite + Tailwind, bundled into a single self-contained `dist/index.html`.

---

## ⌨️ Keypad controls (no cursor needed)

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `OK` / `5` | Play / Pause | | `0` | Mute |
| `◄` / `4` | −10s | | `▲` / `2` / `Vol+` | Volume up |
| `►` / `6` | +10s | | `▼` / `8` / `Vol−` | Volume down |
| `1` | −30s | | `7` | Previous channel |
| `3` | +30s | | `9` | Next channel |
| `*` / LSK | Servers | | `#` / RSK | Settings |
| `Call` | Fullscreen | | `Back` | Show / hide controls |

In menus: `▲/▼` move · `OK`/LSK select · `Back`/RSK/◄ back.
Settings → **Full keymap** shows the complete on-device reference.

---

## 🔨 Build locally

```bash
npm install        # install dependencies
npm run build      # outputs a single file to dist/index.html
npm run preview    # local preview of the production build
```

The production build is fully self-contained in `dist/index.html` (shaka-player
& hls.js are loaded from CDN at runtime).

---

## 🚀 Deploy to Render

### ❗ Fixing "Application exited early"

If your deploy log shows the build succeeding (`✓ built in …s`) and then
**"Application exited early"**, it means your service is a **Web Service**
whose **Start Command is `npm run build`**. `npm run build` only *builds* the
files and exits — there is nothing left running, so Render kills the deploy.

This app is **static** (`dist/index.html`). Choose ONE of the fixes below.

---

### ✅ Fix A — Switch to a Static Site (recommended, free)

This is the correct service type for this app. In the Render dashboard open
your service → **Settings**, change the type to **Static Site**, and set:

| Setting | Value |
|---|---|
| **Build Command** | `npm install && npm run build` |
| **Publish Directory** | `dist` |

Static Sites have **no Start Command** — Render serves the `dist` folder
directly. Save → trigger a manual deploy. Done.

> To recreate cleanly: **New → Static Site** with Build Command
> `npm install && npm run build` and Publish Directory `dist`.

---

### ✅ Fix B — Keep your Web Service (use the bundled server)

This repo includes a zero-dependency static server (`server.js`) that stays
alive forever. In your Web Service **Settings**, set:

| Setting | Value |
|---|---|
| **Build Command** | `npm install && npm run build` |
| **Start Command** | `node server.js` |

`server.js` listens on `$PORT` and serves `dist/` (with SPA fallback). Save →
manual deploy. The log will show:

```
Saoodify Player running →  http://0.0.0.0:<PORT>
```

---

### Option C — Blueprint (auto-config from render.yaml)

The included [`render.yaml`](./render.yaml) already declares a **Static Site**.
Push the repo to GitHub/GitLab, then:

- Render dashboard → **New** → **Blueprint** → select the repo, **or**
- Render CLI: `brew tap render-oss/render-oss && brew install render && render blueprint deploy`

---

### Live endpoints after deploy

- **App:** `https://<your-service>.onrender.com/index.html`
- **KaiOS manifest:** `https://<your-service>.onrender.com/manifest.webapp`
- **Icon:** `https://<your-service>.onrender.com/icons/icon-112.png`

---

## 📦 Packaging as a KaiOS app

The build output (`dist/`) already contains the packaging artifacts:

```
dist/
├── index.html          # self-contained app
├── manifest.webapp     # KaiOS manifest
└── icons/icon-112.png  # app icon
```

To package, zip the `dist/` contents and load it with the KaiOS App Simulator,
or submit via the KaiStore developer portal.
