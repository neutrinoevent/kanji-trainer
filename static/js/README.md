# Frontend layout

One file became eight. There is still no bundler, no module system and no build
step — these are plain `<script>` tags sharing a single scope, loaded in the
order listed in `index.html`. That order is load-bearing: `core.js` defines what
everything else uses, and `boot.js` starts the app, so it must run last.

| File | What's in it |
|---|---|
| `core.js` | shared state (`S`), small helpers, the fluency ladder, typeface detection, romaji→kana, distractors and question building |
| `shell.js` | the hash router, page frame, modal, tooltips, first-run tour |
| `lists.js` | user-made lists and the add-to-list popover |
| `session.js` | review scopes, and the review / drill session |
| `games.js` | the eight games |
| `progress.js` | badges, XP and ranks, the learning path |
| `pages.js` | dashboard, batches, goals, lists page, exams, stats, settings |
| `boot.js` | theme toggle and startup |

## Adding to it

Put new code in the file whose description already covers it rather than making
a ninth file for every feature. If something genuinely doesn't fit, add a file
*before* `boot.js` and add its tag to `index.html`.

Two rules that keep this working without tooling:

- **Anything used at another file's top level must be defined earlier.** Function
  declarations hoist within a file but not across them. Most code here is
  functions called after boot, so this rarely bites — but `const tip = $("#tooltip")`
  in `shell.js` runs at load and needs `$` from `core.js`, which is why the order
  is what it is.
- **`routes` is declared in `shell.js` and assigned from several files.** Any file
  adding a route must load after `shell.js`.
