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
  S.tiers = st.tiers || S.tiers;
  S.sensesWaiting = st.senses_waiting || 0;
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

/**
 * The kanji a game may ask about, limited to a scope.
 *
 * Deliberately has no silent fallback. `activePool()` quietly substituted the
 * top 50 frequency kanji whenever the learner's own pool was small, which is
 * how someone who had studied one batch ended up being quizzed on characters
 * they had never seen. If a scope is too thin for a game, the game says so.
 */
function gamePool(sc) {
  const chars = scopeChars(sc);
  const set = chars ? new Set(chars) : null;
  return S.kanji.filter((r) => kanjiStarted(r.k) && (!set || set.has(r.k)));
}

function gameScopeBar(sc) {
  return `<div class="game-scope">Playing: <b>${esc(scopeLabel(sc))}</b>
    <button class="ghost-btn sm" onclick="location.hash='#/games'">change set</button></div>`;
}

/** Renders an explanation instead of the game when a scope can't support it. */
function tooFewForGame(sc, pool, need, title, why) {
  if (pool.length >= need) return false;
  const total = (scopeChars(sc) || []).length;
  setMain(`
    <h1>${esc(title)}</h1>
    <div class="card" style="text-align:center;padding:38px 22px">
      <h2 style="margin-top:0">Not enough kanji in this set yet</h2>
      <p class="sub">${esc(title)} needs at least <b>${need}</b> kanji you've started.
        <b>${esc(scopeLabel(sc))}</b> currently gives ${pool.length}${
          total ? ` of ${total}` : ""}.${why ? " " + why : ""}</p>
      <div class="row" style="justify-content:center">
        <button class="primary-btn" id="wider">Play with everything instead</button>
        <button class="ghost-btn" onclick="location.hash='#/games'">Choose another set</button>
        <button class="ghost-btn" onclick="location.hash='#/study'">Add more kanji</button>
      </div>
    </div>`);
  const w = $("#wider");
  if (w) w.onclick = () => { location.hash = gameHash(S.lastGameId || "match", null); };
  return true;
}

const gameHash = (id, sc) => `#/games/${id}/${scopeSuffix(sc)}`;
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
// ================================================================ typefaces
//
// A kanji met only ever in one typeface is half-learned. Print uses mincho,
// signage uses gothic, school material uses textbook faces, and the shapes
// genuinely differ — 令 and 直 and 心 are drawn differently enough to stop a
// learner who has only seen one. So quiz prompts rotate through whatever faces
// the machine actually has.
//
// "Actually has" is the whole difficulty. CSS falls back silently: asking for a
// font that isn't installed renders in the default face and looks like variety
// while delivering none. So fonts are not trusted, they are measured — each
// candidate is fingerprinted on a canvas and kept only if it renders
// *differently* from every face already in the set. Detection being imperfect
// then doesn't matter; what matters is that two entries never look the same.

const FONT_STYLES = [
  { id: "gothic", jp: "ゴシック体", en: "Gothic", families: [
    "Hiragino Sans", "Yu Gothic", "YuGothic", "Meiryo", "Noto Sans CJK JP",
    "Noto Sans JP", "Source Han Sans JP", "IPAGothic", "TakaoGothic",
    "VL Gothic", "Osaka", "MS Gothic"] },
  { id: "mincho", jp: "明朝体", en: "Mincho", families: [
    "Hiragino Mincho ProN", "Yu Mincho", "YuMincho", "Toppan Bunkyu Mincho",
    "Noto Serif CJK JP", "Noto Serif JP", "Source Han Serif JP", "IPAMincho",
    "TakaoMincho", "MS Mincho"] },
  { id: "maru", jp: "丸ゴシック体", en: "Rounded gothic", families: [
    "Hiragino Maru Gothic ProN", "Tsukushi A Round Gothic", "Kosugi Maru",
    "Rounded M+ 1c", "M PLUS Rounded 1c"] },
  { id: "kyokasho", jp: "教科書体", en: "Textbook", families: [
    "UD Digi Kyokasho N-R", "UD Digi Kyokasho NK-R", "Klee One", "Klee",
    "YuKyokasho", "Yu Kyokasho"] },
  { id: "ud", jp: "UD体", en: "Universal design", families: [
    "BIZ UDGothic", "BIZ UDMincho", "BIZ UDPGothic"] },
];

// Kanji chosen to differ sharply between faces: strokes, hooks, serifs, density.
const FONT_PROBE = "永国鬱曜線令直心";

function fontFingerprint(family) {
  const c = fontFingerprint._c || (fontFingerprint._c = document.createElement("canvas"));
  const ctx = c.getContext("2d");
  ctx.font = `48px ${family}, monospace`;
  const m = ctx.measureText(FONT_PROBE);
  return [m.width, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent,
          m.actualBoundingBoxLeft, m.actualBoundingBoxRight]
    .map((n) => Math.round((n || 0) * 100) / 100).join("|");
}

/** Faces present on this machine that genuinely render differently from each other. */
function detectFonts() {
  const absent = fontFingerprint('"__kt_no_such_font__"');
  const seen = new Map([[absent, "(fallback)"]]);
  const out = [];
  for (const style of FONT_STYLES) {
    for (const family of style.families) {
      const fp = fontFingerprint(`"${family}"`);
      if (seen.has(fp)) continue;          // absent, or identical to one we have
      seen.set(fp, family);
      out.push({ id: style.id, jp: style.jp, en: style.en, family });
      break;                                // one representative per style
    }
  }
  return out;
}

const fontVarietyOn = () => S.settings?.font_variety !== false && (S.fonts || []).length >= 2;

/** A face for one question. Null means "use the interface font". */
function pickFont() {
  return fontVarietyOn() ? pick(S.fonts) : null;
}

/** Inline style for a varied prompt; empty string when variety is off. */
const fontStyle = (f) => (f ? ` style="font-family:'${f.family}',var(--jp)"` : "");

// ================================================================ the fluency ladder
//
// Four rungs, in the order a learner climbs them:
//   1. see the kanji and recognise it
//   2. know its MOST COMMON meaning
//   3. say it aloud the way a Japanese reader would, seeing it on its own
//   4. pick up its further meanings later, once rung 2 is genuinely solid
// Rungs 2-4 are SRS facets: meaning, then sense2/sense3 unlocked by the server.

const SENSE_FACETS = ["sense2", "sense3"];
const MEANING_FACETS = ["meaning", ...SENSE_FACETS];
const SENSE_INDEX = { meaning: 0, sense2: 1, sense3: 2 };
const SENSE_ORDINAL = ["most common", "second", "third"];
const isSenseFacet = (f) => SENSE_FACETS.includes(f);
const isMeaningFacet = (f) => MEANING_FACETS.includes(f);
// A kanji needs roughly two weeks of reviews to ripen from "introduced" to
// "operative". Goal pacing has to leave room for that, or the deadline lies.
const OPERATIVE_LEAD_DAYS = 14;

// Tier of a single card: 0 not started, 1 learning, 2 operative, 3 solid.
// Computed server-side from the review log — see demo_tier() in server.py.
// Deliberately NOT derived from the scheduling interval: a long interval only
// means the scheduler hasn't asked recently, not that the learner can produce it.
function tierOf(k, facet) {
  const s = srsOf(k, facet);
  return s && typeof s.tier === "number" ? s.tier : 0;
}
const TIER_LABEL = ["not started", "learning", "operative", "solid"];

// KANJIDIC2's gloss list isn't purely a list of senses - it mixes in radical
// names and counter notes. Unfiltered, 一's "second meaning" would be
// "One Radical (no.1)" and 二's would be "Two Radical (no. 7)", which is not a
// meaning anyone should be quizzed on. MUST stay in sync with server.py's
// JUNK_GLOSS, which decides how many senses a kanji can unlock.
const JUNK_GLOSS = /\bradical\b|^counter for\b|\(no\.\s*\d+\)|\bkokuji\b/i;

/** A kanji's teachable senses, most common first. Memoised on the row. */
function senses(row) {
  if (!row.__senses) row.__senses = (row.meanings || []).filter((m) => !JUNK_GLOSS.test(m));
  return row.__senses;
}
/** The meaning this card is actually asking for. */
function senseText(row, facet) {
  return senses(row)[SENSE_INDEX[facet] ?? 0];
}
/** Senses the learner has already been taught for this kanji, in order. */
function knownSenses(row, upto) {
  return senses(row).slice(0, upto).filter(Boolean);
}

// ---------------------------------------------------------------- reading aloud
//
// Not "the first reading in the dictionary" - what someone actually says looking
// at the bare character on a sign. data/spoken.json carries the curated answers
// for the frequent range; the heuristic below covers the tail. See VISION.md D4.

function spokenReading(row) {
  if (!row) return null;
  const strip = (x) => x.replace(/-/g, "");
  const full = (x) => strip(x).replace(/\./g, "");
  const isOn = (kana) => row.on.some((x) => full(x) === kana);
  const override = S.spoken && S.spoken[row.k];
  if (override) return { kana: override, kind: isOn(override) ? "on" : "kun" };
  // a kun reading with no okurigana dot is a standalone word (山 やま, 国 くに)
  const kun = row.kun.find((x) => !x.includes(".") && !x.includes("-"));
  if (kun) return { kana: kun, kind: "kun" };
  const on = row.on.find((x) => !x.includes(".") && !x.includes("-"));
  if (on) return { kana: on, kind: "on" };
  const any = [...row.kun, ...row.on].map((x) => full(x)).find(Boolean);
  return any ? { kana: any, kind: isOn(any) ? "on" : "kun" } : null;
}
const READING_KIND = { on: "音読み", kun: "訓読み" };

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

const normMeaning = (x) => String(x).toLowerCase()
  .replace(/\(.*?\)/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

function glossMatches(inp, gloss) {
  const t = normMeaning(gloss || "");
  if (!t || !inp) return false;
  if (inp === t) return true;
  const tol = t.length >= 8 ? 2 : t.length >= 5 ? 1 : 0;   // typo tolerance
  return tol > 0 && levenshtein(inp, t) <= tol;
}

/**
 * Grade a typed meaning against the ONE sense this card teaches.
 *
 * A meaning card is for the kanji's most common sense; sense2/sense3 cards are
 * for the next ones down. Typing a real-but-different meaning of the same kanji
 * is its own outcome ({ok:false, other}) so the feedback can say what happened
 * instead of just "wrong" - that distinction is what teaches the ranking.
 * Setting strict_primary=false makes any real meaning count.
 */
function gradeMeaning(input, row, facet) {
  const idx = SENSE_INDEX[facet] ?? 0;
  const inp = normMeaning(input);
  if (!inp) return { ok: false };
  if (glossMatches(inp, senses(row)[idx])) return { ok: true };
  const j = row.meanings.findIndex((m, i) => i !== idx && glossMatches(inp, m));
  if (j >= 0) return { ok: !S.settings.strict_primary, other: row.meanings[j] };
  return { ok: false };
}

/**
 * Grade a typed reading. The target is the read-aloud reading, but other real
 * readings of the kanji still count - which one a bare character takes is
 * genuinely ambiguous for some kanji, so this nudges rather than punishes.
 */
function gradeReading(input, row) {
  const kana = toHiragana(input);
  const sp = spokenReading(row);
  if (sp && kana === sp.kana) return { ok: true };
  if (readingForms(row).has(kana)) return { ok: true, other: kana };
  return { ok: false };
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
    const m = senses(r)[0];
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
  const sp = spokenReading(target);
  // a curated reading isn't always in the dictionary forms (四 -> よん), so
  // exclude it explicitly or it could turn up as its own distractor
  if (sp) forms.add(sp.kana);
  const out = new Set();
  for (const r of shuffle(distractorPool(target))) {
    const cand = primaryReading(r);   // distractors are read-aloud readings too
    if (!cand || forms.has(cand) || out.has(cand)) continue;
    out.add(cand);
    if (out.size === n) break;
  }
  return [...out];
}

function buildQuestion(item) {
  const row = S.byChar[item.k];
  const facet = item.facet;
  const st = srsOf(item.k, facet);
  const mature = st && st.state === "review";
  let mode;
  if (isSenseFacet(facet)) {
    // Reverse (meaning -> kanji) is unfair for a secondary sense: several kanji
    // can plausibly carry it. Sense cards stay recognition/recall only.
    mode = mature ? pick(["type-meaning", "mc-meaning", "mc-meaning"]) : "mc-meaning";
  } else if (facet === "meaning") {
    mode = pick(mature ? ["type-meaning", "mc-meaning", "mc-kanji"]
                       : ["mc-meaning", "mc-kanji", "mc-meaning"]);
  } else {
    mode = pick(mature ? ["type-reading", "type-reading", "mc-reading"]
                       : ["mc-reading", "mc-reading", "type-reading"]);
  }
  const q = { item, row, mode, facet, senseIdx: SENSE_INDEX[facet] ?? 0, font: pickFont() };
  if (mode === "mc-meaning") {
    q.answer = senseText(row, facet) || senses(row)[0];
    q.choices = shuffle([q.answer, ...pickMeaningDistractors(row, 3)]);
  } else if (mode === "mc-kanji") {
    q.answer = row.k;
    q.choices = shuffle([row.k, ...pickKanjiDistractors(row, 3)]);
  } else if (mode === "mc-reading") {
    q.answer = primaryReading(row);
    q.choices = shuffle([q.answer, ...pickReadingDistractors(row, 3)]);
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
  { sel: '[data-nav="goals"]', title: "Goals",
    body: "Name a set and a date that matters to you — \"Grade 1, first two batches, by September\". Three things count as knowing a kanji here: you recognise it, you know its most common meaning, and you can read it aloud. Further meanings unlock on their own later. The app will tell you if your pace won't reach the date." },
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

/** The fluency ladder in one line, plus the goal with the nearest deadline. */
function goalSpotlight(stats) {
  const r = stats.rungs || {};
  const sn = stats.senses || {};
  const ladder = r.seen ? `
    <div class="card chart-card">
      <div class="chart-title">Fluency ladder</div>
      <div class="chart-sub">Of ${r.seen} kanji in rotation, counted at the operative bar
        at the operative bar: produced from memory, in more than one kind of
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
    <a href="https://jisho.org/search/${encodeURIComponent(r.k)}%20%23kanji" target="_blank" rel="noopener" style="color:var(--accent)">Look up on jisho.org ↗</a>
  `);
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

// ================================================================ review session

// ================================================================ review scopes
//
// Review used to be all-or-nothing: every card in rotation, whatever the
// learner was actually working on. Someone studying Grade 1 batch 1 would get
// quizzed on anything else they had ever started. A scope is a collection plus
// an optional inclusive batch range; `null` means everything, which stays the
// default and is still one click away.

/** "#/review/c/g1/0" or "#/review/c/g1/0-2" -> {cid, from, to}; null = everything. */
function parseScope(arg) {
  const p = (arg || "").split("/").filter(Boolean);
  if (p[0] !== "c" || !p[1] || !S.colById || !S.colById[p[1]]) return null;
  const cid = p[1];
  if (p[2] === undefined) return { cid, from: null, to: null };
  const [a, b] = p[2].split("-").map((x) => parseInt(x, 10));
  if (!Number.isFinite(a)) return { cid, from: null, to: null };
  return { cid, from: a, to: Number.isFinite(b) ? b : a };
}

function scopeSuffix(sc) {
  if (!sc) return "all";
  if (sc.from === null) return `c/${sc.cid}`;
  return `c/${sc.cid}/${sc.from === sc.to ? sc.from : `${sc.from}-${sc.to}`}`;
}
const scopeHash = (sc, base = "review") => `#/${base}/${scopeSuffix(sc)}`;

function scopeQuery(sc) {
  if (!sc) return "";
  let q = `?collection=${encodeURIComponent(sc.cid)}`;
  if (sc.from !== null) q += `&from=${sc.from}&to=${sc.to}`;
  return q;
}

function scopeLabel(sc) {
  if (!sc) return "Everything in rotation";
  const name = S.colById?.[sc.cid]?.name || sc.cid;
  if (sc.from === null) return name;
  return sc.from === sc.to ? `${name} · Batch ${sc.from + 1}`
                           : `${name} · Batches ${sc.from + 1}–${sc.to + 1}`;
}

/** The characters a scope covers, or null for everything. */
function scopeChars(sc) {
  if (!sc) return null;
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
          ${extra > 0 ? `<p class="later-note">${extra} further meaning${extra === 1 ? "" : "s"}
            (${esc(senses(r).slice(1, 4).join(", "))}${senses(r).length > 4 ? ", …" : ""})
            — you'll meet ${extra === 1 ? "it" : "them"} once this one sticks.</p>` : ""}
        </div>
        <button class="primary-btn" id="cont">Got it →</button>
        <div class="continue-hint">Enter ↵</div>
      </div>
    </div>`);
  advanceOn(sess, "#cont");
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
    <div id="fix-slot"></div>
    <button class="primary-btn" id="next-btn" style="margin-top:12px" disabled>Continue ↵</button>`;

  // A clean hit moves on quickly; anything else asks for the right answer before
  // it lets you past, so a miss can't be skimmed over at drilling speed.
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

// ================================================================ games

const GAME_LAUNCHERS = {
  match: (sc) => matchGame("meaning", { scope: sc }),
  reading: (sc) => matchGame("reading", { scope: sc }),
  memory: (sc) => memoryGame(sc),
  odd: (sc) => oddOneOutGame(sc),
  snap: (sc) => snapGame(sc),
  lightning: (sc) => lightningGame(sc),
  survival: (sc) => survivalGame(sc),
  horde: (sc) => hordeGame(sc),
};
const GAME_TITLES = {
  match: "Match pairs", reading: "Reading pairs", memory: "Memory flip",
  odd: "Odd one out", snap: "Snap judgment", lightning: "Lightning round",
  survival: "Survival", horde: "Kanji horde",
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
  { kanji: "初試験", name: "First Certification", desc: "Pass a mastery exam", test: (s, px) => px.examsPassed >= 1 },
  { kanji: "満点", name: "Full Marks", desc: "Score 100% on a mastery exam", test: (s, px) => px.examBest >= 1 },
  { kanji: "十冠", name: "Ten Crowns", desc: "Pass ten mastery exams", test: (s, px) => px.examsPassed >= 10 },
];

function badgeSection(st) {
  const px = { ...pathContext(), ...examContext(), level: levelInfo(calcXP(st)).lvl };
  const nodes = S.kanji.length ? pathNodes() : [];
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
      nodes.push({ id: `u${u}-gift`, type: "gift", unit: u,
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

routes.path = async () => {
  await loadState();
  const nodes = pathNodes();
  const done = S.settings.path || {};
  let firstOpen = nodes.findIndex((n) => !done[n.id]);
  if (firstOpen === -1) firstOpen = nodes.length;
  const doneCount = nodes.filter((n) => done[n.id]).length;

  const px = pathContext();
  let html = `
    <h1>Path</h1>
    <p class="sub">A guided road through the most common kanji, five at a time: learn them, quiz them, and clear a checkpoint every few steps. ${doneCount} of ${nodes.length} steps done.</p>
    <div class="row" style="margin-bottom:8px">
      <span class="pill">★ ${px.stars} stars</span>
      <span class="pill">🏯 ${px.bosses} checkpoints</span>
      <span class="pill">🎁 ${px.gifts} charms</span>
    </div>
    <div class="path-wrap">`;
  nodes.forEach((n, i) => {
    if (n.type === "learn" && n.unit % 4 === 0) {
      html += `<div class="path-section"><span class="pill">Kanji #${n.unit * 5 + 1}–${Math.min((n.unit + 4) * 5, S.settings.top_n)}</span></div>`;
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
  const rows = [...res.list.flatMap((s) => s.batches.map((b) => ({ cid: s.col.id, from: b.index, to: b.index }))),
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
    <p class="sub">Everything is stored locally in <code>data/trainer.db</code>.</p>
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
          <option value="0" ${s.strict_primary ? "" : "selected"}>No — any real meaning counts (recommended)</option>
          <option value="1" ${s.strict_primary ? "selected" : ""}>Yes — only the most common sense</option>
        </select>
      </div>
      <p class="settings-note">A kanji's second and third meanings unlock on their own once
        you can actually produce the first one on demand, then arrive as review rather than as new
        material. <b>Extra meanings per day</b> caps how fast they arrive; it has its own
        budget so deepening never eats into new kanji. Set it to 0 to pause it entirely.</p>
      <p class="settings-note">Either way, a typed meaning card <b>always tells you the most
        common sense</b>: answer 日 with “Sun” and you're told that Day is the primary one.
        The setting only decides whether the answer is also marked <i>wrong</i>.</p>
      <p class="settings-note">It's off by default because the meaning lists mix genuinely
        different senses (月 = Month, Moon) with near-synonyms (大 = Large, Big; 中 = In,
        Inside, Middle). Strict grading would mark “big” wrong for 大, which teaches you
        nothing except to distrust the app. Turn it on if you want the primary sense to be
        the only accepted answer and you don't mind that.</p>
      <p class="settings-note">Reading cards ask how you'd say a kanji <b>on its own</b> —
        what you'd read off a sign. Those readings are curated in
        <code>data/spoken.json</code>, which you can edit; the app still accepts the kanji's
        other real readings and just nudges you toward the standalone one.</p>
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
  await loadState();
  await loadCollections();
  if (!localStorage.getItem("kt-theme") && S.settings.theme) {
    document.documentElement.dataset.theme = S.settings.theme;
  }
  window.addEventListener("hashchange", navigate);
  navigate();
})();
