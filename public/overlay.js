// Injected into the active tab when the toolbar icon is clicked. Mounts the
// popup UI as a floating extension iframe so it can have rounded corners and
// blur the real page behind it — impossible with a native action popup
// (crbug.com/40852436). Idempotent: re-injection toggles the panel.
(() => {
  if (window.__focusedOverlay) {
    window.__focusedOverlay.toggle();
    return;
  }

  const PANEL_WIDTH = 340;
  const MAX_HEIGHT = 620;
  const RADIUS = 16;
  // Caret: a rotated glass square clipped to its top half, pointing at the
  // toolbar icon. Must match .popup-shell's glass (oklch(0.145 0 0 / .9) on
  // a 1px oklch(1 0 0 / 12%) border) since host CSS can't reach into the iframe.
  const CARET_HEIGHT = 7;
  const CARET_SIZE = 14;
  const CARET_RIGHT = 18;

  let root = null;
  let iframe = null;

  const onDocMouseDown = (event) => {
    if (root && !root.contains(event.target)) close();
  };
  const onDocKeyDown = (event) => {
    if (event.key === "Escape") close();
  };
  const onMessage = (event) => {
    if (!iframe || event.source !== iframe.contentWindow) return;
    const data = event.data;
    if (!data || data.__focusedOverlay !== true) return;
    if (data.close) close();
    else if (typeof data.height === "number" && data.height > 0) {
      iframe.style.height = `${Math.min(Math.ceil(data.height), MAX_HEIGHT)}px`;
    }
  };

  function open() {
    if (root) return;

    root = document.createElement("div");
    Object.assign(root.style, {
      position: "fixed",
      top: "2px",
      right: "8px",
      width: `${PANEL_WIDTH}px`,
      zIndex: "2147483647",
      transition: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "none"
        : "opacity 160ms ease, transform 160ms ease",
      opacity: "0",
      transform: "translateY(-6px)",
    });

    const caretWrap = document.createElement("div");
    Object.assign(caretWrap.style, {
      position: "relative",
      height: `${CARET_HEIGHT}px`,
      overflow: "hidden",
    });
    const caret = document.createElement("div");
    Object.assign(caret.style, {
      position: "absolute",
      top: "2px",
      right: `${CARET_RIGHT}px`,
      width: `${CARET_SIZE}px`,
      height: `${CARET_SIZE}px`,
      transform: "rotate(45deg)",
      background: "rgba(10, 10, 10, 0.78)",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      borderTopLeftRadius: "3px",
      backdropFilter: "blur(24px) saturate(1.15)",
    });
    caretWrap.appendChild(caret);

    iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("popup.html?overlay=1");
    iframe.setAttribute("aria-label", "Focused tab organizer");
    Object.assign(iframe.style, {
      display: "block",
      width: "100%",
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
    });
    iframe.addEventListener("load", () => iframe?.contentWindow?.focus());

    root.append(caretWrap, iframe);
    (document.body || document.documentElement).appendChild(root);
    requestAnimationFrame(() => {
      if (!root) return;
      root.style.opacity = "1";
      root.style.transform = "translateY(0)";
    });
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
    window.addEventListener("message", onMessage);
  }

  function close() {
    if (!root) return;
    root.remove();
    root = null;
    iframe = null;
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
    window.removeEventListener("message", onMessage);
  }

  function toggle() {
    if (root) close();
    else open();
  }

  window.__focusedOverlay = { toggle };
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "toggleOverlay") toggle();
  });

  open();
})();
