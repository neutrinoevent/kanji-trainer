/* Kanji Trainer — review scopes, and the review / drill session itself.
   Plain script, no bundler and no module system: index.html loads these in
   dependency order. See static/js/README.md for the layout. */
"use strict";

// ================================================================ review session

// ================================================================ review scopes
//
// Review used to be all-or-nothing: every card in rotation, whatever the
// learner was actually working on. Someone studying Grade 1 batch 1 would get
// quizzed on anything else they had ever started. A scope is a collection plus
// an optional inclusive batch range; `null` means everything, which stays the
// default and is still one click away.

/**
 * "#/review/c/g1/0", "#/review/c/g1/0-2" or "#/review/l/<listId>" -> a scope.
 * null means everything.
 *
 * A user-made list is deliberately just another scope. That is what lets review,
 * drill, the games and the exam all work on one without any of them needing to
 * know that lists exist.
 */
function parseScope(arg) {
  const p = (arg || "").split("/").filter(Boolean);
  if (p[0] === "l" && p[1]) return listById(p[1]) ? { list: p[1] } : null;
  if (p[0] !== "c" || !p[1] || !S.colById || !S.colById[p[1]]) return null;
  const cid = p[1];
  if (p[2] === undefined) return { cid, from: null, to: null };
  const [a, b] = p[2].split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(a)) return { cid, from: null, to: null };
  return { cid, from: a, to: Number.isFinite(b) ? b : a };
}

function scopeSuffix(sc) {
  if (!sc) return "all";
  if (sc.list) return `l/${sc.list}`;
  if (sc.from === null) return `c/${sc.cid}`;
  return `c/${sc.cid}/${sc.from === sc.to ? sc.from : `${sc.from}-${sc.to}`}`;
}
const scopeHash = (sc, base = "review") => `#/${base}/${scopeSuffix(sc)}`;

function scopeQuery(sc) {
  if (!sc) return "";
  if (sc.list) return `?list=${encodeURIComponent(sc.list)}`;
  let q = `?collection=${encodeURIComponent(sc.cid)}`;
  if (sc.from !== null) q += `&from=${sc.from}&to=${sc.to}`;
  return q;
}

function scopeLabel(sc) {
  if (!sc) return "Everything in rotation";
  if (sc.list) { const l = listById(sc.list); return l ? l.name : "(deleted list)"; }
  const name = S.colById?.[sc.cid]?.name || sc.cid;
  if (sc.from === null) return name;
  return sc.from === sc.to ? `${name} · Batch ${sc.from + 1}`
                           : `${name} · Batches ${sc.from + 1}–${sc.to + 1}`;
}

/** The characters a scope covers, or null for everything. */
function scopeChars(sc) {
  if (!sc) return null;
  if (sc.list) { const l = listById(sc.list); return l ? listKanji(l) : []; }
  const all = colChars(sc.cid);
  if (sc.from === null) return all;
  const size = S.settings.batch_size;
  return all.slice(sc.from * size, (sc.to + 1) * size);
}

/** Counts for a scope, computed from the srs rows already in memory. */
function scopeStats(sc) {
  const chars = scopeChars(sc);
  const set = chars ? new Set(chars) : null;
  const now = Date.now();
  let due = 0, fresh = 0, cards = 0;
  const kanji = new Set();
  for (const r of S.srs.values()) {
    if (set && !set.has(r.kanji)) continue;
    cards++;
    kanji.add(r.kanji);
    if (r.state === "new") fresh++;
    else if (r.due && new Date(r.due).getTime() <= now) due++;
  }
  return { due, fresh, cards, kanji: kanji.size,
           total: chars ? chars.length : kanji.size };
}

/**
 * Scopes worth offering, most-studied first.
 *
 * Sets overlap heavily by design — 日 is in Frequency, Grade 1 and N5 at once —
 * so "every collection containing a started kanji" would list nearly all of them
 * for someone who started two batches. A batch is only listed if it is at least
 * half in rotation, which separates "I worked through this" from "overlap
 * brushed against it", and the collection list is capped unless asked to expand.
 */
function activeScopes(showAll) {
  const size = S.settings.batch_size;
  const threshold = Math.max(2, Math.ceil(size / 2));
  const out = [];
  for (const c of S.collections || []) {
    const chars = colChars(c.id);
    const started = chars.filter((k) => kanjiStarted(k)).length;
    if (!started) continue;
    const batches = [];
    for (let b = 0; b * size < chars.length; b++) {
      const chunk = chars.slice(b * size, (b + 1) * size);
      const n = chunk.filter((k) => kanjiStarted(k)).length;
      if (n >= Math.min(threshold, chunk.length)) {
        batches.push({ index: b, started: n, size: chunk.length });
      }
    }
    const deliberate = batches.length > 0 || started >= chars.length / 2;
    out.push({ col: c, started, total: chars.length, batches, deliberate });
  }
  out.sort((a, b) => b.started - a.started);
  if (showAll) return out;
  const focused = out.filter((s) => s.deliberate);
  return { list: focused.slice(0, 5), hidden: out.length - focused.slice(0, 5).length };
}

async function rememberScope(sc) {
  const suffix = scopeSuffix(sc);
  if (S.settings.review_scope === suffix) return;
  S.settings.review_scope = suffix;
  await api("/api/settings", { review_scope: suffix }).catch(() => {});
}

routes.review = async (arg) => {
  await loadState();
  await loadCollections();
  if (!arg) return reviewHub();
  const sc = arg === "all" ? null : parseScope(arg);
  if (arg !== "all" && !sc) return reviewHub();
  await rememberScope(sc);
  return reviewSession(sc);
};

// Drill: quiz everything in a scope regardless of what's due, and never touch
// the schedule. This is the "let me just practise batch 1" button — useful
// precisely when nothing is due, which is when plain review has nothing to say.
routes.drill = async (arg) => {
  await loadState();
  await loadCollections();
  // "missed" is an ad-hoc set held in memory from the last exam — not a saved
  // scope, because it is a one-off list rather than something to come back to.
  const adhoc = arg === "missed" ? (S.examMissed || []) : null;
  if (arg === "missed" && !adhoc.length) return reviewHub();
  const sc = adhoc ? null : (arg === "all" ? null : parseScope(arg));
  if (!adhoc && arg && arg !== "all" && !sc) return reviewHub();

  const chars = adhoc || scopeChars(sc);
  const set = chars ? new Set(chars) : null;
  const items = [];
  for (const r of S.srs.values()) {
    if (set && !set.has(r.kanji)) continue;
    if (r.state === "new") continue;              // not taught yet
    if (!S.byChar[r.kanji]) continue;
    items.push({ k: r.kanji, facet: r.facet, type: "drill", srsDone: true });
  }
  if (!items.length) {
    // "in rotation" and "already met" are different things -- say which is missing
    const st = scopeStats(sc);
    const untaught = st.kanji > 0;
    setMain(`
      <h1>Drill · ${esc(scopeLabel(sc))}</h1>
      <div class="card" style="text-align:center;padding:40px 20px">
        <h2 style="margin-top:0">Nothing to drill yet</h2>
        <p class="sub">${untaught
          ? `${st.kanji} kanji from this set are in your rotation, but you haven't met
             any of them yet. Review introduces them first — then you can drill them
             as often as you like.`
          : "No kanji from this set are in your rotation. Add a batch first."}</p>
        <div class="row" style="justify-content:center">
          ${untaught
            ? `<button class="primary-btn" onclick="location.hash='${scopeHash(sc)}'">Review this set</button>`
            : `<button class="primary-btn" onclick="location.hash='#/study'">Batches</button>`}
          <button class="ghost-btn" onclick="location.hash='#/review'">Review hub</button>
        </div>
      </div>`);
    return;
  }
  const session = shuffle(items).slice(0, Math.max(10, S.settings.session_size));
  runSession(session, { drill: true, scope: sc,
    title: `Drill · ${adhoc ? `${adhoc.length} kanji missed in the exam` : scopeLabel(sc)}` });
};

function scopeCard(sc, opts = {}) {
  const st = scopeStats(sc);
  // The headline number is what you owe *now*. Not-yet-started cards are gated
  // by the global daily budget, so folding them in would promise a session far
  // larger than the one you'd actually get.
  const canStudy = st.due + st.fresh > 0;
  const label = st.due ? `Review (${st.due})`
    : st.fresh ? "Review · introduces new kanji"
    : "Review — nothing due";
  return `
    <div class="card scope-card ${opts.primary ? "scope-primary" : ""}">
      <div class="scope-head">
        <div>
          <div class="scope-title">${esc(scopeLabel(sc))}</div>
          <div class="chart-sub">${st.kanji} kanji in rotation${
            sc && st.total > st.kanji ? ` of ${st.total}` : ""}${
            st.fresh ? ` · ${st.fresh} card${st.fresh === 1 ? "" : "s"} not yet started` : ""}</div>
        </div>
        <div class="scope-count ${st.due ? "" : "zero"}" data-tip="Cards due now">${st.due}</div>
      </div>
      <div class="row">
        <button class="${opts.primary ? "primary-btn" : "ghost-btn"}"
                onclick="location.hash='${scopeHash(sc)}'" ${canStudy ? "" : "disabled"}>${label}</button>
        <button class="ghost-btn" onclick="location.hash='${scopeHash(sc, "drill")}'"
                ${st.kanji ? "" : "disabled"}>Drill</button>
      </div>
    </div>`;
}

function reviewHub(showAll) {
  const res = activeScopes(showAll);
  const scopes = showAll ? res : res.list;
  const hidden = showAll ? 0 : res.hidden;
  const myLists = lists().filter((l) => listKanji(l).length);
  const goals = (S.settings.goals || []).filter((g) => S.colById && S.colById[g.collection]);

  const batchRow = (cid, b) => {
    const sc = { cid, from: b.index, to: b.index };
    const st = scopeStats(sc);
    const ready = st.due + st.fresh;
    return `
      <div class="batch-review-row">
        <span class="brr-name">Batch ${b.index + 1}</span>
        <span class="brr-meta">${b.started}/${b.size} in rotation · ${st.due} due${
          st.fresh ? ` · ${st.fresh} new` : ""}</span>
        <button class="ghost-btn sm" onclick="location.hash='${scopeHash(sc)}'"
                ${ready ? "" : "disabled"}>${st.due ? `Review (${st.due})` : ready ? "Review · new" : "Review"}</button>
        <button class="ghost-btn sm" onclick="location.hash='${scopeHash(sc, "drill")}'">Drill</button>
        <button class="ghost-btn sm" onclick="location.hash='#/exam/${scopeSuffix(sc)}'"
                title="Mastery exam">📋${examHistory(sc).some((r) => r.passed) ? " ✓" : ""}</button>
      </div>`;
  };

  setMain(`
    <h1>Review</h1>
    <p class="sub">Review everything at once, or narrow it to exactly what you're
      working on. <b>Review</b> follows your schedule and moves cards along.
      <b>Drill</b> practises a set whenever you like and leaves the schedule alone.</p>

    ${scopeCard(null, { primary: true })}

    ${scopes.length ? `
      <h2>By set</h2>
      <p class="sub" style="margin-top:-6px">Sets overlap — a kanji can belong to several at once.
        Batches appear here once they're at least half in your rotation.</p>
      ${scopes.map((s) => `
        ${scopeCard({ cid: s.col.id, from: null, to: null })}
        ${s.batches.length ? `
          <div class="batch-review-list">
            ${s.batches.slice(0, 12).map((b) => batchRow(s.col.id, b)).join("")}
            ${s.batches.length > 12
              ? `<div class="chart-sub" style="padding:6px 2px">…and ${s.batches.length - 12} more
                   — open the set from <a href="#/study">Batches</a>.</div>` : ""}
          </div>` : ""}
      `).join("")}
      ${hidden > 0 ? `<div class="row"><button class="ghost-btn" id="show-all-scopes">
          Show ${hidden} more set${hidden === 1 ? "" : "s"} you've touched</button></div>` : ""}`
    : `<div class="card">Nothing in rotation yet.
        <a href="#/study">Start a batch</a> or <a href="#/path">follow the path</a>.</div>`}

    ${myLists.length ? `
      <h2>Your lists</h2>
      ${myLists.map((l) => scopeCard({ list: l.id })).join("")}` : ""}

    ${goals.length ? `
      <h2>By goal</h2>
      ${goals.map((g) => scopeCard(goalScope(g))).join("")}` : ""}
  `);
  const more = $("#show-all-scopes");
  if (more) more.onclick = () => reviewHub(true);
}

async function reviewSession(sc) {
  const queue = await api("/api/queue" + scopeQuery(sc));
  const sessionSize = S.settings.session_size;
  const due = shuffle(queue.due).slice(0, sessionSize);
  const newItems = queue.new.slice(0, Math.max(0, sessionSize - due.length + 6));

  if (!due.length && !newItems.length) {
    const inScope = scopeStats(sc);
    setMain(`
      <h1>Review${sc ? " · " + esc(scopeLabel(sc)) : ""}</h1>
      <div class="card" style="text-align:center;padding:50px 20px">
        <div style="font-family:var(--jp);font-size:64px">🎉</div>
        <h2 style="margin-top:10px">All caught up!</h2>
        <p class="sub">${sc
          ? `Nothing is due in <b>${esc(scopeLabel(sc))}</b> right now.
             You can still drill it any time — that won't disturb the schedule.`
          : "Nothing is due right now. Start a new batch, or play a game."}</p>
        <div class="row" style="justify-content:center">
          ${sc && inScope.kanji
            ? `<button class="primary-btn" onclick="location.hash='${scopeHash(sc, "drill")}'">Drill this set</button>` : ""}
          <button class="ghost-btn" onclick="location.hash='#/review'">Review hub</button>
          <button class="ghost-btn" onclick="location.hash='#/study'">Batches</button>
          <button class="ghost-btn" onclick="location.hash='#/games'">Games</button>
        </div>
      </div>`);
    return;
  }

  // Build session: intro card once per brand-new kanji, then its quiz items.
  const items = [...due];
  const introduced = new Set();
  for (const it of newItems) {
    if (it.type === "sense") {
      // an extra meaning for a kanji already known - its own kind of introduction
      items.push({ k: it.k, facet: it.facet, type: "sense-intro" });
    } else if (!introduced.has(it.k)) {
      introduced.add(it.k);
      items.push({ k: it.k, type: "intro" });
    }
    items.push(it);
  }
  runSession(items, { scope: sc, title: sc ? `Review · ${scopeLabel(sc)}` : null });
}

function runSession(items, opts = {}) {
  const sess = {
    items,
    pos: 0,
    firstTry: new Map(),   // "k|facet" -> bool
    answered: 0,
    correct: 0,
    missed: new Set(),
    startedAt: Date.now(),
    scope: opts.scope || null,
    title: opts.title || null,
    drill: !!opts.drill,
  };
  nextCard(sess);
}

function sessionHeader(sess) {
  const total = sess.items.length;
  const pct = Math.round((sess.pos / total) * 100);
  return `
    ${sess.title ? `<div class="session-scope">${sess.drill ? "🎯" : "⚡"}
      ${esc(sess.title)}${sess.drill ? ` <span class="pill">schedule untouched</span>` : ""}</div>` : ""}
    <div class="quiz-top">
      <span>${sess.pos + 1} / ${total}</span>
      <div class="meter q-progress"><i style="width:${pct}%"></i></div>
      <span>${sess.correct}✓ ${sess.answered - sess.correct}✗</span>
    </div>`;
}

function nextCard(sess) {
  if (sess.pos >= sess.items.length) return sessionDone(sess);
  const item = sess.items[sess.pos];
  if (item.type === "intro") return introCard(sess, item);
  if (item.type === "sense-intro") return senseIntroCard(sess, item);
  quizCard(sess, item);
}

function advanceOn(sess, btnId, delay = 300) {
  let advanced = false, armed = false;
  const go = () => { if (advanced) return; advanced = true; sess.pos++; nextCard(sess); };
  setTimeout(() => { armed = true; }, delay);
  $(btnId).onclick = () => { if (armed) go(); };
  keyOnce((e) => {
    if (e.repeat) return false;
    if (S.pickerOpen) return false;                   // the list popover owns the keyboard
    if (e.key !== "Enter" && e.key !== " ") return false;
    e.preventDefault();
    if (!armed) return false;
    go();
    return true;
  });
}

// First contact with a kanji: lead with the two things you'll be held to -
// its most common meaning, and how you'd say it out loud.
function introCard(sess, item) {
  const r = S.byChar[item.k];
  const extra = senses(r).length - 1;
  setMain(`
    <div class="quiz-wrap">
      ${sessionHeader(sess)}
      <div class="quiz-card intro-card">
        <div class="q-kind">New kanji</div>
        <div class="q-prompt-kanji">${r.k}</div>
        <div class="headline-pair">
          <div class="hp-cell"><span class="hp-label">Most common meaning</span>
            <span class="hp-value">${esc(senses(r)[0] || "—")}</span></div>
          <div class="hp-cell"><span class="hp-label">Read aloud on its own</span>
            <span class="hp-value jp">${readingLine(r)}</span></div>
        </div>
        <div class="intro-rows">
          <dl class="kv">
            <dt>On</dt><dd class="jp">${r.on.join("、") || "—"}</dd>
            <dt>Kun</dt><dd class="jp">${r.kun.join("、") || "—"}</dd>
            <dt>Rank</dt><dd>#${r.freq || "—"} most frequent</dd>
          </dl>
          ${vocabBlock(r.k)}
          ${noteFor(r.k)}
          ${extra > 0 ? `<p class="later-note">${extra} further meaning${extra === 1 ? "" : "s"}
            (${esc(senses(r).slice(1, 4).join(", "))}${senses(r).length > 4 ? ", …" : ""})
            — you'll meet ${extra === 1 ? "it" : "them"} once this one sticks.</p>` : ""}
        </div>
        <div class="fb-tools">${listBtn(r.k)}</div>
        <button class="primary-btn" id="cont">Got it →</button>
        <div class="continue-hint">Enter ↵</div>
      </div>
    </div>`);
  advanceOn(sess, "#cont");
  bindListButtons($("#main"));
}

// A kanji you already know, coming back with another meaning. This card is the
// visible payoff of the sense ladder, so it says plainly why it turned up now.
function senseIntroCard(sess, item) {
  const r = S.byChar[item.k];
  const idx = SENSE_INDEX[item.facet];
  setMain(`
    <div class="quiz-wrap">
      ${sessionHeader(sess)}
      <div class="quiz-card intro-card">
        <div class="q-kind">A new meaning for a kanji you know</div>
        <div class="q-prompt-kanji">${r.k}</div>
        <p class="sense-why">You've got “<b>${esc(senses(r)[0])}</b>” down.
          ${r.k} also carries a ${SENSE_ORDINAL[idx]} meaning:</p>
        <div class="headline-pair">
          <div class="hp-cell wide"><span class="hp-label">${SENSE_ORDINAL[idx]} meaning</span>
            <span class="hp-value">${esc(senses(r)[idx] || "—")}</span></div>
        </div>
        ${senseLadder(r, idx + 1)}
        <button class="primary-btn" id="cont" style="margin-top:16px">Got it →</button>
        <div class="continue-hint">Enter ↵</div>
      </div>
    </div>`);
  advanceOn(sess, "#cont");
}

let keyHandler = null;
function keyOnce(fn) {
  if (keyHandler) document.removeEventListener("keydown", keyHandler);
  keyHandler = (e) => {
    if (e.target.tagName === "INPUT" && e.key !== "Enter") return;
    if (fn(e)) { document.removeEventListener("keydown", keyHandler); keyHandler = null; }
  };
  document.addEventListener("keydown", keyHandler);
}

const MODE_LABEL = {
  "mc-meaning": "What is its most common meaning?",
  "mc-kanji": "Which kanji means…",
  "mc-reading": "Read it aloud — which reading?",
  "type-meaning": "Type its most common meaning",
  "type-reading": "Type how you'd read it aloud (romaji ok)",
};
const FACET_TAG = { meaning: "meaning", reading: "reading aloud",
                    sense2: "meaning 2", sense3: "meaning 3" };

function modeLabel(q) {
  if (!isSenseFacet(q.facet)) return MODE_LABEL[q.mode];
  const n = SENSE_ORDINAL[q.senseIdx] || "next";
  return q.mode === "type-meaning" ? `Type its ${n} meaning` : `Which is its ${n} meaning?`;
}

function quizCard(sess, item) {
  const q = buildQuestion(item);
  const t0 = Date.now();
  const cls = isSenseFacet(item.facet) ? "meaning" : item.facet;
  const facetTag = `<span class="facet-${cls}">${FACET_TAG[item.facet] || item.facet}</span>`;
  // On a sense card, name what they already know so the question is unambiguous.
  const known = isSenseFacet(item.facet)
    ? `<div class="sense-known">You already know <b>${q.row.k}</b> =
         ${knownSenses(q.row, q.senseIdx).map((m) => `“${esc(m)}”`).join(", ")}.
         It has another meaning.</div>` : "";
  let inner = "";
  if (q.mode === "mc-kanji") {
    inner = `<div class="q-prompt-text">${esc(senses(q.row)[0])}</div>
      <div class="choices">${q.choices.map((c, i) => `<button class="choice jp" data-c="${esc(c)}"${fontStyle(q.font)}><span class="key-hint">${i + 1}</span>${c}</button>`).join("")}</div>`;
  } else if (q.mode === "mc-meaning" || q.mode === "mc-reading") {
    const jp = q.mode === "mc-reading" ? "jp" : "";
    inner = `<div class="q-prompt-kanji"${fontStyle(q.font)}>${q.row.k}</div>${known}
      <div class="choices">${q.choices.map((c, i) => `<button class="choice ${jp}" data-c="${esc(c)}"><span class="key-hint">${i + 1}</span>${esc(c)}</button>`).join("")}</div>`;
  } else {
    const isReading = q.mode === "type-reading";
    inner = `<div class="q-prompt-kanji"${fontStyle(q.font)}>${q.row.k}</div>${known}
      <input class="type-input ${isReading ? "jp" : ""}" id="type-in" autocomplete="off" spellcheck="false"
             placeholder="${isReading ? "reading…" : "meaning…"}">
      ${isReading ? `<div class="kana-preview" id="kana-prev"></div>` : ""}
      <button class="primary-btn" id="type-go" style="margin-top:14px">Check ↵</button>`;
  }
  setMain(`
    <div class="quiz-wrap">
      ${sessionHeader(sess)}
      <div class="quiz-card">
        <div class="q-kind">${facetTag} · ${modeLabel(q)}</div>
        ${inner}
        <div class="q-feedback" id="feedback"></div>
      </div>
    </div>`);

  const settle = (correct, chosen, note) => {
    finishAnswer(sess, item, q, correct, chosen, Date.now() - t0, note);
  };

  if (q.choices) {
    const btns = [...document.querySelectorAll(".choice")];
    const onPick = (btn) => {
      const val = btn.dataset.c;
      const ok = val === q.answer;
      btns.forEach((b) => {
        b.disabled = true;
        if (b.dataset.c === q.answer) b.classList.add("correct");
        else if (b === btn && !ok) b.classList.add("wrong");
      });
      settle(ok, val);
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= q.choices.length && !btns[0].disabled) { onPick(btns[n - 1]); return true; }
      return false;
    });
  } else {
    const input = $("#type-in");
    input.focus();
    if (q.mode === "type-reading") {
      input.addEventListener("input", () => { $("#kana-prev").textContent = toHiragana(input.value); });
    }
    const check = () => {
      if (!input.value.trim()) return;
      input.disabled = true; $("#type-go").disabled = true;
      const g = q.mode === "type-reading"
        ? gradeReading(input.value, q.row)
        : gradeMeaning(input.value, q.row, q.facet);
      settle(g.ok, input.value, g);
    };
    $("#type-go").onclick = check;
    keyOnce((e) => {
      if (e.key !== "Enter" || e.repeat) return false;
      e.preventDefault();                       // don't let it activate anything else
      check();
      return e.target.disabled !== false;
    });
  }
}

// ---------------------------------------------------------------- shared displays

/** How many of this kanji's senses the learner has actually been taught. */
function sensesTaught(k) {
  let n = 0;
  for (const f of MEANING_FACETS) { if (srsOf(k, f)) n++; else break; }
  return Math.max(1, n);
}

/** The read-aloud reading, labelled 音読み / 訓読み. */
function readingLine(row) {
  const sp = spokenReading(row);
  if (!sp) return "—";
  return `<span class="jp">${sp.kana}</span> <span class="rk">${READING_KIND[sp.kind]}</span>`;
}

/** A note the learner wrote for this kanji, shown where it does some good. */
function noteFor(k) {
  const n = (S.settings.notes || {})[k];
  return n ? `<div class="kanji-note">${esc(n)}</div>` : "";
}

/** Numbered senses; the ones past `upto` are shown dimmed as "coming later". */
function senseLadder(row, upto) {
  if (!senses(row).length) return "—";
  return `<div class="sense-ladder">${senses(row).map((m, i) =>
    `<span class="sense-chip ${i < upto ? "on" : ""}"><i>${i + 1}</i>${esc(m)}</span>`
  ).join("")}</div>`;
}

function finishAnswer(sess, item, q, correct, chosen, ms, note) {
  const key = item.k + "|" + item.facet;
  const isFirst = !sess.firstTry.has(key);
  if (isFirst) sess.firstTry.set(key, correct);
  const affectsSrs = isFirst && item.srsDone !== true;

  sess.answered++;
  if (correct) sess.correct++; else sess.missed.add(item.k);

  // "Correct" and "demonstrated the thing this card teaches" are different:
  // a real but secondary meaning is accepted yet proves nothing about the
  // primary sense, so it must not count toward operative fluency.
  const onTargetHit = correct && !(note && note.other);
  api("/api/answer", { k: item.k, facet: item.facet, mode: q.mode, correct, ms,
                       srs: affectsSrs, on_target: onTargetHit }).catch(() => {});

  // wrong answers come back later in the session (practice only, srs already recorded)
  if (!correct) {
    const reinsert = { k: item.k, facet: item.facet, type: "again", srsDone: true };
    const at = Math.min(sess.items.length, sess.pos + 3 + Math.floor(Math.random() * 3));
    sess.items.splice(at, 0, reinsert);
  }

  const r = q.row;
  const fb = $("#feedback");
  // When the answer was a real-but-different meaning or reading, say so. A bare
  // "Not quite" would look like the app didn't recognise a correct answer; the
  // whole point of the strict grade is to teach which sense ranks first.
  let nudge = "";
  if (note && note.other && isMeaningFacet(q.facet)) {
    const want = senseText(r, q.facet);
    nudge = correct
      ? `<div class="nudge">Accepted — but its ${SENSE_ORDINAL[q.senseIdx]} meaning is “<b>${esc(want)}</b>”.</div>`
      : `<div class="nudge">“${esc(note.other)}” <i>is</i> a meaning of ${r.k} — just not this card's.
           This one tests its ${SENSE_ORDINAL[q.senseIdx]} meaning: “<b>${esc(want)}</b>”.
           ${q.senseIdx === 0 ? "You'll meet the others later, once this one sticks." : ""}</div>`;
  } else if (note && note.other && q.facet === "reading") {
    const sp = spokenReading(r);
    nudge = `<div class="nudge">“<span class="jp">${esc(note.other)}</span>” is a real reading of ${r.k}.
      Read on its own it's usually “<span class="jp">${sp.kana}</span>” (${READING_KIND[sp.kind]}).</div>`;
  }
  const want = isMeaningFacet(q.facet) ? senseText(r, q.facet)
             : q.facet === "reading" ? (spokenReading(r) || {}).kana
             : q.answer;
  const offTarget = correct && !!(note && note.other);
  const banner = correct && !offTarget ? { cls: "ok", mark: "✓", text: "Correct" }
    : offTarget ? { cls: "part", mark: "◐", text: "Accepted — but not what this card teaches" }
    : { cls: "no", mark: "✗", text: "Not quite" };

  fb.innerHTML = `
    <div class="verdict-banner ${banner.cls}">
      <span class="v-mark">${banner.mark}</span>
      <span class="v-text">${banner.text}</span>
    </div>
    ${chosen !== undefined && chosen !== null && String(chosen).trim() && !(correct && !offTarget)
      ? `<div class="you-wrote">You answered <b>${esc(String(chosen))}</b></div>` : ""}
    <div class="answer-was"><span class="jp">${r.k}</span>
      <span class="aw-arrow">→</span> <b>${esc(want || "—")}</b></div>
    ${nudge}
    <div class="detail">read aloud ${readingLine(r)}${q.font
      ? ` · shown in <span class="jp">${q.font.jp}</span> <span class="rk">${esc(q.font.en)}</span>` : ""}</div>
    ${senseLadder(r, sensesTaught(r.k))}
    ${vocabBlock(r.k, { compact: true, limit: 2 })}
    ${noteFor(r.k)}
    <div class="fb-tools">${listBtn(r.k)}</div>
    <div id="fix-slot"></div>
    <button class="primary-btn" id="next-btn" style="margin-top:12px" disabled>Continue ↵</button>`;

  // A clean hit moves on quickly; anything else asks for the right answer before
  // it lets you past, so a miss can't be skimmed over at drilling speed.
  bindListButtons($("#feedback"));
  if (correct && !offTarget) armContinue(sess, 400);
  else correctionStep(sess, q, want, offTarget);
}

/**
 * Arm the Continue action after a dwell.
 *
 * The dwell is not cosmetic. Two separate faults made feedback vanish: the
 * Continue button used to be focused *during* the Enter keydown that submitted
 * the answer, so the browser's default action activated it and skipped straight
 * past — every time, on typed cards. And key auto-repeat, or a second impatient
 * press, did the same. So: never focus it here, ignore repeats, swallow presses
 * that arrive before it is armed.
 */
function armContinue(sess, delay) {
  const btn = $("#next-btn");
  if (!btn) return;
  let armed = false, advanced = false;
  const go = () => {
    if (!armed || advanced) return;
    advanced = true;
    sess.pos++;
    nextCard(sess);
  };
  btn.onclick = go;
  setTimeout(() => {
    armed = true;
    if ($("#next-btn") === btn) btn.disabled = false;
  }, delay);
  keyOnce((e) => {
    if (e.repeat) return false;                       // auto-repeat, not a new press
    if (S.pickerOpen) return false;                   // the list popover owns the keyboard
    if (e.key !== "Enter" && e.key !== " ") return false;
    e.preventDefault();
    if (!armed) return false;                         // too soon: swallow, keep waiting
    go();
    return true;
  });
}

/**
 * Make the learner produce the right answer before moving on.
 *
 * Retrieval, not recognition: after a miss you re-answer it rather than nodding
 * at the correction. Typed questions ask for it back; multiple-choice ones ask
 * you to pick the right option, which is highlighted.
 */
function correctionStep(sess, q, want, offTarget) {
  const slot = $("#fix-slot");
  if (!slot) return armContinue(sess, 1200);
  const done = () => {
    slot.innerHTML = `<div class="fix-done">✓ That's the one.</div>`;
    armContinue(sess, 250);
    const b = $("#next-btn");
    if (b) b.textContent = "Continue ↵";
  };

  if (q.choices) {
    const btns = [...document.querySelectorAll(".choice")];
    const target = btns.find((b) => b.dataset.c === q.answer);
    if (!target) return armContinue(sess, 1200);
    slot.innerHTML = `<div class="fix-ask">Tap the right answer to carry on.</div>`;
    btns.forEach((b) => { b.disabled = b !== target; });
    target.classList.add("fix-target");
    target.disabled = false;
    target.onclick = () => {
      btns.forEach((b) => { b.disabled = true; });
      target.classList.remove("fix-target");
      done();
    };
    return;
  }

  const isReading = q.mode === "type-reading";
  slot.innerHTML = `
    <div class="fix-ask">${offTarget
      ? `Type <b>${esc(want)}</b> to lock in the meaning this card teaches.`
      : `Type <b>${esc(want)}</b> to carry on.`}</div>
    <input class="type-input fix-input ${isReading ? "jp" : ""}" id="fix-in"
           autocomplete="off" spellcheck="false" placeholder="${isReading ? "reading…" : "meaning…"}">
    ${isReading ? `<div class="kana-preview" id="fix-kana"></div>` : ""}`;
  const input = $("#fix-in");
  input.focus();
  const check = () => {
    const ok = isReading
      ? toHiragana(input.value) === want
      : glossMatches(normMeaning(input.value), want);
    if (!ok) { input.classList.add("shake"); setTimeout(() => input.classList.remove("shake"), 400); return; }
    input.disabled = true;
    done();
  };
  input.addEventListener("input", () => {
    if (isReading && $("#fix-kana")) $("#fix-kana").textContent = toHiragana(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.repeat) { e.preventDefault(); check(); }
  });
}

/**
 * End of a session.
 *
 * This screen used to lead with "Excellent session!" and a Dashboard button —
 * congratulating the learner and pointing them at the exit after a handful of
 * cards. A session is a lap, not a finish line, so it now reports what is
 * actually demonstrated, names what is still missing, and offers a *different*
 * next thing rather than the door.
 */
async function sessionDone(sess) {
  const mins = Math.max(1, Math.round((Date.now() - sess.startedAt) / 60000));
  const firstTryVals = [...sess.firstTry.values()];
  const ftCorrect = firstTryVals.filter(Boolean).length;
  const acc = firstTryVals.length ? Math.round((ftCorrect / firstTryVals.length) * 100) : 100;

  await loadState().catch(() => {});
  const st = scopeStats(sess.scope);
  const chars = scopeChars(sess.scope) || [...new Set([...S.srs.values()].map((r) => r.kanji))];
  let operative = 0, solid = 0;
  for (const k of chars) {
    const m = tierOf(k, "meaning"), rd = tierOf(k, "reading");
    if (m >= 2 && rd >= 2) operative++;
    if (m >= 3 && rd >= 3) solid++;
  }
  const remaining = Math.max(0, st.kanji - operative);
  const label = sess.scope ? scopeLabel(sess.scope) : "your rotation";

  // Vary the suggested next step so the loop doesn't feel like one button.
  const ideas = [
    { h: scopeHash(sess.scope, "drill"), t: "🎯 Drill this set", why: "same kanji, no schedule pressure" },
    { h: gameHash("match", sess.scope), t: "🀄 Match pairs", why: "same set, against the clock" },
    { h: gameHash("horde", sess.scope), t: "🧟 Kanji horde", why: "same set, if you'd rather it fought back" },
    { h: gameHash("lightning", sess.scope), t: "⚡ Lightning round", why: "same set, 60 seconds" },
    { h: "#/games", t: "🎯 Pick another game", why: "and choose the set" },
    { h: "#/path", t: "🗺️ The path", why: "meet a few new ones" },
  ];
  const picks = shuffle(ideas).slice(0, 3);

  setMain(`
    <div class="quiz-wrap session-done">
      <div class="doneK">${acc >= 80 ? "続" : "精"}</div>
      <h1>${acc >= 80 ? "Good lap" : "Session complete"}</h1>
      <p class="sub">${sess.drill ? "Drill — nothing scheduled changed." : esc(label)}</p>
      <div class="done-stats">
        <div class="tile"><div class="t-label">Cards</div><div class="t-value">${firstTryVals.length}</div></div>
        <div class="tile"><div class="t-label">First-try</div><div class="t-value">${acc}%</div></div>
        <div class="tile"><div class="t-label">Time</div><div class="t-value">${mins}m</div></div>
      </div>
      ${sess.missed.size ? `<p class="sub">Tricky this time:
        <span style="font-family:var(--jp);font-size:22px">${[...sess.missed].join(" ")}</span></p>` : ""}

      <div class="card chart-card" style="text-align:left">
        <div class="chart-title">Where ${esc(label)} actually stands</div>
        <div class="chart-sub">Counted by what you've demonstrated — produced from memory,
          in more than one kind of question, on more than one day.</div>
        <div class="hbars" style="margin-top:10px">
          ${rungBar("Operative", operative, st.kanji || 1, "Meaning and reading both demonstrated")}
          ${rungBar("Solid", solid, st.kanji || 1, "Every question type, across several days")}
        </div>
        <p class="sub" style="margin:10px 0 0">${remaining
          ? `<b>${remaining}</b> of ${st.kanji} still need more evidence. Seeing them again
             on another day, and typing them rather than picking from four, is what moves them.`
          : `Every kanji here is operative. Keep them alive — solid takes every question
             type across several days.`}</p>
      </div>

      <p class="sub" style="margin-bottom:4px">Keep going, differently:</p>
      <div class="next-up">
        ${picks.map((p) => `<button class="ghost-btn" onclick="location.hash='${p.h}'">
            ${p.t} <span style="color:var(--muted);font-size:12px">· ${p.why}</span></button>`).join("")}
      </div>
      <div class="row" style="justify-content:center;margin-top:14px">
        <button class="primary-btn" id="again-btn">${sess.drill ? "Drill again" : "Review more"}</button>
        <button class="ghost-btn" onclick="location.hash='#/review'">Review hub</button>
        <button class="ghost-btn" onclick="location.hash='#/';location.reload()">Dashboard</button>
      </div>
    </div>`);
  // stay in the same scope rather than dropping back to everything
  $("#again-btn").onclick = () => {
    const suffix = scopeSuffix(sess.scope);
    if (sess.drill) return routes.drill(suffix);
    routes.review(suffix);
  };
  bindTips($("#main"));
}
