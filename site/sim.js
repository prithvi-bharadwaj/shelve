// Simulation core: tab/window state, Chrome-strip rendering (FLIP), and the
// scripted actions (organize, stash, dedupe, merge, undo). UI wiring is in demo.js.

const GROUP_DEFS = {
  visa: { name: "O1 Visa", color: "var(--g-blue)", importance: 1 },
  react: { name: "React Perf", color: "var(--g-yellow)", importance: 2 },
  tokyo: { name: "Tokyo Trip", color: "var(--g-green)", importance: 3 },
};

let nextId = 1;
const makeTab = (title, icon, iconBg, url, group, active = false) =>
  ({ id: nextId++, title, icon, iconBg, url, group, active });

const INITIAL_TABS = [
  ["O-1 Visa: Individuals with Extraordinary Ability — USCIS", "U", "#264a9e", "uscis.gov/o1", "visa"],
  ["React re-renders: a complete guide", "R", "#087ea4", "react-rerenders.dev", "react"],
  ["Gmail — inbox (247)", "M", "#c5221f", "mail.google.com", null],
  ["how hard is the o1 actually — r/immigration", "r", "#ff4500", "reddit.com/r/immigration", "visa"],
  ["Google Flights: SFO → NRT", "F", "#188038", "flights.google.com", "tokyo"],
  ["useMemo — React docs", "R", "#087ea4", "react.dev/usememo", "react"],
  ["O1 attorney fee comparison — Notion", "N", "#37352f", "notion.so/o1-fees", "visa"],
  ["lofi hip hop radio — YouTube", "▶", "#cc0000", "youtube.com/lofi", null],
  ["React re-renders: a complete guide", "R", "#087ea4", "react-rerenders.dev", "react"],
  ["Booking.com: Shinjuku hotels", "B", "#1a4fa0", "booking.com/shinjuku", "tokyo"],
  ["Profiling with React DevTools", "R", "#087ea4", "react.dev/profiling", "react"],
  ["lofi hip hop radio — YouTube", "▶", "#cc0000", "youtube.com/lofi", null],
  ["O-1 evidence checklist template", "N", "#37352f", "notion.so/o1-evidence", "visa"],
  ["Tokyo 5-day itinerary", "T", "#e8710a", "tokyo-itinerary.notion.site", "tokyo", true],
];

const OTHER_WINDOW_TABS = [
  ["Japan Rail Pass — worth it?", "J", "#188038", "jrpass.com", "tokyo"],
  ["Airbnb: Shimokitazawa", "A", "#ff385c", "airbnb.com/shimokita", "tokyo"],
  ["best ramen in tokyo — Yelp", "Y", "#d32323", "yelp.com/tokyo-ramen", "tokyo"],
];

const STAGES = [
  { label: "Reading titles", progress: 18, ms: 900 },
  { label: "Finding themes", progress: 48, ms: 1700 },
  { label: "Creating tab groups", progress: 88, ms: 600 },
];

// Canned "where you left off" briefs, one per group — in the real extension the AI writes these on stash.
const BRIEFS = {
  visa: "You were comparing attorney fees in the Notion table ($4k–$8k range), had the USCIS criteria page open, and the evidence checklist still has 3 unchecked items. The reddit thread's consensus: 8 strong letters.",
  react: "Halfway through the re-renders guide; useMemo docs open at dependency arrays. You hadn't profiled the slow list with DevTools yet.",
  tokyo: "Flights SFO→NRT not booked yet. Two Shinjuku hotels shortlisted on Booking. The 5-day itinerary still has day 3 unplanned.",
};

// Canned command-bar answers per topic — the real extension asks the model across tab contents.
const ANSWERS = {
  visa: { text: "The Notion fee table — attorney quotes range $4k–$8k, flat fee. The evidence checklist is the tab you left unfinished.", url: "notion.so/o1-fees" },
  react: { text: "The re-renders guide — you stopped at the memoization section; the profiler walkthrough is in the DevTools tab.", url: "react-rerenders.dev" },
  tokyo: { text: "The Booking.com tab — Shinjuku Granbell, ¥14,200/night, pet-friendly, free cancellation until day before.", url: "booking.com/shinjuku" },
};

// Chrome group palette as solid dot colors (StashPanel's GROUP_DOT)
const DOT = { visa: "#3b82f6", react: "#facc15", tokyo: "#22c55e" };

const state = {
  tabs: INITIAL_TABS.map((t) => makeTab(...t)),
  otherWindow: OTHER_WINDOW_TABS.map((t) => makeTab(...t)),
  appliedGroups: [], // ordered keys of GROUP_DEFS
  stashes: [], // { key, name, color, tabCount, tabs, brief, ago }
  windowCount: 2,
  minGroup: 2,
  dedupe: false,
  mergeOnOrganize: false,
  organizing: false,
};

const undoStack = [];
const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (id) => document.getElementById(id);
const strip = $("tabstrip");
const tabEls = new Map();

/* ---------- tab strip rendering (FLIP) ---------- */

function tabEl(tab) {
  let el = tabEls.get(tab.id);
  if (!el) {
    el = document.createElement("div");
    el.className = "tab";
    el.innerHTML = `<span class="favicon" style="background:${tab.iconBg}">${tab.icon}</span><span class="tab-title"></span><span class="tab-x">✕</span>`;
    el.querySelector(".tab-title").textContent = tab.title;
    el.title = tab.title;
    tabEls.set(tab.id, el);
  }
  el.classList.toggle("active", Boolean(tab.active));
  return el;
}

function renderStrip({ flip = true } = {}) {
  const doFlip = flip && !prefersReducedMotion;
  const before = new Map();
  if (doFlip) {
    for (const [id, el] of tabEls) {
      if (el.isConnected) before.set(id, el.getBoundingClientRect());
    }
  }

  const frag = document.createDocumentFragment();
  const orderedKeys = [...state.appliedGroups].sort(
    (a, b) => GROUP_DEFS[a].importance - GROUP_DEFS[b].importance
  );
  for (const key of orderedKeys) {
    const members = state.tabs.filter((tab) => tab.group === key);
    if (!members.length) continue;
    const def = GROUP_DEFS[key];
    const wrap = document.createElement("div");
    wrap.className = "tgroup";
    wrap.style.setProperty("--group-color", def.color);
    const chip = document.createElement("span");
    chip.className = "tgroup-chip" + (doFlip ? " arriving" : "");
    chip.textContent = def.name;
    const inner = document.createElement("div");
    inner.className = "tgroup-tabs";
    members.forEach((tab) => inner.appendChild(tabEl(tab)));
    wrap.append(chip, inner);
    frag.appendChild(wrap);
  }
  state.tabs
    .filter((tab) => !state.appliedGroups.includes(tab.group))
    .forEach((tab) => frag.appendChild(tabEl(tab)));
  strip.replaceChildren(frag);

  if (doFlip) {
    const moved = [];
    for (const [id, el] of tabEls) {
      const old = before.get(id);
      if (!old || !el.isConnected) continue;
      const now = el.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (!dx && !dy) continue;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(el);
    }
    strip.getBoundingClientRect(); // reflow before playing
    for (const el of moved) {
      el.style.transition = "transform 460ms var(--ease-in-out-strong)";
      el.style.transform = "";
    }
  }
}

/* ---------- popup state ---------- */

const popup = $("popup");
const idleView = $("popup-idle");
const organizingView = $("popup-organizing");
const statusEl = $("popup-status");
const extIcon = $("ext-icon");

function setStatus(text, error = false) {
  statusEl.textContent = text || "";
  statusEl.classList.toggle("error", error);
}

function looseCount() {
  return state.tabs.filter((tab) => !state.appliedGroups.includes(tab.group)).length;
}

function syncButtons() {
  $("qa-undo").disabled = !undoStack.length;
  $("qa-merge").disabled = state.windowCount <= 1;
  const busy = state.organizing;
  for (const id of ["organize-btn", "qa-ungroup", "qa-duplicates", "qa-merge", "qa-undo"]) {
    if (busy) $(id).disabled = true;
  }
  if (!busy) {
    $("organize-btn").disabled = false;
    $("qa-ungroup").disabled = false;
    $("qa-duplicates").disabled = false;
  }
}

function showView(organizing) {
  idleView.hidden = organizing;
  organizingView.hidden = !organizing;
}

function snapshot() {
  undoStack.push(JSON.stringify({
    tabs: state.tabs,
    appliedGroups: state.appliedGroups,
    stashes: state.stashes,
    windowCount: state.windowCount,
    otherWindow: state.otherWindow,
  }));
  syncButtons();
}

/* ---------- groups + stash panels ---------- */

const ICON_STASH = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>`;
const ICON_RESUME = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="m9 15 3-3 3 3"/><path d="M12 12v9"/></svg>`;
const ICON_X = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

function renderPanels() {
  const groupsPanel = $("groups-panel");
  const stashPanel = $("stash-panel");
  const groupsList = $("groups-list");
  const stashList = $("stash-list");

  const applied = state.appliedGroups.filter((key) => state.tabs.some((tab) => tab.group === key));
  groupsPanel.hidden = !applied.length;
  $("groups-count").textContent = applied.length ? ` · ${applied.length}` : "";
  groupsList.replaceChildren(...applied.map((key) => {
    const def = GROUP_DEFS[key];
    const count = state.tabs.filter((tab) => tab.group === key).length;
    const row = document.createElement("div");
    row.className = "panel-row";
    row.innerHTML = `<span class="panel-dot" style="background:${DOT[key]}"></span><span class="panel-name"></span><span class="panel-count">${count}</span><button class="icon-btn" title="Stash “${def.name}”">${ICON_STASH}</button>`;
    row.querySelector(".panel-name").textContent = def.name;
    row.querySelector("button").addEventListener("click", () => stashGroup(key));
    return row;
  }));

  stashPanel.hidden = !state.stashes.length;
  stashList.replaceChildren(...state.stashes.map((stash) => {
    const card = document.createElement("div");
    card.className = "stash-card";
    card.innerHTML = `<div class="panel-row"><span class="panel-dot" style="background:${DOT[stash.key]}"></span><span class="panel-name"></span><span class="panel-count">${stash.tabCount} · ${stash.ago}</span><button class="icon-btn" title="Resume">${ICON_RESUME}</button><button class="icon-btn" title="Delete stash">${ICON_X}</button></div><p class="stash-brief${stash.brief ? "" : " pending"}"></p>`;
    card.querySelector(".panel-name").textContent = stash.name;
    card.querySelector(".stash-brief").textContent = stash.brief || "Writing where-you-left-off brief…";
    const [resumeBtn, deleteBtn] = card.querySelectorAll("button");
    resumeBtn.addEventListener("click", () => resumeStash(stash));
    deleteBtn.addEventListener("click", () => deleteStash(stash));
    return card;
  }));
}

async function stashGroup(key) {
  if (state.organizing) return;
  snapshot();
  const def = GROUP_DEFS[key];
  const members = state.tabs.filter((tab) => tab.group === key);
  for (const tab of members) tabEls.get(tab.id)?.classList.add("closing");
  await wait(300);
  const memberIds = new Set(members.map((tab) => tab.id));
  state.tabs = state.tabs.filter((tab) => !memberIds.has(tab.id));
  for (const id of memberIds) { tabEls.get(id)?.remove(); tabEls.delete(id); }
  state.appliedGroups = state.appliedGroups.filter((k) => k !== key);
  const stash = { key, name: def.name, tabCount: members.length, tabs: members, brief: null, ago: "just now" };
  state.stashes.unshift(stash);
  renderStrip();
  renderPanels();
  setStatus(`Stashed “${def.name}” · ${members.length} tabs`);
  // the brief "arrives" like the real async AI write
  setTimeout(() => {
    stash.brief = BRIEFS[key] || "Brief unavailable.";
    renderPanels();
  }, 1600);
}

async function resumeStash(stash) {
  if (state.organizing) return;
  snapshot();
  state.stashes = state.stashes.filter((item) => item !== stash);
  for (const tab of stash.tabs) {
    state.tabs.push(tab);
    const el = tabEl(tab);
    el.classList.remove("closing");
    el.classList.add("arriving");
    setTimeout(() => el.classList.remove("arriving"), 400);
  }
  if (!state.appliedGroups.includes(stash.key)) state.appliedGroups.push(stash.key);
  renderStrip();
  renderPanels();
  setStatus(`Restored ${stash.tabCount} tab${stash.tabCount === 1 ? "" : "s"}`);
}

function deleteStash(stash) {
  snapshot();
  state.stashes = state.stashes.filter((item) => item !== stash);
  renderPanels();
  setStatus("Stash deleted");
}

