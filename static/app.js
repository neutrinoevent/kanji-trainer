/* Kanji Trainer — frontend. Vanilla JS, no dependencies. */
"use strict";

// ================================================================ state

const S = {
  kanji: [],          // ordered by frequency rank
  byChar: {},         // char -> kanji row
  settings: null,
  srs: new Map(),     // "字|meaning" -> srs row
  dueCount: 0,
  newCount: 0,
};

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function loadState() {
  const st = await api("/api/state");
  S.settings = st.settings;
  S.srs = new Map(st.srs.map((r) => [r.kanji + "|" + r.facet, r]));
  S.dueCount = st.due_count;
  S.newCount = st.new_count;
  const badge = $("#due-badge");
  const total = st.due_count + st.new_count;
  badge.textContent = total;
  badge.classList.toggle("hidden", total === 0);
}

function srsOf(k, facet) { return S.srs.get(k + "|" + facet); }
function kanjiStarted(k) { return S.srs.has(k + "|meaning"); }
function activePool() {
  const pool = S.kanji.filter((r) => kanjiStarted(r.k));
  return pool.length >= 8 ? pool : S.kanji.slice(0, 50);
}
const GROUPS = ["Frequency", "School grades", "JLPT", "Names"];
async function loadCollections() {
  S.collections = await api("/api/collections");
  S.colById = Object.fromEntries(S.collections.map((c) => [c.id, c]));
}
function colChars(cid) { return Array.from(S.colById[cid].chars); }
function colSlice(cid, i) {
  const size = S.settings.batch_size;
  return colChars(cid).slice(i * size, (i + 1) * size).map((c) => S.byChar[c]);
}
function setBadges(r) {
  const out = [];
  if (r.grade >= 1 && r.grade <= 6) out.push(`Jōyō · Grade ${r.grade}`);
  else if (r.grade === 8) out.push("Jōyō · secondary");
  else if (r.grade === 9 || r.grade === 10) out.push("Jinmeiyō");
  if (r.jlpt) out.push(`JLPT N${r.jlpt}`);
  if (r.freq) out.push(`#${r.freq} by frequency`);
  return out;
}

// ================================================================ romaji → hiragana

const ROMAJI = (() => {
  const m = {
    a:"あ",i:"い",u:"う",e:"え",o:"お",
    ka:"か",ki:"き",ku:"く",ke:"け",ko:"こ",ga:"が",gi:"ぎ",gu:"ぐ",ge:"げ",go:"ご",
    sa:"さ",shi:"し",si:"し",su:"す",se:"せ",so:"そ",za:"ざ",ji:"じ",zi:"じ",zu:"ず",ze:"ぜ",zo:"ぞ",
    ta:"た",chi:"ち",ti:"ち",tsu:"つ",tu:"つ",te:"て",to:"と",da:"だ",di:"ぢ",du:"づ",de:"で",do:"ど",
    na:"な",ni:"に",nu:"ぬ",ne:"ね",no:"の",
    ha:"は",hi:"ひ",fu:"ふ",hu:"ふ",he:"へ",ho:"ほ",ba:"ば",bi:"び",bu:"ぶ",be:"べ",bo:"ぼ",
    pa:"ぱ",pi:"ぴ",pu:"ぷ",pe:"ぺ",po:"ぽ",
    ma:"ま",mi:"み",mu:"む",me:"め",mo:"も",
    ya:"や",yu:"ゆ",yo:"よ",ra:"ら",ri:"り",ru:"る",re:"れ",ro:"ろ",
    wa:"わ",wo:"を",vu:"ゔ",
    kya:"きゃ",kyu:"きゅ",kyo:"きょ",gya:"ぎゃ",gyu:"ぎゅ",gyo:"ぎょ",
    sha:"しゃ",shu:"しゅ",sho:"しょ",sya:"しゃ",syu:"しゅ",syo:"しょ",
    ja:"じゃ",ju:"じゅ",jo:"じょ",jya:"じゃ",jyu:"じゅ",jyo:"じょ",zya:"じゃ",zyu:"じゅ",zyo:"じょ",
    cha:"ちゃ",chu:"ちゅ",cho:"ちょ",tya:"ちゃ",tyu:"ちゅ",tyo:"ちょ",
    dya:"ぢゃ",dyu:"ぢゅ",dyo:"ぢょ",
    nya:"にゃ",nyu:"にゅ",nyo:"にょ",hya:"ひゃ",hyu:"ひゅ",hyo:"ひょ",
    bya:"びゃ",byu:"びゅ",byo:"びょ",pya:"ぴゃ",pyu:"ぴゅ",pyo:"ぴょ",
    mya:"みゃ",myu:"みゅ",myo:"みょ",rya:"りゃ",ryu:"りゅ",ryo:"りょ",
    fa:"ふぁ",fi:"ふぃ",fe:"ふぇ",fo:"ふぉ",
    "-":"ー",
  };
  return m;
})();

function romajiToKana(input) {
  let s = input.toLowerCase().replace(/[^a-z\-']/g, "");
  let out = "", i = 0;
  while (i < s.length) {
    // n → ん when followed by a consonant (IME style: "onna" → おんな), n', or end
    if (s[i] === "n") {
      const nx = s[i + 1];
      if (nx === "'") { out += "ん"; i += 2; continue; }
      if (nx === undefined || !"aiueoy".includes(nx)) { out += "ん"; i += 1; continue; }
    }
    // sokuon: doubled consonant
    if (i + 1 < s.length && s[i] === s[i + 1] && !"aiueon-'".includes(s[i])) {
      out += "っ"; i += 1; continue;
    }
    let matched = false;
    for (const len of [3, 2, 1]) {
      const chunk = s.substr(i, len);
      if (ROMAJI[chunk]) { out += ROMAJI[chunk]; i += len; matched = true; break; }
    }
    if (!matched) { i += 1; }
  }
  return out;
}

function toHiragana(s) {
  // convert katakana to hiragana; if latin letters present, run romaji conversion
  let t = s.trim().replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  if (/[a-zA-Z]/.test(t)) t = romajiToKana(t);
  return t;
}

function readingForms(row) {
  // normalized acceptable readings (okurigana dots removed, hyphens stripped)
  const forms = new Set();
  for (const r of [...row.on, ...row.kun]) {
    const clean = r.replace(/-/g, "");
    forms.add(clean.replace(/\./g, ""));           // full form e.g. はなす
    if (clean.includes(".")) forms.add(clean.split(".")[0]); // stem e.g. はな
  }
  forms.delete("");
  return forms;
}

function levenshtein(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[a.length][b.length];
}

function meaningMatches(input, row) {
  const norm = (x) => x.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
  const inp = norm(input);
  if (!inp) return false;
  for (const m of row.meanings) {
    const t = norm(m);
    if (inp === t) return true;
    const tol = t.length >= 8 ? 2 : t.length >= 5 ? 1 : 0;
    if (tol && levenshtein(inp, t) <= tol) return true;
  }
  return false;
}

// ================================================================ question builder

function distractorPool(target) {
  // prefer kanji near the same frequency neighborhood for plausible difficulty
  const idx = S.kanji.indexOf(target);
  const lo = Math.max(0, idx - 60), hi = Math.min(S.kanji.length, idx + 60);
  return S.kanji.slice(lo, hi).filter((r) => r.k !== target.k);
}

function pickMeaningDistractors(target, n) {
  const used = new Set(target.meanings.map((m) => m.toLowerCase()));
  const out = [];
  for (const r of shuffle(distractorPool(target))) {
    const m = r.meanings[0];
    if (!m || used.has(m.toLowerCase())) continue;
    used.add(m.toLowerCase()); out.push(m);
    if (out.length === n) break;
  }
  return out;
}

function pickKanjiDistractors(target, n) {
  const used = new Set([target.k]);
  const tm = new Set(target.meanings.map((m) => m.toLowerCase()));
  const out = [];
  for (const r of shuffle(distractorPool(target))) {
    if (used.has(r.k)) continue;
    if (r.meanings.some((m) => tm.has(m.toLowerCase()))) continue;
    used.add(r.k); out.push(r.k);
    if (out.length === n) break;
  }
  return out;
}

function pickReadingDistractors(target, n) {
  const forms = readingForms(target);
  const out = new Set();
  for (const r of shuffle(distractorPool(target))) {
    const cand = (r.on[0] || r.kun[0] || "").replace(/[-.]/g, "");
    if (!cand || forms.has(cand) || out.has(cand)) continue;
    out.add(cand);
    if (out.size === n) break;
  }
  return [...out];
}

function buildQuestion(item) {
  const row = S.byChar[item.k];
  const st = srsOf(item.k, item.facet);
  const mature = st && st.state === "review";
  let mode;
  if (item.facet === "meaning") {
    const modes = mature ? ["type-meaning", "mc-meaning", "mc-kanji"] : ["mc-meaning", "mc-kanji", "mc-meaning"];
    mode = pick(modes);
  } else {
    mode = mature ? pick(["type-reading", "type-reading", "mc-reading"]) : pick(["mc-reading", "mc-reading", "type-reading"]);
  }
  const q = { item, row, mode };
  if (mode === "mc-meaning") {
    q.answer = row.meanings[0];
    q.choices = shuffle([q.answer, ...pickMeaningDistractors(row, 3)]);
  } else if (mode === "mc-kanji") {
    q.answer = row.k;
    q.choices = shuffle([row.k, ...pickKanjiDistractors(row, 3)]);
  } else if (mode === "mc-reading") {
    const primary = (row.on[0] || row.kun[0] || "").replace(/[-.]/g, "");
    q.answer = primary;
    q.choices = shuffle([primary, ...pickReadingDistractors(row, 3)]);
  }
  return q;
}

// ================================================================ router / shell

const routes = {};
function navigate() {
  // drop any quiz/game key handler left over from the previous screen
  if (keyHandler) { document.removeEventListener("keydown", keyHandler); keyHandler = null; }
  const hash = location.hash || "#/";
  const [_, name, arg] = hash.match(/^#\/([\w-]*)\/?(.*)$/) || [];
  const view = routes[name || "dashboard"] || routes.dashboard;
  document.querySelectorAll(".nav-link").forEach((a) => {
    a.classList.toggle("active", a.dataset.nav === (name || "dashboard"));
  });
  view(arg);
}

function setMain(html) { $("#main").innerHTML = html; window.scrollTo(0, 0); }

function openModal(html) {
  $("#modal-root").innerHTML = `<div class="modal">${html}</div>`;
  $("#modal-root").onclick = (e) => { if (e.target.id === "modal-root") closeModal(); };
}
function closeModal() { $("#modal-root").innerHTML = ""; }

// tooltip helper
const tip = $("#tooltip");
function bindTips(root) {
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mouseenter", () => { tip.innerHTML = el.dataset.tip; tip.classList.remove("hidden"); });
    el.addEventListener("mousemove", (e) => {
      tip.style.left = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 10) + "px";
      tip.style.top = (e.clientY + 16) + "px";
    });
    el.addEventListener("mouseleave", () => tip.classList.add("hidden"));
  });
}

// ================================================================ guided tour

const TOUR_STEPS = [
  { sel: null, title: "Welcome to Kanji Trainer",
    body: "This app teaches the most useful kanji first, a small batch at a time. Here's a one-minute tour of where things are." },
  { sel: '[data-nav="path"]', title: "Path",
    body: "A guided road, five kanji at a time: learn them, quiz them, clear a checkpoint every few steps. It feeds the same review schedule as everything else, so use it as much or as little as you like." },
  { sel: '[data-nav="study"]', title: "Batches",
    body: "Pick a track: newspaper frequency, JLPT level, school grade, or name kanji. Start Batch 1 to add its kanji to your rotation. A kanji shared by several sets is only ever added once." },
  { sel: '[data-nav="review"]', title: "Review",
    body: "Your daily queue. Each kanji has a meaning card and a reading card, and the schedule decides when you see them again: right answers push a card further out, misses bring it back." },
  { sel: '[data-nav="stats"]', title: "Stats",
    body: "Streak, accuracy, batch mastery, and the kanji you miss most. The Games page adds extra practice that counts here without touching your review schedule." },
  { sel: '[data-nav="settings"]', title: "Settings",
    body: "Batch size, new kanji per day, theme, and JSON backups of your progress. That's the tour." },
];

function startTour() {
  if ($("#tour-root")) return;
  let step = 0;
  const root = document.createElement("div");
  root.id = "tour-root";
  root.innerHTML = `
    <div class="tour-spot" id="tour-spot"></div>
    <div class="tour-pop" id="tour-pop">
      <div class="tour-title" id="tour-title"></div>
      <div class="tour-body" id="tour-body"></div>
      <div class="tour-dots" id="tour-dots"></div>
      <div class="row tour-row">
        <button class="ghost-btn" id="tour-skip">Skip</button>
        <span style="flex:1"></span>
        <button class="ghost-btn hidden" id="tour-back">Back</button>
        <button class="primary-btn" id="tour-next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const spot = $("#tour-spot"), pop = $("#tour-pop");

  const render = () => {
    const s = TOUR_STEPS[step];
    $("#tour-title").textContent = s.title;
    $("#tour-body").textContent = s.body;
    $("#tour-dots").innerHTML = TOUR_STEPS.map((_, i) =>
      `<i class="${i === step ? "on" : ""}"></i>`).join("");
    $("#tour-back").classList.toggle("hidden", step === 0);
    $("#tour-next").textContent = step === TOUR_STEPS.length - 1 ? "Pick my first batch" : "Next";

    const target = s.sel && document.querySelector(s.sel);
    if (target) {
      const r = target.getBoundingClientRect();
      spot.style.left = (r.left - 6) + "px";
      spot.style.top = (r.top - 6) + "px";
      spot.style.width = (r.width + 12) + "px";
      spot.style.height = (r.height + 12) + "px";
      // place the card beside the highlight, below it on narrow screens
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let left = r.right + 18, top = r.top - 8;
      if (left + pw > innerWidth - 12) { left = Math.min(r.left, innerWidth - pw - 12); top = r.bottom + 14; }
      pop.style.left = Math.max(12, left) + "px";
      pop.style.top = Math.max(12, Math.min(top, innerHeight - ph - 12)) + "px";
    } else {
      spot.style.left = "50%"; spot.style.top = "38%";
      spot.style.width = "0px"; spot.style.height = "0px";
      pop.style.left = (innerWidth - pop.offsetWidth) / 2 + "px";
      pop.style.top = Math.max(12, innerHeight * 0.38 - pop.offsetHeight / 2) + "px";
    }
  };

  const finish = (goStudy) => {
    document.removeEventListener("keydown", onKey);
    removeEventListener("resize", render);
    root.remove();
    try { localStorage.setItem("kt-tour-done", "1"); } catch (e) {}
    api("/api/settings", { tour_done: true }).catch(() => {});
    S.settings.tour_done = true;
    if (goStudy) location.hash = "#/study";
  };
  const onKey = (e) => {
    if (e.key === "Escape") finish(false);
    if (e.key === "Enter" || e.key === "ArrowRight") $("#tour-next").click();
    if (e.key === "ArrowLeft" && step > 0) $("#tour-back").click();
  };

  $("#tour-skip").onclick = () => finish(false);
  $("#tour-back").onclick = () => { step = Math.max(0, step - 1); render(); };
  $("#tour-next").onclick = () => {
    if (step === TOUR_STEPS.length - 1) return finish(true);
    step++; render();
  };
  document.addEventListener("keydown", onKey);
  addEventListener("resize", render);
  render();
  render(); // second pass now that the card has real dimensions
}

// ================================================================ dashboard

routes.dashboard = async () => {
  await loadState();
  const stats = await api("/api/stats");
  const totalQueue = S.dueCount + S.newCount;
  const acc = stats.total_reviews ? Math.round((stats.total_correct / stats.total_reviews) * 100) : 0;

  const days14 = lastNDays(14).map((d) => ({ d, ...(stats.days[d] || { n: 0, correct: 0 }) }));
  const maxN = Math.max(1, ...days14.map((x) => x.n));

  setMain(`
    <h1>Dashboard</h1>
    <p class="sub">${stats.in_rotation ? `${stats.in_rotation} kanji in rotation.` : "No kanji in rotation yet. Start a batch to begin."}</p>
    <div class="tiles">
      <div class="tile"><div class="t-label">Queue now</div><div class="t-value">${totalQueue}</div><div class="t-sub">${S.dueCount} due · ${S.newCount} new</div></div>
      <div class="tile"><div class="t-label">Streak</div><div class="t-value">${stats.streak}</div><div class="t-sub">day${stats.streak === 1 ? "" : "s"} in a row</div></div>
      <div class="tile"><div class="t-label">Learned</div><div class="t-value">${stats.learned}</div><div class="t-sub">${stats.mature} mature (3wk+)</div></div>
      <div class="tile"><div class="t-label">Jōyō coverage</div><div class="t-value">${Math.round((stats.joyo_learned / stats.joyo_total) * 100)}%</div><div class="t-sub">${stats.joyo_learned} of ${stats.joyo_total}</div></div>
      <div class="tile"><div class="t-label">Accuracy</div><div class="t-value">${acc}%</div><div class="t-sub">${stats.total_reviews} answers all-time</div></div>
    </div>
    <div class="row" style="margin:22px 0">
      <button class="primary-btn" id="go-review" ${totalQueue ? "" : "disabled"}>⚡ Review ${totalQueue ? `(${totalQueue})` : ""}</button>
      <button class="ghost-btn" id="go-study">Browse batches</button>
      <button class="ghost-btn" id="go-games">Play a game</button>
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
      <button class="ghost-btn" id="back-btn">← ${col.group}</button>
    </div>
    <div class="kanji-grid">
      ${chunk.map((r) => {
        const m = srsOf(r.k, "meaning"), rd = srsOf(r.k, "reading");
        const cls = (s) => (s ? (s.state === "new" ? "" : s.state) : "");
        return `<div class="kanji-cell" data-k="${r.k}">${r.k}<span class="st ${cls(m)}" title="meaning"></span><span class="st ${cls(rd)}" title="reading"></span></div>`;
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
    el.onclick = () => kanjiModal(el.dataset.k);
  });
}

function kanjiModal(k) {
  const r = S.byChar[k];
  const m = srsOf(k, "meaning"), rd = srsOf(k, "reading");
  const srsLine = (s) => {
    if (!s || s.state === "new") return "not started";
    const due = s.due ? new Date(s.due) : null;
    const when = due ? (due <= new Date() ? "due now" : "due " + due.toLocaleDateString()) : "";
    return `${s.state} · ${s.reps} reps · ${s.lapses} lapses · ${when}`;
  };
  openModal(`
    <button class="modal-close" onclick="document.getElementById('modal-root').innerHTML=''">✕</button>
    <div class="big-kanji">${r.k}</div>
    <dl class="kv">
      <dt>Meanings</dt><dd>${esc(r.meanings.join(", "))}</dd>
      <dt>On readings</dt><dd class="jp">${r.on.join("、") || "—"}</dd>
      <dt>Kun readings</dt><dd class="jp">${r.kun.join("、") || "—"}</dd>
      <dt>Sets</dt><dd>${setBadges(r).map((b) => `<span class="pill">${b}</span>`).join(" ") || "—"}</dd>
      <dt>Strokes</dt><dd>${r.strokes ?? "—"}</dd>
      <dt>Meaning card</dt><dd>${srsLine(m)}</dd>
      <dt>Reading card</dt><dd>${srsLine(rd)}</dd>
    </dl>
    <a href="https://jisho.org/search/${encodeURIComponent(r.k)}%20%23kanji" target="_blank" rel="noopener" style="color:var(--accent)">Look up on jisho.org ↗</a>
  `);
}

// ================================================================ review session

routes.review = async () => {
  await loadState();
  const queue = await api("/api/queue");
  const sessionSize = S.settings.session_size;
  const due = shuffle(queue.due).slice(0, sessionSize);
  const newItems = queue.new.slice(0, Math.max(0, sessionSize - due.length + 6));

  if (!due.length && !newItems.length) {
    setMain(`
      <h1>Review</h1>
      <div class="card" style="text-align:center;padding:50px 20px">
        <div style="font-family:var(--jp);font-size:64px">🎉</div>
        <h2 style="margin-top:10px">All caught up!</h2>
        <p class="sub">Nothing is due right now. Start a new batch, or play a game.</p>
        <div class="row" style="justify-content:center">
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
    if (!introduced.has(it.k)) {
      introduced.add(it.k);
      items.push({ k: it.k, type: "intro" });
    }
    items.push(it);
  }
  runSession(items);
};

function runSession(items) {
  const sess = {
    items,
    pos: 0,
    firstTry: new Map(),   // "k|facet" -> bool
    answered: 0,
    correct: 0,
    missed: new Set(),
    startedAt: Date.now(),
  };
  nextCard(sess);
}

function sessionHeader(sess) {
  const total = sess.items.length;
  const pct = Math.round((sess.pos / total) * 100);
  return `
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
  quizCard(sess, item);
}

function introCard(sess, item) {
  const r = S.byChar[item.k];
  setMain(`
    <div class="quiz-wrap">
      ${sessionHeader(sess)}
      <div class="quiz-card intro-card">
        <div class="q-kind">New kanji</div>
        <div class="q-prompt-kanji">${r.k}</div>
        <div class="intro-rows">
          <dl class="kv">
            <dt>Meanings</dt><dd>${esc(r.meanings.join(", "))}</dd>
            <dt>On</dt><dd class="jp">${r.on.join("、") || "—"}</dd>
            <dt>Kun</dt><dd class="jp">${r.kun.join("、") || "—"}</dd>
            <dt>Rank</dt><dd>#${r.freq} most frequent</dd>
          </dl>
        </div>
        <button class="primary-btn" id="cont">Got it →</button>
        <div class="continue-hint">Enter ↵</div>
      </div>
    </div>`);
  let advanced = false;
  const go = () => { if (advanced) return; advanced = true; sess.pos++; nextCard(sess); };
  $("#cont").onclick = go;
  keyOnce((e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); return true; } return false; });
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
  "mc-meaning": "What does this mean?",
  "mc-kanji": "Which kanji means…",
  "mc-reading": "Pick a correct reading",
  "type-meaning": "Type the meaning",
  "type-reading": "Type a reading (romaji ok)",
};

function quizCard(sess, item) {
  const q = buildQuestion(item);
  const t0 = Date.now();
  const facetTag = `<span class="facet-${item.facet}">${item.facet}</span>`;
  let inner = "";
  if (q.mode === "mc-kanji") {
    inner = `<div class="q-prompt-text">${esc(q.row.meanings[0])}</div>
      <div class="choices">${q.choices.map((c, i) => `<button class="choice jp" data-c="${esc(c)}"><span class="key-hint">${i + 1}</span>${c}</button>`).join("")}</div>`;
  } else if (q.mode === "mc-meaning" || q.mode === "mc-reading") {
    const jp = q.mode === "mc-reading" ? "jp" : "";
    inner = `<div class="q-prompt-kanji">${q.row.k}</div>
      <div class="choices">${q.choices.map((c, i) => `<button class="choice ${jp}" data-c="${esc(c)}"><span class="key-hint">${i + 1}</span>${esc(c)}</button>`).join("")}</div>`;
  } else {
    const isReading = q.mode === "type-reading";
    inner = `<div class="q-prompt-kanji">${q.row.k}</div>
      <input class="type-input ${isReading ? "jp" : ""}" id="type-in" autocomplete="off" spellcheck="false"
             placeholder="${isReading ? "reading…" : "meaning…"}">
      ${isReading ? `<div class="kana-preview" id="kana-prev"></div>` : ""}
      <button class="primary-btn" id="type-go" style="margin-top:14px">Check ↵</button>`;
  }
  setMain(`
    <div class="quiz-wrap">
      ${sessionHeader(sess)}
      <div class="quiz-card">
        <div class="q-kind">${facetTag} · ${MODE_LABEL[q.mode]}</div>
        ${inner}
        <div class="q-feedback" id="feedback"></div>
      </div>
    </div>`);

  const settle = (correct, chosen) => {
    finishAnswer(sess, item, q, correct, chosen, Date.now() - t0);
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
      let ok;
      if (q.mode === "type-reading") {
        ok = readingForms(q.row).has(toHiragana(input.value));
      } else {
        ok = meaningMatches(input.value, q.row);
      }
      settle(ok, input.value);
    };
    $("#type-go").onclick = check;
    keyOnce((e) => { if (e.key === "Enter") { check(); return e.target.disabled !== false; } return false; });
  }
}

function finishAnswer(sess, item, q, correct, chosen, ms) {
  const key = item.k + "|" + item.facet;
  const isFirst = !sess.firstTry.has(key);
  if (isFirst) sess.firstTry.set(key, correct);
  const affectsSrs = isFirst && item.srsDone !== true;

  sess.answered++;
  if (correct) sess.correct++; else sess.missed.add(item.k);

  api("/api/answer", { k: item.k, facet: item.facet, mode: q.mode, correct, ms, srs: affectsSrs }).catch(() => {});

  // wrong answers come back later in the session (practice only, srs already recorded)
  if (!correct) {
    const reinsert = { k: item.k, facet: item.facet, type: "again", srsDone: true };
    const at = Math.min(sess.items.length, sess.pos + 3 + Math.floor(Math.random() * 3));
    sess.items.splice(at, 0, reinsert);
  }

  const r = q.row;
  const fb = $("#feedback");
  fb.innerHTML = `
    <div class="verdict ${correct ? "ok" : "no"}">${correct ? "Correct!" : "Not quite"}</div>
    <div class="detail"><span class="jp">${r.k}</span> — ${esc(r.meanings.slice(0, 3).join(", "))}
      · <span class="jp">${[...r.on.slice(0, 2), ...r.kun.slice(0, 2)].join("、")}</span></div>
    <button class="primary-btn" id="next-btn" style="margin-top:12px">Continue ↵</button>`;
  let advanced = false;
  const go = () => { if (advanced) return; advanced = true; sess.pos++; nextCard(sess); };
  $("#next-btn").onclick = go;
  $("#next-btn").focus();
  keyOnce((e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); return true; } return false; });
}

function sessionDone(sess) {
  const mins = Math.max(1, Math.round((Date.now() - sess.startedAt) / 60000));
  const firstTryVals = [...sess.firstTry.values()];
  const ftCorrect = firstTryVals.filter(Boolean).length;
  const acc = firstTryVals.length ? Math.round((ftCorrect / firstTryVals.length) * 100) : 100;
  setMain(`
    <div class="quiz-wrap session-done">
      <div class="doneK">${acc >= 80 ? "凄" : "続"}</div>
      <h1>${acc >= 80 ? "Excellent session!" : "Session complete"}</h1>
      <div class="done-stats">
        <div class="tile"><div class="t-label">Cards</div><div class="t-value">${firstTryVals.length}</div></div>
        <div class="tile"><div class="t-label">First-try</div><div class="t-value">${acc}%</div></div>
        <div class="tile"><div class="t-label">Time</div><div class="t-value">${mins}m</div></div>
      </div>
      ${sess.missed.size ? `<p class="sub">Tricky this time: <span style="font-family:var(--jp);font-size:22px">${[...sess.missed].join(" ")}</span></p>` : ""}
      <div class="row" style="justify-content:center">
        <button class="primary-btn" onclick="location.hash='#/';location.reload()">Dashboard</button>
        <button class="ghost-btn" id="again-btn">Review more</button>
      </div>
    </div>`);
  $("#again-btn").onclick = () => { routes.review(); };
  loadState().catch(() => {});
}

// ================================================================ games

const GAME_LAUNCHERS = {
  match: () => matchGame("meaning"),
  reading: () => matchGame("reading"),
  memory: () => memoryGame(),
  odd: () => oddOneOutGame(),
  snap: () => snapGame(),
  lightning: () => lightningGame(),
  survival: () => survivalGame(),
  horde: () => hordeGame(),
};

routes.games = async (arg) => {
  await loadState();
  // each game lives at #/games/<id> so Quit/Done (hash back to #/games) always works
  if (arg && GAME_LAUNCHERS[arg]) return GAME_LAUNCHERS[arg]();
  setMain(`
    <h1>Games</h1>
    <p class="sub">Extra practice with the kanji you've started. Games don't affect your review schedule, but results count in your stats.</p>
    <div class="game-cards">
      <div class="game-card" id="g-match"><h3>🀄 Match pairs</h3><p>Match kanji to meanings against the clock. 6 pairs per round.</p></div>
      <div class="game-card" id="g-match-r"><h3>🔊 Reading pairs</h3><p>Same idea, but match each kanji to one of its readings.</p></div>
      <div class="game-card" id="g-memory"><h3>🎴 Memory flip</h3><p>Twelve face-down cards. Find the kanji and meaning pairs from memory.</p></div>
      <div class="game-card" id="g-odd"><h3>🕵️ Odd one out</h3><p>Three of the four kanji are pronounced with the same on-reading. Find the one that sounds different.</p></div>
      <div class="game-card" id="g-snap"><h3>👍 Snap judgment</h3><p>45 seconds of true or false: does this meaning belong to this kanji?</p></div>
      <div class="game-card" id="g-lightning"><h3>⚡ Lightning round</h3><p>60 seconds. As many correct answers as you can. Streaks count.</p></div>
      <div class="game-card" id="g-survival"><h3>❤️ Survival</h3><p>Three lives, no timer. Questions march down the frequency list and get harder as you go.</p></div>
      <div class="game-card" id="g-horde"><h3>🧟 Kanji horde</h3><p>Zombies shamble toward your gate. Each correct answer cuts down the closest one. Hold the line.</p></div>
    </div>`);
  const launch = { "g-match": "match", "g-match-r": "reading", "g-memory": "memory",
    "g-odd": "odd", "g-snap": "snap", "g-lightning": "lightning",
    "g-survival": "survival", "g-horde": "horde" };
  for (const [el, id] of Object.entries(launch)) {
    $("#" + el).onclick = () => (location.hash = "#/games/" + id);
  }
};

function primaryReading(r) {
  return (r.on[0] || r.kun[0] || "").replace(/[-.]/g, "");
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
  const base = opts.pool || activePool();
  const source = kind === "reading" ? base.filter((r) => primaryReading(r)) : base;
  const pool = shuffle(source).slice(0, 6);
  const title = opts.title || (kind === "reading" ? "Reading pairs" : "Match pairs");
  const tiles = shuffle([
    ...pool.map((r) => ({ id: r.k, kind: "k", text: r.k })),
    ...pool.map((r) => ({ id: r.k, kind: "m", text: kind === "reading" ? primaryReading(r) : r.meanings[0] })),
  ]);
  const t0 = Date.now();
  let solved = 0, misses = 0, sel = null;
  setMain(`
    <h1>${title}</h1>
    <p class="sub" id="match-status">Match each kanji with its ${kind === "reading" ? "reading" : "meaning"}.</p>
    <div class="match-grid">
      ${tiles.map((t, i) => `<button class="match-tile ${t.kind === "k" || kind === "reading" ? "jp" : ""}" data-i="${i}">${esc(t.text)}</button>`).join("")}
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
        $("#match-again").onclick = () => matchGame(kind);
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

function memoryGame() {
  const pool = shuffle(activePool()).slice(0, 6);
  const tiles = shuffle([
    ...pool.map((r) => ({ id: r.k, kind: "k", text: r.k })),
    ...pool.map((r) => ({ id: r.k, kind: "m", text: r.meanings[0] })),
  ]);
  let first = null, lock = false, flips = 0, solved = 0;
  setMain(`
    <h1>Memory flip</h1>
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
        $("#mem-again").onclick = memoryGame;
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

function oddOneOutGame() {
  // reading groups need a wide pool; extend with common kanji if the user's is small
  const pool = [...new Set([...activePool(), ...S.kanji.slice(0, 400)])];
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
      $("#odd-again").onclick = oddOneOutGame;
      return;
    }
    const r = buildOddRound(pool);
    if (!r) { $("#odd-box").innerHTML = `<div class="q-prompt-text">Not enough shared readings to play yet.</div>`; return; }
    $("#odd-round").textContent = `${round + 1} / ${TOTAL}`;
    $("#odd-box").innerHTML = `
      <div class="q-kind">Which kanji sounds different?</div>
      <p style="margin:0;color:var(--ink-2);font-size:14px">Three of these four share the same on-reading (the Chinese-derived pronunciation). Pick the one that is <b>not</b> read that way.</p>
      <div class="choices choices-4">${r.options.map((o, i) =>
        `<button class="choice jp" data-k="${o.k}"><span class="key-hint">${i + 1}</span>${o.k}</button>`).join("")}
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
          The odd one was <span class="jp">${oddRow.k}</span> (${esc(oddRow.meanings[0])}), read <span class="jp">${oddOn.join("・") || primaryReading(oddRow) || "—"}</span>.</div>`;
      round++;
      setTimeout(ask, 1900);
    };
    btns.forEach((b) => (b.onclick = () => onPick(b)));
    keyOnce((e) => { const n = parseInt(e.key, 10); if (n >= 1 && n <= 4 && !btns[0].disabled) { onPick(btns[n - 1]); return true; } return false; });
  };
  setMain(`
    <h1>Odd one out</h1>
    <div class="lightning-hud"><span>Round <b id="odd-round">1 / ${TOTAL}</b></span></div>
    <div class="quiz-wrap"><div class="quiz-card" id="odd-box"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="ghost-btn" onclick="location.hash='#/games'">Quit</button></div>`);
  ask();
}

// ---------------------------------------------------------------- snap judgment

function snapGame() {
  const pool = activePool();
  let score = 0, streak = 0, best = 0, timeLeft = 45, alive = true;
  const ask = () => {
    if (!alive || !document.getElementById("snap-box")) return;
    const row = pick(pool);
    const truth = Math.random() < 0.5;
    const shown = truth ? pick(row.meanings) : (pickMeaningDistractors(row, 1)[0] || row.meanings[0]);
    const isMatch = truth || row.meanings.some((m) => m.toLowerCase() === shown.toLowerCase());
    $("#snap-box").innerHTML = `
      <div class="q-prompt-kanji" style="font-size:76px">${row.k}</div>
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
      $("#snap-again").onclick = snapGame;
    }
    updateHud();
  }, "snap-time");
  ask();
}

// ---------------------------------------------------------------- survival

function survivalGame() {
  let lives = 3, score = 0, idx = 0;
  const hearts = () => "♥".repeat(lives) + "♡".repeat(3 - lives);
  const ask = () => {
    if (!document.getElementById("sv-box")) return;
    while (idx < S.kanji.length && !S.kanji[idx].meanings.length) idx++;
    if (idx >= S.kanji.length) return end();
    const row = S.kanji[idx];
    const facet = primaryReading(row) && Math.random() < 0.4 ? "reading" : "meaning";
    let answer, choices, jp;
    if (facet === "reading") {
      answer = primaryReading(row);
      choices = shuffle([answer, ...pickReadingDistractors(row, 3)]);
      jp = "jp";
    } else {
      answer = row.meanings[0];
      choices = shuffle([answer, ...pickMeaningDistractors(row, 3)]);
      jp = "";
    }
    $("#sv-rank").textContent = "#" + (idx + 1);
    $("#sv-box").innerHTML = `
      <div class="q-kind">${facet === "reading" ? "Pick a correct reading" : "What does this mean?"}</div>
      <div class="q-prompt-kanji" style="font-size:80px">${row.k}</div>
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
      <div class="q-prompt-text">${score} correct · reached rank #${idx + 1}</div>
      <div class="row" style="justify-content:center">
        <button class="primary-btn" id="sv-again">Again</button>
        <button class="ghost-btn" onclick="location.hash='#/games'">Done</button>
      </div>`;
    $("#sv-again").onclick = survivalGame;
  };
  setMain(`
    <h1>Survival</h1>
    <div class="lightning-hud">
      <span style="color:var(--bad)"><b id="sv-lives">${hearts()}</b></span>
      <span>Score <b id="sv-score">0</b></span>
      <span>Rank <b id="sv-rank">#1</b></span>
    </div>
    <div class="quiz-wrap"><div class="quiz-card" id="sv-box"></div></div>
    <div class="row" style="justify-content:center;margin-top:16px"><button class="ghost-btn" onclick="location.hash='#/games'">Quit</button></div>`);
  ask();
}

function lightningGame() {
  const pool = activePool();
  let score = 0, streak = 0, best = 0, timeLeft = 60, alive = true;
  const ask = () => {
    if (!alive) return;
    const row = pick(pool);
    const answer = row.meanings[0];
    const choices = shuffle([answer, ...pickMeaningDistractors(row, 3)]);
    $("#lq").innerHTML = `
      <div class="q-prompt-kanji">${row.k}</div>
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
      $("#lq-again").onclick = lightningGame;
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

function hordeGame() {
  const pool = activePool();
  const W = 640, H = 176, GROUND = 150, GATE_X = 52;
  let hp = 10, kills = 0, over = false;
  const t0 = Date.now();
  let zombies = [], particles = [], gateFlash = 0;
  let lastSpawn = performance.now() - 3200, lastTick = performance.now();

  setMain(`
    <h1>Kanji horde</h1>
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
    $("#hd-again").onclick = hordeGame;
  };

  const ask = () => {
    if (over || !document.getElementById("horde-q")) return;
    const row = pick(pool);
    const facet = primaryReading(row) && Math.random() < 0.4 ? "reading" : "meaning";
    const answer = facet === "reading" ? primaryReading(row) : row.meanings[0];
    const distractors = facet === "reading" ? pickReadingDistractors(row, 3) : pickMeaningDistractors(row, 3);
    const choices = shuffle([answer, ...distractors]);
    const jp = facet === "reading" ? "jp" : "";
    $("#horde-q").innerHTML = `
      <div class="horde-prompt"><span class="q-prompt-kanji" style="font-size:56px">${row.k}</span>
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

// ================================================================ badges

const GAME_MODE_IDS = ["match-meaning", "match-reading", "memory", "odd-one-out", "snap", "lightning", "survival", "horde"];

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
];

function badgeSection(st) {
  const earned = BADGES.filter((b) => { try { return b.test(st); } catch { return false; } });
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
    </div>`;
}

// ================================================================ learning path

const NODE_META = {
  learn: { icon: "📖", label: "Learn" },
  quiz: { icon: "✏️", label: "Quiz" },
  game: { icon: "🎲", label: "Match" },
  boss: { icon: "🏯", label: "Checkpoint" },
};

function pathNodes() {
  const topN = Math.min(S.settings.top_n, S.kanji.length);
  const units = Math.floor(topN / 5);
  const nodes = [];
  for (let u = 0; u < units; u++) {
    const chars = S.kanji.slice(u * 5, u * 5 + 5);
    nodes.push({ id: `u${u}-learn`, type: "learn", unit: u, chars });
    nodes.push({ id: `u${u}-quiz`, type: "quiz", unit: u, chars });
    if (u % 3 === 2) {
      nodes.push({ id: `u${u}-game`, type: "game", unit: u,
                   chars: S.kanji.slice(Math.max(0, u * 5 - 10), u * 5 + 5) });
    }
    if (u % 5 === 4) {
      nodes.push({ id: `u${u}-boss`, type: "boss", unit: u,
                   chars: S.kanji.slice((u - 4) * 5, u * 5 + 5) });
    }
  }
  return nodes;
}

async function pathMark(id, stars) {
  const cur = S.settings.path || {};
  cur[id] = Math.max(cur[id] || 0, stars);
  S.settings.path = cur;
  await api("/api/settings", { path: cur }).catch(() => {});
}

routes.path = async () => {
  await loadState();
  const nodes = pathNodes();
  const done = S.settings.path || {};
  let firstOpen = nodes.findIndex((n) => !done[n.id]);
  if (firstOpen === -1) firstOpen = nodes.length;
  const doneCount = nodes.filter((n) => done[n.id]).length;

  let html = `
    <h1>Path</h1>
    <p class="sub">A guided road through the most common kanji, five at a time: learn them, quiz them, and clear a checkpoint every few steps. ${doneCount} of ${nodes.length} steps done.</p>
    <div class="path-wrap">`;
  nodes.forEach((n, i) => {
    if (n.type === "learn" && n.unit % 4 === 0) {
      html += `<div class="path-section"><span class="pill">Kanji #${n.unit * 5 + 1}–${Math.min((n.unit + 4) * 5, S.settings.top_n)}</span></div>`;
    }
    const stars = done[n.id] || 0;
    const state = stars ? "done" : i === firstOpen ? "current" : i < firstOpen ? "done" : "locked";
    const offset = Math.round(Math.sin(i * 0.85) * 95);
    const label = n.type === "learn" ? n.chars.map((r) => r.k).join("") : NODE_META[n.type].label;
    html += `
      <div class="path-row">
        <div class="path-step" style="transform:translateX(${offset}px)">
          <button class="path-node ${n.type} ${state}" data-i="${i}" ${state === "locked" ? "disabled" : ""}
                  title="${NODE_META[n.type].label}">${state === "locked" ? "🔒" : NODE_META[n.type].icon}</button>
          <span class="path-stars">${stars ? "★".repeat(stars) : ""}</span>
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
          <div class="intro-rows">
            <dl class="kv">
              <dt>Meanings</dt><dd>${esc(r.meanings.join(", "))}</dd>
              <dt>On</dt><dd class="jp">${r.on.join("、") || "—"}</dd>
              <dt>Kun</dt><dd class="jp">${r.kun.join("、") || "—"}</dd>
              <dt>Rank</dt><dd>#${r.freq || "—"} by frequency</dd>
            </dl>
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
    const answer = facet === "reading" ? primaryReading(r) : r.meanings[0];
    const distractors = facet === "reading" ? pickReadingDistractors(r, 3) : pickMeaningDistractors(r, 3);
    const choices = shuffle([answer, ...distractors]);
    const jp = facet === "reading" ? "jp" : "";
    $("#pq-round").textContent = `${i + 1} / ${questions.length}`;
    $("#pq-score").textContent = score;
    $("#pq-box").innerHTML = `
      <div class="q-kind">${facet === "reading" ? "Pick a correct reading" : "What does this mean?"}</div>
      <div class="q-prompt-kanji" style="font-size:80px">${r.k}</div>
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
    <p class="sub">Everything is stored locally in <code>data/trainer.db</code>.</p>
    <div class="tiles" style="margin-bottom:14px">
      <div class="tile"><div class="t-label">Total answers</div><div class="t-value">${st.total_reviews}</div></div>
      <div class="tile"><div class="t-label">Accuracy</div><div class="t-value">${acc}%</div></div>
      <div class="tile"><div class="t-label">Streak</div><div class="t-value">${st.streak}</div><div class="t-sub">days</div></div>
      <div class="tile"><div class="t-label">In rotation</div><div class="t-value">${st.in_rotation}</div><div class="t-sub">kanji being studied</div></div>
      <div class="tile"><div class="t-label">Learned</div><div class="t-value">${st.learned}</div><div class="t-sub">${st.mature} mature (3wk+)</div></div>
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
    <h2>Data</h2>
    <div class="card">
      <div class="row">
        <button class="ghost-btn" id="export-btn">⬇ Export backup (JSON)</button>
        <button class="ghost-btn" id="import-btn">⬆ Import backup</button>
        <input type="file" id="import-file" accept=".json" class="hidden">
      </div>
      <p class="settings-note" style="margin-bottom:0">Your progress lives in <code>data/trainer.db</code> next to the app. Export/import lets you move progress between computers. Importing <b>replaces</b> current progress.</p>
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
  for (const name of ["top_n", "batch_size", "new_per_day", "session_size"]) {
    $("#set-" + name).onchange = async (e) => {
      await api("/api/settings", { [name]: parseInt(e.target.value, 10) });
      await loadState();
      await loadCollections();
    };
  }
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
  await loadState();
  await loadCollections();
  if (!localStorage.getItem("kt-theme") && S.settings.theme) {
    document.documentElement.dataset.theme = S.settings.theme;
  }
  window.addEventListener("hashchange", navigate);
  navigate();
})();
