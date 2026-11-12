// Background Service Worker - Meta Ads Block Automator
// Handles CORS-free translation requests and extension badge/panel toggling.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATE_TEXT') {
    translateText(message.text, message.targetLang, message.sourceLang || 'auto')
      .then((translated) => sendResponse({ ok: true, translated }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === 'TRANSLATE_BATCH') {
    Promise.all(
      (message.items || []).map(async (item) => {
        if (!item.text || !item.text.trim()) return { key: item.key, translated: '' };
        const translated = await translateText(
          item.text,
          message.targetLang,
          message.sourceLang || 'pt'
        );
        return { key: item.key, translated };
      })
    )
      .then((results) => sendResponse({ ok: true, results }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function translateText(text, targetLang, sourceLang = 'auto') {
  if (!text || !text.trim()) return '';
  // Normalize language codes (e.g., tl -> tl, sr -> sr, etc.)
  const tl = targetLang.trim().toLowerCase();
  const sl = sourceLang.trim().toLowerCase();
  if (tl === sl) return text;

  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(
    sl
  )}&tl=${encodeURIComponent(tl)}&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Erro HTTP na tradução: ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Formato de resposta inesperado do tradutor');
  }
  return data[0].map((segment) => segment[0] || '').join('');
}

