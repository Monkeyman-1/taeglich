# Täglich — Deutsch

A daily German practice app (spaced repetition, typed recall) built as a single-page, installable PWA. No build step — `index.html` is the whole app.

## One-time setup: enable GitHub Pages

1. In this repo on GitHub: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or this branch) — the `Deploy to GitHub Pages` workflow (`.github/workflows/deploy.yml`) will publish the site automatically.
4. Your live URL will be `https://<username>.github.io/<repo>/` (shown in the Actions run and in Settings → Pages).

## Installing on your phone

1. Open the GitHub Pages URL in Chrome on Android.
2. Tap the menu (⋮) → **Add to Home screen** / **Install app**.
3. It now runs full-screen from your home screen like a native app.

## How updates reach your phone

The app registers a service worker (`sw.js`) that caches its files for offline use. Every time you (or Claude) push a change to `main`:

1. GitHub Actions redeploys the site.
2. Next time your phone opens the app (or Chrome does its periodic background check), it fetches the updated `sw.js`, installs it, and swaps in the new files.

**To force an immediate update** after pushing a change, fully close the app and reopen it (or pull to refresh) — twice if the change doesn't appear the first time, since the first load activates the new service worker and the second load serves the new content.

If you make a change and it doesn't show up after reopening twice, bump the cache name in `sw.js` (e.g. `taeglich-v1` → `taeglich-v2`) in the same commit — this forces the service worker to treat it as a new version and refresh the cache immediately.

## Sound

Every cue the app plays is defined in one place: the `CUES` table in the
`sound effects` section of `index.html`, played through the single `useSound`
hook that all five practice modes share. To retune a sound, change its entry in
`CUES` — don't schedule oscillators at the call site, or modes will drift apart.

Cues are mixed for a phone speaker rather than headphones: everything sits above
~590Hz (a small speaker can barely move air below that), layers are summed hot
and driven into a soft-clip curve to raise average level, and a rumble filter
plus a waveshaper output ceiling keep the result bounded to 0.98 with no
clipping. The comments in that section record what was measured and why.

## Local development

Just open `index.html` in a browser, or serve the folder locally (`python3 -m http.server`) since service workers require `http(s)://`, not `file://`.
