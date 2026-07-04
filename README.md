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

### Option A — Blueprint (recommended)

This repo includes a [`render.yaml`](./render.yaml) Blueprint.

1. Push this repo to GitHub/GitLab.
2. In the Render dashboard → **New** → **Blueprint** → select the repo.
3. Render reads `render.yaml` and creates the static site automatically.
4. It runs `npm ci && npm run build` and serves `./dist`.

**Or, with the Render CLI:**

```bash
# install the CLI (macOS) — see Render docs for Windows/Linux installers
brew tap render-oss/render-oss && brew install render

# from the project root
render blueprint deploy
```

### Option B — Manual (no config files)

In the Render dashboard → **New** → **Static Site**:

| Setting | Value |
|---|---|
| **Build Command** | `npm ci && npm run build` |
| **Publish Directory** | `dist` |
| **Environment** | `Node 20` |

That's it — Render runs the build and serves the `dist` folder on a free
`*.onrender.com` URL (or your custom domain).

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
