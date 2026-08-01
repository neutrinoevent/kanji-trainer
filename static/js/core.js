/* Kanji Trainer — shared state, helpers, the fluency ladder, typefaces, romaji, question building.
   Plain script, no bundler and no module system: index.html loads these in
   dependency order. See static/js/README.md for the layout. */
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
  S.recovery = st.recovery || null;
  S.storage = st.storage || S.storage;
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

const CORE_FACETS = ["meaning", "reading"];
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

/**
 * A kanji's distinct senses, most common first — the wording to teach for each.
 *
 * Curated groupings win where they exist (see data/senses.json), because the raw
 * gloss list is not a list of senses: 大's "second meaning" would otherwise be
 * "Big", which is the same sense as "Large" said differently.
 */
function senses(row) {
  if (!row.__senses) {
    const g = S.senseGroups && S.senseGroups[row.k];
    row.__senses = g ? g.map((x) => x[0]).filter(Boolean)
                     : (row.meanings || []).filter((m) => !JUNK_GLOSS.test(m));
  }
  return row.__senses;
}

/**
 * Whether we have curated sense groupings for this kanji.
 *
 * Strict grading is only fair where we do. Without groupings, "Big" for 大 looks
 * like a different sense and would be marked wrong — a false negative that
 * teaches the learner to distrust the app. So strictness follows the data:
 * strict where the senses are known to be distinct, forgiving where they aren't.
 * It tightens by itself as more of the range is curated.
 */
const hasCuratedSenses = (row) => !!(S.senseGroups && S.senseGroups[row.k]);

/** Every accepted wording of one sense — all count as fully correct for it. */
function senseWordings(row, idx) {
  const g = S.senseGroups && S.senseGroups[row.k];
  if (g && g[idx]) return g[idx];
  const s = senses(row)[idx];
  return s ? [s] : [];
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
const strictFor = (row) => S.settings.strict_primary !== false && hasCuratedSenses(row);

function gradeMeaning(input, row, facet) {
  const idx = SENSE_INDEX[facet] ?? 0;
  const inp = normMeaning(input);
  if (!inp) return { ok: false };
  // any accepted wording of this sense is fully correct, not merely tolerated
  if (senseWordings(row, idx).some((w) => glossMatches(inp, w))) return { ok: true };
  // a wording belonging to one of the kanji's *other* senses
  const all = senses(row);
  for (let i = 0; i < all.length; i++) {
    if (i === idx) continue;
    if (senseWordings(row, i).some((w) => glossMatches(inp, w))) {
      return { ok: !strictFor(row), other: all[i] };
    }
  }
  const j = (row.meanings || []).findIndex((m) => glossMatches(inp, m));
  if (j >= 0) return { ok: !strictFor(row), other: row.meanings[j] };
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

// ---------------------------------------------------------------- example words
//
// The reading cards teach one standalone reading, which is right for a beginner
// but leaves them unable to say why 日 is ひ alone and に in 日本. Showing a few
// real words closes that gap without adding anything to memorise: these are
// displayed, never quizzed.

const READING_KIND_SHORT = { on: "音", kun: "訓", irregular: "特" };

const vocabFor = (k) => (S.vocab && S.vocab[k]) || [];

/**
 * Example words for a kanji, contrast first.
 *
 * If the kanji is read differently across the examples, lead with words that
 * differ — a list where every entry uses the same reading teaches nothing about
 * why readings change, which is the entire point of showing them.
 */
function vocabRows(k, limit = 3) {
  const all = vocabFor(k);
  if (!all.length) return [];
  const kinds = [...new Set(all.map((v) => v.kind))];
  if (kinds.length < 2) return all.slice(0, limit);
  const out = [];
  for (const kind of kinds) {
    const first = all.find((v) => v.kind === kind && !out.includes(v));
    if (first) out.push(first);
  }
  for (const v of all) {
    if (out.length >= limit) break;
    if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, limit);
}

/** Example words with the target kanji picked out inside each one. */
function vocabBlock(k, opts = {}) {
  const rows = vocabRows(k, opts.limit || 3);
  if (!rows.length) return "";
  const mark = (w) => Array.from(w).map((c) =>
    c === k ? `<b class="vw-k">${c}</b>` : esc(c)).join("");
  return `
    <div class="vocab-block${opts.compact ? " compact" : ""}">
      ${opts.title === false ? "" : `<div class="vocab-title">Seen in</div>`}
      ${rows.map((v) => `
        <div class="vocab-row">
          <span class="vw jp">${mark(v.w)}</span>
          <span class="vr jp">${esc(v.r)}</span>
          <span class="vm">${esc(v.m)}</span>
          <span class="vk" title="${v.kind === "irregular"
            ? "an irregular reading — no per-character reading applies"
            : v.kind === "on" ? "on-reading (Chinese-derived)"
            : "kun-reading (native Japanese)"}">${READING_KIND_SHORT[v.kind] || ""}</span>
        </div>`).join("")}
    </div>`;
}

// ---------------------------------------------------------------- look-alikes
//
// Distractors drawn from the frequency neighbourhood are plausible but not
// difficult: nothing about 待 against 会 tests whether you can actually read 待.
// Mistaking similar-looking characters is the dominant failure in real reading,
// and it was the one thing the app never asked about. data/similar.json groups
// the ones that are easy to confuse; see that file for why it is curated.

/** Look-alikes for a kanji. Empty if none are known. */
function lookAlikes(k) {
  if (!S.similarIndex) return [];
  return S.similarIndex[k] || [];
}
const hasLookAlikes = (k) => lookAlikes(k).length > 0;

/** Flatten the curated groups to kanji -> [look-alikes], once, at boot. */
function buildSimilarIndex(groups) {
  const idx = {};
  for (const g of groups || []) {
    const chars = Array.from(g);
    for (const c of chars) {
      const others = chars.filter((x) => x !== c && S.byChar[x]);
      if (!others.length) continue;
      idx[c] = [...new Set([...(idx[c] || []), ...others])];
    }
  }
  return idx;
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

/**
 * Choose kanji to offer against `target`.
 *
 * Look-alikes come first, then the frequency neighbourhood fills the remainder,
 * so a question is as hard as the data allows and still complete when no
 * look-alikes are known. Mixing rather than replacing matters: if every option
 * were a look-alike, the answer would be identifiable as the odd one out.
 */
function pickKanjiDistractors(target, n) {
  const used = new Set([target.k]);
  const tm = new Set(target.meanings.map((m) => m.toLowerCase()));
  const out = [];
  const take = (rows) => {
    for (const r of rows) {
      if (out.length === n) return;
      if (!r || used.has(r.k)) continue;
      if (r.meanings.some((m) => tm.has(m.toLowerCase()))) continue;
      used.add(r.k);
      out.push(r.k);
    }
  };
  // capped at n-1 so at least one option always comes from outside the
  // look-alike set, keeping the shape of the answer uninformative
  take(shuffle(lookAlikes(target.k)).slice(0, Math.max(1, n - 1)).map((k) => S.byChar[k]));
  take(shuffle(distractorPool(target)));
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
