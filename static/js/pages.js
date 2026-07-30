/* Kanji Trainer — every page: dashboard, batches, goals, lists, exams, stats, settings.
   Plain script, no bundler and no module system: index.html loads these in
   dependency order. See static/js/README.md for the layout. */
"use strict";

// ================================================================ dashboard

routes.dashboard = async () => {
  await loadState();
  const stats = await api("/api/stats");
  const totalQueue = S.dueCount + S.newCount;
  const acc = stats.total_reviews ? Math.round((stats.total_correct / stats.total_reviews) * 100) : 0;

  const days14 = lastNDays(14).map((d) => ({ d, ...(stats.days[d] || { n: 0, correct: 0 }) }));
  const maxN = Math.max(1, ...days14.map((x) => x.n));

  const today = stats.today || { n: 0, correct: 0, modes: [] };
  const extraModes = [...GAME_MODE_IDS, "path-quiz", "path-boss"];
  const didExtra = today.modes.some((m) => extraModes.includes(m));
  const goal = (label, cur, target, done) => `
    <div class="goal-row ${done ? "done" : ""}">
      <span class="goal-check">${done ? "✓" : "○"}</span>
      <span class="goal-label">${label}</span>
      <div class="meter goal-meter"><i style="width:${Math.min(100, Math.round((cur / target) * 100))}%"></i></div>
      <span class="goal-val">${Math.min(cur, target)}/${target}</span>
    </div>`;

  setMain(`
    <h1>Dashboard</h1>
    <p class="sub">${stats.in_rotation ? `${stats.in_rotation} kanji in rotation.` : "No kanji in rotation yet. Start a batch to begin."}</p>
    ${levelCard(stats)}
    <div class="tiles">
      <div class="tile"><div class="t-label">Queue now</div><div class="t-value">${totalQueue}</div><div class="t-sub">${S.dueCount} due · ${S.newCount} new</div></div>
      <div class="tile"><div class="t-label">Streak</div><div class="t-value">${stats.streak}</div><div class="t-sub">day${stats.streak === 1 ? "" : "s"} in a row</div></div>
      <div class="tile"><div class="t-label">Learned</div><div class="t-value">${stats.learned}</div><div class="t-sub">${stats.mature} solid · meaning + reading</div></div>
      <div class="tile"><div class="t-label">Jōyō coverage</div><div class="t-value">${Math.round((stats.joyo_learned / stats.joyo_total) * 100)}%</div><div class="t-sub">${stats.joyo_learned} of ${stats.joyo_total}</div></div>
      <div class="tile"><div class="t-label">Accuracy</div><div class="t-value">${acc}%</div><div class="t-sub">${stats.total_reviews} answers all-time</div></div>
    </div>
    <div class="row" style="margin:22px 0">
      <button class="primary-btn" id="go-review" ${totalQueue ? "" : "disabled"}>⚡ Review ${totalQueue ? `(${totalQueue})` : ""}</button>
      <button class="ghost-btn" id="go-study">Browse batches</button>
      <button class="ghost-btn" id="go-games">Play a game</button>
    </div>
    ${recoveryCard()}
    ${fluencyNotice(stats)}
    ${leechCard(stats)}
    ${goalSpotlight(stats)}
    <div class="card chart-card">
      <div class="chart-title">Today's goals</div>
      <div class="chart-sub">Reset at midnight. No pressure, just momentum.</div>
      ${goal("Answer 20 questions", today.n, 20, today.n >= 20)}
      ${goal("Get 15 right", today.correct, 15, today.correct >= 15)}
      ${goal("Play a game or path step", didExtra ? 1 : 0, 1, didExtra)}
    </div>
    <div class="card chart-card">
      <div class="chart-title">Answers per day</div>
      <div class="chart-sub">Last 14 days</div>
      <div class="bars">${days14.map((x) => `<div class="bar ${x.n ? "" : "empty"}" style="height:${Math.max(2, (x.n / maxN) * 100)}%" data-tip="<b>${x.d.slice(5)}</b><br>${x.n} answers · ${x.n ? Math.round((x.correct / x.n) * 100) : 0}% correct"></div>`).join("")}</div>
      <div class="bar-x">${days14.map((x, i) => `<span>${i % 2 ? "" : x.d.slice(8)}</span>`).join("")}</div>
    </div>
    ${nextBatchHint(stats)}
  `);
  $("#go-review").onclick = () => (location.hash = "#/review");
  $("#go-study").onclick = () => (location.hash = "#/study");
  $("#go-games").onclick = () => (location.hash = "#/games");
  bindLeechItems($("#main"));
  const notice = $("#notice-ok");
  if (notice) notice.onclick = async () => {
    S.settings.fluency_notice_seen = true;
    await api("/api/settings", { fluency_notice_seen: true }).catch(() => {});
    routes.dashboard();
  };
  const rec = $("#rec-restore");
  if (rec) rec.onclick = async () => {
    rec.disabled = true;
    rec.textContent = "Restoring…";
    try {
      if (S.recovery.source === "legacy") await api("/api/adopt-legacy", {});
      else await api("/api/restore", { name: S.recovery.name, source: S.recovery.source });
      location.reload();
    } catch (e) { toast("Restore failed: " + e.message); rec.disabled = false; }
  };
  const dis = $("#rec-dismiss");
  if (dis) dis.onclick = () => { S.recovery = null; routes.dashboard(); };
  const replay = $("#replay-tour");
  if (replay) replay.onclick = () => startTour();
  bindTips($("#main"));

  const firstVisit = stats.total_reviews === 0 && stats.in_rotation === 0
    && !S.settings.tour_done && !localStorage.getItem("kt-tour-done");
  if (firstVisit || S.forceTour) {
    S.forceTour = false;
    startTour();
  }
};

const FACET_NAME = { meaning: "meaning", reading: "reading", sense2: "2nd meaning", sense3: "3rd meaning" };

/**
 * Cards that are fighting the learner.
 *
 * These were previously invisible: a card you keep failing simply returned
 * forever, and because it can never reach operative it also quietly held down
 * batch mastery, goals and coverage with no explanation. Naming them and
 * offering a way out is the whole point — the alternative is a learner who
 * concludes the numbers are broken.
 */
function leechCard(st) {
  const l = st.leeches || [];
  if (!l.length) return "";
  const shown = l.slice(0, 8);
  return `
    <div class="card leech-card">
      <div class="chart-title">${st.leech_total} card${st.leech_total === 1 ? " is" : "s are"} fighting you</div>
      <div class="chart-sub">Missed often enough that repetition alone probably isn't going to
        fix them. They also can't count toward your totals until they come good, which is part of
        why a batch can feel stuck. Pick one and do something different with it.</div>
      <div class="leech-list">
        ${shown.map((x) => `
          <button class="leech-item" data-k="${x.k}" data-facet="${x.facet}">
            <span class="li-k jp">${x.k}</span>
            <span class="li-body">
              <span class="li-facet">${FACET_NAME[x.facet] || x.facet}</span>
              <span class="li-stat">${x.lapses} lapse${x.lapses === 1 ? "" : "s"}${
                x.attempts ? ` · ${Math.round(x.accuracy * 100)}% of ${x.attempts}` : ""}</span>
            </span>
          </button>`).join("")}
      </div>
      ${st.leech_total > shown.length
        ? `<div class="chart-sub" style="margin-top:8px">…and ${st.leech_total - shown.length} more on
           <a href="#/stats">Stats</a>.</div>` : ""}
      ${st.parked ? `<div class="chart-sub" style="margin-top:8px">${st.parked} kanji parked —
        they're left out of your queue and your mastery figures until you bring them back.</div>` : ""}
    </div>`;
}

/**
 * Shown once, to someone whose counts just dropped because the definition of
 * "learned" changed under them.
 *
 * Nothing was lost, but a number going from 47 to 12 overnight looks exactly
 * like loss, and telling someone "trust us, it's fine" is worth less than
 * showing them both figures and the reason. Only appears when their own numbers
 * actually moved — a learner who started after the change never sees it.
 */
function fluencyNotice(st) {
  if (S.settings.fluency_notice_seen) return "";
  if (!st.total_reviews) return "";
  const before = st.legacy_learned || 0;
  const after = st.rungs ? st.rungs.both : 0;
  if (before <= after) return "";        // nothing moved for this learner
  return `
    <div class="card notice-card">
      <div class="chart-title">Your numbers changed — your work didn't</div>
      <p class="sub" style="margin:6px 0 10px">This version measures what you've
        <b>demonstrated</b> rather than what the scheduler happened to have moved along.
        On your history that reads:</p>
      <div class="notice-compare">
        <div class="nc-cell"><span class="nc-label">Learned, old rule</span>
          <span class="nc-val old">${before}</span>
          <span class="nc-note">a card the scheduler had graduated</span></div>
        <div class="nc-arrow">→</div>
        <div class="nc-cell"><span class="nc-label">Learned, now</span>
          <span class="nc-val">${after}</span>
          <span class="nc-note">produced from memory, more than one question type, more than one day</span></div>
      </div>
      <p class="sub" style="margin:12px 0 0">Every answer you have ever given is still
        here — all ${st.total_reviews.toLocaleString()} of them — and all of it counts
        toward the new measure. The bar moved, not your history. The ${before - after}
        kanji in the gap aren't lost; they need showing again on another day, and typing
        rather than picking from four. Any kanji's card will tell you exactly what it's
        still waiting for.</p>
      <div class="row" style="margin-top:14px">
        <button class="primary-btn" id="notice-ok">Got it</button>
        <button class="ghost-btn" onclick="location.hash='#/stats'">See where I stand</button>
      </div>
    </div>`;
}

/**
 * Offered when the store is empty but a backup holds real work — after a folder
 * was deleted, a fresh clone, or a bad restore. Deliberately an offer: someone
 * who has just reset their progress on purpose must not have it resurrected
 * behind their back.
 */
function bindLeechItems(root) {
  (root || document).querySelectorAll(".leech-item").forEach((b) => {
    b.onclick = () => kanjiModal(b.dataset.k, b.dataset.facet);
  });
}

function recoveryCard() {
  const r = S.recovery;
  if (!r) return "";
  const legacy = r.source === "legacy";
  const held = `<b>${r.reviews}</b> answers across <b>${r.srs}</b> cards${
    r.exams ? ` and ${r.exams} exam record${r.exams === 1 ? "" : "s"}` : ""}`;
  const when = r.ts ? ` from <b>${esc(r.ts.replace("T", " ").replace("Z", " UTC"))}</b>` : "";
  return `
    <div class="card recovery-card">
      <div class="chart-title">${legacy
        ? "An older database of yours holds more than what's loaded"
        : "There's a backup we can put back"}</div>
      <p class="sub" style="margin:6px 0 12px">${legacy
        ? `A database from a version before this one is still sitting at
           <code>data/trainer.db</code>, holding ${held}. It wasn't moved automatically
           because this install already had its own${r.current_reviews
             ? ` (with ${r.current_reviews} answers in it)` : ""}.`
        : `This copy of the app has no progress in it, but a backup${when} holds ${held}.
           ${r.source === "mirror"
             ? "It was found outside the app folder, where updates and re-installs can't reach it."
             : "It was found in this install's own backups."}`}</p>
      <div class="row">
        <button class="primary-btn" id="rec-restore">${legacy ? "Use the older one" : "Restore it"}</button>
        <button class="ghost-btn" id="rec-dismiss">Not now</button>
      </div>
      <p class="settings-note" style="margin-bottom:0">${legacy
        ? "Nothing is deleted either way. Switching keeps the current database alongside it as <code>.replaced</code>, and takes a backup first."
        : "Restoring takes a backup of the current state first, so it can be undone."}</p>
    </div>`;
}

/** The fluency ladder in one line, plus the goal with the nearest deadline. */
function goalSpotlight(stats) {
  const r = stats.rungs || {};
  const sn = stats.senses || {};
  const ladder = r.seen ? `
    <div class="card chart-card">
      <div class="chart-title">Fluency ladder</div>
      <div class="chart-sub">Of ${r.seen} kanji in rotation, counted at the operative bar:
        produced from memory, in more than one kind of
        question, on more than one day.</div>
      <div class="hbars">
        ${rungBar("Meaning", r.meaning || 0, r.seen, "Most common meaning, operative")}
        ${rungBar("Read aloud", r.reading || 0, r.seen, "Standalone reading, operative")}
        ${rungBar("Both", r.both || 0, r.seen, "Meaning and reading both operative")}
      </div>
      ${sn.unlocked ? `<div class="chart-sub" style="margin-top:8px">Depth:
        ${sn.unlocked} extra meaning${sn.unlocked === 1 ? "" : "s"} unlocked,
        ${sn.operative} operative.</div>`
      : sn.eligible ? `<div class="chart-sub" style="margin-top:8px">${sn.eligible} kanji are
        solid enough to start earning a second meaning.</div>` : ""}
    </div>` : "";

  const goals = (S.settings.goals || []).filter((g) => S.colById && S.colById[g.collection]);
  if (!goals.length) {
    return ladder + `<div class="card">
      <b>No goal set.</b> Pick a set of kanji and a date that matters to you, and the
      dashboard will tell you whether you're on pace.
      <div class="row" style="margin-top:10px">
        <button class="ghost-btn" onclick="location.hash='#/goals'">Set a goal</button>
      </div></div>`;
  }
  const dated = goals.filter((g) => g.date).sort((a, b) => a.date.localeCompare(b.date));
  return ladder + goalCard(dated[0] || goals[0], true);
}

function nextBatchHint(stats) {
  // primary track = the collection with the most kanji in rotation
  let best = null;
  for (const [cid, batches] of Object.entries(stats.collections || {})) {
    const started = batches.reduce((a, b) => a + b.started, 0);
    if (started > 0 && (!best || started > best.started)) best = { cid, batches, started };
  }
  if (!best) {
    return `
    <div class="start-card">
      <div class="start-kanji">始</div>
      <div class="start-body">
        <h2 style="margin:0 0 6px">Start your first batch</h2>
        <p style="margin:0 0 16px;color:var(--ink-2)">Follow the guided path five kanji at a time, or start a batch of ${S.settings.batch_size} from any track. A few minutes of review a day is the whole routine.</p>
        <div class="row">
          <button class="primary-btn" onclick="location.hash='#/path'">Follow the path</button>
          <button class="ghost-btn" onclick="location.hash='#/study'">Choose a batch</button>
          <button class="ghost-btn" id="replay-tour">Replay the walkthrough</button>
        </div>
      </div>
    </div>`;
  }
  const name = S.colById?.[best.cid]?.name || best.cid;
  const active = best.batches.filter((b) => b.started > 0);
  const current = active.find((b) => b.mastery < 0.6) || active[active.length - 1];
  const next = best.batches.find((b) => b.started < b.size);
  if (next && current.mastery >= 0.6) {
    return `<div class="card"><b>${name}</b> Batch ${current.index + 1} is at ${Math.round(current.mastery * 100)}% mastery. You're ready to <a href="#/study">start Batch ${next.index + 1}</a>.</div>`;
  }
  return `<div class="card">Current: <b>${name}</b> Batch ${current.index + 1} at ${Math.round(current.mastery * 100)}% mastery. Reach ~60% before starting the next one.</div>`;
}

function lastNDays(n) {
  const out = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d); x.setDate(d.getDate() - i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`);
  }
  return out;
}

// ================================================================ batches

routes.study = async (arg) => {
  await loadState();
  await loadCollections();
  const parts = (arg || "").split("/").filter(Boolean);
  if (parts.length >= 2) return batchDetail(parts[0], parseInt(parts[1], 10));
  const group = parts[0] && GROUPS.includes(decodeURIComponent(parts[0]))
    ? decodeURIComponent(parts[0])
    : S.studyGroup || "Frequency";
  S.studyGroup = group;
  const stats = await api("/api/stats");

  const tabs = GROUPS.map((g) =>
    `<button class="ghost-btn tab ${g === group ? "tab-active" : ""}" data-g="${g}">${g}</button>`).join("");

  const cols = S.collections.filter((c) => c.group === group);
  const sections = cols.map((c) => {
    const chars = colChars(c.id);
    const batches = stats.collections[c.id] || [];
    const inRotation = batches.reduce((a, b) => a + b.started, 0);
    const cards = batches.map((b, i) => {
      const chunk = colSlice(c.id, i);
      const started = b.started > 0;
      const full = b.started === b.size;
      const prev = i === 0 ? null : batches[i - 1];
      const suggested = !full && (i === 0 || (prev && prev.mastery >= 0.6));
      const pill = full ? Math.round(b.mastery * 100) + "%"
        : started ? `${b.started}/${b.size} in`
        : suggested ? "ready" : "later";
      return `
        <div class="batch-card ${started || suggested ? "" : "locked"}" data-col="${c.id}" data-batch="${i}">
          <div class="batch-title">Batch ${i + 1}
            <span class="pill ${started ? "started" : ""}">${pill}</span>
          </div>
          <div class="batch-range">#${i * S.settings.batch_size + 1}–${i * S.settings.batch_size + chunk.length} of ${c.name}</div>
          <div class="batch-kanji-preview">${chunk.slice(0, 12).map((r) => r.k).join(" ")}</div>
          <div class="meter"><i style="width:${Math.round(b.mastery * 100)}%"></i></div>
        </div>`;
    }).join("");
    return `
      <h2>${c.name} <span class="pill" style="vertical-align:middle">${chars.length} kanji${inRotation ? ` · ${inRotation} in rotation` : ""}</span></h2>
      <p class="sub" style="margin-bottom:12px">${esc(c.desc)}.</p>
      ${inRotation ? `<div class="row" style="margin-bottom:12px">
        <button class="ghost-btn sm" onclick="location.hash='${scopeHash({ cid: c.id, from: null, to: null })}'">⚡ Review ${esc(c.name)} only</button>
        <button class="ghost-btn sm" onclick="location.hash='${scopeHash({ cid: c.id, from: null, to: null }, "drill")}'">🎯 Drill</button>
      </div>` : ""}
      <div class="batch-grid">${cards}</div>`;
  }).join("");

  setMain(`
    <h1>Batches</h1>
    <p class="sub">A kanji that appears in more than one set shares a single pair of review cards. "5/25 in" means 5 kanji from that batch are already in your rotation through other batches.</p>
    <div class="row" style="margin-bottom:6px">${tabs}</div>
    ${sections}
  `);
  document.querySelectorAll(".tab").forEach((el) => {
    el.onclick = () => { S.studyGroup = el.dataset.g; location.hash = "#/study/" + encodeURIComponent(el.dataset.g); };
  });
  document.querySelectorAll(".batch-card").forEach((el) => {
    el.onclick = () => (location.hash = `#/study/${el.dataset.col}/${el.dataset.batch}`);
  });
};

async function batchDetail(cid, i) {
  const col = S.colById[cid];
  if (!col) { location.hash = "#/study"; return; }
  const chunk = colSlice(cid, i);
  const notStarted = chunk.filter((r) => !kanjiStarted(r.k)).length;
  const overlap = chunk.length - notStarted;
  setMain(`
    <h1>${col.name} · Batch ${i + 1} <span class="pill" style="vertical-align:middle">#${i * S.settings.batch_size + 1}–${i * S.settings.batch_size + chunk.length}</span></h1>
    <p class="sub">Click any kanji for details.
      ${overlap && notStarted ? `${overlap} of these are already in your rotation from other batches. Starting adds only the ${notStarted} new one${notStarted === 1 ? "" : "s"}.`
        : notStarted === 0 ? "Every kanji here is already in your review rotation." : ""}</p>
    <div class="row" style="margin-bottom:18px">
      ${notStarted ? `<button class="primary-btn" id="start-batch">Add ${notStarted} kanji to rotation</button>` : ""}
      ${overlap ? `<button class="${notStarted ? "ghost-btn" : "primary-btn"}"
          onclick="location.hash='${scopeHash({ cid, from: i, to: i })}'">⚡ Review this batch</button>
        <button class="ghost-btn"
          onclick="location.hash='${scopeHash({ cid, from: i, to: i }, "drill")}'">🎯 Drill this batch</button>
        <button class="ghost-btn"
          onclick="location.hash='#/exam/${scopeSuffix({ cid, from: i, to: i })}'">📋 Mastery exam</button>` : ""}
      <button class="ghost-btn" id="back-btn">← ${col.group}</button>
    </div>
    <div class="kanji-grid">
      ${chunk.map((r) => {
        const m = srsOf(r.k, "meaning"), rd = srsOf(r.k, "reading");
        const cls = (s) => (s ? (s.state === "new" ? "" : s.state) : "");
        return `<div class="kanji-cell" data-k="${r.k}">${r.k}<span class="st ${cls(m)}" title="meaning"></span><span class="st ${cls(rd)}" title="reading"></span><button class="lm-x lm-add" data-list-add="${r.k}" title="Add to a list">＋</button></div>`;
      }).join("")}
    </div>
  `);
  $("#back-btn").onclick = () => { location.hash = "#/study/" + encodeURIComponent(col.group); };
  const btn = $("#start-batch");
  if (btn) btn.onclick = async () => {
    const res = await api("/api/batch/start", { collection: cid, index: i });
    await loadState();
    batchDetail(cid, i);
    if (res.already) {
      $(".sub").innerHTML = `Added ${res.added} new kanji. The other ${res.already} were already in rotation.`;
    }
  };
  document.querySelectorAll(".kanji-cell").forEach((el) => {
    el.onclick = (e) => { if (!e.target.dataset.listAdd) kanjiModal(el.dataset.k); };
  });
  bindListButtons($("#main"));
}

function kanjiModal(k, focusFacet) {
  const r = S.byChar[k];
  const srsLine = (facet) => {
    const s = srsOf(k, facet);
    if (!s || s.state === "new") return `<span class="tier t0">not started</span>`;
    const due = s.due ? new Date(s.due) : null;
    const when = due ? (due <= new Date() ? "due now" : "due " + due.toLocaleDateString()) : "";
    const t = tierOf(k, facet);
    return `<span class="tier t${t}">${TIER_LABEL[t]}</span>
      <span class="tier-meta">${s.reps} reps · ${s.lapses} lapses · ${when}</span>`;
  };
  const taught = sensesTaught(k);
  const locked = senses(r).length - taught;
  openModal(`
    <button class="modal-close" onclick="document.getElementById('modal-root').innerHTML=''">✕</button>
    <div class="big-kanji">${r.k}</div>
    <dl class="kv">
      <dt>Read aloud</dt><dd>${readingLine(r)}</dd>
      <dt>Meanings</dt><dd>${senseLadder(r, taught)}
        ${locked > 0 ? `<div class="chart-sub">${locked} not yet unlocked — they arrive
          once the meaning card above is operative.</div>` : ""}</dd>
      <dt>On readings</dt><dd class="jp">${r.on.join("、") || "—"}</dd>
      <dt>Kun readings</dt><dd class="jp">${r.kun.join("、") || "—"}</dd>
      <dt>Sets</dt><dd>${setBadges(r).map((b) => `<span class="pill">${b}</span>`).join(" ") || "—"}</dd>
      <dt>Strokes</dt><dd>${r.strokes ?? "—"}</dd>
      <dt>Meaning card</dt><dd>${srsLine("meaning")}<div id="gap-meaning"></div></dd>
      <dt>Reading card</dt><dd>${srsLine("reading")}<div id="gap-reading"></div></dd>
      ${srsOf(k, "sense2") ? `<dt>Meaning 2 card</dt><dd>${srsLine("sense2")}</dd>` : ""}
      ${srsOf(k, "sense3") ? `<dt>Meaning 3 card</dt><dd>${srsLine("sense3")}</dd>` : ""}
    </dl>
    <div class="card-actions">
      ${CORE_FACETS.map((f) => {
        const row = srsOf(k, f);
        if (!row) return "";
        const parked = row.state === "parked";
        return `<div class="ca-row ${focusFacet === f ? "focus" : ""}">
          <span class="ca-label">${FACET_NAME[f]} card${parked ? " · parked" : ""}</span>
          ${parked
            ? `<button class="ghost-btn sm" data-act="unpark" data-f="${f}">Bring it back</button>`
            : `<button class="ghost-btn sm" data-act="relearn" data-f="${f}">Start it over</button>
               <button class="ghost-btn sm" data-act="park" data-f="${f}">Park it</button>`}
        </div>`;
      }).join("")}
    </div>
    <div class="note-box">
      <label class="ca-label" for="kanji-note">Your note${
        " "}<span class="chart-sub">— a mnemonic, a story, anything that makes it stick</span></label>
      <textarea id="kanji-note" rows="2" maxlength="400"
        placeholder="e.g. 待 is 彳 (going) + 寺 (temple) — waiting on the way to the temple">${
        esc((S.settings.notes || {})[k] || "")}</textarea>
      <div class="row"><button class="ghost-btn sm" id="note-save">Save note</button></div>
    </div>
    <div class="row" style="margin:4px 0 12px">${listBtn(r.k)}${
      listsContaining(k).map((l) => `<span class="pill">in ${esc(l.name)}</span>`).join("")}</div>
    <a href="https://jisho.org/search/${encodeURIComponent(r.k)}%20%23kanji" target="_blank" rel="noopener" style="color:var(--accent)">Look up on jisho.org ↗</a>
  `);
  bindListButtons($("#modal-root"));
  document.querySelectorAll("#modal-root [data-act]").forEach((b) => {
    b.onclick = async () => {
      const act = b.dataset.act;
      if (act === "relearn" && !confirm(
        `Start the ${FACET_NAME[b.dataset.f]} card for ${k} over?\n\n`
        + "It goes back to being introduced from scratch. Your review history is kept.")) return;
      await api("/api/card-action", { k, facet: b.dataset.f, action: act }).catch(() => {});
      await loadState();
      toast(act === "park" ? `${k} parked` : act === "unpark" ? `${k} back in rotation`
                                                             : `${k} will be re-introduced`);
      kanjiModal(k, focusFacet);
    };
  });
  const noteEl = $("#kanji-note");
  if (noteEl) $("#note-save").onclick = async () => {
    const notes = { ...(S.settings.notes || {}) };
    const v = noteEl.value.trim();
    if (v) notes[k] = v; else delete notes[k];
    S.settings.notes = notes;
    await api("/api/settings", { notes }).catch(() => {});
    toast(v ? "Note saved" : "Note cleared");
  };
  // Spell out what is still missing before a card counts as operative, so the
  // bar is legible instead of mysterious.
  for (const facet of ["meaning", "reading"]) {
    if (!srsOf(k, facet)) continue;
    api(`/api/card?k=${encodeURIComponent(k)}&facet=${facet}`).then((d) => {
      const el = $("#gap-" + facet);
      if (!el) return;
      const e = d.evidence;
      const seen = `<div class="chart-sub">${e.hits}/${e.attempts} on target ·
        ${e.modes.length} question type${e.modes.length === 1 ? "" : "s"} ·
        typed ${e.produced}× · ${e.days} day${e.days === 1 ? "" : "s"}</div>`;
      el.innerHTML = seen + (d.gaps.length
        ? `<ul class="gap-list">${d.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>`
        : `<div class="chart-sub" style="color:var(--good)">Operative — nothing outstanding.</div>`);
    }).catch(() => {});
  }
}

// ================================================================ goals
//
// A goal names a set of kanji, a bar to clear on each rung of the fluency
// ladder, and a date the user picked for reasons outside this app. The app's
// job is to report honestly whether that date is reachable at the current
// settings - not to quietly reschedule the SRS to make the number look good.

const BAR_LABEL = { operative: "Operative", solid: "Solid" };
const BAR_DESC = {
  operative: "produced from memory, in 2+ question types, on 2+ days",
  solid: "every question type, produced repeatedly, across 4+ days",
};

/** A goal expressed as a review scope, so it can be reviewed or drilled directly. */
function goalScope(goal) {
  return goal.batches
    ? { cid: goal.collection, from: 0, to: goal.batches - 1 }
    : { cid: goal.collection, from: null, to: null };
}

function goalChars(goal) {
  const col = S.colById[goal.collection];
  if (!col) return [];
  const all = Array.from(col.chars);
  return goal.batches ? all.slice(0, goal.batches * S.settings.batch_size) : all;
}

function goalStatus(goal) {
  const chars = goalChars(goal);
  const bar = goal.bar === "solid" ? 3 : 2;
  let started = 0, meaning = 0, reading = 0, both = 0, senses = 0;
  for (const k of chars) {
    const m = tierOf(k, "meaning"), rd = tierOf(k, "reading");
    // "started" = in the rotation at all. A freshly added card is tier 0 but the
    // kanji is very much started, and pacing depends on this being intake, not recall.
    if (srsOf(k, "meaning")) started++;
    if (m >= bar) meaning++;
    if (rd >= bar) reading++;
    if (m >= bar && rd >= bar) both++;
    if (tierOf(k, "sense2") >= bar) senses++;
  }
  const total = chars.length;
  const notStarted = total - started;
  const daysLeft = goal.date
    ? Math.ceil((new Date(goal.date + "T23:59:59") - Date.now()) / 86400000) : null;
  // A card can't be introduced today and be operative tomorrow: it needs about
  // two weeks of successful reviews to ripen. So the intake window is shorter
  // than the calendar window, and pace has to be computed against that.
  const intake = daysLeft === null ? null : Math.max(0, daysLeft - OPERATIVE_LEAD_DAYS);
  let needPerDay = null;
  if (intake !== null && notStarted > 0) needPerDay = intake > 0 ? Math.ceil(notStarted / intake) : Infinity;
  else if (intake !== null) needPerDay = 0;
  return { chars, total, started, notStarted, meaning, reading, both, senses,
           daysLeft, needPerDay, bar };
}

function goalName(goal) {
  const col = S.colById[goal.collection];
  const base = col ? col.name : goal.collection;
  if (!goal.batches) return base;
  return goal.batches === 1 ? `${base} · first batch`
                            : `${base} · first ${goal.batches} batches`;
}

function rungBar(label, n, total, tip) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return `<div class="hb-row" data-tip="${tip}">
      <span class="hb-label">${label}</span>
      <div class="hb-track"><div class="hb-fill" style="width:${pct}%"></div></div>
      <span class="hb-val">${n}/${total}</span>
    </div>`;
}

function goalCard(goal, compact) {
  const st = goalStatus(goal);
  const pct = st.total ? Math.round((st.both / st.total) * 100) : 0;
  let pace = "";
  if (st.daysLeft !== null) {
    if (st.daysLeft < 0) {
      pace = `<div class="pace late">Target date passed. ${st.both} of ${st.total} cleared —
        pick a new date when you're ready.</div>`;
    } else if (st.notStarted === 0) {
      pace = `<div class="pace ok">Every kanji is in rotation with ${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"} to go.
        From here it's review, not intake.</div>`;
    } else if (st.needPerDay === Infinity) {
      pace = `<div class="pace late">${st.notStarted} kanji still to start, and under
        ${OPERATIVE_LEAD_DAYS} days left — they can't ripen to <b>${BAR_LABEL[goal.bar]}</b> in time.
        Push the date out, or narrow the goal.</div>`;
    } else {
      const budget = S.settings.new_per_day;
      const ok = st.needPerDay <= budget;
      pace = `<div class="pace ${ok ? "ok" : "late"}">
        ${st.notStarted} kanji left to start, ${st.daysLeft} days out.
        Allowing ~${OPERATIVE_LEAD_DAYS} days for the last ones to ripen, that's
        <b>${st.needPerDay}/day</b> — ${ok
          ? `within your ${budget}/day setting.`
          : `above your ${budget}/day setting. Raise it in Settings, move the date, or trim the goal.`}</div>`;
    }
  }
  return `
    <div class="card goal-card">
      <div class="goal-head">
        <div>
          <div class="goal-title">${esc(goalName(goal))}</div>
          <div class="chart-sub">${st.total} kanji · bar: <b>${BAR_LABEL[goal.bar]}</b>
            (${BAR_DESC[goal.bar]})${goal.date ? ` · by ${goal.date}` : " · no date set"}</div>
        </div>
        <div class="goal-pct">${pct}%</div>
      </div>
      <div class="hbars">
        ${rungBar("Recognise", st.started, st.total, "Kanji you have started at all")}
        ${rungBar("Meaning", st.meaning, st.total, `Most common meaning, at the ${BAR_LABEL[goal.bar]} bar`)}
        ${rungBar("Read aloud", st.reading, st.total, "Standalone reading, at the same bar")}
        ${rungBar("All three", st.both, st.total, "Meaning and reading both cleared — the goal proper")}
      </div>
      ${st.senses ? `<div class="chart-sub" style="margin-top:8px">Bonus: ${st.senses} of these
        have a second meaning at the same bar.</div>` : ""}
      ${pace}
      ${compact ? `<div class="row" style="margin-top:12px">
          <button class="ghost-btn" onclick="location.hash='#/goals'">All goals</button>
        </div>`
        : `<div class="row" style="margin-top:12px">
          <button class="ghost-btn" onclick="location.hash='${scopeHash(goalScope(goal))}'">⚡ Review this set</button>
          <button class="ghost-btn" onclick="location.hash='${scopeHash(goalScope(goal), "drill")}'">🎯 Drill</button>
          <button class="ghost-btn" onclick="location.hash='#/exam/${scopeSuffix(goalScope(goal))}'">📋 Exam</button>
          <button class="ghost-btn" data-goal-study="${goal.id}">Study</button>
          <button class="ghost-btn danger" data-goal-del="${goal.id}">Remove</button>
        </div>`}
    </div>`;
}

async function saveGoals(goals) {
  S.settings.goals = goals;
  await api("/api/settings", { goals });
}

routes.goals = async () => {
  await loadState();
  await loadCollections();
  const goals = S.settings.goals || [];
  const maxBatches = (cid) => Math.ceil(
    Array.from(S.colById[cid].chars).length / S.settings.batch_size);

  const firstCol = "g1";
  const colOpts = S.collections.map((c) =>
    `<option value="${c.id}" ${c.id === firstCol ? "selected" : ""}>${esc(c.group)} — ${esc(c.name)}</option>`).join("");

  setMain(`
    <h1>Goals</h1>
    <p class="sub">Name a set of kanji and a date that matters to you. The app reports
      whether you're on pace — it won't shuffle the review schedule to flatter the number.</p>

    <div class="card ladder-card">
      <div class="chart-title">What "knowing" a kanji means here</div>
      <ol class="ladder">
        <li><b>Recognise it</b> — you've seen it and it's in your rotation.</li>
        <li><b>Its most common meaning</b> — specifically the most common one.</li>
        <li><b>Read it aloud</b> — what you'd say seeing it alone on a sign.</li>
        <li><b>Its further meanings</b> — these unlock by themselves once rung 2
          holds, and come back as review, not as new material.</li>
      </ol>
      <p class="chart-sub" style="margin:0">A goal tracks rungs 1–3. Rung 4 keeps
        going after the goal is met — it's depth, not a finish line.</p>
    </div>

    ${goals.length ? goals.map((g) => goalCard(g, false)).join("")
      : `<div class="card"><b>No goals yet.</b> A good first one: Grade 1, first two
         batches, by a date about two months out.</div>`}

    <h2>New goal</h2>
    <div class="card">
      <div class="form-grid">
        <label>Set</label><select id="goal-col">${colOpts}</select>
        <label>How much of it</label><select id="goal-batches"></select>
        <label>Target date</label><input type="date" id="goal-date">
        <label>Bar to clear</label>
        <select id="goal-bar">
          <option value="operative">Operative — you can produce it, more than one way</option>
          <option value="solid">Solid — every question type, over several days</option>
        </select>
      </div>
      <div class="row" style="margin-top:14px"><button class="primary-btn" id="goal-add">Add goal</button></div>
    </div>
  `);

  const batchSel = $("#goal-batches");
  const fillBatches = () => {
    const cid = $("#goal-col").value;
    const n = maxBatches(cid);
    const opts = [`<option value="0">All ${Array.from(S.colById[cid].chars).length} kanji</option>`];
    for (let i = 1; i <= Math.min(n, 20); i++) {
      opts.push(`<option value="${i}" ${i === 1 ? "selected" : ""}>First ${i} batch${i === 1 ? "" : "es"} (${Math.min(i * S.settings.batch_size, Array.from(S.colById[cid].chars).length)} kanji)</option>`);
    }
    batchSel.innerHTML = opts.join("");
    batchSel.value = "1";
  };
  $("#goal-col").onchange = fillBatches;
  fillBatches();

  const d = new Date(); d.setDate(d.getDate() + 60);
  $("#goal-date").value = d.toISOString().slice(0, 10);

  $("#goal-add").onclick = async () => {
    const goal = {
      id: "g" + Date.now(),
      collection: $("#goal-col").value,
      batches: parseInt(batchSel.value, 10),
      date: $("#goal-date").value,
      bar: $("#goal-bar").value,
      created: new Date().toISOString().slice(0, 10),
    };
    await saveGoals([...(S.settings.goals || []), goal]);
    routes.goals();
  };
  document.querySelectorAll("[data-goal-del]").forEach((el) => {
    el.onclick = async () => {
      if (!confirm("Remove this goal? Your review progress is not affected.")) return;
      await saveGoals((S.settings.goals || []).filter((g) => g.id !== el.dataset.goalDel));
      routes.goals();
    };
  });
  document.querySelectorAll("[data-goal-study]").forEach((el) => {
    el.onclick = () => {
      const g = (S.settings.goals || []).find((x) => x.id === el.dataset.goalStudy);
      if (!g) return;
      // open the first batch that isn't fully in rotation, not always batch 1
      const size = S.settings.batch_size;
      const chars = colChars(g.collection);
      const last = g.batches ? g.batches - 1 : Math.ceil(chars.length / size) - 1;
      let target = 0;
      for (let b = 0; b <= last; b++) {
        const chunk = chars.slice(b * size, (b + 1) * size);
        target = b;
        if (chunk.some((k) => !kanjiStarted(k))) break;
      }
      location.hash = `#/study/${g.collection}/${target}`;
    };
  });
  bindTips($("#main"));
};

// ================================================================ lists page

/**
 * Optional starting points for a new list.
 *
 * Deliberately opt-in and quiet: the dropdown defaults to "Start empty", the
 * templates are one control among several rather than a wizard step you have to
 * clear, and nothing nags you toward them. They exist because "the twenty I keep
 * missing" is tedious to assemble by hand, not because a list ought to come from
 * a template.
 */
function listTemplates(stats) {
  const notOperative = (chars) => chars.filter((k) =>
    kanjiStarted(k) && !(tierOf(k, "meaning") >= 2 && tierOf(k, "reading") >= 2));
  const inRotation = S.kanji.filter((r) => kanjiStarted(r.k)).map((r) => r.k);
  return [
    { id: "empty", label: "Start empty", build: () => [] },
    { id: "missed", label: "My most-missed kanji",
      build: () => (stats?.hardest || []).map((h) => h.k).slice(0, 20) },
    { id: "unfinished", label: "In rotation but not yet operative",
      build: () => notOperative(inRotation).slice(0, 30) },
    { id: "copy-set", label: "Copy a set or batch…", needsScope: true,
      build: (sc) => scopeChars(sc) || [] },
    { id: "copy-list", label: "Copy another list…", needsList: true,
      build: (id) => { const l = listById(id); return l ? listKanji(l) : []; } },
  ];
}

routes.lists = async (arg) => {
  await loadState();
  await loadCollections();
  if (arg) return listDetail(arg);
  const stats = await api("/api/stats").catch(() => null);
  const templates = listTemplates(stats);
  const mine = lists();

  const scopeOpts = [];
  for (const c of S.collections) {
    scopeOpts.push({ sc: { cid: c.id, from: null, to: null }, label: c.name });
    const n = Math.ceil(Array.from(c.chars).length / S.settings.batch_size);
    for (let b = 0; b < Math.min(n, 8); b++) {
      scopeOpts.push({ sc: { cid: c.id, from: b, to: b }, label: `${c.name} · Batch ${b + 1}` });
    }
  }

  setMain(`
    <h1>Lists</h1>
    <p class="sub">Your own groupings of kanji — the ones you keep missing, a set you're
      building for a trip, whatever you like. A list can be reviewed, drilled, played as a
      game or sat as an exam, exactly like a built-in set. Adding a kanji to a list doesn't
      start it, and deleting a list never touches your progress.</p>

    ${mine.length ? `<div class="list-cards">
      ${mine.map((l) => {
        const ks = listKanji(l);
        const sc = { list: l.id };
        const st = scopeStats(sc);
        return `<div class="card list-card">
          <div class="lc-head">
            <div><div class="lc-name">${esc(l.name)}</div>
              <div class="chart-sub">${ks.length} kanji · ${st.kanji} in rotation · ${st.due} due${
                l.note ? ` · ${esc(l.note)}` : ""}</div></div>
            <div class="lc-count">${ks.length}</div>
          </div>
          <div class="lc-preview jp">${ks.slice(0, 18).map((k) => k).join(" ")}${ks.length > 18 ? " …" : ""}</div>
          <div class="row">
            <button class="ghost-btn sm" onclick="location.hash='${scopeHash(sc)}'"
              ${st.due + st.fresh ? "" : "disabled"}>⚡ Review${st.due ? ` (${st.due})` : ""}</button>
            <button class="ghost-btn sm" onclick="location.hash='${scopeHash(sc, "drill")}'"
              ${st.kanji ? "" : "disabled"}>🎯 Drill</button>
            <button class="ghost-btn sm" onclick="location.hash='#/games'">🎮 Games</button>
            <button class="ghost-btn sm" onclick="location.hash='#/exam/${scopeSuffix(sc)}'">📋 Exam</button>
            <button class="ghost-btn sm" onclick="location.hash='#/lists/${l.id}'">Manage</button>
          </div>
        </div>`;
      }).join("")}
    </div>` : `<div class="card">No lists yet. Make one below, or hit
      <b>＋ List</b> on any kanji anywhere in the app.</div>`}

    <h2>New list</h2>
    <div class="card">
      <div class="form-grid">
        <label>Name</label><input id="nl-name" placeholder="e.g. Ones I keep missing" maxlength="60">
        <label>Start from</label>
        <select id="nl-template">${templates.map((t) =>
          `<option value="${t.id}">${esc(t.label)}</option>`).join("")}</select>
        <label class="nl-extra hidden" id="nl-scope-label">Which set</label>
        <select id="nl-scope" class="nl-extra hidden">${scopeOpts.map((o, i) =>
          `<option value="${i}">${esc(o.label)}</option>`).join("")}</select>
        <label class="nl-extra hidden" id="nl-list-label">Which list</label>
        <select id="nl-list" class="nl-extra hidden">${mine.map((l) =>
          `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select>
        <label>Or paste kanji <span class="chart-sub">(optional)</span></label>
        <input id="nl-paste" class="jp" placeholder="日月火水…" autocomplete="off">
      </div>
      <div class="row" style="margin-top:14px">
        <button class="primary-btn" id="nl-create">Create list</button>
        <span class="chart-sub" id="nl-preview"></span>
      </div>
    </div>`);

  const tSel = $("#nl-template");
  const showExtras = () => {
    const t = templates.find((x) => x.id === tSel.value);
    $("#nl-scope-label").classList.toggle("hidden", !t.needsScope);
    $("#nl-scope").classList.toggle("hidden", !t.needsScope);
    const canList = t.needsList && mine.length > 0;
    $("#nl-list-label").classList.toggle("hidden", !canList);
    $("#nl-list").classList.toggle("hidden", !canList);
    preview();
  };
  const seedFrom = () => {
    const t = templates.find((x) => x.id === tSel.value);
    if (t.needsScope) return t.build(scopeOpts[+$("#nl-scope").value].sc);
    if (t.needsList) return mine.length ? t.build($("#nl-list").value) : [];
    return t.build();
  };
  const preview = () => {
    const seeded = dedupeKanji([...seedFrom(), ...Array.from($("#nl-paste").value || "")]);
    $("#nl-preview").textContent = seeded.length
      ? `${Array.from(seeded).length} kanji: ${Array.from(seeded).slice(0, 12).join("")}${
          Array.from(seeded).length > 12 ? "…" : ""}`
      : "empty — you can add kanji later from anywhere in the app";
  };
  tSel.onchange = showExtras;
  $("#nl-scope").onchange = preview;
  $("#nl-list").onchange = preview;
  $("#nl-paste").oninput = preview;
  showExtras();

  $("#nl-create").onclick = async () => {
    const name = $("#nl-name").value.trim() || "Untitled list";
    const kanji = dedupeKanji([...seedFrom(), ...Array.from($("#nl-paste").value || "")]);
    const l = await createList(name, kanji);
    toast(`Created “${esc(l.name)}”`);
    location.hash = "#/lists/" + l.id;
  };
};

async function listDetail(id) {
  const l = listById(id);
  if (!l) { location.hash = "#/lists"; return; }
  const ks = listKanji(l);
  const sc = { list: l.id };
  const st = scopeStats(sc);
  setMain(`
    <h1>${esc(l.name)}</h1>
    <p class="sub">${ks.length} kanji · ${st.kanji} in rotation · created ${l.created}</p>
    <div class="row" style="margin-bottom:16px">
      <button class="primary-btn" onclick="location.hash='${scopeHash(sc)}'"
        ${st.due + st.fresh ? "" : "disabled"}>⚡ Review this list</button>
      <button class="ghost-btn" onclick="location.hash='${scopeHash(sc, "drill")}'"
        ${st.kanji ? "" : "disabled"}>🎯 Drill</button>
      <button class="ghost-btn" onclick="location.hash='#/exam/${scopeSuffix(sc)}'">📋 Exam</button>
      <button class="ghost-btn" id="ld-back">← All lists</button>
    </div>

    ${ks.length ? `
    <div class="card">
      <div class="chart-title">Members</div>
      <div class="chart-sub">Click a kanji to inspect it, or ✕ to take it out of this list.
        Removing it here never affects your progress on that kanji.</div>
      <div class="kanji-grid list-members">
        ${ks.map((k) => {
          const m = srsOf(k, "meaning"), rd = srsOf(k, "reading");
          const cls = (x) => (x ? (x.state === "new" ? "" : x.state) : "");
          return `<div class="kanji-cell" data-k="${k}">${k}
            <span class="st ${cls(m)}"></span><span class="st ${cls(rd)}"></span>
            <button class="lm-x" data-remove="${k}" title="Remove from list">✕</button></div>`;
        }).join("")}
      </div>
    </div>` : `<div class="card">This list is empty. Hit <b>＋ List</b> on any kanji
      anywhere in the app — mid-review, on the Batches grid, in your stats — to add it here.</div>`}

    <div class="card">
      <div class="chart-title">Add kanji</div>
      <div class="form-grid" style="margin-top:10px">
        <label>Paste kanji</label><input id="ld-paste" class="jp" placeholder="日月火…" autocomplete="off">
      </div>
      <div class="row" style="margin-top:12px"><button class="ghost-btn" id="ld-add">Add to list</button></div>
    </div>

    <h2>Manage</h2>
    <div class="card">
      <div class="form-grid">
        <label>Rename</label><input id="ld-name" value="${esc(l.name)}" maxlength="60">
      </div>
      <div class="row" style="margin-top:12px">
        <button class="ghost-btn" id="ld-rename">Save name</button>
        <button class="ghost-btn danger" id="ld-delete">Delete list</button>
      </div>
      <p class="settings-note" style="margin-bottom:0">Deleting a list removes the grouping
        only. Every kanji stays in your rotation with its full history, and any exam results
        for this list stay in your records.</p>
    </div>`);

  $("#ld-back").onclick = () => (location.hash = "#/lists");
  document.querySelectorAll(".kanji-cell").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.dataset.remove) return;
      kanjiModal(el.dataset.k);
    };
  });
  document.querySelectorAll("[data-remove]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      await setListKanji(id, listKanji(listById(id)).filter((k) => k !== b.dataset.remove));
      listDetail(id);
    };
  });
  $("#ld-add").onclick = async () => {
    const add = Array.from($("#ld-paste").value || "").filter((k) => S.byChar[k]);
    if (!add.length) return toast("No recognisable kanji in that.");
    await setListKanji(id, [...listKanji(listById(id)), ...add]);
    toast(`Added ${add.length} kanji`);
    listDetail(id);
  };
  $("#ld-rename").onclick = async () => {
    const name = $("#ld-name").value.trim();
    if (!name) return;
    await renameList(id, name);
    toast("Renamed");
    listDetail(id);
  };
  $("#ld-delete").onclick = async () => {
    if (!confirm(`Delete “${l.name}”?\n\nThe grouping goes away. Your progress on every `
      + `kanji in it is untouched.`)) return;
    await deleteList(id);
    location.hash = "#/lists";
  };
}

// ================================================================ mastery exam
//
// A capstone for a batch. Review is study — it re-asks what you miss, tells you
// immediately, and nudges the schedule. An exam is assessment, so it behaves
// differently on purpose:
//
//   * feedback is deferred to the end, so you can't learn the answer mid-test
//     and score yourself on it
//   * nothing is re-asked, and there is no correction step to walk you through
//   * it does not touch the review schedule, so a nervous run can't damage
//     weeks of spacing — fear of that would stop anyone taking it
//   * answers still count as *evidence*, exactly as drills do: real retrieval
//     in real question types
//
// It is deliberately not a test of everything a kanji can mean. Secondary
// senses appear only where the learner has already unlocked them, are labelled
// bonus, and can only add to the score — never subtract. Finishing a batch
// should be crownable without having met every meaning of every character.

const EXAM_MAX_KANJI = 30;          // keeps a whole-collection exam finishable
const EXAM_PASS = 0.80;             // overall
const EXAM_SECTION_FLOOR = 0.70;    // every required section, so breadth is enforced
const EXAM_STRONG = 0.95;
const EXAM_STRONG_SECTION = 0.90;

const EXAM_SECTIONS = [
  { id: "meaning", title: "Recognition and meaning", jp: "意味",
    blurb: "See the kanji and give its most common meaning — or the reverse, "
         + "given the meaning, pick the kanji. Some ask you to type it with no options.",
    required: true },
  { id: "reading", title: "Reading aloud", jp: "読み",
    blurb: "How you'd say each kanji on its own, as you'd read it off a sign. "
         + "Some multiple choice, some typed.",
    required: true },
  { id: "bonus", title: "Further meanings", jp: "余力",
    blurb: "Only for kanji whose second meaning you've already unlocked. "
         + "Bonus marks — these can add to your score but never take from it.",
    required: false },
];

function examQuestion(row, mode, facet, senseIdx) {
  const q = { k: row.k, row, mode, facet, senseIdx: senseIdx || 0, font: pickFont() };
  if (mode === "mc-meaning") {
    q.answer = senses(row)[q.senseIdx];
    q.choices = shuffle([q.answer, ...pickMeaningDistractors(row, 3)]);
  } else if (mode === "mc-kanji") {
    q.answer = row.k;
    q.choices = shuffle([row.k, ...pickKanjiDistractors(row, 3)]);
  } else if (mode === "mc-reading") {
    q.answer = primaryReading(row);
    q.choices = shuffle([q.answer, ...pickReadingDistractors(row, 3)]);
  } else if (mode === "type-meaning") {
    q.answer = senses(row)[q.senseIdx];
  } else {
    q.answer = primaryReading(row);
  }
  return q;
}

/** Spread modes evenly across the kanji rather than picking each at random. */
function spreadModes(n, modes) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(modes[i % modes.length]);
  return shuffle(out);
}

function buildExam(sc) {
  const all = (scopeChars(sc) || []).filter((k) => S.byChar[k] && senses(S.byChar[k]).length);
  const sampled = all.length > EXAM_MAX_KANJI ? shuffle(all).slice(0, EXAM_MAX_KANJI) : all.slice();
  const chars = shuffle(sampled);

  const mModes = spreadModes(chars.length, ["mc-meaning", "mc-kanji", "type-meaning"]);
  const meaning = chars.map((k, i) => examQuestion(S.byChar[k], mModes[i], "meaning", 0));

  const readable = chars.filter((k) => primaryReading(S.byChar[k]));
  const rModes = spreadModes(readable.length, ["mc-reading", "type-reading"]);
  const reading = readable.map((k, i) => examQuestion(S.byChar[k], rModes[i], "reading", 0));

  // bonus: only senses the learner has actually been given
  const bonusChars = chars.filter((k) => srsOf(k, "sense2") && senses(S.byChar[k]).length > 1);
  const bonus = shuffle(bonusChars).slice(0, 6).map((k) =>
    examQuestion(S.byChar[k], pick(["mc-meaning", "type-meaning"]), "sense2", 1));

  return {
    scope: sc, sampled: chars.length, total: all.length,
    sections: [
      { ...EXAM_SECTIONS[0], questions: meaning },
      { ...EXAM_SECTIONS[1], questions: reading },
      ...(bonus.length ? [{ ...EXAM_SECTIONS[2], questions: bonus }] : []),
    ],
  };
}

function gradeExamAnswer(q, given) {
  if (q.choices) return { ok: given === q.answer };
  return q.facet === "reading" ? gradeReading(given, q.row)
                               : gradeMeaning(given, q.row, q.facet);
}

routes.exam = async (arg) => {
  await loadState();
  await loadCollections();
  const sc = arg === "all" ? null : parseScope(arg || "");
  if (!arg || (arg !== "all" && !sc)) return examPicker();
  return examIntro(sc);
};

function examPicker() {
  const res = activeScopes(false);
  const rows = [...lists().filter((l) => listKanji(l).length).map((l) => ({ list: l.id })),
                ...res.list.flatMap((s) => s.batches.map((b) => ({ cid: s.col.id, from: b.index, to: b.index }))),
                ...res.list.map((s) => ({ cid: s.col.id, from: null, to: null }))];
  setMain(`
    <h1>Mastery exam</h1>
    <p class="sub">A capstone for a set you've been working through. Feedback comes
      at the end, nothing is re-asked, and it leaves your review schedule alone —
      so a bad day costs you nothing but the time.</p>
    ${rows.length ? `<div class="card"><div class="chart-title">Which set?</div>
      <div class="scope-chips" style="margin-top:12px">
        ${rows.map((sc) => `<button class="chip" onclick="location.hash='#/exam/${scopeSuffix(sc)}'">
          ${esc(scopeLabel(sc))} <span class="chip-n">${(scopeChars(sc) || []).length}</span></button>`).join("")}
      </div></div>`
      : `<div class="card">Nothing in rotation yet. <a href="#/study">Start a batch</a> first.</div>`}
  `);
}

function examHistory(sc) {
  return ((S.settings.exams || {})[scopeSuffix(sc)] || []).slice().reverse();
}

function examIntro(sc) {
  const chars = scopeChars(sc) || [];
  const started = chars.filter((k) => kanjiStarted(k)).length;
  const exam = buildExam(sc);
  const count = exam.sections.reduce((a, s) => a + s.questions.length, 0);
  const required = exam.sections.filter((s) => s.required).reduce((a, s) => a + s.questions.length, 0);
  const past = examHistory(sc);
  const best = past.reduce((a, r) => Math.max(a, r.score), 0);

  setMain(`
    <h1>Mastery exam · ${esc(scopeLabel(sc))}</h1>
    <p class="sub">${exam.sampled} kanji${exam.total > exam.sampled
      ? ` sampled from ${exam.total}` : ""} · ${count} questions${
      count > required ? ` (${count - required} of them bonus)` : ""} · no timer.</p>

    <div class="card exam-brief">
      <div class="chart-title">Before you begin</div>
      <p>This is a capstone for <b>${esc(scopeLabel(sc))}</b> — the ${exam.sampled}
        kanji you've been working through. <b>Nothing in it is new.</b> Every question
        asks something you have already practised, in a form you have already seen. The
        exam just asks for all of it at once, without hints, and without a second go at
        any single item.</p>
      <p class="exam-brief-h">What you'll be asked to do</p>
      <ul class="exam-brief-list">
        <li><b>Recognise each kanji</b> and give its most common meaning.</li>
        <li><b>Go the other way</b> — from a meaning, pick out the kanji.</li>
        <li><b>Say each one aloud</b>, the way you'd read it off a sign.</li>
        <li><b>Type some from memory</b>, with no options to choose from.</li>
        ${exam.sections.some((x) => !x.required)
          ? `<li><b>Bonus:</b> a few second meanings you've already unlocked. These can
               add to your score and can never take from it.</li>` : ""}
      </ul>
      <p class="exam-brief-h">What it costs you</p>
      <p>Nothing. There's no timer. It doesn't touch your review schedule, so a shaky
        run can't undo weeks of work. You can retake it as often as you like. A miss
        costs you a line in the report at the end, and that's all.</p>
      <p class="exam-brief-h">What passing means</p>
      <p class="exam-claim">Clear this and you'll be able to say, and mean it:
        <i>“I can recognise every one of the ${exam.sampled} kanji in
        ${esc(scopeLabel(sc))}, give the most common meaning of each, and read each one
        aloud.”</i></p>
      <p>That's a real claim about what you can do — checkable, not a participation
        mark. And if it doesn't go your way this time, the report names exactly which
        kanji and which kind of question caught you out, and offers to drill precisely
        those. Then you come back and take it again.</p>
    </div>

    ${started < chars.length ? `<div class="card"><b>${chars.length - started} of ${chars.length}
      kanji aren't in your rotation yet.</b> You can still sit the exam — just expect those
      to be unfamiliar. <a href="#/study">Add them first</a> if you'd rather.</div>` : ""}

    ${past.length ? `<div class="card">
      <div class="chart-title">Previous attempts</div>
      <div class="chart-sub">Best so far: <b>${Math.round(best * 100)}%</b></div>
      <div class="hbars" style="margin-top:10px">
        ${past.slice(0, 5).map((r) => `<div class="hb-row">
          <span class="hb-label">${r.date}</span>
          <div class="hb-track"><div class="hb-fill" style="width:${Math.round(r.score * 100)}%"></div></div>
          <span class="hb-val">${Math.round(r.score * 100)}%${r.passed ? " ✓" : ""}</span>
        </div>`).join("")}
      </div></div>` : ""}

    <div class="card">
      <div class="chart-title">What it covers</div>
      ${exam.sections.map((s) => `
        <div class="exam-sec-intro">
          <div class="esi-head"><span class="jp">${s.jp}</span> ${esc(s.title)}
            <span class="pill">${s.questions.length} question${s.questions.length === 1 ? "" : "s"}</span>
            ${s.required ? "" : `<span class="pill">bonus</span>`}</div>
          <div class="chart-sub">${esc(s.blurb)}</div>
        </div>`).join("")}
    </div>

    <div class="card">
      <div class="chart-title">How it's marked</div>
      <p class="chart-sub" style="margin:0">
        Pass at <b>${Math.round(EXAM_PASS * 100)}%</b> overall, and at least
        <b>${Math.round(EXAM_SECTION_FLOOR * 100)}%</b> in each required section — so you
        can't pass on meaning alone while unable to read any of them.
        <b>${Math.round(EXAM_STRONG * 100)}%</b> overall with
        <b>${Math.round(EXAM_STRONG_SECTION * 100)}%</b> in both is a strong pass.
        Bonus questions only ever add.</p>
    </div>

    <div class="row" style="margin-top:18px">
      <button class="primary-btn" id="exam-start">Begin the exam</button>
      <button class="ghost-btn" onclick="location.hash='#/review'">Not yet</button>
    </div>`);
  $("#exam-start").onclick = () => runExam(exam);
}

function runExam(exam) {
  const flat = [];
  exam.sections.forEach((s, si) => s.questions.forEach((q) => flat.push({ q, si })));
  const sess = { exam, flat, pos: 0, answers: [], startedAt: Date.now() };
  examCard(sess);
}

function examCard(sess) {
  if (sess.pos >= sess.flat.length) return examResults(sess);
  const { q, si } = sess.flat[sess.pos];
  const sec = sess.exam.sections[si];
  const pct = Math.round((sess.pos / sess.flat.length) * 100);
  const t0 = Date.now();

  let inner;
  if (q.mode === "mc-kanji") {
    inner = `<div class="q-prompt-text">${esc(senses(q.row)[q.senseIdx])}</div>
      <div class="choices">${q.choices.map((c, i) =>
        `<button class="choice jp" data-c="${esc(c)}"${fontStyle(q.font)}><span class="key-hint">${i + 1}</span>${c}</button>`).join("")}</div>`;
  } else if (q.choices) {
    const jp = q.mode === "mc-reading" ? "jp" : "";
    inner = `<div class="q-prompt-kanji"${fontStyle(q.font)}>${q.row.k}</div>
      <div class="choices">${q.choices.map((c, i) =>
        `<button class="choice ${jp}" data-c="${esc(c)}"><span class="key-hint">${i + 1}</span>${esc(c)}</button>`).join("")}</div>`;
  } else {
    const isReading = q.mode === "type-reading";
    inner = `<div class="q-prompt-kanji"${fontStyle(q.font)}>${q.row.k}</div>
      <input class="type-input ${isReading ? "jp" : ""}" id="exam-in" autocomplete="off"
             spellcheck="false" placeholder="${isReading ? "reading…" : "meaning…"}">
      ${isReading ? `<div class="kana-preview" id="exam-kana"></div>` : ""}
      <button class="primary-btn" id="exam-go" style="margin-top:14px">Answer ↵</button>`;
  }

  setMain(`
    <div class="quiz-wrap">
      <div class="session-scope">📋 Exam · ${esc(scopeLabel(sess.exam.scope))}
        <span class="pill">no feedback until the end</span></div>
      <div class="quiz-top">
        <span>${sess.pos + 1} / ${sess.flat.length}</span>
        <div class="meter q-progress"><i style="width:${pct}%"></i></div>
        <span class="jp">${sec.jp}</span>
      </div>
      <div class="quiz-card">
        <div class="q-kind">${esc(sec.title)}${sec.required ? "" : " · bonus"}${
          q.senseIdx ? ` · another meaning of this kanji` : ""}</div>
        ${q.senseIdx ? `<div class="sense-known">You already know
          <b>${q.row.k}</b> = “${esc(senses(q.row)[0])}”.</div>` : ""}
        ${inner}
      </div>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="ghost-btn" id="exam-quit">Abandon exam</button>
      </div>
    </div>`);

  $("#exam-quit").onclick = () => {
    if (confirm("Abandon this exam? Nothing will be recorded.")) location.hash = "#/review";
  };

  const record = (given) => {
    const g = gradeExamAnswer(q, given);
    sess.answers.push({ q, given, ok: !!g.ok, offTarget: !!(g.ok && g.other), ms: Date.now() - t0 });
    // counts as evidence, like a drill, but never reschedules
    api("/api/answer", { k: q.k, facet: q.facet, mode: q.mode, correct: g.ok ? 1 : 0,
                         ms: Date.now() - t0, srs: false,
                         on_target: g.ok && !g.other }).catch(() => {});
    sess.pos++;
    examCard(sess);
  };

  if (q.choices) {
    const btns = [...document.querySelectorAll(".choice")];
    btns.forEach((b) => (b.onclick = () => { btns.forEach((x) => (x.disabled = true)); record(b.dataset.c); }));
    keyOnce((e) => {
      if (e.repeat) return false;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= btns.length && !btns[0].disabled) { e.preventDefault(); btns[n - 1].click(); return true; }
      return false;
    });
  } else {
    const input = $("#exam-in");
    input.focus();
    if (q.mode === "type-reading") {
      input.addEventListener("input", () => { $("#exam-kana").textContent = toHiragana(input.value); });
    }
    const go = () => {
      if (input.disabled) return;
      input.disabled = true;
      $("#exam-go").disabled = true;
      record(input.value);
    };
    $("#exam-go").onclick = go;
    keyOnce((e) => {
      if (e.key !== "Enter" || e.repeat) return false;
      e.preventDefault();
      go();
      return true;
    });
  }
}

/**
 * Mark an exam. Pure, so the thresholds can be checked without a browser.
 *
 * Bonus questions lift the numerator but never the denominator, which is what
 * "can only add, never subtract" means arithmetically: getting them wrong is
 * identical to not having been asked, and getting them right can pull a
 * borderline paper up.
 */
function scoreExam(sections, answers, flat) {
  const bySection = sections.map((sec, si) => {
    const rows = answers.filter((a, i) => flat[i].si === si);
    const ok = rows.filter((a) => a.ok).length;
    return { sec, rows, ok, n: rows.length, pct: rows.length ? ok / rows.length : 1 };
  });
  const req = bySection.filter((b) => b.sec.required);
  const reqOk = req.reduce((a, b) => a + b.ok, 0);
  const reqN = req.reduce((a, b) => a + b.n, 0);
  const bonusOk = bySection.filter((b) => !b.sec.required).reduce((a, b) => a + b.ok, 0);
  const score = reqN ? Math.min(1, (reqOk + bonusOk) / reqN) : 0;
  const floor = req.length ? Math.min(...req.map((b) => b.pct)) : 1;
  const passed = score >= EXAM_PASS && floor >= EXAM_SECTION_FLOOR;
  const strong = passed && score >= EXAM_STRONG && floor >= EXAM_STRONG_SECTION;
  return { bySection, score, floor, passed, strong };
}

async function examResults(sess) {
  const { exam } = sess;
  const { bySection, score, floor, passed, strong } =
    scoreExam(exam.sections, sess.answers, sess.flat);
  const req = bySection.filter((b) => b.sec.required);

  // per-mode diagnosis: typed vs multiple choice is the useful split
  const byMode = {};
  sess.answers.forEach((a) => {
    const m = byMode[a.q.mode] || (byMode[a.q.mode] = { ok: 0, n: 0 });
    m.n++; if (a.ok) m.ok++;
  });

  const missed = sess.answers.filter((a) => !a.ok);
  S.examMissed = [...new Set(missed.map((a) => a.q.k))];

  const mins = Math.max(1, Math.round((Date.now() - sess.startedAt) / 60000));
  const attempt = { date: new Date().toISOString().slice(0, 10), score: Math.round(score * 1000) / 1000,
                    passed, strong, questions: sess.answers.length, minutes: mins };
  const store = { ...(S.settings.exams || {}) };
  store[scopeSuffix(exam.scope)] = [...(store[scopeSuffix(exam.scope)] || []), attempt];
  S.settings.exams = store;
  await api("/api/settings", { exams: store }).catch(() => {});

  // Certification-grade record, sealed and chained server-side. Sent with the
  // resolved kanji and the thresholds in force, because a certificate awarded
  // later has to know what was actually examined and under which rubric — a
  // scope name alone means different characters if batch_size ever changes.
  await api("/api/exam", {
    scope: { suffix: scopeSuffix(exam.scope), name: scopeLabel(exam.scope),
             collection: exam.scope ? exam.scope.cid : null,
             from: exam.scope ? exam.scope.from : null,
             to: exam.scope ? exam.scope.to : null },
    batch_size: S.settings.batch_size,
    kanji: [...new Set(sess.flat.map((f) => f.q.k))].join(""),
    sections: bySection.map((b) => ({ id: b.sec.id, required: !!b.sec.required,
                                      ok: b.ok, n: b.n })),
    by_mode: byMode,
    score, floor, passed, strong,
    thresholds: { pass: EXAM_PASS, section: EXAM_SECTION_FLOOR,
                  strong: EXAM_STRONG, strong_section: EXAM_STRONG_SECTION },
    questions: sess.answers.length, minutes: mins,
  }).catch(() => {});

  const stamp = strong ? { k: "優", en: "Distinction", cls: "strong" }
    : passed ? { k: "合格", en: "Passed", cls: "pass" }
    : { k: "未だ", en: "Not yet", cls: "notyet" };

  setMain(`
    <div class="quiz-wrap session-done">
      <div class="exam-stamp ${stamp.cls}"><span class="jp">${stamp.k}</span><span>${stamp.en}</span></div>
      <h1>${esc(scopeLabel(exam.scope))}</h1>
      <p class="sub">${Math.round(score * 100)}% over ${sess.answers.length} questions · ${mins}m</p>

      <div class="card chart-card" style="text-align:left">
        <div class="chart-title">By section</div>
        <div class="hbars" style="margin-top:8px">
          ${bySection.map((b) => `<div class="hb-row">
            <span class="hb-label">${esc(b.sec.title.split(" ")[0])}${b.sec.required ? "" : " (bonus)"}</span>
            <div class="hb-track"><div class="hb-fill" style="width:${Math.round(b.pct * 100)}%;${
              b.sec.required && b.pct < EXAM_SECTION_FLOOR ? "background:var(--bad)" : ""}"></div></div>
            <span class="hb-val">${b.ok}/${b.n}</span></div>`).join("")}
        </div>
        <div class="chart-sub" style="margin-top:10px">By question type —
          ${Object.entries(byMode).map(([m, v]) =>
            `${esc(MODE_LABEL[m] ? m.replace("mc-", "choose ").replace("type-", "type ") : m)} ${v.ok}/${v.n}`).join(" · ")}</div>
        ${!passed ? `<p class="sub" style="margin:12px 0 0">${floor < EXAM_SECTION_FLOOR
          ? `One section fell below ${Math.round(EXAM_SECTION_FLOOR * 100)}% — that's the part to work on before retaking.`
          : `Close. ${Math.round(EXAM_PASS * 100)}% overall is the bar.`}</p>` : ""}
      </div>

      ${missed.length ? `
      <div class="card chart-card" style="text-align:left">
        <div class="chart-title">What went wrong (${missed.length})</div>
        <div class="chart-sub">Click a kanji to see where it stands.</div>
        <div class="exam-misses">
          ${missed.map((a) => `
            <div class="exam-miss" data-k="${a.q.k}">
              <span class="em-k jp">${a.q.k}</span>
              <span class="em-body">
                <span class="em-mode">${esc(a.q.mode.replace("mc-", "choose ").replace("type-", "type "))}</span>
                <span class="em-gave">you said ${a.given && String(a.given).trim()
                  ? `“${esc(String(a.given))}”` : "nothing"}</span>
                <span class="em-want">answer: <b>${esc(String(a.q.answer))}</b></span>
              </span>
            </div>`).join("")}
        </div>
      </div>` : `<div class="card"><b>Nothing missed.</b> Every question, every angle.</div>`}

      <div class="next-up">
        ${S.examMissed.length ? `<button class="primary-btn" onclick="location.hash='#/drill/missed'">
          🎯 Drill the ${S.examMissed.length} you missed</button>` : ""}
        <button class="ghost-btn" onclick="location.hash='#/exam/${scopeSuffix(exam.scope)}'">Retake</button>
        <button class="ghost-btn" onclick="location.hash='${scopeHash(exam.scope)}'">Review this set</button>
        <button class="ghost-btn" onclick="location.hash='#/';location.reload()">Dashboard</button>
      </div>
    </div>`);
  document.querySelectorAll(".exam-miss").forEach((el) => {
    el.onclick = () => S.byChar[el.dataset.k] && kanjiModal(el.dataset.k);
  });
}

// ================================================================ stats

routes.stats = async () => {
  await loadState();
  const st = await api("/api/stats");
  const acc = st.total_reviews ? Math.round((st.total_correct / st.total_reviews) * 100) : 0;

  const days30 = lastNDays(30).map((d) => ({ d, ...(st.days[d] || { n: 0, correct: 0 }) }));
  const maxN = Math.max(1, ...days30.map((x) => x.n));

  const days120 = lastNDays(119 + 1).map((d) => ({ d, ...(st.days[d] || { n: 0 }) }));
  const maxH = Math.max(1, ...days120.map((x) => x.n));
  const seq = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6", "--seq-7"];
  // pad so columns align to weeks (heatmap flows column-per-week, 7 rows)
  const firstDow = new Date(days120[0].d + "T00:00:00").getDay();
  const cells = [...Array(firstDow).fill(null), ...days120];

  await loadCollections();
  const trackSections = Object.entries(st.collections || {})
    .map(([cid, batches]) => ({ cid, name: S.colById[cid]?.name || cid, batches: batches.filter((b) => b.started > 0) }))
    .filter((t) => t.batches.length);

  setMain(`
    <h1>Stats</h1>
    <p class="sub">Everything is stored locally in <code>userdata/</code>.</p>
    ${levelCard(st)}
    <div class="tiles" style="margin-bottom:14px">
      <div class="tile"><div class="t-label">Total answers</div><div class="t-value">${st.total_reviews}</div></div>
      <div class="tile"><div class="t-label">Accuracy</div><div class="t-value">${acc}%</div></div>
      <div class="tile"><div class="t-label">Streak</div><div class="t-value">${st.streak}</div><div class="t-sub">days</div></div>
      <div class="tile"><div class="t-label">In rotation</div><div class="t-value">${st.in_rotation}</div><div class="t-sub">kanji being studied</div></div>
      <div class="tile"><div class="t-label">Learned</div><div class="t-value">${st.learned}</div><div class="t-sub">${st.mature} solid · every question type</div></div>
      <div class="tile"><div class="t-label">Jōyō coverage</div><div class="t-value">${Math.round((st.joyo_learned / st.joyo_total) * 100)}%</div><div class="t-sub">${st.joyo_learned} / ${st.joyo_total}</div></div>
    </div>

    ${badgeSection(st)}

    <div class="card chart-card">
      <div class="chart-title">Answers per day</div>
      <div class="chart-sub">Last 30 days</div>
      <div class="bars">${days30.map((x) => `<div class="bar ${x.n ? "" : "empty"}" style="height:${Math.max(2, (x.n / maxN) * 100)}%" data-tip="<b>${x.d}</b><br>${x.n} answers · ${x.n ? Math.round(((x.correct || 0) / x.n) * 100) : 0}% correct"></div>`).join("")}</div>
      <div class="bar-x">${days30.map((x, i) => `<span>${i % 5 ? "" : x.d.slice(8)}</span>`).join("")}</div>
    </div>

    <div class="card chart-card">
      <div class="chart-title">Activity heatmap</div>
      <div class="chart-sub">Last 4 months. Stronger color means more answers.</div>
      <div class="heatmap">
        ${cells.map((c) => {
          if (!c) return `<i style="visibility:hidden"></i>`;
          const lvl = c.n === 0 ? -1 : Math.min(6, Math.floor((c.n / maxH) * 6.99));
          const bg = lvl < 0 ? "" : `style="background:var(${seq[lvl]})"`;
          return `<i ${bg} data-tip="<b>${c.d}</b><br>${c.n} answers"></i>`;
        }).join("")}
      </div>
    </div>

    ${trackSections.length ? `
    <div class="card chart-card hbars">
      <div class="chart-title">Batch mastery</div>
      <div class="chart-sub">Average card strength per started batch</div>
      ${trackSections.map((t) => `
        <div style="font-size:13px;font-weight:700;margin:12px 0 6px">${esc(t.name)}</div>
        ${t.batches.map((b) => `
        <div class="hb-row">
          <span class="hb-label">Batch ${b.index + 1}</span>
          <div class="hb-track"><div class="hb-fill" style="width:${Math.round(b.mastery * 100)}%"></div></div>
          <span class="hb-val">${Math.round(b.mastery * 100)}%</span>
        </div>`).join("")}`).join("")}
    </div>` : ""}

    ${st.hardest.length ? `
    <div class="card chart-card">
      <div class="chart-title">Trickiest kanji</div>
      <div class="chart-sub">Most missed. Click a kanji to inspect it.</div>
      <div class="hard-list">
        ${st.hardest.map((h) => `<div class="hard-item" data-k="${h.k}"><span class="hk">${h.k}</span><span class="hw">${h.wrong}✗</span></div>`).join("")}
      </div>
    </div>` : ""}
  `);
  bindTips($("#main"));
  document.querySelectorAll(".hard-item").forEach((el) => {
    el.onclick = () => S.byChar[el.dataset.k] && kanjiModal(el.dataset.k);
  });
};

// ================================================================ settings

async function renderBackups() {
  const el = $("#backup-card");
  if (!el) return;
  let d;
  try { d = await api("/api/backups"); }
  catch (e) { el.innerHTML = `<div class="chart-sub">Couldn't read backups: ${esc(e.message)}</div>`; return; }
  const kb = (n) => (n > 1024 * 1024 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");
  const row = (s, source) => `
    <div class="snap-row">
      <span class="snap-when">${esc((s.ts || s.name).replace("T", " ").replace("Z", ""))}</span>
      <span class="snap-what">${s.broken ? "<i>unreadable</i>"
        : `${s.reviews} answers · ${s.srs} cards${s.exams ? ` · ${s.exams} exams` : ""}`}</span>
      <span class="snap-why">${esc(s.reason || "")}</span>
      <span class="snap-size">${kb(s.bytes || 0)}</span>
      <button class="ghost-btn sm" data-restore="${esc(s.name)}" data-source="${source}"
        ${s.broken ? "disabled" : ""}>Restore</button>
    </div>`;
  el.innerHTML = `
    <div class="chart-title">Automatic backups</div>
    <div class="chart-sub">Taken when you start the app and while it runs, whenever something
      has changed. Thinned over time: the recent ones, then one a day, then one a month.</div>
    <div class="snap-list">${d.snapshots.length
      ? d.snapshots.map((s) => row(s, "local")).join("")
      : `<div class="chart-sub">None yet — one is taken as soon as there's progress to save.</div>`}</div>

    <div class="chart-title" style="margin-top:18px">Copy outside the app folder</div>
    <div class="chart-sub">${d.mirror_ok
      ? `Kept at <code>${esc(d.mirror_dir)}</code>. Deleting this app folder, re-cloning it or
         reinstalling doesn't touch these — if the app ever starts up empty, it offers to
         put one back.`
      : `Not writable on this machine, so backups live only inside the app folder.`}</div>
    <div class="snap-list">${d.mirror.map((s) => row(s, "mirror")).join("")}</div>

    <div class="row" style="margin-top:14px">
      <button class="ghost-btn" id="backup-now">Back up now</button>
    </div>
    <p class="settings-note" style="margin-bottom:0">Your data lives in
      <code>${esc(d.user_dir)}</code>. Nothing else writes there, so updating the app or
      pulling a new version can't disturb it.</p>`;

  $("#backup-now").onclick = async () => {
    const r = await api("/api/backup", { reason: "manual" });
    toast(r.snapshot ? "Backup saved" : "Nothing to back up yet");
    renderBackups();
  };
  el.querySelectorAll("[data-restore]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm("Restore this backup?\n\nIt replaces your current progress. A backup of "
        + "the current state is taken first, so this can be undone.")) return;
      await api("/api/restore", { name: b.dataset.restore, source: b.dataset.source });
      alert("Restored.");
      location.reload();
    };
  });
}

routes.settings = async () => {
  await loadState();
  const s = S.settings;
  const sel = (name, options, val) =>
    `<select id="set-${name}">${options.map((o) => `<option value="${o}" ${o == val ? "selected" : ""}>${o}</option>`).join("")}</select>`;
  setMain(`
    <h1>Settings</h1>
    <p class="sub">Changes apply immediately.</p>
    <div class="card">
      <div class="form-grid">
        <label>Frequency track size (top N)</label>${sel("top_n", [250, 500, 750, 1000, 1500, 2000, 2501], s.top_n)}
        <label>Batch size</label>${sel("batch_size", [10, 15, 20, 25, 50], s.batch_size)}
        <label>New kanji per day</label>${sel("new_per_day", [3, 5, 10, 15, 20], s.new_per_day)}
        <label>Session length (cards)</label>${sel("session_size", [10, 20, 30, 50], s.session_size)}
      </div>
    </div>
    <h2>Typefaces</h2>
    <div class="card">
      <div class="form-grid">
        <label>Vary the typeface</label>
        <select id="set-font_variety">
          <option value="1" ${s.font_variety !== false ? "selected" : ""}>Yes — rotate through the faces on this computer</option>
          <option value="0" ${s.font_variety === false ? "selected" : ""}>No — always use the interface font</option>
        </select>
      </div>
      <div id="font-report"></div>
    </div>
    <h2>Meanings and readings</h2>
    <div class="card">
      <div class="form-grid">
        <label>Extra meanings per day</label>${sel("sense_per_day", [0, 2, 4, 8, 15], s.sense_per_day)}
        <label>Grade the primary meaning strictly</label>
        <select id="set-strict_primary">
          <option value="1" ${s.strict_primary !== false ? "selected" : ""}>Yes — where the senses are curated (recommended)</option>
          <option value="0" ${s.strict_primary !== false ? "" : "selected"}>No — any real meaning always counts</option>
        </select>
      </div>
      <p class="settings-note">A kanji's second and third meanings unlock on their own once
        you can actually produce the first one on demand, then arrive as review rather than as new
        material. <b>Extra meanings per day</b> caps how fast they arrive; it has its own
        budget so deepening never eats into new kanji. Set it to 0 to pause it entirely.</p>
      <p class="settings-note">Either way, a typed meaning card <b>always tells you the most
        common sense</b>: answer 日 with “Sun” and you're told that Day is the primary one.
        The setting only decides whether the answer is also marked <i>wrong</i>.</p>
      <p class="settings-note">Strictness follows the data. For the kanji whose senses have
        been curated in <code>data/senses.json</code> — the beginner range — every reasonable
        wording of a sense counts as fully right (“big”, “great” and “large” are all 大), so
        being strict about <i>which sense</i> is fair. For kanji not yet curated, any real
        meaning is accepted, because there the app can't tell a different sense from the same
        one worded differently. It tightens on its own as more of the range is curated.</p>
      <p class="settings-note">Reading cards ask how you'd say a kanji <b>on its own</b> —
        what you'd read off a sign. Those readings are curated in
        <code>data/spoken.json</code>, which you can edit; the app still accepts the kanji's
        other real readings and just nudges you toward the standalone one.</p>
    </div>
    <h2>Backups</h2>
    <div class="card" id="backup-card">
      <div class="chart-sub">Loading…</div>
    </div>
    <h2>Data</h2>
    <div class="card">
      <div class="row">
        <button class="ghost-btn" id="export-btn">⬇ Export backup (JSON)</button>
        <button class="ghost-btn" id="import-btn">⬆ Import backup</button>
        <input type="file" id="import-file" accept=".json" class="hidden">
      </div>
      <p class="settings-note" style="margin-bottom:0">Your progress lives in <code>userdata/trainer.db</code>. Export/import moves it between computers; importing <b>replaces</b> what's here, and takes a backup first so it can be undone.</p>
    </div>
    <h2>Help</h2>
    <div class="card">
      <button class="ghost-btn" id="settings-tour">Replay the interface walkthrough</button>
    </div>
    <h2>About</h2>
    <p class="settings-note">Kanji Trainer was made by Alexander Nichols (Old Dominion University). It began as a way to help my brother prepare for his move to Japan and his studies in Waseda University's JCulP program: he needed to learn a lot of kanji in a sensible order, without wrestling with the tools.</p>
    <p class="settings-note">You don't need a plane ticket for it to work for you, though. Whether you're studying for the JLPT, planning a trip, or just want to read a menu someday, the plan is the same one: learn the most common characters first, in small batches, and show up for a few minutes of review each day. That's the whole trick, and it's yours too.</p>
    <p class="settings-note">Kanji data derived from KANJIDIC2 © EDRDG, used under CC BY-SA 4.0 (via davidluzgouveia/kanji-data). Frequency ranks are from newspaper corpus counts.</p>
  `);
  for (const name of ["top_n", "batch_size", "new_per_day", "session_size", "sense_per_day"]) {
    $("#set-" + name).onchange = async (e) => {
      await api("/api/settings", { [name]: parseInt(e.target.value, 10) });
      await loadState();
      await loadCollections();
    };
  }
  // Report what was actually detected. Claiming variety we can't deliver would be
  // the same silent-substitution mistake the games used to make.
  (function () {
    const el = $("#font-report");
    if (!el) return;
    const fonts = S.fonts || [];
    const sample = "永国令直心";
    if (fonts.length < 2) {
      el.innerHTML = `<p class="settings-note"><b>Only one Japanese typeface was found
        on this computer</b>, so there is nothing to rotate through — prompts will use it
        whatever this setting says. Installing another Japanese font (a 明朝 / Mincho face
        is the most useful second one) turns this on by itself.</p>`;
      return;
    }
    el.innerHTML = `
      <p class="settings-note">${fonts.length} distinct Japanese typefaces found on this
        computer. Quiz prompts rotate through them; everything else — the intro card, the
        answer reveal, kanji lists — stays in the interface font so it's always legible.
        Each face below was measured, not assumed: any that rendered identically to
        another was dropped.</p>
      <div class="font-samples">
        ${fonts.map((f) => `
          <div class="font-sample">
            <div class="fs-glyphs" style="font-family:'${f.family}',var(--jp)">${sample}</div>
            <div class="fs-name"><span class="jp">${f.jp}</span> · ${esc(f.en)}</div>
            <div class="fs-family">${esc(f.family)}</div>
          </div>`).join("")}
      </div>`;
  })();
  $("#set-font_variety").onchange = async (e) => {
    await api("/api/settings", { font_variety: e.target.value === "1" });
    await loadState();
  };
  $("#set-strict_primary").onchange = async (e) => {
    await api("/api/settings", { strict_primary: e.target.value === "1" });
    await loadState();
  };
  renderBackups();
  $("#settings-tour").onclick = () => { S.forceTour = true; location.hash = "#/"; };
  $("#export-btn").onclick = async () => {
    const dump = await api("/api/export");
    const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `kanji-trainer-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $("#import-btn").onclick = () => $("#import-file").click();
  $("#import-file").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm("Importing replaces ALL current progress. Continue?")) return;
    try {
      const dump = JSON.parse(await file.text());
      await api("/api/import", dump);
      alert("Import complete.");
      location.reload();
    } catch (err) {
      alert("Import failed: " + err.message);
    }
  };
};
