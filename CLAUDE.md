# Täglich — working on this repo

A German spaced-repetition PWA. Read this before changing anything; the
architecture has a few hard constraints that are easy to break by accident.

## Run it

```bash
python3 -m http.server 8000    # then open http://localhost:8000
node tools/validate-vocab.mjs  # word list is well-formed
node tools/check-html.mjs      # every inline script still parses
```

Run both checks before pushing. CI runs them on every branch and blocks the
deploy if either fails.

## Layout

| File | What it is |
| --- | --- |
| `index.html` | The entire app — styles, React (vendored), and all logic |
| `vocab.json` | The word list. **Add words here, never in `index.html`** |
| `sw.js` | Service worker: offline support and update delivery |
| `tools/` | Validators run locally and in CI |
| `.github/workflows/` | `check.yml` on every branch, `deploy.yml` on `main` |

## Adding words — the common task

Append to `items` in `vocab.json`, then run `node tools/validate-vocab.mjs`.
Nothing else. No code change is needed, and the UI adapts on its own:

- A new CEFR level (say the first `B2` word) makes a `B2` filter tab and a `B2`
  row in the home-screen progress tracker appear automatically. `USED_LEVELS`
  is derived from the data, not hardcoded.
- A new `tp` (topic) becomes a filter chip automatically.
- Cards are generated from `t` — see the table below.

### Item schema

```jsonc
{
  "id": "n42",                    // unique, stable — progress is saved against it
  "t": "n",                       // n noun | v verb | a adjective | k connector
                                  // p phrase | g grammar drill
  "art": "die",                   // nouns only: der | die | das
  "de": "Wohnung",                // bare German word — NO article here
  "en": "flat, apartment",        // English gloss
  "lv": "A1",                     // A1 A2 B1 B2 C1 C2
  "tp": "Umzug",                  // topic; free text, becomes a filter chip
  "s": [                          // optional (required for t:"g")
    "Wir suchen eine Wohnung.",   // German sentence
    "We're looking for a flat.",  // English translation
    "Wohnung"                     // the word to blank out — must appear in s[0]
  ]
}
```

`id` is the one field you must never reuse or change: saved progress, the SRS
schedule, and the mastery tracker are all keyed on it. Changing an existing
`id` silently resets that word's history for every user.

### Which cards each type produces

| `t` | Cards generated |
| --- | --- |
| `n` | produce, gender (der/die/das), cloze |
| `p` | produce, listen |
| `g` | cloze only — the drill *is* the sentence, so `s` is required |
| others | produce, plus cloze when `s` is present |

Grammar drills (`t: "g"`) may put `___` directly in `s[0]`; for everything else
the app blanks `s[2]` out of the sentence itself.

## Hard constraints

**The app is one HTML file.** No build step, no bundler, no npm dependencies at
runtime. React is vendored inline. Anything you add must work when the file is
served as static content. Don't introduce JSX — the code is written as
`React.createElement` calls (aliased to `e` in newer components) because nothing
transpiles it.

**Data loads before the first render.** `ITEMS`, `CARDS`, `ITEM_BY_ID`,
`LEARN_ITEMS`, `LEARN_TOPICS` and `USED_LEVELS` are `let` bindings filled by
`initVocab()` after `vocab.json` arrives, then the app renders. Read them inside
components or functions, never at module scope — at module scope they are still
empty. If you need a new derived collection, build it inside `initVocab()`.

**Caching decides whether users ever see your work.** `sw.js` serves
`index.html` and `vocab.json` **network-first** so releases and new words
actually reach installed copies; icons and the manifest are cache-first. If you
add a file that changes between releases, it must go on the network-first path
or users will be pinned to a stale copy. Bump `CACHE` when you change `sw.js`.

**Progress is user data.** It lives in `localStorage` under `taeglich:v1`.
Adding a field to `DEFAULT_SAVE` is safe — saves are merged over the defaults on
load, so old saves gain new fields. Renaming or removing one is not: it destroys
history that only exists on that person's device. Treat missing fields as
expected and fall back gracefully (see `dayStatsFor`, which handles days
recorded before per-day stats existed).

## Adding a feature

1. Components live in `index.html`, roughly grouped by screen with
   `/* ---------- name ---------- */` banners. Match the surrounding style:
   `React.createElement`, the `C` colour tokens, `MONO`/`SERIF` fonts, and the
   bilingual `Deutsch · english` label convention.
2. Colours come from `C` (`C.signal`, `C.paper`, `C.muted`, `C.ok`, `C.warn`,
   `C.bad`, …) which map to CSS variables. Never hardcode a hex — it breaks the
   dark theme and the four accent options.
3. Screens are registered in `App`'s `screen` state and reached with `nav(name)`;
   `navBack()` uses browser history so Android's back button works.
4. New persisted state goes in `DEFAULT_SAVE` and is written through `commit()`,
   which saves and mirrors to the notification worker.

## Testing

There is no test runner. Verify changes by driving the real app — Playwright and
Chromium are available:

```js
const { chromium } = require('playwright');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
```

Seed `localStorage` with `page.addInitScript` to reach a specific state (a
part-finished day, a mastered level, a long streak) instead of clicking there.
Always assert on `pageerror` — a silent exception leaves a blank screen.
