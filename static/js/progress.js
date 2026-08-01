/* Kanji Trainer — badges, XP and ranks, and the learning path.
   Plain script, no bundler and no module system: index.html loads these in
   dependency order. See static/js/README.md for the layout. */
"use strict";

// ================================================================ badges

// The eight games that existed when "Jack of All Trades" was written. New games
// are deliberately NOT added here: doing so would un-earn a badge people already
// hold, and a badge is theirs once earned. New games get their own badge instead.
const GAME_MODE_IDS = ["match-meaning", "match-reading", "memory", "odd-one-out", "snap", "lightning", "survival", "horde"];
// Every mode that counts as "played something extra today".
const EXTRA_MODE_IDS = [...GAME_MODE_IDS, "compound"];

const BADGES = [
  { kanji: "初陣", name: "First Battle", desc: "Answer your first question", test: (s) => s.total_reviews >= 1 },
  { kanji: "百人斬り", name: "Hundred Cuts", desc: "100 answers", test: (s) => s.total_reviews >= 100 },
  { kanji: "千本桜", name: "Thousand Blossoms", desc: "1,000 answers", test: (s) => s.total_reviews >= 1000 },
  { kanji: "万事達成", name: "Ten Thousand Deeds", desc: "10,000 answers", test: (s) => s.total_reviews >= 10000 },
  { kanji: "三日坊主返上", name: "No Three-Day Monk", desc: "4-day streak", test: (s) => s.streak >= 4 },
  { kanji: "七転八起", name: "Fall Seven, Rise Eight", desc: "7-day streak", test: (s) => s.streak >= 7 },
  { kanji: "月光", name: "A Month of Moonlight", desc: "30-day streak", test: (s) => s.streak >= 30 },
  { kanji: "不動明王", name: "The Immovable", desc: "100-day streak", test: (s) => s.streak >= 100 },
  { kanji: "芽生え", name: "First Sprout", desc: "10 kanji learned", test: (s) => s.learned >= 10 },
  { kanji: "竹林", name: "Bamboo Grove", desc: "100 kanji learned", test: (s) => s.learned >= 100 },
  { kanji: "千字文", name: "Thousand Character Classic", desc: "1,000 kanji learned", test: (s) => s.learned >= 1000 },
  { kanji: "山の中腹", name: "Halfway Up the Mountain", desc: "Half the jōyō set learned", test: (s) => s.joyo_learned >= s.joyo_total / 2 },
  { kanji: "常用制覇", name: "Jōyō Conquest", desc: "Every jōyō kanji learned", test: (s) => s.joyo_total > 0 && s.joyo_learned >= s.joyo_total },
  { kanji: "古老の木", name: "Elder Tree", desc: "100 mature kanji (3-week+ intervals)", test: (s) => s.mature >= 100 },
  { kanji: "免許皆伝", name: "Menkyo Kaiden", desc: "90% accuracy over 500+ answers", test: (s) => s.total_reviews >= 500 && s.total_correct / s.total_reviews >= 0.9 },
  { kanji: "早起き三文", name: "Worth Three Mon", desc: "Review before 7 a.m.", test: (s) => [4, 5, 6].some((h) => s.hours?.[h] > 0) },
  { kanji: "夜桜", name: "Night Blossom", desc: "Review between midnight and 4 a.m.", test: (s) => [0, 1, 2, 3].some((h) => s.hours?.[h] > 0) },
  { kanji: "門番", name: "Gatekeeper", desc: "Defend the gate in Kanji Horde", test: (s) => (s.modes?.horde?.n || 0) >= 1 },
  { kanji: "鬼退治", name: "Oni Hunter", desc: "Cut down 100 zombies", test: (s) => (s.modes?.horde?.c || 0) >= 100 },
  { kanji: "何でも屋", name: "Jack of All Trades", desc: "Play every game mode", test: (s) => GAME_MODE_IDS.every((m) => s.modes?.[m]?.n > 0) },
  { kanji: "第一歩", name: "The First Step", desc: "Complete a path step", test: (s, px) => px.steps >= 1 },
  { kanji: "道中", name: "On the Road", desc: "25 path steps", test: (s, px) => px.steps >= 25 },
  { kanji: "百歩", name: "A Hundred Strides", desc: "100 path steps", test: (s, px) => px.steps >= 100 },
  { kanji: "星集め", name: "Star Gatherer", desc: "50 path stars", test: (s, px) => px.stars >= 50 },
  { kanji: "天の川", name: "Milky Way", desc: "300 path stars", test: (s, px) => px.stars >= 300 },
  { kanji: "完璧主義", name: "Perfectionist", desc: "10 three-star path steps", test: (s, px) => px.perfect >= 10 },
  { kanji: "関所破り", name: "Barrier Breaker", desc: "Clear 5 checkpoints", test: (s, px) => px.bosses >= 5 },
  { kanji: "宝探し", name: "Treasure Hunter", desc: "Open 5 treasure chests", test: (s, px) => px.gifts >= 5 },
  { kanji: "満開", name: "Full Bloom", desc: "Finish the first path section", test: (s, px) => px.firstSection },
  { kanji: "昇段", name: "Promotion", desc: "Reach level 10", test: (s, px) => px.level >= 10 },
  { kanji: "熟語読み", name: "Compound Reader", desc: "Answer 50 compound readings", test: (s) => (s.modes?.compound?.c || 0) >= 50 },
  { kanji: "初試験", name: "First Certification", desc: "Pass a mastery exam", test: (s, px) => px.examsPassed >= 1 },
  { kanji: "満点", name: "Full Marks", desc: "Score 100% on a mastery exam", test: (s, px) => px.examBest >= 1 },
  { kanji: "十冠", name: "Ten Crowns", desc: "Pass ten mastery exams", test: (s, px) => px.examsPassed >= 10 },
];

function badgeSection(st) {
  const px = { ...pathContext(), ...examContext(), level: levelInfo(calcXP(st)).lvl };
  const nodes = S.kanji.length ? pathNodes(null) : [];   // the original path
  const sec1 = nodes.filter((n) => n.unit < 4 && n.type !== "gift");
  px.firstSection = sec1.length > 0 && sec1.every((n) => (S.settings.path || {})[n.id] > 0);
  const earned = BADGES.filter((b) => { try { return b.test(st, px); } catch { return false; } });
  const got = new Set(earned);
  return `
    <div class="card chart-card">
      <div class="chart-title">Badges</div>
      <div class="chart-sub">${earned.length} of ${BADGES.length} earned</div>
      <div class="badge-grid">
        ${BADGES.map((b) => `
          <div class="badge-tile ${got.has(b) ? "earned" : ""}">
            <span class="b-kanji">${b.kanji}</span>
            <span class="b-name">${b.name}</span>
            <span class="b-desc">${b.desc}</span>
          </div>`).join("")}
      </div>
    </div>
    <div class="card chart-card">
      <div class="chart-title">Charm collection</div>
      <div class="chart-sub">Found in treasure chests along the path</div>
      <div class="badge-grid">
        ${CHARMS.map((c, i) => `
          <div class="badge-tile ${i < px.gifts ? "earned" : ""}">
            <span class="b-kanji" style="font-size:28px">${i < px.gifts ? c[0] : "❔"}</span>
            <span class="b-name"><span class="jp">${c[1]}</span></span>
            <span class="b-desc">${i < px.gifts ? c[2] : "Keep walking the path"}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

// ================================================================ xp, ranks, charms

const RANKS = [
  [1, "見習い", "Apprentice"], [3, "書生", "Student"], [6, "旅人", "Wanderer"],
  [10, "武者", "Warrior"], [15, "侍", "Samurai"], [21, "剣豪", "Sword Saint"],
  [28, "達人", "Master"], [36, "賢者", "Sage"], [45, "仙人", "Immortal"],
  [55, "漢字王", "Kanji King"],
];

const CHARMS = [
  ["🐱", "招き猫", "Beckoning Cat"], ["⛩️", "鳥居", "Torii Gate"],
  ["🌸", "桜", "Sakura"], ["🎎", "達磨", "Daruma"],
  ["🕊️", "折鶴", "Paper Crane"], ["🎐", "風鈴", "Wind Chime"],
  ["🏮", "提灯", "Lantern"], ["🎏", "鯉のぼり", "Koi Banner"],
  ["🗻", "富士山", "Mount Fuji"], ["🍡", "団子", "Dango"],
  ["🌊", "波", "The Great Wave"], ["🦊", "狐面", "Fox Mask"],
];

function examContext() {
  const all = Object.values(S.settings?.exams || {}).flat();
  return {
    examsPassed: all.filter((r) => r.passed).length,
    examBest: all.reduce((a, r) => Math.max(a, r.score || 0), 0),
  };
}

function pathContext() {
  const p = S.settings?.path || {};
  const entries = Object.entries(p);
  const gifts = entries.filter(([k]) => k.endsWith("-gift"));
  const steps = entries.filter(([k]) => !k.endsWith("-gift"));
  return {
    steps: steps.length,
    stars: steps.reduce((a, [, v]) => a + v, 0),
    perfect: steps.filter(([, v]) => v === 3).length,
    bosses: entries.filter(([k, v]) => k.endsWith("-boss") && v > 0).length,
    gifts: gifts.length,
  };
}

function calcXP(st) {
  const px = pathContext();
  return st.total_correct * 2 + (st.total_reviews - st.total_correct)
    + px.stars * 15 + px.gifts * 40;
}

function levelInfo(xp) {
  let lvl = 1, need = 100, rest = xp;
  while (rest >= need) { rest -= need; lvl++; need = 100 + (lvl - 1) * 60; }
  return { lvl, into: rest, need };
}

function rankFor(lvl) {
  let r = RANKS[0];
  for (const cand of RANKS) if (lvl >= cand[0]) r = cand;
  return r;
}

function levelCard(st) {
  const xp = calcXP(st);
  const { lvl, into, need } = levelInfo(xp);
  const [, rk, rname] = rankFor(lvl);
  return `
    <div class="level-card">
      <div class="rank-kanji">${rk}</div>
      <div class="level-body">
        <div><b>Level ${lvl} · ${rname}</b> <span style="color:var(--muted);font-size:13px">${xp.toLocaleString()} XP</span></div>
        <div class="meter" style="margin:7px 0 4px"><i style="width:${Math.round((into / need) * 100)}%"></i></div>
        <div class="t-sub">${into} / ${need} XP to level ${lvl + 1}</div>
      </div>
    </div>`;
}

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.innerHTML = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 350); }, 2300);
}

// ================================================================ learning path

const NODE_META = {
  learn: { icon: "📖", label: "Learn" },
  quiz: { icon: "✏️", label: "Quiz" },
  game: { icon: "🎲", label: "Match" },
  boss: { icon: "🏯", label: "Checkpoint" },
  gift: { icon: "🎁", label: "Treasure" },
};

/**
 * Node ids double as the keys under which star progress is stored, so they
 * cannot change for the path people are already walking. The original
 * frequency-ordered path keeps its bare `u0-learn` keys; every other scope gets
 * its own namespace. Each path therefore keeps separate progress, and nobody's
 * existing stars move.
 */
const pathKey = (sc, u, kind) => (sc ? `${scopeSuffix(sc)}:u${u}-${kind}` : `u${u}-${kind}`);

/** The kanji a path walks, in teaching order. */
function pathSource(sc) {
  if (!sc) return S.kanji.slice(0, Math.min(S.settings.top_n, S.kanji.length));
  return (scopeChars(sc) || []).map((k) => S.byChar[k]).filter(Boolean);
}

function pathNodes(sc) {
  const src = pathSource(sc);
  const units = Math.floor(src.length / 5);
  const nodes = [];
  for (let u = 0; u < units; u++) {
    const chars = src.slice(u * 5, u * 5 + 5);
    nodes.push({ id: pathKey(sc, u, "learn"), type: "learn", unit: u, chars });
    nodes.push({ id: pathKey(sc, u, "quiz"), type: "quiz", unit: u, chars });
    if (u % 3 === 2) {
      nodes.push({ id: pathKey(sc, u, "game"), type: "game", unit: u,
                   chars: src.slice(Math.max(0, u * 5 - 10), u * 5 + 5) });
    }
    if (u % 5 === 4) {
      nodes.push({ id: pathKey(sc, u, "boss"), type: "boss", unit: u,
                   chars: src.slice((u - 4) * 5, u * 5 + 5) });
      nodes.push({ id: pathKey(sc, u, "gift"), type: "gift", unit: u,
                   giftIndex: Math.floor(u / 5) });
    }
  }
  return nodes;
}

async function pathMark(id, stars) {
  const cur = S.settings.path || {};
  const prev = cur[id] || 0;
  cur[id] = Math.max(prev, stars);
  S.settings.path = cur;
  await api("/api/settings", { path: cur }).catch(() => {});
  if (cur[id] > prev) {
    const isGift = id.endsWith("-gift");
    const gained = isGift ? 40 : (cur[id] - prev) * 15;
    toast(`+${gained} XP${isGift ? " · treasure found!" : ` · ${"★".repeat(cur[id])}`}`);
  }
}

routes.path = async (arg) => {
  await loadState();
  await loadCollections();
  // The Path used to walk the frequency list no matter what the learner had
  // chosen to study — the same fault fixed for review (V-005) and games (V-008).
  // The scope is remembered rather than inherited from review_scope, because
  // path progress is stateful: silently switching sets would look like lost stars.
  if (arg !== undefined && arg !== "") {
    const picked = arg === "all" ? null : parseScope(arg);
    if (arg === "all" || picked) {
      S.pathScope = picked;
      const suffix = scopeSuffix(picked);
      if (S.settings.path_scope !== suffix) {
        S.settings.path_scope = suffix;
        await api("/api/settings", { path_scope: suffix }).catch(() => {});
      }
    }
  } else {
    const saved = S.settings.path_scope || "all";
    S.pathScope = saved === "all" ? null : parseScope(saved);
  }
  const sc = S.pathScope;
  const nodes = pathNodes(sc);
  if (sc && !nodes.length) {
    setMain(`
      <h1>Path · ${esc(scopeLabel(sc))}</h1>
      <div class="card" style="text-align:center;padding:38px 22px">
        <h2 style="margin-top:0">Not enough kanji for a path</h2>
        <p class="sub">A path walks five kanji at a time, so this set needs at least five.
          <b>${esc(scopeLabel(sc))}</b> has ${(scopeChars(sc) || []).length}.</p>
        <div class="row" style="justify-content:center">
          <button class="primary-btn" onclick="location.hash='#/path/all'">Walk the main path</button>
          <button class="ghost-btn" onclick="location.hash='#/lists'">Lists</button>
        </div>
      </div>`);
    return;
  }
  const done = S.settings.path || {};
  let firstOpen = nodes.findIndex((n) => !done[n.id]);
  if (firstOpen === -1) firstOpen = nodes.length;
  const doneCount = nodes.filter((n) => done[n.id]).length;

  const px = pathContext();
  const pathOpts = [{ sc: null, label: "Most common kanji" }];
  for (const l of lists()) {
    if (listKanji(l).length >= 5) pathOpts.push({ sc: { list: l.id }, label: "List · " + l.name });
  }
  for (const a of activeScopes(false).list) {
    pathOpts.push({ sc: { cid: a.col.id, from: null, to: null }, label: a.col.name });
    for (const b of a.batches.slice(0, 4)) {
      pathOpts.push({ sc: { cid: a.col.id, from: b.index, to: b.index },
                      label: `${a.col.name} · Batch ${b.index + 1}` });
    }
  }
  const curScope = scopeSuffix(sc);

  let html = `
    <h1>Path</h1>
    <p class="sub">A guided road ${sc ? `through <b>${esc(scopeLabel(sc))}</b>` : "through the most common kanji"},
      five at a time: learn them, quiz them, and clear a checkpoint every few steps.
      ${doneCount} of ${nodes.length} steps done.</p>
    ${pathOpts.length > 1 ? `<div class="card" style="margin-bottom:14px">
      <div class="chart-title">Which kanji does this path walk?</div>
      <div class="chart-sub">Each set keeps its own stars, so switching never loses progress.</div>
      <div class="scope-chips">${pathOpts.map((o) => `
        <button class="chip ${scopeSuffix(o.sc) === curScope ? "on" : ""}"
          onclick="location.hash='#/path/${scopeSuffix(o.sc)}'">${esc(o.label)}</button>`).join("")}
      </div></div>` : ""}
    <div class="row" style="margin-bottom:8px">
      <span class="pill">★ ${px.stars} stars</span>
      <span class="pill">🏯 ${px.bosses} checkpoints</span>
      <span class="pill">🎁 ${px.gifts} charms</span>
    </div>
    <div class="path-wrap">`;
  nodes.forEach((n, i) => {
    if (n.type === "learn" && n.unit % 4 === 0) {
      const total = pathSource(sc).length;
      html += `<div class="path-section"><span class="pill">${sc ? "" : "Kanji "}#${
        n.unit * 5 + 1}–${Math.min((n.unit + 4) * 5, total)}${
        sc ? ` of ${esc(scopeLabel(sc))}` : ""}</span></div>`;
    }
    const stars = done[n.id] || 0;
    const state = stars ? "done" : i === firstOpen ? "current" : i < firstOpen ? "done" : "locked";
    const offset = Math.round(Math.sin(i * 0.85) * 95);
    const label = n.type === "learn" ? n.chars.map((r) => r.k).join("")
      : n.type === "gift" && stars ? `${CHARMS[n.giftIndex % CHARMS.length][0]} ${CHARMS[n.giftIndex % CHARMS.length][2]}`
      : NODE_META[n.type].label;
    html += `
      <div class="path-row">
        <div class="path-step" style="transform:translateX(${offset}px)">
          <button class="path-node ${n.type} ${state}" data-i="${i}" ${state === "locked" ? "disabled" : ""}
                  title="${NODE_META[n.type].label}">${state === "locked" ? "🔒" : NODE_META[n.type].icon}</button>
          <span class="path-stars">${n.type === "gift" ? "" : stars ? "★".repeat(stars) : ""}</span>
          <span class="path-label ${n.type === "learn" ? "jp" : ""}">${label}</span>
        </div>
      </div>`;
  });
  html += `</div>`;
  setMain(html);
  document.querySelectorAll(".path-node:not(:disabled)").forEach((el) => {
    el.onclick = () => {
      const n = nodes[+el.dataset.i];
      if (n.type === "learn") pathLearn(n);
      else if (n.type === "quiz") pathQuiz(n, false);
      else if (n.type === "boss") pathQuiz(n, true);
      else if (n.type === "gift") pathGift(n);
      else pathGame(n);
    };
  });
  const cur = document.querySelector(".path-node.current");
  if (cur) cur.scrollIntoView({ block: "center" });
};

function pathLearn(node) {
  let i = 0;
  const show = () => {
    if (!document.getElementById("main")) return;
    const r = node.chars[i];
    setMain(`
      <div class="quiz-wrap">
        <div class="quiz-top"><span>New kanji ${i + 1} / ${node.chars.length}</span>
          <div class="meter q-progress"><i style="width:${(i / node.chars.length) * 100}%"></i></div>
          <button class="ghost-btn" id="p-back" style="padding:4px 10px;font-size:12px">← Path</button></div>
        <div class="quiz-card intro-card">
          <div class="q-kind">Meet this kanji</div>
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
              <dt>Rank</dt><dd>#${r.freq || "—"} by frequency</dd>
            </dl>
            ${vocabBlock(r.k)}
            ${senses(r).length > 1 ? `<p class="later-note">${senses(r).length - 1} further
              meaning${senses(r).length === 2 ? "" : "s"} — they come back later, once this one sticks.</p>` : ""}
          </div>
          <button class="primary-btn" id="p-next">${i === node.chars.length - 1 ? "Finish" : "Got it →"}</button>
          <div class="continue-hint">Enter ↵</div>
        </div>
      </div>`);
    $("#p-back").onclick = () => routes.path();
    let advanced = false;
    const go = async () => {
      if (advanced) return; advanced = true;
      i++;
      if (i < node.chars.length) return show();
      await api("/api/srs/start", { kanji: node.chars.map((r) => r.k) }).catch(() => {});
      await pathMark(node.id, 3);
      routes.path();
    };
    $("#p-next").onclick = go;
    keyOnce((e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); return true; } return false; });
  };
  show();
}

function pathQuiz(node, boss) {
  const qcount = boss ? 12 : 8;
  const passAt = boss ? 9 : 6;
  const qs = [];
  for (const r of node.chars) {
    qs.push({ r, facet: "meaning" });
    if (primaryReading(r)) qs.push({ r, facet: "reading" });
  }
  const questions = shuffle(qs).slice(0, qcount);
  let i = 0, score = 0;
  const title = boss ? "Checkpoint" : "Quiz";

  const finish = async () => {
    const passed = score >= passAt;
    const stars = score === questions.length ? 3 : score >= questions.length - 1 ? 2 : passed ? 1 : 0;
    if (passed) await pathMark(node.id, stars);
    $("#pq-box").innerHTML = `
      <div class="q-kind">${passed ? "Cleared!" : "Not this time"}</div>
      <div class="q-prompt-text">${score} / ${questions.length}${passed ? ` · ${"★".repeat(stars)}` : ""}</div>
      ${passed ? "" : `<p style="color:var(--ink-2);margin:0 0 14px">You need ${passAt} to pass.</p>`}
      <div class="row" style="justify-content:center">
        ${passed ? `<button class="primary-btn" id="pq-cont">Continue</button>`
                 : `<button class="primary-btn" id="pq-retry">Try again</button>`}
        <button class="ghost-btn" id="pq-exit">Back to path</button>
      </div>`;
    const c = $("#pq-cont"), rt = $("#pq-retry");
    if (c) c.onclick = () => routes.path();
    if (rt) rt.onclick = () => pathQuiz(node, boss);
    $("#pq-exit").onclick = () => routes.path();
  };

  const ask = () => {
    if (!document.getElementById("pq-box")) return;
    if (i >= questions.length) return finish();
    const { r, facet } = questions[i];
    const answer = facet === "reading" ? primaryReading(r) : senses(r)[0];
    const distractors = facet === "reading" ? pickReadingDistractors(r, 3) : pickMeaningDistractors(r, 3);
    const choices = shuffle([answer, ...distractors]);
    const jp = facet === "reading" ? "jp" : "";
    $("#pq-round").textContent = `${i + 1} / ${questions.length}`;
    $("#pq-score").textContent = score;
    $("#pq-box").innerHTML = `
      <div class="q-kind">${facet === "reading" ? "Pick a correct reading" : "What does this mean?"}</div>
      <div class="q-prompt-kanji" style="font-size:80px${(function(){const f=pickFont();return f?`;font-family:'${f.family}',var(--jp)`:"";})()}">${r.k}</div>
      <div class="choices">${choices.map((c, x) =>
        `<button class="choice ${jp}" data-c="${esc(c)}"><span class="key-hint">${x + 1}</span>${esc(c)}</button>`).join("")}
      </div>`;
    const btns = [...document.querySelectorAll("#pq-box .choice")];
    const onPick = (btn) => {
      const ok = btn.dataset.c === answer;
      gameLog(r.k, facet, boss ? "path-boss" : "path-quiz", ok);
      i++;
      if (ok) { score++; ask(); return; }
      btns.forEach((b) => { b.disabled = true; if (b.dataset.c === answer) b.classList.add("correct"); });
      btn.classList.add("wrong");
      setTimeout(ask, 900);
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 4 && !btns[0].disabled) { onPick(btns[n - 1]); return true; } return false; });
  };

  setMain(`
    <h1>${title}</h1>
    <div class="lightning-hud">
      <span>Question <b id="pq-round">1 / ${questions.length}</b></span>
      <span>Correct <b id="pq-score">0</b></span>
      <span>Pass at <b>${passAt}</b></span>
    </div>
    <div class="quiz-wrap"><div class="quiz-card" id="pq-box"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="ghost-btn" id="pq-quit">← Path</button></div>`);
  $("#pq-quit").onclick = () => routes.path();
  ask();
}

function pathGift(node) {
  const [emoji, jp, en] = CHARMS[node.giftIndex % CHARMS.length];
  const opened = (S.settings.path || {})[node.id] > 0;
  setMain(`
    <div class="quiz-wrap">
      <div class="quiz-card" id="gift-box" style="padding:44px 30px">
        ${opened ? "" : `
        <div class="q-kind">Treasure</div>
        <button class="gift-chest" id="gift-open" title="Open">🎁</button>
        <p style="color:var(--ink-2);margin:16px 0 0">You've earned a reward. Open it!</p>`}
      </div>
      <div class="row" style="justify-content:center;margin-top:16px">
        <button class="ghost-btn" id="gift-back">← Path</button>
      </div>
    </div>`);
  $("#gift-back").onclick = () => routes.path();
  const reveal = () => {
    $("#gift-box").innerHTML = `
      <div class="q-kind">A charm for your collection</div>
      <div class="gift-charm">${emoji}</div>
      <div class="q-prompt-text" style="padding:8px 0 2px"><span class="jp">${jp}</span> · ${en}</div>
      <p style="color:var(--ink-2);margin:0 0 18px">+40 XP. See your collection on the Stats page.</p>
      <button class="primary-btn" id="gift-cont">Continue</button>`;
    $("#gift-cont").onclick = () => routes.path();
  };
  if (opened) reveal();
  else $("#gift-open").onclick = async () => { await pathMark(node.id, 1); reveal(); };
}

function pathGame(node) {
  matchGame("meaning", {
    pool: node.chars,
    title: "Path: match pairs",
    backHash: "#/path",
    onDone: async ({ misses }) => {
      const stars = misses === 0 ? 3 : misses <= 3 ? 2 : 1;
      await pathMark(node.id, stars);
      $("#match-status").innerHTML = `<b style="color:var(--good)">Cleared! ${"★".repeat(stars)}</b> &nbsp;<button class="primary-btn" id="p-cont">Continue</button>`;
      $("#p-cont").onclick = () => routes.path();
    },
  });
}
