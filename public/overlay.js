// Injected into the active tab when the toolbar icon is clicked. Mounts the
// popup UI as a floating extension iframe so it can have rounded corners and
// blur the real page behind it — impossible with a native action popup
// (crbug.com/40852436). No pointer caret: the page cannot know where the
// toolbar icon sits, so an anchored pointer is only possible for the native
// popup fallback, which the browser draws itself. Idempotent: re-injection
// toggles the panel.
(() => {
  if (window.__focusedOverlay) {
    window.__focusedOverlay.toggle();
    return;
  }

  const PANEL_WIDTH = 340;
  const MAX_HEIGHT = 620;
  const RADIUS = 16;

  let iframe = null;
  let contentHeight = 200;

  // The frame is fixed, so anything past the viewport bottom is unreachable —
  // cap against the live viewport, not just MAX_HEIGHT (the popup body
  // scrolls internally when clamped).
  const applyHeight = () => {
    if (!iframe) return;
    const viewportCap = Math.max(120, window.innerHeight - 12);
    iframe.style.height = `${Math.min(contentHeight, MAX_HEIGHT, viewportCap)}px`;
  };

  const onDocMouseDown = (event) => {
    if (iframe && event.target !== iframe) close();
  };
  const onDocKeyDown = (event) => {
    if (event.key === "Escape") close();
  };
  const onResize = () => applyHeight();
  const onMessage = (event) => {
    if (!iframe || event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.__focusedOverlay !== true) return;
    if (data.close) close();
    else if (typeof data.height === "number" && data.height > 0) {
      contentHeight = Math.ceil(data.height);
      applyHeight();
    }
  };

  function open() {
    if (iframe) return;
    iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("popup.html?overlay=1");
    iframe.setAttribute("aria-label", "Focused tab organizer");
    Object.assign(iframe.style, {
      position: "fixed",
      top: "2px",
      right: "8px",
      width: `${PANEL_WIDTH}px`,
      height: "200px",
      border: "0",
      borderRadius: `${RADIUS}px`,
      boxShadow: "0 24px 64px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.3)",
      background: "transparent",
      backdropFilter: "blur(24px) saturate(1.15)",
      // Keep the used color-scheme aligned with the embedded document's so
      // Chrome composites the iframe transparently instead of painting an
      // opaque canvas behind it.
      colorScheme: "light",
      zIndex: "2147483647",
      transition: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "opacity 160ms ease, transform 160ms ease",
      opacity: "0",
      transform: "translateY(-6px)",
    });
    iframe.addEventListener("load", () => iframe?.contentWindow?.focus());
    (document.body || document.documentElement).appendChild(iframe);
    requestAnimationFrame(() => {
      if (!iframe) return;
      iframe.style.opacity = "1";
      iframe.style.transform = "translateY(0)";
    });
    applyHeight();
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("message", onMessage);
  }

  function close() {
    if (!iframe) return;
    iframe.remove();
    iframe = null;
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("message", onMessage);
  }

  function toggle() {
    if (iframe) close();
    else open();
  }

  window.__focusedOverlay = { toggle };
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "toggleOverlay") toggle();
  });

  open();
})();
