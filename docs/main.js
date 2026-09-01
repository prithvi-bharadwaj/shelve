// ── Reduced motion: stop the background video ────────
(function () {
  var video = document.querySelector(".bg-video");
  if (!video) return;
  var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  function apply() {
    if (mq.matches) {
      video.pause();
      video.removeAttribute("autoplay");
    } else {
      video.play().catch(function () {});
    }
  }
  mq.addEventListener("change", apply);
  apply();
})();

// ── Stat count-up ────────────────────────────────────
(function () {
  var values = document.querySelectorAll(".stat-value");
  if (!values.length) return;

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function countUp(el, i) {
    var target = parseFloat(el.dataset.target || "0");
    var suffix = el.dataset.suffix || "";
    var decimals = parseInt(el.dataset.decimals || "0", 10);
    var duration = 1500 + i * 80;
    var startDelay = 480 + i * 90;
    var start = null;

    function frame(now) {
      if (start === null) start = now;
      var t = Math.min((now - start) / duration, 1);
      var value = target * easeOutCubic(t);
      el.textContent = value.toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(frame);
    }

    setTimeout(function () {
      requestAnimationFrame(frame);
    }, startDelay);
  }

  var started = false;
  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !started) {
          started = true;
          values.forEach(countUp);
          observer.disconnect();
        }
      });
    },
    { threshold: 0.25 }
  );

  observer.observe(document.querySelector(".stats"));
})();

// ── Mobile menu ──────────────────────────────────────
(function () {
  var burger = document.querySelector(".burger");
  var overlay = document.getElementById("menu-overlay");
  var menu = document.getElementById("mobile-menu");
  if (!burger || !overlay || !menu) return;

  var page = document.querySelector(".page");

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
    if (e.key !== "Tab" || !isOpen()) return;
    var focusables = [burger].concat(
      Array.prototype.slice.call(menu.querySelectorAll("a"))
    );
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

  function isOpen() {
    return burger.getAttribute("aria-expanded") === "true";
  }

  burger.addEventListener("click", function () {
    setOpen(!isOpen());
  });

  overlay.addEventListener("click", function () {
    setOpen(false);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) setOpen(false);
  });

  menu.querySelectorAll("a").forEach(function (link) {
    link.addEventListener("click", function () {
      setOpen(false);
    });
  });

  window.addEventListener("resize", function () {
    if (window.innerWidth > 720 && isOpen()) setOpen(false);
  });
})();
