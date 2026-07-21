import React from "react";
import ReactDOM from "react-dom/client";
import "@/styles/globals.css";
import { Popup } from "./Popup";

// Overlay mode: the popup is embedded as a rounded iframe in the current page
// (see public/overlay.js). The host script owns our size and lifetime, so we
// report content height and ask it to close on Escape.
if (new URLSearchParams(window.location.search).has("overlay")) {
  document.documentElement.dataset.overlay = "";
  const reportHeight = () =>
    window.parent.postMessage({ __focusedOverlay: true, height: document.body.scrollHeight }, "*");
  new ResizeObserver(reportHeight).observe(document.body);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      window.parent.postMessage({ __focusedOverlay: true, close: true }, "*");
    }
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>
);
