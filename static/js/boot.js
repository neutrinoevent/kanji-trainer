/* Kanji Trainer — theme toggle and startup — must load last.
   Plain script, no bundler and no module system: index.html loads these in
   dependency order. See static/js/README.md for the layout. */
"use strict";

// ================================================================ boot

$("#theme-toggle").onclick = () => {
  const cur = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = cur;
  try { localStorage.setItem("kt-theme", cur); } catch (e) {}
  api("/api/settings", { theme: cur }).catch(() => {});
};

(async function boot() {
  const res = await fetch("/data/kanji.json");
  S.kanji = await res.json();
  S.byChar = Object.fromEntries(S.kanji.map((r) => [r.k, r]));
  S.fonts = detectFonts();
  // Curated read-aloud readings; the heuristic in spokenReading() covers the
  // rest. spoken.local.json is the user's own overlay: optional, wins over the
  // shipped file, and survives updates (update.py preserves it).
  const loadSpoken = async (p) => {
    try {
      const r = await fetch(p);
      return r.ok ? ((await r.json()).overrides || {}) : {};
    } catch (e) { return {}; }
  };
  S.spoken = { ...(await loadSpoken("/data/spoken.json")),
               ...(await loadSpoken("/data/spoken.local.json")) };
  // curated sense groupings; the server has already merged any local overrides
  try {
    S.senseGroups = (await (await fetch("/data/senses.json")).json()).senses || {};
  } catch (e) { S.senseGroups = {}; }
  await loadState();
  await loadCollections();
  if (!localStorage.getItem("kt-theme") && S.settings.theme) {
    document.documentElement.dataset.theme = S.settings.theme;
  }
  window.addEventListener("hashchange", navigate);
  navigate();
})();
