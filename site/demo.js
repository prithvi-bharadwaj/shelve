// Page wiring: command bar, onboarding overlay, navigation, and modals.
// Depends on the simulation core in sim.js (loaded first).

/* ---------- command bar ---------- */

const cmdInput = $("cmd-input");
const cmdResult = $("cmd-result");
const cmdResultText = $("cmd-result-text");
const cmdGoto = $("cmd-goto");
let cmdTargetTab = null;

// Topic fallback so paraphrased queries ("the pet-friendly place") still resolve,
// approximating what the model does with full tab context.
const TOPIC_WORDS = {
  tokyo: ["hotel", "pet", "place", "stay", "night", "tokyo", "flight", "ramen", "japan", "trip", "airbnb"],
  visa: ["visa", "attorney", "fee", "lawyer", "letter", "immigration", "uscis", "evidence"],
  react: ["react", "render", "memo", "profil", "perf", "devtools", "slow", "component"],
};

function topicFor(query) {
  const lower = query.toLowerCase();
  for (const [topic, words] of Object.entries(TOPIC_WORDS)) {
    if (words.some((word) => lower.includes(word))) return topic;
  }
  return null;
}

const STOP_WORDS = new Set([
  "the", "and", "with", "that", "this", "tab", "tabs", "open", "which", "what", "where",
  "who", "how", "had", "have", "has", "was", "were", "for", "you", "your", "did", "does",
  "one", "its", "about", "show", "find", "goto",
]);

function findTab(query) {
  const words = query.toLowerCase().split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  let best = null;
  let bestScore = 0;
  for (const tab of state.tabs) {
    const haystack = `${tab.title} ${tab.url}`.toLowerCase();
    const score = words.reduce((total, word) => total + (haystack.includes(word) ? 1 : 0), 0);
    if (score > bestScore) { best = tab; bestScore = score; }
  }
  return best;
}

function focusTab(tab) {
  for (const item of state.tabs) item.active = item === tab;
  if (tab.group) state.collapsed.delete(tab.group); // jumping into a collapsed group expands it

  document.querySelector(".omnibox").textContent = tab.url;
  renderStrip();
}

async function runCommand() {
  const query = cmdInput.value.trim();
  if (!query || state.organizing) return;
  $("cmd-send").hidden = true;
  $("cmd-spinner").hidden = false;
  cmdResult.hidden = true;
  cmdInput.disabled = true;
  await wait(1100);
  $("cmd-send").hidden = false;
  $("cmd-spinner").hidden = true;
  cmdInput.disabled = false;

  const topic = topicFor(query);
  const match = findTab(query) || (topic ? state.tabs.find((tab) => tab.group === topic) : null);
  const isGroupRequest = /\b(group|collect|bundle)\b/i.test(query);
  const isQuestion = /\?|^(which|what|where|who|how)\b/i.test(query);
  cmdResult.hidden = false;
  cmdGoto.hidden = true;
  cmdResult.classList.remove("error");
  if (!match) {
    cmdResult.classList.add("error");
    cmdResultText.textContent = "No open tab matches that.";
    return;
  }
  if (isGroupRequest && topic) {
    const members = state.tabs.filter((tab) => tab.group === topic);
    if (!state.appliedGroups.includes(topic)) {
      snapshot();
      state.appliedGroups.push(topic);
      state.collapsed.delete(topic);
      renderStrip();
      renderPanels();
    }
    cmdInput.value = "";
    cmdResultText.textContent = `Created “${GROUP_DEFS[topic].name}” with ${members.length} tab${members.length === 1 ? "" : "s"}`;
    return;
  }
  if (isQuestion) {
    // topic beats title-word overlap for questions — the model answers from content
    const answer = ANSWERS[topic || match.group];
    cmdTargetTab = (answer && findTab(answer.url)) || match;
    cmdResultText.textContent = answer ? answer.text : `Closest match: “${match.title}”.`;
    cmdGoto.hidden = false;
  } else {
    focusTab(match);
    cmdResultText.textContent = `Jumped to “${match.title}”`;
  }
}

cmdInput.addEventListener("keydown", (event) => { if (event.key === "Enter") runCommand(); });
$("cmd-send").addEventListener("click", runCommand);
cmdGoto.addEventListener("click", () => {
  if (!cmdTargetTab) return;
  focusTab(cmdTargetTab);
  cmdResultText.textContent = `Jumped to “${cmdTargetTab.title}”`;
  cmdGoto.hidden = true;
});

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
  // filing cascade: groups snap in one after another, like the real apply animation
  state.appliedGroups = [];
  for (const key of keys) {
    state.appliedGroups.push(key);
    renderStrip();
    await wait(280);
  }

  const sorted = state.tabs.filter((tab) => keys.includes(tab.group)).length;
  state.organizing = false;
  showView(false);
  renderPanels();
  setStatus(`${keys.length} group${keys.length === 1 ? "" : "s"} · ${sorted} tabs sorted`);
  syncButtons();
}

function ungroup() {
  const count = state.tabs.filter((tab) => state.appliedGroups.includes(tab.group)).length;
  if (!count) return setStatus("No grouped tabs in this window.", true);
  snapshot();
  state.appliedGroups = [];
  renderStrip();
  renderPanels();
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
  renderPanels();
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
  renderPanels();
  setStatus(`Merged 1 window · ${moved} tabs`);
}

function undo() {
  const prev = undoStack.pop();
  if (!prev) return setStatus("Nothing to undo.", true);
  const restored = JSON.parse(prev);
  state.tabs = restored.tabs;
  state.appliedGroups = restored.appliedGroups;
  state.stashes = restored.stashes || [];
  state.windowCount = restored.windowCount;
  state.otherWindow = restored.otherWindow;
  renderStrip();
  renderPanels();
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

$("groups-toggle").addEventListener("click", () => {
  const list = $("groups-list");
  list.hidden = !list.hidden;
  $("groups-toggle").setAttribute("aria-expanded", String(!list.hidden));
});

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

function dismissOnboard() {
  $("onboard").hidden = true;
  document.querySelector(".chrome").classList.remove("onboard-active");
}

extIcon.addEventListener("click", (event) => {
  event.stopPropagation();
  dismissOnboard();
  popup.hidden = !popup.hidden;
  extIcon.classList.remove("pulse");
  $("page-hint").style.visibility = popup.hidden ? "visible" : "hidden";
});
$("onboard-skip").addEventListener("click", dismissOnboard);
$("onboard").addEventListener("click", (event) => { if (event.target === $("onboard")) dismissOnboard(); });
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
  $("onboard").hidden = false;
  document.querySelector(".chrome").classList.add("onboard-active");
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
// chrome:// URLs can't be opened from a web page, so the "link" copies instead
$("chrome-url").addEventListener("click", (event) => {
  event.preventDefault();
  navigator.clipboard?.writeText("chrome://extensions").catch(() => {});
  const hint = $("copy-hint");
  hint.textContent = "copied — paste it into a new tab";
  hint.classList.add("copied");
});
$("close-install").addEventListener("click", () => installModal.close());
installModal.addEventListener("click", (event) => { if (event.target === installModal) installModal.close(); });

const videoModal = $("video-modal");
const videoFrame = $("video-frame");
function openVideo(event) {
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
      iframe.title = "Focused demo video";
      videoFrame.replaceChildren(iframe);
    }
  } else if (!url) {
    videoFrame.textContent = "Demo video coming soon.";
  }
  videoModal.showModal();
}
$("open-video").addEventListener("click", openVideo);
$("note-video").addEventListener("click", openVideo);
$("note-install").addEventListener("click", () => installModal.showModal());
$("close-video").addEventListener("click", () => videoModal.close());
videoModal.addEventListener("click", (event) => { if (event.target === videoModal) videoModal.close(); });
