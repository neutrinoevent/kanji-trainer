/* Kanji Trainer — user-made lists of kanji and the add-to-list popover.
   Plain script, no bundler and no module system: index.html loads these in
   dependency order. See static/js/README.md for the layout. */
"use strict";

// ================================================================ lists
//
// Kanji the user has grouped themselves. Called "lists" rather than
// "collections" because that word already means the built-in tracks throughout
// this codebase — COLLECTIONS, the `collection=` API parameter, colById — and
// overloading it would make every scope-resolving function ambiguous.
//
// A list is purely a grouping. Adding a kanji to one does not start it in the
// review rotation, and deleting a list never touches SRS records, review
// history or exam results. That separation is what makes lists safe to
// experiment with.

const lists = () => S.settings?.lists || [];
const listById = (id) => lists().find((l) => l.id === id) || null;
/** Members as an array, dropping anything not in the dataset. */
const listKanji = (l) => Array.from(l.kanji || "").filter((k) => S.byChar[k]);

async function saveLists(next) {
  S.settings.lists = next;
  await api("/api/settings", { lists: next });
}

function newListId() {
  return "l" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
}

async function createList(name, kanji, note) {
  const l = { id: newListId(), name: (name || "Untitled list").slice(0, 60),
              kanji: dedupeKanji(kanji), note: (note || "").slice(0, 200),
              created: new Date().toISOString().slice(0, 10) };
  await saveLists([...lists(), l]);
  return l;
}

/** Order-preserving dedupe, so a list never holds the same kanji twice. */
function dedupeKanji(input) {
  const src = Array.isArray(input) ? input : Array.from(input || "");
  const seen = new Set();
  let out = "";
  for (const k of src) {
    if (S.byChar[k] && !seen.has(k)) { seen.add(k); out += k; }
  }
  return out;
}

async function setListKanji(id, kanji) {
  await saveLists(lists().map((l) => (l.id === id ? { ...l, kanji: dedupeKanji(kanji) } : l)));
}

async function toggleInList(id, kanji) {
  const l = listById(id);
  if (!l) return false;
  const has = listKanji(l).includes(kanji);
  await setListKanji(id, has ? listKanji(l).filter((k) => k !== kanji) : [...listKanji(l), kanji]);
  return !has;
}

async function renameList(id, name) {
  await saveLists(lists().map((l) => (l.id === id ? { ...l, name: name.slice(0, 60) } : l)));
}

async function deleteList(id) {
  await saveLists(lists().filter((l) => l.id !== id));
}

const listsContaining = (k) => lists().filter((l) => listKanji(l).includes(k));

// ---------------------------------------------------------------- add from anywhere
//
// The picker has to be usable in the middle of a review card without hijacking
// the session. It sets S.pickerOpen so the quiz's Enter handler stands down
// while it's up — otherwise typing a new list name and pressing Enter would
// advance the card underneath.

function closeListPicker() {
  const el = $("#list-picker");
  if (el) el.remove();
  S.pickerOpen = false;
}

/** Small popover anchored to a button: tick lists, or make a new one. */
function openListPicker(kanji, anchor) {
  closeListPicker();
  S.pickerOpen = true;
  const el = document.createElement("div");
  el.id = "list-picker";
  el.className = "list-picker";
  const render = () => {
    const mine = lists();
    el.innerHTML = `
      <div class="lp-head"><span class="jp">${kanji}</span> add to a list</div>
      ${mine.length ? `<div class="lp-items">
        ${mine.map((l) => {
          const on = listKanji(l).includes(kanji);
          return `<button class="lp-item ${on ? "on" : ""}" data-id="${l.id}">
            <span class="lp-check">${on ? "✓" : "＋"}</span>
            <span class="lp-name">${esc(l.name)}</span>
            <span class="lp-n">${listKanji(l).length}</span></button>`;
        }).join("")}
      </div>` : `<div class="lp-empty">No lists yet.</div>`}
      <div class="lp-new">
        <input id="lp-name" placeholder="New list…" autocomplete="off" maxlength="60">
        <button class="ghost-btn sm" id="lp-add">Create &amp; add</button>
      </div>
      <div class="lp-foot"><a href="#/lists" id="lp-manage">Manage lists</a></div>`;

    el.querySelectorAll(".lp-item").forEach((b) => {
      b.onclick = async (e) => {
        e.stopPropagation();
        const added = await toggleInList(b.dataset.id, kanji);
        render();
        toast(`${kanji} ${added ? "added to" : "removed from"} ${esc(listById(b.dataset.id).name)}`);
      };
    });
    const nameEl = el.querySelector("#lp-name");
    const create = async () => {
      const name = nameEl.value.trim();
      if (!name) return;
      const l = await createList(name, [kanji]);
      render();
      toast(`${kanji} added to ${esc(l.name)}`);
    };
    el.querySelector("#lp-add").onclick = (e) => { e.stopPropagation(); create(); };
    // keep Enter inside the popover; the card underneath must not advance
    nameEl.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.repeat) { e.preventDefault(); create(); }
      if (e.key === "Escape") closeListPicker();
    };
    el.querySelector("#lp-manage").onclick = () => closeListPicker();
  };
  render();
  document.body.appendChild(el);

  const r = anchor.getBoundingClientRect();
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + "px";
  el.style.top = (r.bottom + 6 + el.offsetHeight > innerHeight
    ? Math.max(8, r.top - el.offsetHeight - 6) : r.bottom + 6) + "px";

  setTimeout(() => {
    document.addEventListener("click", function away(ev) {
      if (el.contains(ev.target)) return;
      document.removeEventListener("click", away);
      closeListPicker();
    });
  }, 0);
}

/** The ＋ button that opens the picker. Drop it anywhere a kanji is on screen. */
const listBtn = (kanji, extra = "") =>
  `<button class="list-add-btn ${extra}" data-list-add="${kanji}"
           title="Add ${kanji} to a list">＋ List</button>`;

function bindListButtons(root) {
  (root || document).querySelectorAll("[data-list-add]").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); openListPicker(b.dataset.listAdd, b); };
  });
}
