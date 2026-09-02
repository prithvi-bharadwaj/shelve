import { mountGalaxy } from "./galaxy.js";

// ── Galaxy background (respects reduced motion, skips on no WebGL) ──
(function () {
  var bg = document.getElementById("bg");
  if (!bg) return;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var isDoc = document.body.classList.contains("is-doc");
  var dispose = null;

  function mount() {
    if (dispose) dispose();
    dispose = mountGalaxy(bg, {
      hueShift: 200,
      saturation: 0.45,
      density: isDoc ? 0.7 : 1,
      glowIntensity: 0.28,
      twinkleIntensity: 0.4,
      starSpeed: 0.4,
      rotationSpeed: 0.04,
      speed: 0.8,
      mouseRepulsion: !reduce.matches,
      mouseInteraction: !reduce.matches,
      repulsionStrength: 1.6,
      disableAnimation: reduce.matches,
    });
  }
  reduce.addEventListener("change", mount);
  mount();
})();

// ── Stat count-up ────────────────────────────────────
(function () {
  var values = document.querySelectorAll(".stat-value[data-target]");
  var stats = document.querySelector(".stats");
  if (!values.length || !stats) return;

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function countUp(el, i) {
    var target = parseFloat(el.dataset.target || "0");
    var prefix = el.dataset.prefix || "";
    var suffix = el.dataset.suffix || "";
    var duration = 1400 + i * 80;
    var startDelay = 500 + i * 90;
    var start = null;

    function frame(now) {
      if (start === null) start = now;
      var t = Math.min((now - start) / duration, 1);
      el.textContent = prefix + Math.round(target * easeOutCubic(t)) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    }
    setTimeout(function () {
      requestAnimationFrame(frame);
    }, startDelay);
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    values.forEach(function (el) {
      el.textContent = (el.dataset.prefix || "") + el.dataset.target + (el.dataset.suffix || "");
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      values.forEach(countUp);
      observer.disconnect();
    },
    { threshold: 0.25 }
  );
  observer.observe(stats);
})();

// ── Mobile menu ──────────────────────────────────────
(function () {
  var burger = document.querySelector(".burger");
  var overlay = document.getElementById("menu-overlay");
  var menu = document.getElementById("mobile-menu");
  if (!burger || !overlay || !menu) return;

  var page = document.querySelector(".page");

  function isOpen() {
    return burger.getAttribute("aria-expanded") === "true";
  }

  function setOpen(open) {
    burger.setAttribute("aria-expanded", String(open));
    burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    overlay.hidden = !open;
    menu.hidden = !open;
    document.body.classList.toggle("menu-open", open);
    if (page) page.inert = open;
    if (open) {
      var first = menu.querySelector("a");
      if (first) first.focus();
    } else {
      burger.focus();
    }
  }

  // Keep Tab inside the open menu (burger lives outside it in the DOM)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) return setOpen(false);
    if (e.key !== "Tab" || !isOpen()) return;
    var focusables = [burger].concat(Array.prototype.slice.call(menu.querySelectorAll("a")));
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  burger.addEventListener("click", function () { setOpen(!isOpen()); });
  overlay.addEventListener("click", function () { setOpen(false); });
  menu.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () { setOpen(false); });
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 760 && isOpen()) setOpen(false);
  });
})();

// ── Uninstall feedback (bye page) ────────────────────
(function () {
  var reasons = document.getElementById("reasons");
  var thanks = document.getElementById("thanks");
  if (!reasons || !thanks) return;
  reasons.addEventListener("click", function (e) {
    var btn = e.target.closest("button[data-reason]");
    if (!btn) return;
    fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: btn.dataset.reason }),
    }).catch(function () {});
    reasons.hidden = true;
    thanks.hidden = false;
  });
})();
