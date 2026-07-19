// Scripted demo of the organize flow. No network calls — the real extension
// does this against your actual tab strip with a real model.

const GROUPS = [
  { id: "visa", name: "O1 Visa", color: "var(--g-blue)" },
  { id: "react", name: "React Perf", color: "var(--g-yellow)" },
  { id: "tokyo", name: "Tokyo Trip", color: "var(--g-green)" },
];

const TABS = [
  { title: "O-1 Visa: Individuals with Extraordinary Ability — USCIS", icon: "U", iconBg: "#264a9e", group: "visa" },
  { title: "Booking.com: Shinjuku hotels", icon: "B", iconBg: "#1a4fa0", group: "tokyo" },
  { title: "React re-renders: a complete guide", icon: "R", iconBg: "#087ea4", group: "react" },
  { title: "Gmail — inbox (247)", icon: "M", iconBg: "#c5221f", group: null },
  { title: "how hard is the o1 visa actually — r/immigration", icon: "r", iconBg: "#ff4500", group: "visa" },
  { title: "Google Flights: SFO → NRT", icon: "F", iconBg: "#188038", group: "tokyo" },
  { title: "useMemo — React docs", icon: "R", iconBg: "#087ea4", group: "react" },
  { title: "O1 attorney fee comparison — Notion", icon: "N", iconBg: "#37352f", group: "visa" },
  { title: "lofi hip hop radio — YouTube", icon: "▶", iconBg: "#cc0000", group: null },
  { title: "Tokyo 5-day itinerary that isn't touristy", icon: "T", iconBg: "#5f6368", group: "tokyo" },
  { title: "Profiling with React DevTools", icon: "R", iconBg: "#087ea4", group: "react" },
  { title: "O-1 evidence checklist template", icon: "N", iconBg: "#37352f", group: "visa" },
];

const strip = document.getElementById("tabstrip");
const organizeBtn = document.getElementById("organize-btn");
const statusEl = document.getElementById("popup-status");
const countEl = document.getElementById("popup-count");

const prefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let tabEls = [];
let organized = false;

function buildStrip() {
  strip.innerHTML = "";
  tabEls = TABS.map((tab) => {
    const el = document.createElement("div");
    el.className = "tab";
    el.innerHTML = `<span class="favicon" style="background:${tab.iconBg}">${tab.icon}</span><span class="tab-title"></span>`;
    el.querySelector(".tab-title").textContent = tab.title;
    strip.appendChild(el);
    return el;
  });
  countEl.textContent = `${TABS.length} loose tabs`;
  statusEl.textContent = "";
  statusEl.classList.remove("done");
}

function setStatus(text, { spinner = false, done = false } = {}) {
  statusEl.classList.toggle("done", done);
  statusEl.innerHTML = spinner ? `<span class="spinner"></span><span></span>` : `<span></span>`;
  statusEl.lastElementChild.textContent = text;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function organize() {
  if (organized) {
    buildStrip();
    organized = false;
    organizeBtn.textContent = "Organize tabs";
    return;
  }
  organizeBtn.disabled = true;

  setStatus(`Collecting ${TABS.length} tabs…`, { spinner: true });
  await wait(700);
  setStatus("Classifying with AI…", { spinner: true });
  await wait(1600);
  setStatus("Applying groups…", { spinner: true });
  await wait(400);

  applyGroups();

  await wait(prefersReducedMotion ? 100 : 700);
  const groupedCount = TABS.filter((tab) => tab.group).length;
  setStatus(`Done — ${GROUPS.length} groups · ${groupedCount} tabs organized`, { done: true });
  countEl.textContent = "2 loose tabs";
  organized = true;
  organizeBtn.textContent = "Replay demo";
  organizeBtn.disabled = false;
}

function applyGroups() {
  // FLIP: measure, reorder DOM with group chips inserted, then slide from old positions.
  const firstRects = tabEls.map((el) => el.getBoundingClientRect());

  const chips = [];
  const fragment = document.createDocumentFragment();
  for (const group of GROUPS) {
    const chip = document.createElement("span");
    chip.className = "group-chip";
    chip.style.setProperty("--group-color", group.color);
    chip.textContent = group.name;
    fragment.appendChild(chip);
    chips.push(chip);
    TABS.forEach((tab, i) => {
      if (tab.group !== group.id) return;
      tabEls[i].classList.add("grouped");
      tabEls[i].style.setProperty("--group-color", group.color);
      fragment.appendChild(tabEls[i]);
    });
  }
  TABS.forEach((tab, i) => {
    if (!tab.group) fragment.appendChild(tabEls[i]);
  });
  strip.replaceChildren(fragment);

  if (!prefersReducedMotion) {
    const lastRects = tabEls.map((el) => el.getBoundingClientRect());
    tabEls.forEach((el, i) => {
      const dx = firstRects[i].left - lastRects[i].left;
      const dy = firstRects[i].top - lastRects[i].top;
      if (!dx && !dy) return;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.transition = "none";
    });
    strip.getBoundingClientRect(); // force reflow before playing
    tabEls.forEach((el) => {
      el.style.transition = "transform 480ms var(--ease-in-out-strong)";
      el.style.transform = "";
    });
  }

  setTimeout(() => chips.forEach((chip) => chip.classList.add("shown")), prefersReducedMotion ? 0 : 380);
}

organizeBtn.addEventListener("click", organize);
buildStrip();

// ---------- video embed ----------

const videoFrame = document.getElementById("video-frame");
const videoUrl = (videoFrame.dataset.videoUrl || "").trim();
if (!videoUrl) {
  videoFrame.textContent = "Demo video coming soon.";
} else if (videoUrl.endsWith(".mp4") || videoUrl.endsWith(".webm")) {
  const video = document.createElement("video");
  video.src = videoUrl;
  video.controls = true;
  videoFrame.replaceChildren(video);
} else {
  const iframe = document.createElement("iframe");
  iframe.src = videoUrl;
  iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
  iframe.allowFullscreen = true;
  iframe.title = "Regroup demo video";
  videoFrame.replaceChildren(iframe);
}

// ---------- install modal ----------

const modal = document.getElementById("install-modal");
document.getElementById("open-install").addEventListener("click", () => modal.showModal());
document.getElementById("close-install").addEventListener("click", () => modal.close());
modal.addEventListener("click", (event) => {
  if (event.target === modal) modal.close();
});
