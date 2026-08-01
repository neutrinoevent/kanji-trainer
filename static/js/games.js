/* Kanji Trainer — the eight games.
   Plain script, no bundler and no module system: index.html loads these in
   dependency order. See static/js/README.md for the layout. */
"use strict";

// ================================================================ games

/**
 * Compound reading drill.
 *
 * Sits with the games rather than in review because it is practice, not
 * assessment: it does not touch the schedule, and it asks about something the
 * SRS deliberately doesn't track. Answers are logged as evidence in their own
 * mode name so they show in stats without polluting the fluency bar, which is
 * built around the standalone reading.
 */
function compoundGame(sc) {
  const pool = gamePool(sc).filter((r) => compoundReadable(r.k));
  if (!pool.length) {
    const inScope = gamePool(sc).length;
    setMain(`
      <h1>Compound readings</h1>
      ${gameScopeBar(sc)}
      <div class="card" style="text-align:center;padding:38px 22px">
        <h2 style="margin-top:0">No example words for this set yet</h2>
        <p class="sub">This drill needs kanji with example words showing more than one
          reading. ${inScope
            ? `None of the ${inScope} kanji you've started in <b>${esc(scopeLabel(sc))}</b> have them yet —
               the word list covers the more common kanji first.`
            : "Start a batch first."}</p>
        <div class="row" style="justify-content:center">
          <button class="primary-btn" onclick="location.hash='${gameHash("compound", null)}'">Try everything</button>
          <button class="ghost-btn" onclick="location.hash='#/games'">Other games</button>
        </div>
      </div>`);
    return;
  }
  const TOTAL = 10;
  let round = 0, score = 0;

  const ask = () => {
    if (!document.getElementById("cr-box")) return;
    if (round === TOTAL) {
      $("#cr-box").innerHTML = `
        <div class="q-kind">Done</div>
        <div class="q-prompt-text">${score} / ${TOTAL}</div>
        <p class="sub" style="margin:6px 0 14px">Readings shift inside words. Knowing which
          one a compound takes is the difference between recognising a kanji and reading it.</p>
        <div class="row" style="justify-content:center">
          <button class="primary-btn" id="cr-again">Again</button>
          <button class="ghost-btn" onclick="location.hash='#/games'">Done</button>
        </div>`;
      $("#cr-again").onclick = () => compoundGame(sc);
      return;
    }
    const q = buildCompoundQuestion(pick(pool).k);
    if (!q) { round++; return ask(); }
    $("#cr-round").textContent = `${round + 1} / ${TOTAL}`;
    $("#cr-score").textContent = score;
    const marked = Array.from(q.word).map((c) =>
      c === q.k ? `<b class="cr-target">${c}</b>` : esc(c)).join("");
    $("#cr-box").innerHTML = `
      <div class="q-kind">How is <span class="jp">${q.k}</span> read in this word?</div>
      <div class="cr-word jp">${marked}</div>
      <div class="cr-gloss">${esc(q.meaning)}</div>
      <div class="choices">${q.choices.map((c, i) =>
        `<button class="choice jp" data-c="${esc(c)}"><span class="key-hint">${i + 1}</span>${esc(c)}</button>`).join("")}
      </div>
      <div class="q-feedback" id="cr-fb"></div>`;
    const btns = [...document.querySelectorAll("#cr-box .choice")];
    const onPick = (btn) => {
      const ok = btn.dataset.c === q.answer;
      if (ok) score++;
      gameLog(q.k, "reading", "compound", ok);
      btns.forEach((b) => {
        b.disabled = true;
        if (b.dataset.c === q.answer) b.classList.add("correct");
        else if (b === btn && !ok) b.classList.add("wrong");
      });
      $("#cr-fb").innerHTML = `
        <div class="verdict-banner ${ok ? "ok" : "no"}">
          <span class="v-mark">${ok ? "✓" : "✗"}</span>
          <span class="v-text">${esc(q.word)} is <span class="jp">${esc(q.wordReading)}</span></span>
        </div>
        <div class="detail"><span class="jp">${q.k}</span> is
          <span class="jp">${esc(q.answer)}</span> here —
          ${q.kind === "on" ? "its 音読み, the Chinese-derived reading"
            : "its 訓読み, the native Japanese reading"}.</div>
        ${q.others.length ? `<div class="cr-others">
          <div class="vocab-title">Elsewhere</div>
          ${q.others.slice(0, 3).map((v) => `
            <div class="vocab-row">
              <span class="vw jp">${Array.from(v.w).map((c) =>
                c === q.k ? `<b class="vw-k">${c}</b>` : esc(c)).join("")}</span>
              <span class="vr jp">${esc(v.r)}</span>
              <span class="vm">${esc(v.m)}</span>
              <span class="vk">${v.kr ? esc(v.kr) : "—"}</span>
            </div>`).join("")}
        </div>` : ""}`;
      round++;
      setTimeout(ask, ok ? 1500 : 2600);
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => {
      if (e.repeat) return false;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= btns.length && !btns[0].disabled) { onPick(btns[n - 1]); return true; }
      return false;
    });
  };

  setMain(`
    <h1>Compound readings</h1>
    ${gameScopeBar(sc)}
    <div class="lightning-hud">
      <span>Round <b id="cr-round">1 / ${TOTAL}</b></span>
      <span>Correct <b id="cr-score">0</b></span>
    </div>
    <div class="quiz-wrap"><div class="quiz-card" id="cr-box"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px">
      <button class="ghost-btn" onclick="location.hash='#/games'">Quit</button>
    </div>`);
  ask();
}

const GAME_LAUNCHERS = {
  match: (sc) => matchGame("meaning", { scope: sc }),
  reading: (sc) => matchGame("reading", { scope: sc }),
  memory: (sc) => memoryGame(sc),
  odd: (sc) => oddOneOutGame(sc),
  snap: (sc) => snapGame(sc),
  lightning: (sc) => lightningGame(sc),
  survival: (sc) => survivalGame(sc),
  horde: (sc) => hordeGame(sc),
  compound: (sc) => compoundGame(sc),
};
const GAME_TITLES = {
  match: "Match pairs", reading: "Reading pairs", memory: "Memory flip",
  odd: "Odd one out", snap: "Snap judgment", lightning: "Lightning round",
  survival: "Survival", horde: "Kanji horde", compound: "Compound readings",
};

const GAME_CARDS = [
  ["match", "🀄 Match pairs", "Match kanji to meanings against the clock. 6 pairs per round.", 6],
  ["reading", "🔊 Reading pairs", "Same idea, but match each kanji to one of its readings.", 6],
  ["memory", "🎴 Memory flip", "Twelve face-down cards. Find the kanji and meaning pairs from memory.", 6],
  ["odd", "🕵️ Odd one out", "Three of the four kanji share an on-reading. Find the one that sounds different.", 40],
  ["snap", "👍 Snap judgment", "45 seconds of true or false: does this meaning belong to this kanji?", 4],
  ["lightning", "⚡ Lightning round", "60 seconds. As many correct answers as you can. Streaks count.", 4],
  ["survival", "❤️ Survival", "Three lives, no timer. Questions get harder as you go.", 4],
  ["horde", "🧟 Kanji horde", "Zombies shamble toward your gate. Each correct answer cuts down the closest one.", 4],
  ["compound", "🧩 Compound readings", "日 is ひ alone but に in 日本. Given a real word, pick how the kanji is read inside it.", 1],
];

routes.games = async (arg) => {
  await loadState();
  await loadCollections();
  // #/games/<id>[/all | /c/<cid>[/<from>-<to>]] — the scope rides in the hash so
  // Quit/Done and Play-again keep the set the learner chose.
  const parts = (arg || "").split("/").filter(Boolean);
  const id = parts[0];
  if (id && GAME_LAUNCHERS[id]) {
    S.lastGameId = id;
    // A bare #/games/<id> inherits the set they were last studying, which is
    // what "try a game" right after a batch session should obviously mean.
    const rest = parts.slice(1).join("/");
    const sc = rest ? (rest === "all" ? null : parseScope(rest))
                    : parseScope(S.settings.review_scope || "all");
    return GAME_LAUNCHERS[id](sc);
  }

  const sc = parseScope(S.settings.review_scope || "all");
  const pool = gamePool(sc);
  const allPool = gamePool(null);
  const opts = [{ sc: null, label: "Everything in rotation", n: allPool.length }];
  const seen = new Set(["all"]);
  for (const g of (S.settings.goals || [])) {
    const gs = goalScope(g);
    if (S.colById?.[g.collection] && !seen.has(scopeSuffix(gs))) {
      seen.add(scopeSuffix(gs));
      opts.push({ sc: gs, label: "Goal · " + scopeLabel(gs), n: gamePool(gs).length });
    }
  }
  for (const l of lists()) {
    if (!listKanji(l).length) continue;
    const cand = { list: l.id };
    if (seen.has(scopeSuffix(cand))) continue;
    seen.add(scopeSuffix(cand));
    opts.push({ sc: cand, label: "List · " + l.name, n: gamePool(cand).length });
  }
  const act = activeScopes(false);
  for (const a of act.list) {
    for (const cand of [{ cid: a.col.id, from: null, to: null },
                        ...a.batches.slice(0, 4).map((b) => ({ cid: a.col.id, from: b.index, to: b.index }))]) {
      if (seen.has(scopeSuffix(cand))) continue;
      seen.add(scopeSuffix(cand));
      opts.push({ sc: cand, label: scopeLabel(cand), n: gamePool(cand).length });
    }
  }
  const cur = scopeSuffix(sc);

  setMain(`
    <h1>Games</h1>
    <p class="sub">Extra practice. Games don't affect your review schedule, but results
      count in your stats. Pick the set first — a game only ever asks about kanji from it.</p>

    <div class="card">
      <div class="chart-title">Which kanji?</div>
      <div class="chart-sub">Currently: <b>${esc(scopeLabel(sc))}</b> — ${pool.length} kanji you've started.</div>
      <div class="scope-chips">
        ${opts.map((o) => `<button class="chip ${scopeSuffix(o.sc) === cur ? "on" : ""}"
            data-scope="${scopeSuffix(o.sc)}">${esc(o.label)}
            <span class="chip-n">${o.n}</span></button>`).join("")}
      </div>
    </div>

    <div class="game-cards">
      ${GAME_CARDS.map(([gid, title, desc, need]) => {
        const thin = pool.length < need;
        return `<div class="game-card ${thin ? "thin" : ""}" data-game="${gid}">
          <h3>${title}</h3><p>${esc(desc)}</p>
          ${thin ? `<p class="game-warn">Needs ${need}+ kanji from this set — you have ${pool.length}.
            Opens with everything instead.</p>` : ""}
        </div>`;
      }).join("")}
    </div>`);

  document.querySelectorAll(".chip").forEach((el) => {
    el.onclick = async () => {
      await api("/api/settings", { review_scope: el.dataset.scope }).catch(() => {});
      S.settings.review_scope = el.dataset.scope;
      routes.games();
    };
  });
  document.querySelectorAll(".game-card").forEach((el) => {
    el.onclick = () => {
      const gid = el.dataset.game;
      const need = (GAME_CARDS.find((g) => g[0] === gid) || [])[3] || 4;
      location.hash = gameHash(gid, pool.length < need ? null : sc);
    };
  });
};

// Everything that quizzes "the reading" targets the read-aloud reading.
function primaryReading(r) {
  const sp = spokenReading(r);
  return sp ? sp.kana : "";
}
function gameLog(k, facet, mode, correct) {
  api("/api/answer", { k, facet, mode, correct, srs: false }).catch(() => {});
}
// interval that stops itself once its HUD element leaves the DOM (user navigated away)
function gameTimer(fn, probeId) {
  const t = setInterval(() => {
    if (!document.getElementById(probeId)) { clearInterval(t); return; }
    fn(t);
  }, 1000);
  return t;
}

// ---------------------------------------------------------------- match pairs

function matchGame(kind, opts = {}) {
  const sc = opts.scope !== undefined ? opts.scope : null;
  const base = opts.pool || gamePool(sc);
  const source = kind === "reading" ? base.filter((r) => primaryReading(r)) : base;
  const title = opts.title || (kind === "reading" ? "Reading pairs" : "Match pairs");
  if (!opts.pool && tooFewForGame(sc, source, 6, title,
      kind === "reading" ? "Reading pairs also needs each kanji to have a standalone reading." : "")) return;
  const pool = shuffle(source).slice(0, 6);
  const tiles = shuffle([
    ...pool.map((r) => ({ id: r.k, kind: "k", text: r.k })),
    ...pool.map((r) => ({ id: r.k, kind: "m", text: kind === "reading" ? primaryReading(r) : senses(r)[0] })),
  ]);
  const t0 = Date.now();
  let solved = 0, misses = 0, sel = null;
  setMain(`
    <h1>${title}</h1>
    ${opts.pool ? "" : gameScopeBar(sc)}
    <p class="sub" id="match-status">Match each kanji with its ${kind === "reading" ? "reading" : "meaning"}.</p>
    <div class="match-grid">
      ${tiles.map((t, i) => `<button class="match-tile ${t.kind === "k" || kind === "reading" ? "jp" : ""}" data-i="${i}"${t.kind === "k" ? fontStyle(pickFont()) : ""}>${esc(t.text)}</button>`).join("")}
    </div>
    <div class="row" style="justify-content:center"><button class="ghost-btn" onclick="location.hash='${opts.backHash || "#/games"}'">← Back</button></div>`);
  const els = [...document.querySelectorAll(".match-tile")];
  els.forEach((el) => (el.onclick = () => {
    const t = tiles[+el.dataset.i];
    if (sel && sel.el === el) { el.classList.remove("sel"); sel = null; return; }
    if (!sel) { sel = { t, el }; el.classList.add("sel"); return; }
    if (sel.t.id === t.id && sel.t.kind !== t.kind) {
      [sel.el, el].forEach((x) => { x.classList.remove("sel"); x.classList.add("done"); });
      gameLog(t.id, kind, "match-" + kind, true);
      solved++;
      if (solved === 6) {
        const secs = Math.round((Date.now() - t0) / 1000);
        if (opts.onDone) return opts.onDone({ secs, misses });
        $("#match-status").innerHTML = `<b style="color:var(--good)">Cleared in ${secs}s with ${misses} miss${misses === 1 ? "" : "es"}!</b> &nbsp;<button class="ghost-btn" id="match-again">Play again</button>`;
        $("#match-again").onclick = () => matchGame(kind, { scope: sc });
      }
    } else {
      misses++;
      const kanjiTile = sel.t.kind === "k" ? sel.t : t;
      gameLog(kanjiTile.id, kind, "match-" + kind, false);
      const a = sel.el; a.classList.remove("sel");
      [a, el].forEach((x) => x.classList.add("miss"));
      setTimeout(() => [a, el].forEach((x) => x.classList.remove("miss")), 400);
    }
    sel = null;
  }));
}

// ---------------------------------------------------------------- memory flip

function memoryGame(sc) {
  const base = gamePool(sc);
  if (tooFewForGame(sc, base, 6, "Memory flip")) return;
  const pool = shuffle(base).slice(0, 6);
  const tiles = shuffle([
    ...pool.map((r) => ({ id: r.k, kind: "k", text: r.k })),
    ...pool.map((r) => ({ id: r.k, kind: "m", text: senses(r)[0] })),
  ]);
  let first = null, lock = false, flips = 0, solved = 0;
  setMain(`
    <h1>Memory flip</h1>
    ${gameScopeBar(sc)}
    <p class="sub" id="mem-status">All cards are face down. Find the kanji and meaning pairs.</p>
    <div class="match-grid">
      ${tiles.map((t, i) => `<button class="match-tile facedown" data-i="${i}">?</button>`).join("")}
    </div>
    <div class="row" style="justify-content:center"><button class="ghost-btn" onclick="location.hash='#/games'">← Games</button></div>`);
  const els = [...document.querySelectorAll(".match-tile")];
  const show = (el, t) => { el.textContent = t.text; el.classList.remove("facedown"); el.classList.toggle("jp", t.kind === "k"); };
  const hide = (el) => { el.textContent = "?"; el.classList.add("facedown"); el.classList.remove("jp"); };
  els.forEach((el) => (el.onclick = () => {
    if (lock || el.classList.contains("done") || (first && first.el === el)) return;
    const t = tiles[+el.dataset.i];
    show(el, t);
    if (!first) { first = { t, el }; return; }
    flips++;
    if (first.t.id === t.id && first.t.kind !== t.kind) {
      [first.el, el].forEach((x) => x.classList.add("done"));
      gameLog(t.id, "meaning", "memory", true);
      solved++;
      first = null;
      if (solved === 6) {
        $("#mem-status").innerHTML = `<b style="color:var(--good)">Cleared in ${flips} flips!</b> (perfect is 6) &nbsp;<button class="ghost-btn" id="mem-again">Play again</button>`;
        $("#mem-again").onclick = () => memoryGame(sc);
      }
    } else {
      lock = true;
      const a = first.el;
      first = null;
      setTimeout(() => { hide(a); hide(el); lock = false; }, 750);
    }
  }));
}

// ---------------------------------------------------------------- odd one out

function buildOddRound(pool) {
  // group by cleaned on-reading; need a reading shared by >=3 kanji
  const groups = {};
  for (const r of pool) {
    for (const raw of r.on) {
      const rd = raw.replace(/[-.]/g, "");
      if (rd) (groups[rd] = groups[rd] || []).push(r);
    }
  }
  const shared = Object.entries(groups).filter(([, v]) => v.length >= 3);
  if (!shared.length) return null;
  const [reading, members] = pick(shared);
  const trio = shuffle(members).slice(0, 3);
  const hasReading = (r) => r.on.some((x) => x.replace(/[-.]/g, "") === reading);
  const odd = pick(pool.filter((r) => !hasReading(r) && !trio.includes(r)));
  if (!odd) return null;
  return { reading, trio, odd, options: shuffle([...trio, odd]) };
}

function oddOneOutGame(sc) {
  // This game needs three kanji sharing an on-reading, which a single batch
  // almost never contains — so it asks rather than silently widening the net.
  const pool = gamePool(sc);
  if (tooFewForGame(sc, pool, 40, "Odd one out",
      "It has to find three kanji that share an on-reading, which needs a wide set.")) return;
  const TOTAL = 10;
  let round = 0, score = 0;
  const ask = () => {
    if (!document.getElementById("odd-box")) return;
    if (round === TOTAL) {
      $("#odd-box").innerHTML = `
        <div class="q-kind">Done!</div>
        <div class="q-prompt-text">${score} / ${TOTAL}</div>
        <div class="row" style="justify-content:center">
          <button class="primary-btn" id="odd-again">Again</button>
          <button class="ghost-btn" onclick="location.hash='#/games'">Done</button>
        </div>`;
      $("#odd-again").onclick = () => oddOneOutGame(sc);
      return;
    }
    const r = buildOddRound(pool);
    const of_ = pickFont();
    if (!r) { $("#odd-box").innerHTML = `<div class="q-prompt-text">Not enough shared readings to play yet.</div>`; return; }
    $("#odd-round").textContent = `${round + 1} / ${TOTAL}`;
    $("#odd-box").innerHTML = `
      <div class="q-kind">Which kanji sounds different?</div>
      <p style="margin:0;color:var(--ink-2);font-size:14px">Three of these four share the same on-reading (the Chinese-derived pronunciation). Pick the one that is <b>not</b> read that way.</p>
      <div class="choices choices-4">${r.options.map((o, i) =>
        `<button class="choice jp" data-k="${o.k}"${fontStyle(of_)}><span class="key-hint">${i + 1}</span>${o.k}</button>`).join("")}
      </div>
      <div class="q-feedback" id="odd-fb"></div>`;
    const btns = [...document.querySelectorAll("#odd-box .choice")];
    const onPick = (btn) => {
      const ok = btn.dataset.k === r.odd.k;
      if (ok) score++;
      gameLog(r.odd.k, "reading", "odd-one-out", ok);
      btns.forEach((b) => {
        b.disabled = true;
        if (b.dataset.k === r.odd.k) b.classList.add("correct");
        else if (b === btn && !ok) b.classList.add("wrong");
      });
      const oddRow = r.odd;
      const oddOn = oddRow.on.map((x) => x.replace(/[-.]/g, "")).filter(Boolean);
      $("#odd-fb").innerHTML = `
        <div class="verdict ${ok ? "ok" : "no"}">${ok ? "Correct!" : "Not quite"}</div>
        <div class="detail"><span class="jp">${r.trio.map((t) => t.k).join("・")}</span> are all read <span class="jp">${r.reading}</span>.
          The odd one was <span class="jp">${oddRow.k}</span> (${esc(senses(oddRow)[0])}), read <span class="jp">${oddOn.join("・") || primaryReading(oddRow) || "—"}</span>.</div>`;
      round++;
      setTimeout(ask, 1900);
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 4 && !btns[0].disabled) { onPick(btns[n - 1]); return true; } return false; });
  };
  setMain(`
    <h1>Odd one out</h1>
    ${gameScopeBar(sc)}
    <div class="lightning-hud"><span>Round <b id="odd-round">1 / ${TOTAL}</b></span></div>
    <div class="quiz-wrap"><div class="quiz-card" id="odd-box"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="ghost-btn" onclick="location.hash='#/games'">Quit</button></div>`);
  ask();
}

// ---------------------------------------------------------------- snap judgment

function snapGame(sc) {
  const pool = gamePool(sc);
  if (tooFewForGame(sc, pool, 4, "Snap judgment")) return;
  let score = 0, streak = 0, best = 0, timeLeft = 45, alive = true;
  const ask = () => {
    if (!alive || !document.getElementById("snap-box")) return;
    const row = pick(pool);
    const truth = Math.random() < 0.5;
    const shown = truth ? pick(senses(row)) : (pickMeaningDistractors(row, 1)[0] || senses(row)[0]);
    const isMatch = truth || row.meanings.some((m) => m.toLowerCase() === shown.toLowerCase());
    const sf = pickFont();
    $("#snap-box").innerHTML = `
      <div class="q-prompt-kanji" style="font-size:76px${sf ? `;font-family:'${sf.family}',var(--jp)` : ""}">${row.k}</div>
      <div class="q-prompt-text" style="padding:8px 0 0">${esc(shown)}</div>
      <div class="choices">
        <button class="choice" data-v="1"><span class="key-hint">1</span>✓ Match</button>
        <button class="choice" data-v="0"><span class="key-hint">2</span>✗ No match</button>
      </div>`;
    const btns = [...document.querySelectorAll("#snap-box .choice")];
    const onPick = (btn) => {
      if (!alive) return;
      const saidMatch = btn.dataset.v === "1";
      const ok = saidMatch === isMatch;
      gameLog(row.k, "meaning", "snap", ok);
      if (ok) { score++; streak++; best = Math.max(best, streak); ask(); }
      else {
        streak = 0;
        btns.forEach((b) => { b.disabled = true; if ((b.dataset.v === "1") === isMatch) b.classList.add("correct"); });
        btn.classList.add("wrong");
        setTimeout(ask, 650);
      }
      updateHud();
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => { const n = parseInt(e.key, 10); if ((n === 1 || n === 2) && !btns[0].disabled) { onPick(btns[n - 1]); return true; } return false; });
  };
  const updateHud = () => {
    const t = $("#snap-time"); if (!t) return;
    t.textContent = timeLeft;
    $("#snap-score").textContent = score;
    $("#snap-streak").textContent = streak;
  };
  setMain(`
    <h1>Snap judgment</h1>
    ${gameScopeBar(sc)}
    <div class="lightning-hud">
      <span>⏱ <b id="snap-time">45</b>s</span><span>Score <b id="snap-score">0</b></span><span>Streak <b id="snap-streak">0</b></span>
    </div>
    <div class="quiz-wrap"><div class="quiz-card" id="snap-box"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="ghost-btn" onclick="location.hash='#/games'">Quit</button></div>`);
  gameTimer((t) => {
    timeLeft--;
    if (timeLeft <= 0) {
      alive = false; clearInterval(t);
      $("#snap-box").innerHTML = `
        <div class="q-kind">Time!</div>
        <div class="q-prompt-text">${score} correct · best streak ${best}</div>
        <div class="row" style="justify-content:center">
          <button class="primary-btn" id="snap-again">Again</button>
          <button class="ghost-btn" onclick="location.hash='#/games'">Done</button>
        </div>`;
      $("#snap-again").onclick = () => snapGame(sc);
    }
    updateHud();
  }, "snap-time");
  ask();
}

// ---------------------------------------------------------------- survival

function survivalGame(sc) {
  // Unscoped Survival keeps its original shape: it marches down the whole
  // frequency list and deliberately runs past what you know — that's the game.
  // Scoped, it marches down that set instead, still in frequency order.
  const list = sc ? gamePool(sc) : S.kanji;
  if (sc && tooFewForGame(sc, list, 4, "Survival")) return;
  let lives = 3, score = 0, idx = 0;
  const hearts = () => "♥".repeat(lives) + "♡".repeat(3 - lives);
  const ask = () => {
    if (!document.getElementById("sv-box")) return;
    while (idx < list.length && !senses(list[idx]).length) idx++;
    if (idx >= list.length) return end();
    const row = list[idx];
    const facet = primaryReading(row) && Math.random() < 0.4 ? "reading" : "meaning";
    let answer, choices, jp;
    if (facet === "reading") {
      answer = primaryReading(row);
      choices = shuffle([answer, ...pickReadingDistractors(row, 3)]);
      jp = "jp";
    } else {
      answer = senses(row)[0];
      choices = shuffle([answer, ...pickMeaningDistractors(row, 3)]);
      jp = "";
    }
    $("#sv-rank").textContent = sc ? `${idx + 1}/${list.length}` : "#" + (idx + 1);
    const vf = pickFont();
    $("#sv-box").innerHTML = `
      <div class="q-kind">${facet === "reading" ? "Pick a correct reading" : "What does this mean?"}</div>
      <div class="q-prompt-kanji" style="font-size:80px${vf ? `;font-family:'${vf.family}',var(--jp)` : ""}">${row.k}</div>
      <div class="choices">${choices.map((c, i) =>
        `<button class="choice ${jp}" data-c="${esc(c)}"><span class="key-hint">${i + 1}</span>${esc(c)}</button>`).join("")}
      </div>`;
    const btns = [...document.querySelectorAll("#sv-box .choice")];
    const onPick = (btn) => {
      const ok = btn.dataset.c === answer;
      gameLog(row.k, facet, "survival", ok);
      if (ok) { score++; idx++; updateHud(); ask(); return; }
      lives--;
      btns.forEach((b) => { b.disabled = true; if (b.dataset.c === answer) b.classList.add("correct"); });
      btn.classList.add("wrong");
      updateHud();
      if (lives === 0) { setTimeout(end, 900); } else { idx++; setTimeout(ask, 900); }
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= choices.length && !btns[0].disabled) { onPick(btns[n - 1]); return true; } return false; });
  };
  const updateHud = () => {
    const h = $("#sv-lives"); if (!h) return;
    h.textContent = hearts();
    $("#sv-score").textContent = score;
  };
  const end = () => {
    if (!document.getElementById("sv-box")) return;
    $("#sv-box").innerHTML = `
      <div class="q-kind">Run over</div>
      <div class="q-prompt-text">${score} correct · ${sc ? `reached ${idx + 1} of ${list.length}` : `reached rank #${idx + 1}`}</div>
      <div class="row" style="justify-content:center">
        <button class="primary-btn" id="sv-again">Again</button>
        <button class="ghost-btn" onclick="location.hash='#/games'">Done</button>
      </div>`;
    $("#sv-again").onclick = () => survivalGame(sc);
  };
  setMain(`
    <h1>Survival</h1>
    ${gameScopeBar(sc)}
    <div class="lightning-hud">
      <span style="color:var(--bad)"><b id="sv-lives">${hearts()}</b></span>
      <span>Score <b id="sv-score">0</b></span>
      <span>${sc ? "Kanji" : "Rank"} <b id="sv-rank">${sc ? "1/" + list.length : "#1"}</b></span>
    </div>
    <div class="quiz-wrap"><div class="quiz-card" id="sv-box"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="ghost-btn" onclick="location.hash='#/games'">Quit</button></div>`);
  ask();
}

function lightningGame(sc) {
  const pool = gamePool(sc);
  if (tooFewForGame(sc, pool, 4, "Lightning round")) return;
  let score = 0, streak = 0, best = 0, timeLeft = 60, alive = true;
  const ask = () => {
    if (!alive) return;
    const row = pick(pool);
    const answer = senses(row)[0];
    const choices = shuffle([answer, ...pickMeaningDistractors(row, 3)]);
    const lf = pickFont();
    $("#lq").innerHTML = `
      <div class="q-prompt-kanji"${fontStyle(lf)}>${row.k}</div>
      <div class="choices">${choices.map((c, i) => `<button class="choice" data-c="${esc(c)}"><span class="key-hint">${i + 1}</span>${esc(c)}</button>`).join("")}</div>`;
    const btns = [...document.querySelectorAll("#lq .choice")];
    const onPick = (btn) => {
      const ok = btn.dataset.c === answer;
      api("/api/answer", { k: row.k, facet: "meaning", mode: "lightning", correct: ok, srs: false }).catch(() => {});
      if (ok) { score++; streak++; best = Math.max(best, streak); }
      else { streak = 0; btns.forEach((b) => { if (b.dataset.c === answer) b.classList.add("correct"); }); btn.classList.add("wrong"); }
      updateHud();
      if (ok) ask(); else setTimeout(ask, 550);
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 4) { onPick(btns[n - 1]); return true; } return false; });
  };
  const updateHud = () => {
    const t = $("#lh-time"); if (!t) return;
    t.textContent = timeLeft;
    $("#lh-score").textContent = score;
    $("#lh-streak").textContent = streak;
  };
  setMain(`
    <h1>Lightning round</h1>
    ${gameScopeBar(sc)}
    <div class="lightning-hud">
      <span>⏱ <b id="lh-time">60</b>s</span><span>Score <b id="lh-score">0</b></span><span>Streak <b id="lh-streak">0</b></span>
    </div>
    <div class="quiz-wrap"><div class="quiz-card" id="lq"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="ghost-btn" id="lq-quit">Quit</button></div>`);
  $("#lq-quit").onclick = () => { alive = false; location.hash = "#/games"; };
  gameTimer((t) => {
    timeLeft--;
    if (timeLeft <= 0) {
      alive = false; clearInterval(t);
      $("#lq").innerHTML = `
        <div class="q-kind">Time!</div>
        <div class="q-prompt-text">${score} correct · best streak ${best}</div>
        <div class="row" style="justify-content:center">
          <button class="primary-btn" id="lq-again">Again</button>
          <button class="ghost-btn" onclick="location.hash='#/games'">Done</button>
        </div>`;
      $("#lq-again").onclick = () => lightningGame(sc);
    }
    updateHud();
  }, "lh-time");
  ask();
}

// ---------------------------------------------------------------- kanji horde

const ZOMBIE_FRAMES = [
  [
    "..GGGG..",
    ".GGGGGG.",
    ".GrGGrG.",
    ".GGGGGG.",
    "..GGGG..",
    "AA.GGG..",
    "AAGGGG..",
    "..DDDD..",
    "..DDDD..",
    "..D..D..",
    ".DD..DD.",
  ],
  [
    "..GGGG..",
    ".GGGGGG.",
    ".GrGGrG.",
    ".GGGGGG.",
    "..GGGG..",
    ".AAGGG..",
    "AAGGGG..",
    "..DDDD..",
    "..DDDD..",
    "..D.D...",
    ".DD.DD..",
  ],
];
const ZOMBIE_COLORS = { G: "#7bb661", r: "#e04444", A: "#5d9147", D: "#3f4a3a" };
const ZPX = 3; // pixel size: sprites render 24x33

function hordeGame(sc) {
  const pool = gamePool(sc);
  if (tooFewForGame(sc, pool, 4, "Kanji horde")) return;
  const W = 640, H = 176, GROUND = 150, GATE_X = 52;
  let hp = 10, kills = 0, over = false;
  const t0 = Date.now();
  let zombies = [], particles = [], gateFlash = 0;
  let lastSpawn = performance.now() - 3200, lastTick = performance.now();

  setMain(`
    <h1>Kanji horde</h1>
    ${gameScopeBar(sc)}
    <div class="lightning-hud">
      <span style="color:var(--bad)">Gate <b id="hd-hp">${"♥".repeat(hp)}</b></span>
      <span>Cut down <b id="hd-kills">0</b></span>
    </div>
    <div class="horde-stage"><canvas id="horde-canvas" width="${W}" height="${H}"></canvas></div>
    <div class="quiz-wrap"><div class="quiz-card" id="horde-q"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="ghost-btn" onclick="location.hash='#/games'">Quit</button></div>`);

  const canvas = $("#horde-canvas");
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  const drawSprite = (x, y, frame) => {
    const grid = ZOMBIE_FRAMES[frame];
    for (let r = 0; r < grid.length; r++)
      for (let c = 0; c < grid[r].length; c++) {
        const col = ZOMBIE_COLORS[grid[r][c]];
        if (col) { ctx.fillStyle = col; ctx.fillRect(x + c * ZPX, y + r * ZPX, ZPX, ZPX); }
      }
  };

  const draw = () => {
    ctx.fillStyle = css("--surface-2"); ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = css("--grid"); ctx.fillRect(0, GROUND, W, H - GROUND);       // ground
    // fort wall with brick pattern
    ctx.fillStyle = "#6e6e6e"; ctx.fillRect(8, 52, 38, GROUND - 52);
    ctx.fillStyle = "#5b5b5b";
    for (let y = 52; y < GROUND; y += 12)
      for (let x = 8 + ((y / 12) % 2) * 9; x < 42; x += 18) ctx.fillRect(x, y, 8, 5);
    ctx.fillStyle = "#4a4a4a"; ctx.fillRect(4, 44, 46, 8);                        // parapet
    ctx.fillStyle = css("--accent"); ctx.fillRect(24, 14, 4, 30);                 // flag pole
    ctx.fillRect(28, 14, 22, 16);
    ctx.fillStyle = "#fff"; ctx.font = "12px sans-serif"; ctx.fillText("守", 32, 27); // "defend"
    if (gateFlash > 0) {
      ctx.fillStyle = `rgba(224,68,68,${gateFlash * 0.5})`;
      ctx.fillRect(8, 44, 42, GROUND - 44);
    }
    for (const z of zombies) drawSprite(z.x, GROUND - 33, Math.floor(z.x / 12) % 2);
    for (const p of particles) {
      ctx.fillStyle = p.color; ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillRect(p.x, p.y, ZPX, ZPX);
    }
    ctx.globalAlpha = 1;
  };

  const poof = (x, y) => {
    for (let i = 0; i < 16; i++) {
      particles.push({
        x: x + 8, y: y + 14,
        vx: (i / 16 - 0.5) * 2.2, vy: -1.6 + (i % 4) * 0.5,
        life: 1, color: i % 3 ? "#7bb661" : "#c9d6c0",
      });
    }
  };

  const hud = () => {
    const el = $("#hd-hp"); if (!el) return;
    el.textContent = hp > 0 ? "♥".repeat(hp) : "—";
    $("#hd-kills").textContent = kills;
  };

  const loop = (now) => {
    if (!document.getElementById("horde-canvas")) return;   // navigated away
    const dt = Math.min(50, now - lastTick) / 1000;
    lastTick = now;
    if (!over) {
      const spawnEvery = Math.max(3500, 5200 - kills * 18);
      if (now - lastSpawn > spawnEvery) {
        lastSpawn = now;
        zombies.push({ x: W + 10, speed: 26 + Math.random() * 10 });
      }
      for (const z of zombies) z.x -= z.speed * dt;
      const biters = zombies.filter((z) => z.x <= GATE_X);
      if (biters.length) {
        zombies = zombies.filter((z) => z.x > GATE_X);
        hp -= biters.length; gateFlash = 1; hud();
        if (hp <= 0) { hp = 0; over = true; hud(); endScreen(); }
      }
    }
    gateFlash = Math.max(0, gateFlash - dt * 2);
    for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= dt * 1.6; }
    particles = particles.filter((p) => p.life > 0);
    draw();
    requestAnimationFrame(loop);
  };

  const endScreen = () => {
    const secs = Math.round((Date.now() - t0) / 1000);
    $("#horde-q").innerHTML = `
      <div class="q-kind">The gate has fallen</div>
      <div class="q-prompt-text">${kills} zombie${kills === 1 ? "" : "s"} cut down · held for ${Math.floor(secs / 60)}m ${secs % 60}s</div>
      <div class="row" style="justify-content:center">
        <button class="primary-btn" id="hd-again">Again</button>
        <button class="ghost-btn" onclick="location.hash='#/games'">Done</button>
      </div>`;
    $("#hd-again").onclick = () => hordeGame(sc);
  };

  const ask = () => {
    if (over || !document.getElementById("horde-q")) return;
    const row = pick(pool);
    const facet = primaryReading(row) && Math.random() < 0.4 ? "reading" : "meaning";
    const answer = facet === "reading" ? primaryReading(row) : senses(row)[0];
    const distractors = facet === "reading" ? pickReadingDistractors(row, 3) : pickMeaningDistractors(row, 3);
    const choices = shuffle([answer, ...distractors]);
    const jp = facet === "reading" ? "jp" : "";
    $("#horde-q").innerHTML = `
      <div class="horde-prompt"><span class="q-prompt-kanji" style="font-size:56px${(function(){const f=pickFont();return f?`;font-family:'${f.family}',var(--jp)`:"";})()}">${row.k}</span>
        <span class="q-kind" style="margin:0">${facet === "reading" ? "reading" : "meaning"}</span></div>
      <div class="choices">${choices.map((c, i) =>
        `<button class="choice ${jp}" data-c="${esc(c)}"><span class="key-hint">${i + 1}</span>${esc(c)}</button>`).join("")}
      </div>`;
    const btns = [...document.querySelectorAll("#horde-q .choice")];
    const onPick = (btn) => {
      if (over) return;
      const ok = btn.dataset.c === answer;
      gameLog(row.k, facet, "horde", ok);
      if (ok) {
        if (zombies.length) {
          const nearest = zombies.reduce((a, b) => (a.x < b.x ? a : b));
          poof(nearest.x, GROUND - 33);
          zombies = zombies.filter((z) => z !== nearest);
          kills++; hud();
        }
        ask();
      } else {
        if (zombies.length) zombies.reduce((a, b) => (a.x < b.x ? a : b)).x -= 30; // lurch
        btns.forEach((b) => { b.disabled = true; if (b.dataset.c === answer) b.classList.add("correct"); });
        btn.classList.add("wrong");
        setTimeout(ask, 600);
      }
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 4 && !btns[0].disabled) { onPick(btns[n - 1]); return true; } return false; });
  };

  requestAnimationFrame(loop);
  ask();
}
