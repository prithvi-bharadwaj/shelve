// Optional page-content snippets for ambiguous tabs (needs the scripting permission).

import { SNIPPET_TIMEOUT_MS } from "./constants.js";
import { withTimeout } from "./util.js";

export async function collectSnippets(tabIds, urlById) {
  const snippets = {};
  await Promise.all(
    tabIds.map(async (id) => {
      try {
        const tab = await chrome.tabs.get(id);
        if (urlById && tab.url !== urlById[id]) return;
        // executeScript waits for document_idle, so a page that never finishes
        // loading would otherwise wedge the caller at this stage.
        const [result] = await withTimeout(chrome.scripting.executeScript({
          target: { tabId: id },
          func: () => (document.body ? document.body.innerText.slice(0, 900) : "")
        }), SNIPPET_TIMEOUT_MS);
        if (result?.result) snippets[id] = result.result;
      } catch {
        // The tab disappeared, navigated, is still loading, or cannot be scripted.
      }
    })
  );
  return snippets;
}
