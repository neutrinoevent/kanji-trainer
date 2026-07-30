/* Kanji Trainer — the router, page frame, modal, tooltips and the first-run tour.
   Plain script, no bundler and no module system: index.html loads these in
   dependency order. See static/js/README.md for the layout. */
"use strict";

// ================================================================ router / shell

const routes = {};
function navigate() {
  // drop any quiz/game key handler left over from the previous screen
  if (keyHandler) { document.removeEventListener("keydown", keyHandler); keyHandler = null; }
  closeListPicker();
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
  { sel: '[data-nav="lists"]', title: "Lists",
    body: "Your own groupings — the ones you keep missing, a set you're building for a trip. You can add a kanji to a list from wherever you happen to be: mid-review, on the batches grid, from your stats. A list can then be reviewed, drilled, played or examined exactly like a built-in set." },
  { sel: '[data-nav="review"]', title: "Review",
    body: "Your daily queue. Each kanji has a meaning card and a reading card, and the schedule decides when you see them again. You don't have to take the whole queue at once — review can be narrowed to one set, one batch or one list, so studying Grade 1 doesn't mean being asked about everything you've ever started." },
  { sel: '[data-nav="exam"]', title: "Exams",
    body: "When you've finished a set, sit an exam on it: every kanji, from several angles, feedback held back until the end. It never touches your review schedule, so a bad day costs nothing but the time — and passing means you can honestly say you know that set." },
  { sel: '[data-nav="games"]', title: "Games",
    body: "Eight of them, from matching pairs to holding a gate against zombies. Pick which set they draw from — they only ever ask about kanji you've chosen. Results count in your stats without touching your schedule." },
  { sel: '[data-nav="stats"]', title: "Stats",
    body: "Streak, accuracy, batch mastery, badges, and the kanji you miss most. Knowing a kanji here means having demonstrated it — produced from memory, in more than one kind of question, on more than one day — so the numbers are earned rather than waited out." },
  { sel: '[data-nav="settings"]', title: "Settings",
    body: "Batch size, new kanji per day, theme, and your backups. Your progress is saved automatically and copied outside the app folder, so it survives updates and reinstalls. That's the tour — everything here is optional except showing up." },
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
