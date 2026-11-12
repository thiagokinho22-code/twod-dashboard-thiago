document.getElementById("btn-open-panel").addEventListener("click", async () => {
  const statusEl = document.getElementById("status-msg");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      statusEl.textContent = "Nenhuma aba ativa encontrada.";
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" }, async (res) => {
      if (chrome.runtime.lastError || !res) {
        // Inject dynamically so user doesn't even have to refresh their open Ads Manager tab!
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["content/panel.css"]
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["data/blocks.js", "content/automator.js"]
        });
        statusEl.textContent = "✅ Painel injetado na aba sem precisar recarregar!";
      } else {
        statusEl.textContent = "✅ Painel exibido na aba!";
      }
    });
  } catch (err) {
    statusEl.style.color = "#f87171";
    statusEl.textContent = "Abra uma aba do Meta Ads Manager primeiro.";
  }
});

