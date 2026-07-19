// Fully scripted simulation of the extension. No AI calls — the popup UI,
// stages, and tab-strip behavior mirror the real extension 1:1.

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

const state = {
  tabs: INITIAL_TABS.map((t) => makeTab(...t)),
  otherWindow: OTHER_WINDOW_TABS.map((t) => makeTab(...t)),
  appliedGroups: [], // ordered keys of GROUP_DEFS
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
    windowCount: state.windowCount,
    otherWindow: state.otherWindow,
  }));
  syncButtons();
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, prefersReducedMotion ? Math.min(ms, 250) : ms));

/* ---------- actions ---------- */

async function organize() {
  if (state.organizing) return;
  state.organizing = true;
  snapshot();
  setStatus("");
  showView(true);
  syncButtons();

  $("org-title").textContent = `Organizing ${looseCount()} tabs`;

  const stagePromise = (async () => {
    for (const stage of STAGES) {
      $("org-stage").textContent = stage.label;
      $("org-stage-2").textContent = stage.label;
      $("org-pct").textContent = `${stage.progress}%`;
      $("org-bar-fill").style.transform = `scaleX(${stage.progress / 100})`;
      await wait(stage.ms);
    }
  })();

  if (state.mergeOnOrganize && state.windowCount > 1) await mergeTabsIn();
  if (state.dedupe) await closeDuplicateTabs();
  await stagePromise;

  const keys = Object.keys(GROUP_DEFS).filter(
    (key) => state.tabs.filter((tab) => tab.group === key).length >= state.minGroup
  );
  state.appliedGroups = keys;
  renderStrip();

  const sorted = state.tabs.filter((tab) => keys.includes(tab.group)).length;
  state.organizing = false;
  showView(false);
  setStatus(`${keys.length} group${keys.length === 1 ? "" : "s"} · ${sorted} tabs sorted`);
  syncButtons();
}

function ungroup() {
  const count = state.tabs.filter((tab) => state.appliedGroups.includes(tab.group)).length;
  if (!count) return setStatus("No grouped tabs in this window.", true);
  snapshot();
  state.appliedGroups = [];
  renderStrip();
  setStatus(`${count} tab${count === 1 ? "" : "s"} ungrouped`);
}

async function closeDuplicateTabs() {
  const seen = new Map();
  const toClose = [];
  for (const tab of state.tabs) {
    const keeper = seen.get(tab.url);
    if (!keeper) { seen.set(tab.url, tab); continue; }
    // keep the active copy, like the real dedupe
    if (tab.active) { toClose.push(keeper); seen.set(tab.url, tab); }
    else toClose.push(tab);
  }
  if (!toClose.length) return 0;
  for (const tab of toClose) {
    const el = tabEls.get(tab.id);
    if (el) el.classList.add("closing");
  }
  await wait(300);
  const closing = new Set(toClose.map((tab) => tab.id));
  state.tabs = state.tabs.filter((tab) => !closing.has(tab.id));
  for (const id of closing) { tabEls.get(id)?.remove(); tabEls.delete(id); }
  renderStrip();
  return toClose.length;
}

async function duplicatesAction() {
  snapshot();
  const closed = await closeDuplicateTabs();
  if (!closed) {
    undoStack.pop(); // nothing changed; the real extension stores no snapshot either
    syncButtons();
    return setStatus("No duplicate tabs found");
  }
  setStatus(`Closed ${closed} duplicate tab${closed === 1 ? "" : "s"}`);
}

async function mergeTabsIn() {
  const arriving = state.otherWindow;
  state.otherWindow = [];
  state.windowCount = 1;
  for (const tab of arriving) {
    state.tabs.push(tab);
    const el = tabEl(tab);
    el.classList.add("arriving");
    setTimeout(() => el.classList.remove("arriving"), 400);
  }
  renderStrip();
  await wait(200);
  return arriving.length;
}

async function mergeAction() {
  if (state.windowCount <= 1) return;
  snapshot();
  const moved = await mergeTabsIn();
  syncButtons();
  setStatus(`Merged 1 window · ${moved} tabs`);
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return setStatus("Nothing to undo.", true);
  const restored = JSON.parse(prev);
  state.tabs = restored.tabs;
  state.appliedGroups = restored.appliedGroups;
  state.windowCount = restored.windowCount;
  state.otherWindow = restored.otherWindow;
  renderStrip();
  syncButtons();
  setStatus("Previous tab layout restored");
}

/* ---------- wiring ---------- */

$("organize-btn").addEventListener("click", organize);
$("qa-ungroup").addEventListener("click", ungroup);
$("qa-duplicates").addEventListener("click", duplicatesAction);
$("qa-merge").addEventListener("click", mergeAction);
$("qa-undo").addEventListener("click", undo);
$("gear-btn").addEventListener("click", () =>
  setStatus("Full settings (provider, model, API keys, budget) live in the real extension.")
);

$("bs-toggle").addEventListener("click", () => {
  const body = $("bs-body");
  body.hidden = !body.hidden;
  $("bs-toggle").setAttribute("aria-expanded", String(!body.hidden));
});
$("min-group").addEventListener("input", (event) => {
  state.minGroup = Number(event.target.value);
  $("min-group-val").textContent = event.target.value;
});
$("opt-dedupe").addEventListener("change", (event) => { state.dedupe = event.target.checked; });
$("opt-merge").addEventListener("change", (event) => { state.mergeOnOrganize = event.target.checked; });
$("opt-monitor").addEventListener("change", (event) =>
  setStatus(event.target.checked ? "Monitor on — the real extension badges the icon at 15 loose tabs." : "")
);

extIcon.addEventListener("click", (event) => {
  event.stopPropagation();
  popup.hidden = !popup.hidden;
  extIcon.classList.remove("pulse");
  $("page-hint").style.visibility = popup.hidden ? "visible" : "hidden";
});
popup.addEventListener("click", (event) => event.stopPropagation());
document.addEventListener("click", (event) => {
  // Chrome closes the popup on any outside click; organizing continues in the background.
  if (!popup.hidden && !$("demo").hidden && !extIcon.contains(event.target)) {
    popup.hidden = true;
    $("page-hint").style.visibility = "visible";
  }
});

$("open-demo").addEventListener("click", () => {
  $("landing").hidden = true;
  $("demo").hidden = false;
  extIcon.classList.add("pulse");
  renderStrip({ flip: false });
});
$("demo-exit").addEventListener("click", () => {
  $("demo").hidden = true;
  $("landing").hidden = false;
  popup.hidden = true;
  $("page-hint").style.visibility = "visible";
});

/* ---------- modals ---------- */

const installModal = $("install-modal");
$("open-install").addEventListener("click", () => installModal.showModal());
$("close-install").addEventListener("click", () => installModal.close());
installModal.addEventListener("click", (event) => { if (event.target === installModal) installModal.close(); });

const videoModal = $("video-modal");
const videoFrame = $("video-frame");
$("open-video").addEventListener("click", (event) => {
  event.preventDefault();
  const url = (videoFrame.dataset.videoUrl || "").trim();
  if (url && !videoFrame.dataset.loaded) {
    videoFrame.dataset.loaded = "1";
    if (url.endsWith(".mp4") || url.endsWith(".webm")) {
      const video = document.createElement("video");
      video.src = url;
      video.controls = true;
      videoFrame.replaceChildren(video);
    } else {
      const iframe = document.createElement("iframe");
      iframe.src = url;
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.title = "Regroup demo video";
      videoFrame.replaceChildren(iframe);
    }
  } else if (!url) {
    videoFrame.textContent = "Demo video coming soon.";
  }
  videoModal.showModal();
});
$("close-video").addEventListener("click", () => videoModal.close());
videoModal.addEventListener("click", (event) => { if (event.target === videoModal) videoModal.close(); });
