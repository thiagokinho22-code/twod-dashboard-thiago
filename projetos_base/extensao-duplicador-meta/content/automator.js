// Content Script - Meta Ads Block Automator
(function () {
  if (window.__MAB_AUTOMATOR_LOADED__) return;
  window.__MAB_AUTOMATOR_LOADED__ = true;

  const BLOCKS = window.META_ADS_BLOCKS_DEFAULT || {};

  // Default state persisted in chrome.storage.local
  const state = {
    selectedBlockId: "BLOCO-03",
    checkedCountries: {}, // { "BLOCO-03": { "França": true, ... } }
    doneCountries: {},    // { "BLOCO-03": { "Gabão": true, ... } }
    currentAdSetSidebarEl: null,
    options: {
      updateName: true,
      updateAdName: true,
      adNameFormat: "country_only",
      updateCountry: true,
      updateBudget: true,
      budgetValue: "1.00",
      updateAdvertiser: true,
      advertiserName: "Futuretech Dynamics LLC",
      updateAdChild: false, // auto-enabled on BLOCO-02 or when user toggles
      updateUrlLang: true,
      translateTexts: true,
      removeOldCreatives: false,
      ensureActive: true,
      stepDelayMs: 900
    },
    baseTexts: {
      sourceLang: "pt",
      primaryText: "TREINE PRA PASSAR NA PROVA DE HABILITAÇÃO.",
      headline: "📲 SIMULADO DA PROVA",
      description: "",
      urlTemplate: ""
    },
    manualTranslateLang: "fr",
    previewTranslations: {
      primaryText: "",
      headline: "",
      description: ""
    },
    conferirReady: false,
    conferirSource: {
      url: "",
      primaryTexts: [],
      headlines: [],
      descriptions: []
    },
    isRunning: false,
    stopRequested: false,
    activeTab: "tab-blocks",
    minimized: false
  };

  // Initialize default checked states for all blocks
  Object.keys(BLOCKS).forEach((blockId) => {
    state.checkedCountries[blockId] = {};
    state.doneCountries[blockId] = {};
    BLOCKS[blockId].countries.forEach((c) => {
      state.checkedCountries[blockId][c.adSetName] = true;
      state.doneCountries[blockId][c.adSetName] = false;
    });
  });

  // Load saved state from storage
  function loadState(cb) {
    if (!chrome?.storage?.local) {
      if (cb) cb();
      return;
    }
    chrome.storage.local.get(["mabState_v1"], (res) => {
      if (res && res.mabState_v1) {
        const saved = res.mabState_v1;
        if (saved.selectedBlockId && BLOCKS[saved.selectedBlockId]) {
          state.selectedBlockId = saved.selectedBlockId;
        }
        if (saved.checkedCountries) {
          Object.assign(state.checkedCountries, saved.checkedCountries);
        }
        if (saved.doneCountries) {
          Object.assign(state.doneCountries, saved.doneCountries);
        }
        if (saved.options) {
          Object.assign(state.options, saved.options);
        }
        // In single-language blocks (e.g. BLOCO-03 Francês), keep updateAdChild false by default so copies don't re-check the Ad
        if (BLOCKS[state.selectedBlockId]?.singleLanguage) {
          state.options.updateAdChild = false;
        }
        if (saved.baseTexts) {
          Object.assign(state.baseTexts, saved.baseTexts);
        }
        if (saved.manualTranslateLang) {
          state.manualTranslateLang = saved.manualTranslateLang;
        }
        if (saved.conferirSource) {
          state.conferirSource = saved.conferirSource;
          if (
            state.conferirSource.primaryTexts?.length > 0 ||
            state.conferirSource.headlines?.length > 0
          ) {
            state.conferirReady = true;
          }
        }
      }
      if (cb) cb();
    });
  }

  function saveState() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.set({
      mabState_v1: {
        selectedBlockId: state.selectedBlockId,
        checkedCountries: state.checkedCountries,
        doneCountries: state.doneCountries,
        options: state.options,
        baseTexts: state.baseTexts,
        conferirSource: state.conferirSource,
        manualTranslateLang: state.manualTranslateLang
      }
    });
  }

  // =========================================================================
  // LOGGING & UTILITIES (WITH INSTANT STOP ABORT)
  // =========================================================================
  class AutomationStoppedError extends Error {
    constructor() {
      super("AUTOMATION_STOPPED");
      this.name = "AutomationStoppedError";
    }
  }

  function checkStopNow() {
    if (state.isRunning && state.stopRequested) {
      throw new AutomationStoppedError();
    }
  }

  const rawSleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function sleep(ms) {
    checkStopNow();
    const step = 40;
    let elapsed = 0;
    while (elapsed < ms) {
      await rawSleep(Math.min(step, ms - elapsed));
      elapsed += step;
      checkStopNow();
    }
  }

  function normalizeStr(str) {
    return (str || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function log(msg, level = "info") {
    console.log(`[MetaAdsAutomator][${level.toUpperCase()}]`, msg);
    const box = document.getElementById("mab-log-container");
    if (!box) return;
    const line = document.createElement("div");
    line.className = `mab-log-entry mab-log-${level}`;
    const time = new Date().toLocaleTimeString("pt-BR", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    line.textContent = `[${time}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }

  // React 18 & Lexical / Draft.js compatible value setter
  async function setReactInputValue(el, value, pressEnter = false) {
    checkStopNow();
    if (!el) return false;
    el.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(100);

    el.focus();
    el.click();
    await sleep(80);

    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea") {
      const proto =
        tag === "textarea"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;

      // Clear first
      el.select?.();
      if (nativeSetter) {
        nativeSetter.call(el, "");
      } else {
        el.value = "";
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: "" }));

      // Try execCommand insertText first (triggers React's internal value tracker in Chrome)
      const execOk = document.execCommand("insertText", false, value);
      if (!execOk || el.value !== value) {
        if (nativeSetter) {
          nativeSetter.call(el, value);
        } else {
          el.value = value;
        }
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: value
          })
        );
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      // Meta Ads Manager uses Lexical / Draft.js contenteditable divs for Primary Text, Headline, Description, and sometimes Location Search
      el.focus();
      await sleep(60);

      // Select all existing content inside contenteditable
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      selection.removeAllRanges();
      selection.addRange(range);
      await sleep(50);

      // Delete existing text and insert new text via execCommand (triggers Lexical/DraftJS listeners cleanly)
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      await sleep(50);

      const inserted = document.execCommand("insertText", false, value);
      if (!inserted) {
        el.textContent = value;
        el.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: value
          })
        );
      }
    }

    await sleep(100);
    if (pressEnter) {
      el.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true
        })
      );
      el.dispatchEvent(
        new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true
        })
      );
    }
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  function simulateClick(el) {
    checkStopNow();
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
    el.dispatchEvent(new PointerEvent("pointerdown", opts));
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new PointerEvent("pointerup", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  // =========================================================================
  // PAGE LEVEL DETECTION & TOP BREADCRUMB NAVIGATION (CONJUNTO <-> ANÚNCIO)
  // =========================================================================
  function getCurrentEditorLevel() {
    const url = (window.location.href || "").toLowerCase();
    const hasAdUrl = url.includes("/ads/edit");
    const hasAdSetUrl = url.includes("/adsets/edit");

    // Inspect visible section titles/labels in the main editor pane
    const editorLabels = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, label, span, div")
    )
      .filter((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const r = el.getBoundingClientRect();
        return (
          r.left > 210 &&
          r.left < window.innerWidth - 240 &&
          r.top > 75 &&
          r.width < 700 &&
          r.height < 60 &&
          el.children.length <= 2
        );
      })
      .map((el) => normalizeStr(el.innerText || el.textContent || ""));

    const adSetMarkers = [
      "ad set name",
      "nome do conjunto de anuncios",
      "nome do conjunto",
      "budget & schedule",
      "orcamento e programacao",
      "budget strategy",
      "estrategia de orcamento",
      "daily budget",
      "orcamento diario",
      "lifetime budget",
      "orcamento vitalicio",
      "performance goal",
      "meta de desempenho"
    ];

    // NOTE: NEVER include "ad creative" / "criativo do anuncio" as ad markers because
    // Meta shows "Advantage+ creative" and recommendation cards with "ad creative" inside the Ad Set!
    const adMarkers = [
      "ad name",
      "nome do anuncio",
      "ad setup",
      "configuracao do anuncio",
      "primary text",
      "texto principal",
      "website url",
      "url do site",
      "destination",
      "destino",
      "call to action",
      "chamada para acao",
      "identity",
      "identidade"
    ];

    const hasAdSetDom = editorLabels.some((t) =>
      adSetMarkers.some((m) => t === m || t.startsWith(m))
    );
    const hasAdDom = editorLabels.some((t) =>
      adMarkers.some((m) => t === m || t.startsWith(m))
    );

    // Prioritize explicit URL matches combined with DOM confirmation
    if (hasAdUrl && hasAdDom) return "ad";
    if (hasAdSetUrl && hasAdSetDom) return "adset";

    if (hasAdDom && !hasAdSetDom) return "ad";
    if (hasAdSetDom && !hasAdDom) return "adset";

    // Check top breadcrumbs: if ending in "1 Ad" / "X Ads", we are still at the Ad Set level!
    const crumbs = getTopBreadcrumbItems();
    if (crumbs.length > 0) {
      const lastCrumb = crumbs[crumbs.length - 1];
      if (/^\d+\s*(ad|ads|anuncio|anuncios)$/i.test(lastCrumb.normText)) {
        return "adset";
      }
    }

    if (hasAdUrl) return "ad";
    if (hasAdSetUrl) return "adset";
    return "unknown";
  }

  // Finds the breadcrumb buttons at the top of the editor: [Campaign] > [Conjunto] > [1 Ad / Anúncio]
  function getTopBreadcrumbItems() {
    const ignoredTexts = new Set([
      ">",
      "/",
      "edit",
      "editar",
      "review",
      "revisar",
      "in draft",
      "em rascunho",
      "rascunho",
      "search",
      "pesquisar",
      "procurar",
      "close",
      "fechar",
      "help",
      "ajuda",
      "help tray search bar",
      "search bar"
    ]);

    const allLeafs = Array.from(document.querySelectorAll("span, div, a, button")).filter(
      (el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        if (el.closest('[aria-label*="help" i], [data-testid*="help" i]')) return false;
        const r = el.getBoundingClientRect();
        // Top breadcrumb bar sits at the top of the main editor pane (y: 0..85, x: 210..right-240)
        if (r.top < 0 || r.top > 85 || r.bottom > 105) return false;
        if (r.left < 210 || r.right > window.innerWidth - 240) return false;
        if (r.width < 16 || r.height < 12 || r.height > 48) return false;

        const hasChildText = Array.from(el.children).some(
          (c) => (c.innerText || c.textContent || "").trim().length > 0
        );
        if (hasChildText) return false;

        const txt = (el.innerText || el.textContent || "").trim();
        if (!txt || txt.includes("\n") || txt.length > 90) return false;
        const norm = normalizeStr(txt);
        if (ignoredTexts.has(norm)) return false;
        return /[a-zA-Z0-9À-ÿ]/.test(txt);
      }
    );

    const items = [];
    for (const el of allLeafs) {
      const r = el.getBoundingClientRect();
      const txt = (el.innerText || el.textContent || "").trim();
      const norm = normalizeStr(txt);

      // Deduplicate items at approximately the same horizontal position
      if (items.some((it) => Math.abs(it.left - r.left) < 18)) continue;

      const clickable =
        el.closest('[role="button"], a, button, [tabindex="0"]') || el.parentElement || el;

      items.push({
        text: txt,
        normText: norm,
        textEl: el,
        clickEl: clickable,
        left: r.left,
        top: r.top,
        rect: r
      });
    }

    items.sort((a, b) => a.left - b.left);
    return items;
  }

  async function ensureOnAdSetPage(expectedAdSetName = "") {
    const crumbs = getTopBreadcrumbItems();
    const normExpected = normalizeStr(expectedAdSetName);

    // If already on an Ad Set AND it matches expectedAdSetName (or none specified), return true
    if (getCurrentEditorLevel() === "adset") {
      if (!normExpected || (crumbs.length >= 2 && crumbs[1].normText === normExpected)) {
        return true;
      }
    }

    log("🔀 Trocando para a página do Conjunto...", "info");

    // 1. If an expectedAdSetName was given, search and click in the sidebar
    if (normExpected) {
      const opened = await navigateToSidebarAdSetByName(expectedAdSetName);
      if (opened) {
        await sleep(500);
        if (getCurrentEditorLevel() === "adset") return true;
      }
    }

    // 2. Click the Ad Set row in the left sidebar tree (guarantees Ad Set level, never child ad!)
    const adSetRows = getAdSetSidebarItems();
    const sidebarTarget =
      (normExpected && adSetRows.find((r) => r.normText === normExpected)) ||
      (crumbs.length >= 2 && adSetRows.find((r) => r.normText === crumbs[1].normText)) ||
      adSetRows.find((r) => r.normText === "conferir") ||
      adSetRows.find((r) => r.normText === "franca" || r.normText === "frança") ||
      adSetRows[0];

    if (sidebarTarget && sidebarTarget.textEl) {
      log(`🔀 Clicando no Conjunto "${sidebarTarget.text}" na barra lateral esquerda...`, "info");
      sidebarTarget.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(180);
      simulateClick(sidebarTarget.textEl);
      if (sidebarTarget.rowEl && sidebarTarget.rowEl !== sidebarTarget.textEl) {
        simulateClick(sidebarTarget.rowEl);
      }
      for (let i = 0; i < 8; i++) {
        await sleep(320);
        if (getCurrentEditorLevel() === "adset") {
          log(`✅ Página do Conjunto aberta ("${sidebarTarget.text}").`, "ok");
          return true;
        }
      }
    }

    // 3. Fallback: Click the Ad Set crumb in top breadcrumbs [Campaign] > [Ad Set] > [Ad]
    let adSetCrumb = null;
    if (crumbs.length >= 2) {
      adSetCrumb = crumbs[1];
    } else if (normExpected) {
      adSetCrumb = crumbs.find((c) => c.normText === normExpected);
    }

    if (adSetCrumb) {
      simulateClick(adSetCrumb.textEl);
      if (adSetCrumb.clickEl && adSetCrumb.clickEl !== adSetCrumb.textEl) {
        simulateClick(adSetCrumb.clickEl);
      }
      for (let i = 0; i < 7; i++) {
        await sleep(300);
        if (getCurrentEditorLevel() === "adset") {
          log(`✅ Página do Conjunto aberta ("${adSetCrumb.text}").`, "ok");
          return true;
        }
      }
    }

    return getCurrentEditorLevel() === "adset";
  }

  async function ensureOnAdPage(adSetName = "") {
    if (getCurrentEditorLevel() === "ad") return true;

    // Strategy 1: Open the child Ad row in the left sidebar directly
    // This is the most reliable way in Meta Ads Manager because the tree row sits right beneath the Ad Set!
    const items = getSidebarItems();
    const normTarget = normalizeStr(adSetName || "conferir");

    let childAdItem = null;

    // Priority 1A: Look right beneath the exact Ad Set element we currently have active
    if (state.currentAdSetSidebarEl) {
      const activeIdx = items.findIndex((it) => it.textEl === state.currentAdSetSidebarEl);
      if (activeIdx >= 0 && activeIdx + 1 < items.length) {
        const candidate = items[activeIdx + 1];
        if (
          candidate.normText.startsWith("novo anuncio") ||
          candidate.normText.startsWith("new ") ||
          candidate.left > items[activeIdx].left + 6 ||
          /ad|anuncio/i.test(candidate.text)
        ) {
          childAdItem = candidate;
        }
      }
    }

    // Priority 1B: If multiple items match normTarget, prefer the currently selected tree row
    if (!childAdItem && normTarget) {
      const matchingAdSetIndices = [];
      for (let i = 0; i < items.length; i++) {
        const normItem = items[i].normText;
        if (
          normItem === normTarget ||
          (normTarget === "conferir" && (normItem === "conferir" || COPY_REGEX.test(items[i].text)))
        ) {
          matchingAdSetIndices.push(i);
        }
      }

      for (const idx of matchingAdSetIndices) {
        const el = items[idx].textEl;
        const row = el.closest('[role="treeitem"], [role="row"], li, div');
        const isSelected =
          row?.getAttribute("aria-selected") === "true" ||
          row?.getAttribute("aria-current") === "true" ||
          el.getAttribute("aria-selected") === "true";
        if (isSelected && idx + 1 < items.length) {
          childAdItem = items[idx + 1];
          break;
        }
      }

      if (!childAdItem && matchingAdSetIndices.length > 0) {
        // If none is explicitly selected, use the first matching one
        const firstIdx = matchingAdSetIndices[0];
        if (firstIdx + 1 < items.length) {
          childAdItem = items[firstIdx + 1];
        }
      }
    }

    if (!childAdItem) {
      childAdItem = items.find(
        (it) => it.normText.startsWith("novo anuncio") || it.normText.startsWith("new ")
      );
    }

    if (childAdItem) {
      log(`🔀 Clicando no anúncio ("${childAdItem.text}") na barra lateral esquerda...`, "info");
      simulateClick(childAdItem.textEl);
      for (let i = 0; i < 8; i++) {
        await sleep(350);
        if (getCurrentEditorLevel() === "ad") {
          await sleep(400);
          log(`✅ Página do Anúncio ("${childAdItem.text}") aberta!`, "ok");
          return true;
        }
      }
    }

    // Strategy 2: Click the Ad button in the top breadcrumb bar (e.g. "1 Ad" / "1 anúncio")
    const crumbs = getTopBreadcrumbItems();
    const adPattern = /^\d+\s*(ad|ads|anuncio|anuncios)$/i;

    let adCrumb = crumbs.find(
      (c) =>
        adPattern.test(c.normText) ||
        c.normText.startsWith("novo anuncio") ||
        c.normText.startsWith("new ")
    );
    if (!adCrumb && crumbs.length >= 3) {
      adCrumb = crumbs[crumbs.length - 1];
    }

    if (adCrumb) {
      log(`🔀 Clicando no botão superior "${adCrumb.text}" para abrir a página do Anúncio...`, "info");
      simulateClick(adCrumb.textEl);
      if (adCrumb.clickEl && adCrumb.clickEl !== adCrumb.textEl) {
        simulateClick(adCrumb.clickEl);
      }

      for (let i = 0; i < 7; i++) {
        await sleep(350);
        if (getCurrentEditorLevel() === "ad") {
          await sleep(400);
          log("✅ Página do Anúncio aberta pelo topo!", "ok");
          return true;
        }

        // Check if clicking "1 Ad" opened a dropdown popover listing the ad right below the top bar
        if (i === 2) {
          const popoverOption = Array.from(
            document.querySelectorAll(
              '[role="menuitem"], [role="option"], [role="menu"] span, [role="listbox"] span, div, span'
            )
          ).find((el) => {
            if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
            const r = el.getBoundingClientRect();
            if (r.top < adCrumb.rect.bottom - 4 || r.top > adCrumb.rect.bottom + 200) return false;
            if (Math.abs(r.left - adCrumb.rect.left) > 180) return false;
            if (el.children.length > 1) return false;
            const t = normalizeStr(el.innerText || "");
            return (
              t.startsWith("novo anuncio") ||
              t.startsWith("new ") ||
              (t.length > 2 && t !== adCrumb.normText)
            );
          });
          if (popoverOption) {
            log(`🔀 Selecionando anúncio "${(popoverOption.innerText || "").trim()}" no menu...`, "info");
            simulateClick(popoverOption);
          }
        }
      }
    }

    log("❌ Não foi possível mudar para a página do Anúncio. Continuando sem editar campos do anúncio.", "err");
    return false;
  }

  // =========================================================================
  // SIDEBAR TREE SCANNER (LEFT PANEL OF META ADS MANAGER)
  // =========================================================================
  const COPY_REGEX = /\s*[-–—]\s*(Copy|Cópia)(\s+\d+)?$/i;

  function getSidebarItems() {
    // Look at elements in the left tree pane (x between 40 and 320, y > 90)
    const allElements = Array.from(document.querySelectorAll("span, div, a"));
    const candidates = [];

    for (const el of allElements) {
      if (!isVisible(el)) continue;
      if (el.closest("#mab-root-panel")) continue;

      // Only take leaf text elements (no child elements with their own text) so parent wrappers never block inner spans
      const hasElementChildrenWithText = Array.from(el.children).some(
        (child) => (child.innerText || child.textContent || "").trim().length > 0
      );
      if (hasElementChildrenWithText) continue;

      const rect = el.getBoundingClientRect();
      // Left campaign/adset tree in Meta Ads Manager starts at x >= 68 (x < 68 is the dark global navigation icon rail!)
      if (rect.left < 68 || rect.left > 320) continue;
      if (rect.top < 95 || rect.bottom > window.innerHeight - 10) continue;
      // Note: short names like "Mali", "Togo", "Peru" can be ~18px wide!
      if (rect.height < 12 || rect.height > 52 || rect.width < 12 || rect.width > 290) continue;

      const directText = (el.innerText || el.textContent || "").trim();
      if (!directText || directText.includes("\n") || directText.length > 90) continue;
      // Must contain at least 2 letters
      if (!/[a-zA-ZÀ-ÿ]{2,}/.test(directText)) continue;
      // Ignore UI chrome labels in the sidebar
      const norm = normalizeStr(directText);
      if (
        norm === "search" ||
        norm === "pesquisar" ||
        norm === "procurar" ||
        norm === "account overview" ||
        norm === "visao geral da conta" ||
        norm === "campaigns" ||
        norm === "campanhas" ||
        norm === "all tools" ||
        norm === "todas as ferramentas"
      ) {
        continue;
      }

      // Avoid exact duplicate text on the same vertical row
      if (
        candidates.some(
          (c) => Math.abs(c.top - rect.top) < 6 && normalizeStr(c.text) === norm
        )
      ) {
        continue;
      }

      // Find clickable row container
      const row =
        el.closest('[role="treeitem"], [role="row"], [role="button"], [tabindex="0"], a') ||
        el.parentElement;

      candidates.push({
        text: directText,
        normText: norm,
        textEl: el,
        rowEl: row,
        top: rect.top,
        left: rect.left
      });
    }

    candidates.sort((a, b) => a.top - b.top);
    return candidates;
  }

  function findSidebarScrollContainer() {
    // Strategy 1: Start from a visible sidebar item and walk up to find its scrollable ancestor
    const currentItems = getSidebarItems();
    if (currentItems.length > 0) {
      let curr = currentItems[0].textEl.parentElement;
      while (curr && curr !== document.body) {
        const style = window.getComputedStyle(curr);
        const rect = curr.getBoundingClientRect();
        const isScrollableY =
          curr.scrollHeight > curr.clientHeight + 8 &&
          (style.overflowY === "auto" ||
            style.overflowY === "scroll" ||
            style.overflowY === "overlay" ||
            curr.scrollHeight > curr.clientHeight + 30);
        if (isScrollableY && rect.left < 150 && rect.width < 400) {
          return curr;
        }
        curr = curr.parentElement;
      }
    }

    // Strategy 2: Scan all divs on the left side of the screen for a scrollable container
    const allDivs = Array.from(document.querySelectorAll("div"));
    let best = null;
    for (const div of allDivs) {
      if (!isVisible(div) || div.closest("#mab-root-panel")) continue;
      const rect = div.getBoundingClientRect();
      if (rect.left < 30 || rect.left > 140) continue;
      if (rect.width < 150 || rect.width > 380 || rect.height < 180) continue;
      if (div.scrollHeight > div.clientHeight + 10) {
        if (!best || div.scrollHeight > best.scrollHeight) {
          best = div;
        }
      }
    }
    return best;
  }

  async function scanAllSidebarTextsWithAutoScroll() {
    const collectedTexts = new Set();
    const collectedCopyTexts = new Set();

    const harvestVisible = () => {
      const items = getAdSetSidebarItems();
      for (const item of items) {
        if (COPY_REGEX.test(item.text)) {
          // Use text + approximate scroll position key to count copies accurately
          collectedCopyTexts.add(`${item.text}__${Math.round(item.top / 18)}`);
        } else {
          collectedTexts.add(item.text);
        }
      }
    };

    harvestVisible();

    const scrollContainer = findSidebarScrollContainer();
    if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + 12) {
      const originalScrollTop = scrollContainer.scrollTop;
      log("🔄 Rolando barra lateral automaticamente para ler todos os conjuntos...", "info");

      // Scroll to top first
      scrollContainer.scrollTop = 0;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(220);
      harvestVisible();

      const step = Math.max(160, Math.floor(scrollContainer.clientHeight * 0.7));
      let currentPos = 0;
      const maxScroll = scrollContainer.scrollHeight;

      while (currentPos < maxScroll) {
        currentPos += step;
        scrollContainer.scrollTop = currentPos;
        scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
        await sleep(200);
        harvestVisible();
        if (
          scrollContainer.scrollTop + scrollContainer.clientHeight >=
          scrollContainer.scrollHeight - 4
        ) {
          break;
        }
      }

      // Restore original scroll position
      scrollContainer.scrollTop = originalScrollTop;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(150);
    }

    return {
      allTexts: Array.from(collectedTexts),
      visibleCopiesCount: findCopyAdSetsInSidebar().length
    };
  }

  // Returns ONLY Ad Set rows (⊞) from the left sidebar, strictly filtering out the Campaign row (📁) and Child Ad rows (◪)
  function getAdSetSidebarItems() {
    const items = getSidebarItems();
    if (items.length === 0) return [];

    // Step 1: Exclude campaign header and explicit child Ad texts
    const nonCampaign = items.filter((it) => {
      const n = it.normText;
      if (it.text.includes(",") && it.text.toLowerCase().includes("utm")) return false;
      if (it.left < 90) return false; // Campaign folder icon text sits further left
      if (
        n.startsWith("novo anuncio") ||
        n.startsWith("new ") ||
        n === "1 ad" ||
        n === "1 anuncio" ||
        /^\d+\s*(ad|ads|anuncio|anuncios)$/i.test(n)
      ) {
        return false;
      }
      return true;
    });

    if (nonCampaign.length === 0) return [];

    // Step 2: In Meta's sidebar tree, all Ad Sets share the minimum horizontal indentation level (~100..128px).
    // Child Ads under an expanded Ad Set are indented at least 14px further right.
    const minAdSetLeft = Math.min(...nonCampaign.map((it) => it.left));
    return nonCampaign.filter((it) => it.left <= minAdSetLeft + 8);
  }

  function findCopyAdSetsInSidebar() {
    const adSetItems = getAdSetSidebarItems();
    return adSetItems.filter((item) => COPY_REGEX.test(item.text));
  }

  async function countAllCopyAdSetsInSidebarWithScroll() {
    const items = await scanAllSidebarAdSetsWithScroll();
    return items.filter((it) => COPY_REGEX.test(it.text)).length;
  }

  // Searches for an Ad Set in the sidebar tree by name (scrolling if necessary) and clicks it
  async function navigateToSidebarAdSetByName(targetName) {
    if (!targetName) return false;
    const normTarget = normalizeStr(targetName);

    // Check if we are already on this ad set in breadcrumbs
    const crumbs = getTopBreadcrumbItems();
    if (crumbs.length >= 2 && normalizeStr(crumbs[1].text) === normTarget && getCurrentEditorLevel() === "adset") {
      return true;
    }

    const scroller = findSidebarScrollContainer();

    function findMatchInVisible() {
      const rows = getAdSetSidebarItems();
      return (
        rows.find((r) => r.normText === normTarget) ||
        rows.find((r) => doesSidebarTextMatchCountry(r.text, { adSetName: targetName }))
      );
    }

    let match = findMatchInVisible();
    if (match) {
      match.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(150);
      simulateClick(match.textEl);
      for (let i = 0; i < 8; i++) {
        await sleep(250);
        if (getCurrentEditorLevel() === "adset") {
          state.currentAdSetSidebarEl = match.textEl;
          return true;
        }
      }
    }

    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 10) {
      return false;
    }

    // Scroll to top and scan downwards
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(200);

    match = findMatchInVisible();
    if (match) {
      match.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(150);
      simulateClick(match.textEl);
      for (let i = 0; i < 8; i++) {
        await sleep(250);
        if (getCurrentEditorLevel() === "adset") {
          state.currentAdSetSidebarEl = match.textEl;
          return true;
        }
      }
    }

    let prev = -1;
    while (scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 4) {
      if (scroller.scrollTop === prev) break;
      prev = scroller.scrollTop;
      scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + 200);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(180);

      match = findMatchInVisible();
      if (match) {
        match.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(150);
        simulateClick(match.textEl);
        for (let i = 0; i < 8; i++) {
          await sleep(250);
          if (getCurrentEditorLevel() === "adset") {
            state.currentAdSetSidebarEl = match.textEl;
            return true;
          }
        }
      }
    }

    return false;
  }

  // Scans the entire left sidebar from top to bottom and returns all unique Ad Set items
  async function scanAllSidebarAdSetsWithScroll() {
    const scroller = findSidebarScrollContainer();
    const collected = [];
    const seenMap = new Map();

    function harvest() {
      const visible = getAdSetSidebarItems();
      for (const it of visible) {
        const absTop = Math.round(it.top + (scroller ? scroller.scrollTop : 0));
        let existingKey = null;
        for (const [key, val] of seenMap.entries()) {
          if (val.normText === it.normText && Math.abs(val.absTop - absTop) < 18) {
            existingKey = key;
            break;
          }
        }
        if (!existingKey) {
          const newKey = `${it.normText}__${absTop}`;
          const itemObj = { ...it, absTop };
          seenMap.set(newKey, itemObj);
          collected.push(itemObj);
        }
      }
    }

    if (!scroller || scroller.scrollHeight <= scroller.clientHeight + 10) {
      harvest();
      return collected;
    }

    const origScroll = scroller.scrollTop;
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(220);
    harvest();

    let prev = -1;
    while (scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 4) {
      if (scroller.scrollTop === prev) break;
      prev = scroller.scrollTop;
      scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + 220);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(180);
      harvest();
    }

    scroller.scrollTop = origScroll;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(150);

    collected.sort((a, b) => a.absTop - b.absTop);
    return collected;
  }

  // Scroll to and click a specific sidebar item identified during scan
  async function scrollToAndClickSidebarItem(item) {
    if (!item) return false;
    const scroller = findSidebarScrollContainer();
    if (scroller && item.absTop != null) {
      const targetScroll = Math.max(0, item.absTop - Math.floor(scroller.clientHeight / 2));
      scroller.scrollTop = targetScroll;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(200);
    }

    const visible = getAdSetSidebarItems();
    const match =
      visible.find((v) => v.textEl === item.textEl) ||
      visible.find((v) => v.normText === item.normText && Math.abs(v.top - item.top) < 30) ||
      visible.find((v) => v.normText === item.normText) ||
      visible[0];

    if (match) {
      match.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(150);
      simulateClick(match.textEl);
      await sleep(800);
      state.currentAdSetSidebarEl = match.textEl;
      return true;
    }
    return false;
  }

  function isBulkEditActive() {
    // 1. Text header in central pane with 2 or more ad sets (e.g. "Name for 13 ad sets", "Nome para 13 conjuntos")
    // Note: single ad set editing like "Location for 1 ad set" is NOT bulk edit!
    const allHeaders = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, [role='heading'], span, div")
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const t = (el.innerText || "").trim();
      if (!t || t.length > 60) return false;
      return /(name|nome|location|localiza|budget|orcamento)\s+(for|de|para)\s+([2-9]|\d{2,})\s+(ad\s*sets|conjuntos)/i.test(
        normalizeStr(t)
      );
    });
    if (allHeaders.length > 0) return true;

    // 2. Multiple sidebar checkboxes checked (left < 320)
    const checkedBoxes = Array.from(
      document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      return r.left < 320 && (el.checked || el.getAttribute("aria-checked") === "true");
    });
    return checkedBoxes.length > 1;
  }

  // Dismiss any bulk-edit drawers ("Name for X ad sets"), "Close without saving?" dialogs, or multi-edit banners
  async function dismissAnyBulkEditOrUnsavedModal() {
    // 1. Check for "Close without saving?" modal dialog
    const dialogs = Array.from(
      document.querySelectorAll('[role="dialog"], [aria-modal="true"], div')
    ).filter((d) => {
      if (!isVisible(d) || d.closest("#mab-root-panel")) return false;
      const txt = normalizeStr(d.innerText || "");
      return (
        txt.includes("close without saving") ||
        txt.includes("fechar sem salvar") ||
        txt.includes("sair sem salvar") ||
        txt.includes("descartar alterac") ||
        txt.includes("cant be recovered if you dont save") ||
        txt.includes("nao podem ser recuperadas")
      );
    });

    if (dialogs.length > 0) {
      const dlg = dialogs[dialogs.length - 1];
      const discardBtn = findElementByText(
        [
          "Close without saving",
          "Fechar sem salvar",
          "Sair sem salvar",
          "Descartar",
          "Discard",
          "Don't save",
          "Nao salvar"
        ],
        ['[role="button"]', "button", "div", "span"],
        dlg
      );
      if (discardBtn) {
        log('🧹 Clicando em "Close without saving" / "Fechar sem salvar"...', "info");
        simulateClick(discardBtn);
        discardBtn.click?.();
        await sleep(350);
      }
    }

    // 2. Check for multi-adset bulk banner: "Your edits will apply to X ad sets" -> Click "Edit each ad set"
    const editEachBtn = findElementByText(
      [
        "Edit each ad set",
        "Editar cada conjunto de anúncios",
        "Editar cada conjunto",
        "Edit each ad",
        "Editar cada anúncio"
      ],
      ['[role="button"]', "button", "span", "div", "a"]
    );

    if (editEachBtn) {
      log('🧹 Clicando em "Edit each ad set" para sair da edição em massa e focar em 1 conjunto...', "info");
      simulateClick(editEachBtn);
      editEachBtn.click?.();
      await sleep(400);
    }

    // 3. Check for bulk-edit mode ("Name for X ad sets" / multiple checkboxes checked in sidebar)
    if (isBulkEditActive()) {
      log('🧹 Detectado modo de Edição em Massa. Desmarcando seleção múltipla para focar em 1 conjunto...', "info");

      // A: Uncheck all sidebar checkboxes so multiple ad sets are not selected together
      const checkedBoxes = Array.from(
        document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
      ).filter((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const r = el.getBoundingClientRect();
        return r.left < 320 && (el.checked || el.getAttribute("aria-checked") === "true");
      });

      if (checkedBoxes.length > 0) {
        log(`🧹 Desmarcando ${checkedBoxes.length} caixa(s) de seleção múltipla na barra lateral...`, "info");
        for (const cb of checkedBoxes) {
          simulateClick(cb);
          await sleep(60);
        }
        await sleep(300);
      }

      // B: Click on an individual Ad Set in sidebar to focus on it and cleanly exit bulk edit
      const adSets = getAdSetSidebarItems();
      if (adSets.length > 0) {
        const target =
          adSets.find((it) => normalizeStr(it.text) === "conferir" || COPY_REGEX.test(it.text)) ||
          adSets[0];
        target.textEl.scrollIntoView({ behavior: "instant", block: "center" });
        await sleep(150);
        simulateClick(target.textEl);
        await sleep(500);
      }
    }
  }

  // Ensures Meta Ads Manager is currently displaying the editor (either standalone or drawer view)
  // If the user is on the table view (/adsmanager/manage/adsets), clicks Edit or opens Standalone editor.
  async function ensureEditorOpen() {
    // 1. If we are already in standalone editor, or sidebar items are visible, we are ready!
    if (window.location.href.includes("/edit/standalone") || getAdSetSidebarItems().length > 0) {
      return true;
    }

    log("🔍 Modo Tabela detectado (editor fechado). Procurando botão de Edição...", "info");

    // 2. Look for "Edit" button in table toolbar or on a table row
    const editBtns = Array.from(
      document.querySelectorAll('button, [role="button"], a, span')
    ).filter((btn) => {
      if (!isVisible(btn) || btn.closest("#mab-root-panel")) return false;
      const t = (btn.innerText || "").trim().toLowerCase();
      const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
      return (
        t === "edit" ||
        t === "editar" ||
        aria === "edit" ||
        aria === "editar" ||
        t.startsWith("edit ") ||
        t.startsWith("editar ")
      );
    });

    if (editBtns.length > 0) {
      log('✏️ Clicando em "Edit" / "Editar" na tabela para abrir o editor...', "info");
      simulateClick(editBtns[0]);
      editBtns[0].click?.();
      await sleep(1500);
      if (getAdSetSidebarItems().length > 0) {
        log("✅ Painel de edição aberto com sucesso!", "ok");
        return true;
      }
    }

    // 3. Fallback: switch to standalone editor URL
    const currentUrl = window.location.href;
    if (/\/adsmanager\/manage\/(ads|adsets|campaigns)/i.test(currentUrl)) {
      log("🔀 Redirecionando para o Editor Standalone (/adsmanager/manage/adsets/edit/standalone)...", "ok");
      const standaloneUrl = currentUrl.replace(
        /\/adsmanager\/manage\/(ads|adsets|campaigns)(\/edit)?/i,
        "/adsmanager/manage/adsets/edit/standalone"
      );
      window.location.href = standaloneUrl;
      return false; // page navigation triggered
    }

    log("⚠️ Abra a edição de um conjunto ou clique no botão '🔀 Standalone' no topo do painel.", "warn");
    return false;
  }

  async function findNextCopyInSidebarWithScroll() {
    let copies = findCopyAdSetsInSidebar();
    if (copies.length > 0) return copies[0];

    const scrollContainer = findSidebarScrollContainer();
    if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight + 10) {
      return null;
    }

    // Scroll from top to bottom looking for a "- Copy" item
    scrollContainer.scrollTop = 0;
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(220);
    copies = findCopyAdSetsInSidebar();
    if (copies.length > 0) return copies[0];

    const step = Math.max(160, Math.floor(scrollContainer.clientHeight * 0.7));
    let pos = 0;
    while (pos < scrollContainer.scrollHeight) {
      pos += step;
      scrollContainer.scrollTop = pos;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(220);
      copies = findCopyAdSetsInSidebar();
      if (copies.length > 0) return copies[0];
      if (
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
        scrollContainer.scrollHeight - 4
      ) {
        break;
      }
    }
    return null;
  }

  const visitedBatchTargetKeys = new Set();

  function findDuplicateNamedAdSetInSidebar() {
    const adSets = getAdSetSidebarItems();
    const nameCounts = {};
    for (const it of adSets) {
      nameCounts[it.normText] = (nameCounts[it.normText] || 0) + 1;
    }

    for (let i = 0; i < adSets.length; i++) {
      const it = adSets[i];
      if (nameCounts[it.normText] > 1) {
        const key = `dup_${it.normText}_${Math.round(it.top)}`;
        if (!visitedBatchTargetKeys.has(key)) {
          return { item: it, key };
        }
      }
    }
    return null;
  }

  async function findNextDuplicateNamedAdSetInSidebarWithScroll() {
    let found = findDuplicateNamedAdSetInSidebar();
    if (found) {
      visitedBatchTargetKeys.add(found.key);
      return found.item;
    }

    const scrollContainer = findSidebarScrollContainer();
    if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight + 10) {
      return null;
    }

    scrollContainer.scrollTop = 0;
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(200);
    found = findDuplicateNamedAdSetInSidebar();
    if (found) {
      visitedBatchTargetKeys.add(found.key);
      return found.item;
    }

    const step = Math.max(160, Math.floor(scrollContainer.clientHeight * 0.7));
    let pos = 0;
    while (pos < scrollContainer.scrollHeight) {
      pos += step;
      scrollContainer.scrollTop = pos;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(200);
      found = findDuplicateNamedAdSetInSidebar();
      if (found) {
        visitedBatchTargetKeys.add(found.key);
        return found.item;
      }
      if (scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 4) {
        break;
      }
    }
    return null;
  }

  function doesSidebarTextMatchCountry(rawSidebarText, country) {
    if (!rawSidebarText || COPY_REGEX.test(rawSidebarText)) return false;
    const normSidebar = normalizeStr(rawSidebarText)
      .replace(/^[\d\s.\-–—*]+/, "")
      .replace(/[\s*]+$/, "");
    if (!normSidebar) return false;

    // Ignore standard child Ad names
    if (
      normSidebar.startsWith("novo anuncio") ||
      normSidebar.startsWith("new ") ||
      normSidebar === "1 ad" ||
      normSidebar === "1 anuncio"
    ) {
      return false;
    }

    const candidates = [
      country.adSetName,
      country.searchPT,
      country.searchEN,
      ...(country.altSearch || [])
    ]
      .filter(Boolean)
      .map((s) => normalizeStr(s));

    // Prevent "República do Congo" from matching "República Democrática do Congo"
    if (
      normalizeStr(country.adSetName) === "republica do congo" &&
      (normSidebar.includes("democratica") || normSidebar.includes("democratic"))
    ) {
      return false;
    }

    for (const cand of candidates) {
      if (!cand) continue;
      if (normSidebar === cand) return true;
      // Also match if user added suffix like "Suíça (fr)" or "França - FR", but be careful with short names
      if (
        normSidebar.startsWith(cand + " ") ||
        normSidebar.startsWith(cand + "-") ||
        normSidebar.startsWith(cand + " (")
      ) {
        return true;
      }
    }
    return false;
  }

  async function detectDoneCountriesFromSidebar(blockId) {
    const block = BLOCKS[blockId];
    if (!block) return { foundCount: 0, foundNames: [] };

    const { allTexts } = await scanAllSidebarTextsWithAutoScroll();

    const foundNames = [];
    block.countries.forEach((country) => {
      const isPresent = allTexts.some((sidebarTxt) =>
        doesSidebarTextMatchCountry(sidebarTxt, country)
      );
      if (isPresent) {
        state.doneCountries[blockId][country.adSetName] = true;
        state.checkedCountries[blockId][country.adSetName] = false;
        foundNames.push(country.adSetName);
      }
    });

    saveState();
    return { foundCount: foundNames.length, foundNames };
  }

  // =========================================================================
  // AD SET AUTOMATION FUNCTIONS
  // =========================================================================

  // 1. Change Ad Set Name
  async function updateAdSetName(newName) {
    log(`Renomeando conjunto para: "${newName}"...`, "info");

    // Find input in the main editor pane (left > 270)
    const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
      .filter((el) => isVisible(el) && !el.closest("#mab-root-panel"))
      .filter((el) => el.getBoundingClientRect().left > 270);

    let nameInput = null;

    // Strategy 1: Find by nearby label "Ad set name" or "Nome do conjunto de anúncios"
    for (const input of inputs) {
      const container = input.closest("div")?.parentElement?.parentElement;
      const containerText = (container?.innerText || "").toLowerCase();
      if (
        containerText.includes("ad set name") ||
        containerText.includes("nome do conjunto")
      ) {
        nameInput = input;
        break;
      }
    }

    // Strategy 2: Check input whose value ends with "- Copy" / "– Copy" or matches a known country name
    if (!nameInput) {
      nameInput = inputs.find((inp) => COPY_REGEX.test(inp.value || ""));
    }

    // In Drawer View, switch to "Name" / "General" tab if needed
    if (!nameInput) {
      const navNameTab = Array.from(
        document.querySelectorAll('[role="tab"], [role="treeitem"], div, span, a')
      ).find((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const r = el.getBoundingClientRect();
        if (r.left < 210 || r.left > 560) return false;
        const t = normalizeStr(el.innerText || "");
        return t === "name" || t === "general" || t === "nome" || t === "geral";
      });
      if (navNameTab && navNameTab.closest('nav, [role="navigation"], [role="tablist"]')) {
        simulateClick(navNameTab);
        await sleep(300);
      }
    }

    // Strategy 3: Top-most text input inside the center editor pane (not a search box)
    if (!nameInput) {
      const nonSearchInputs = inputs
        .filter((inp) => {
          const ph = (inp.placeholder || "").toLowerCase();
          return (
            !ph.includes("search") &&
            !ph.includes("pesquisar") &&
            !ph.includes("procurar") &&
            !ph.includes("http")
          );
        })
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      nameInput = nonSearchInputs[0] || null;
    }

    if (!nameInput) {
      log("⚠️ Campo de Nome do Conjunto não encontrado nesta tela (role até o topo se necessário).", "warn");
      return false;
    }

    await setReactInputValue(nameInput, newName, true);
    log(`✅ Nome do conjunto alterado para "${newName}".`, "ok");
    return true;
  }

  function getDesiredAdName(countryObj, currentInputVal = "") {
    const country = countryObj.adSetName;
    const format = state.options.adNameFormat || "country_only";

    if (format === "prefix_country") {
      // e.g. "Novo anúncio de Vendas - Filipinas"
      const base = currentInputVal && !currentInputVal.includes(country)
        ? currentInputVal.replace(/\s*[-–—]\s*.*$/, "").trim()
        : "Novo anúncio de Vendas";
      return `${base || "Novo anúncio de Vendas"} - ${country}`;
    }

    if (format === "country_suffix") {
      // e.g. "Filipinas - Novo anúncio de Vendas"
      const base = currentInputVal && !currentInputVal.includes(country)
        ? currentInputVal.replace(/\s*[-–—]\s*.*$/, "").trim()
        : "Novo anúncio de Vendas";
      return `${country} - ${base || "Novo anúncio de Vendas"}`;
    }

    // Default: "country_only" -> e.g. "Filipinas"
    return country;
  }

  // 1b. Change Ad Name (under "Ad name" / "Nome do anúncio" card)
  async function updateAdName(countryObj) {
    if (!countryObj) return false;

    // Must be on Ad page
    if (getCurrentEditorLevel() !== "ad") {
      log("⚠️ Não está na página do Anúncio para renomear.", "warn");
      return false;
    }

    // Find all text inputs in the main editor area
    const inputs = Array.from(
      document.querySelectorAll('input[type="text"], input:not([type])')
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      return r.left > 240 && r.top > 80 && r.top < 380;
    });

    let nameInput = null;

    // Strategy 1: Find by nearby card container text ("Ad name" or "Nome do anúncio")
    for (const inp of inputs) {
      let curr = inp.parentElement;
      for (let i = 0; i < 5 && curr && curr !== document.body; i++) {
        const t = (curr.innerText || "").toLowerCase();
        if (
          t.includes("ad name") ||
          t.includes("nome do anuncio") ||
          t.includes("nome do anúncio")
        ) {
          nameInput = inp;
          break;
        }
        curr = curr.parentElement;
      }
      if (nameInput) break;
    }

    // Strategy 2: Input matching current value "Novo anúncio" / "New ad"
    if (!nameInput) {
      nameInput = inputs.find((inp) => {
        const v = (inp.value || "").toLowerCase();
        return (
          v.includes("novo anuncio") ||
          v.includes("novo anúncio") ||
          v.includes("new ad") ||
          v.includes("sales ad") ||
          v.includes("vendas")
        );
      });
    }

    // Strategy 3: The topmost text input in the central editor pane
    if (!nameInput && inputs.length > 0) {
      nameInput = inputs[0];
    }

    if (!nameInput) {
      log("⚠️ Campo 'Ad name' / 'Nome do anúncio' não encontrado.", "warn");
      return false;
    }

    const currentVal = (nameInput.value || "").trim();
    const desiredName = getDesiredAdName(countryObj, currentVal);

    if (normalizeStr(currentVal) === normalizeStr(desiredName)) {
      log(`✅ Nome do anúncio já está como "${desiredName}".`, "ok");
      return true;
    }

    log(`Renomeando anúncio ("Novo anúncio de Vendas") para: "${desiredName}"...`, "info");

    nameInput.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(150);
    simulateClick(nameInput);
    await sleep(150);

    await setReactInputValue(nameInput, desiredName, true);
    await sleep(350);

    const afterVal = (nameInput.value || "").trim();
    if (normalizeStr(afterVal) === normalizeStr(desiredName)) {
      log(`✅ Nome do anúncio alterado para "${desiredName}".`, "ok");
      return true;
    } else {
      // Direct property assignment + event dispatch as fallback
      nameInput.value = desiredName;
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(200);
      log(`✅ Nome do anúncio alterado para "${desiredName}".`, "ok");
      return true;
    }
  }

  // =========================================================================
  // CENTER EDITOR PANE AUTO-SCROLLER & GEOMETRIC LABEL FINDER
  // =========================================================================
  function findEditorScrollContainer() {
    // Strategy 1: Start from any visible element in the center editor column and walk up to its scrollable ancestor
    const centerCandidates = Array.from(
      document.querySelectorAll("input, textarea, h2, h3, h4, label, span, div")
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      return r.left > 280 && r.left < 650 && r.top > 110 && r.top < 650;
    });

    for (const seed of centerCandidates.slice(0, 20)) {
      let curr = seed.parentElement;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        const style = window.getComputedStyle(curr);
        const r = curr.getBoundingClientRect();
        const canScroll =
          curr.scrollHeight > curr.clientHeight + 20 &&
          (style.overflowY === "auto" ||
            style.overflowY === "scroll" ||
            style.overflowY === "overlay" ||
            curr.scrollTop > 0);
        if (canScroll && r.width >= 250 && r.height >= 160) {
          return curr;
        }
        curr = curr.parentElement;
      }
    }

    // Strategy 2: Scan all visible divs covering the center column (x ≈ 450) for a scrollable container
    const allDivs = Array.from(document.querySelectorAll("div"));
    let best = null;
    for (const div of allDivs) {
      if (!isVisible(div) || div.closest("#mab-root-panel")) continue;
      const r = div.getBoundingClientRect();
      if (r.left > 460 || r.right < 480) continue;
      if (r.width < 250 || r.height < 160) continue;
      if (div.scrollHeight > div.clientHeight + 20) {
        const style = window.getComputedStyle(div);
        if (
          style.overflowY === "auto" ||
          style.overflowY === "scroll" ||
          style.overflowY === "overlay" ||
          div.scrollTop > 0
        ) {
          if (!best || div.clientHeight < best.clientHeight) {
            best = div;
          }
        }
      }
    }
    return best;
  }

  async function scrollEditorUntil(finderFn, { startFromCurrent = true, maxSteps = 14 } = {}) {
    if (startFromCurrent) {
      const immediate = finderFn();
      if (immediate) return immediate;
    }

    const scroller = findEditorScrollContainer();
    if (!scroller) {
      return finderFn();
    }

    // First try scrolling down from current position
    const step = Math.max(220, Math.floor(scroller.clientHeight * 0.6));
    let stepsDone = 0;
    while (
      stepsDone < maxSteps &&
      scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 4
    ) {
      const prev = scroller.scrollTop;
      scroller.scrollTop = Math.min(scroller.scrollHeight, prev + step);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(240);
      stepsDone++;

      const found = finderFn();
      if (found) return found;
      if (scroller.scrollTop === prev) break;
    }

    // If still not found, scan from the very top (scrollTop = 0) down
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(240);

    const foundAtTop = finderFn();
    if (foundAtTop) return foundAtTop;

    for (let i = 0; i < maxSteps; i++) {
      const prev = scroller.scrollTop;
      scroller.scrollTop = Math.min(scroller.scrollHeight, prev + step);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(240);

      const found = finderFn();
      if (found) return found;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) break;
      if (scroller.scrollTop === prev) break;
    }

    return finderFn();
  }

  function findElementByText(textList, selectors = ["div", "span", "label", "h2", "h3", "h4", "button", "p"]) {
    const normTargets = textList.map((t) => normalizeStr(t));
    const elements = Array.from(document.querySelectorAll(selectors.join(","))).filter(
      (el) =>
        isVisible(el) &&
        !el.closest("#mab-root-panel") &&
        el.getBoundingClientRect().left > 210 &&
        el.getBoundingClientRect().height < 80
    );

    const matches = [];
    for (const el of elements) {
      const rawTxt = (el.innerText || el.textContent || "").trim();
      if (!rawTxt || rawTxt.length > 95) continue;
      // Allow single-line or take first line if an info icon/badge adds a newline
      const firstLine = rawTxt.split("\n")[0].trim();
      const cleanNorm = normalizeStr(firstLine).replace(/^[*✓•\s]+/, "");
      if (!cleanNorm) continue;

      if (normTargets.some((t) => cleanNorm === t || cleanNorm.startsWith(t))) {
        const r = el.getBoundingClientRect();
        matches.push({ el, area: r.width * r.height });
      }
    }

    if (matches.length === 0) return null;
    // Prefer the most specific (smallest area) element
    matches.sort((a, b) => a.area - b.area);
    return matches[0].el;
  }

  // 2. Set Budget to $1.00 inside "Budget & schedule" -> "Daily budget" (NEVER in "Bid strategy" / "Cost per result goal")
  function findBudgetInput() {
    const budgetAnchorEl = findElementByText([
      "Daily budget",
      "Lifetime budget",
      "Orçamento diário",
      "Orçamento vitalício",
      "Budget strategy",
      "Estratégia de orçamento",
      "Budget & schedule",
      "Orçamento e programação"
    ]);

    const allInputs = Array.from(document.querySelectorAll("input"))
      .filter((el) => isVisible(el) && !el.closest("#mab-root-panel"))
      .filter((el) => {
        const type = (el.type || "").toLowerCase();
        if (type === "checkbox" || type === "radio" || type === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.left > 210 && r.left < window.innerWidth - 240 && r.height >= 12 && r.height <= 70;
      });

    if (allInputs.length === 0) return null;

    const dateOrMonthRegex =
      /\b(202\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|fev|abr|mai|ago|set|out|dez|gmt|utc)\b/i;

    for (const inp of allInputs) {
      const val = (inp.value || "").trim();
      const ph = (inp.placeholder || "").toLowerCase();
      const aria = (inp.getAttribute("aria-label") || "").toLowerCase();
      const r = inp.getBoundingClientRect();

      // Exclude search, URL, time (21:15), and date (6 November 2026) inputs
      if (
        ph.includes("search") ||
        ph.includes("pesquisar") ||
        ph.includes("procurar") ||
        ph.includes("http") ||
        aria.includes("search") ||
        aria.includes("pesquisar")
      ) {
        continue;
      }
      if (val.includes(":") || dateOrMonthRegex.test(val) || /\d{1,2}\/\d{1,2}/.test(val)) {
        continue;
      }

      // Inspect ancestor context (up to 6 levels, stopping before giant page containers)
      let wrapperText = "";
      let p = inp.parentElement;
      for (let i = 0; i < 6 && p && p !== document.body; i++) {
        if (p.getBoundingClientRect().height > 550) break;
        wrapperText += " " + (p.innerText || "");
        p = p.parentElement;
      }
      const normWrapper = normalizeStr(wrapperText);

      // STRICT EXCLUSION: Never touch "Bid strategy" / "Highest volume" / "Cost per result goal" / "ROAS goal" / "Bid cap"
      if (
        ph === "x.xx" ||
        normWrapper.includes("bid strategy") ||
        normWrapper.includes("estrategia de lance") ||
        normWrapper.includes("highest volume") ||
        normWrapper.includes("volume mais alto") ||
        normWrapper.includes("cost per result") ||
        normWrapper.includes("custo por resultado") ||
        normWrapper.includes("roas goal") ||
        normWrapper.includes("bid cap") ||
        normWrapper.includes("limite de lance")
      ) {
        continue;
      }

      // Match 1: Ancestor wrapper explicitly mentions "Daily budget" / "Lifetime budget" / "Budget strategy" / "Budget & schedule"
      if (
        normWrapper.includes("daily budget") ||
        normWrapper.includes("lifetime budget") ||
        normWrapper.includes("orcamento diario") ||
        normWrapper.includes("orcamento vitalicio") ||
        normWrapper.includes("budget strategy") ||
        normWrapper.includes("estrategia de orcamento") ||
        normWrapper.includes("budget & schedule") ||
        normWrapper.includes("orcamento e programacao")
      ) {
        return inp;
      }

      // Match 2: Near currency symbol/code (USD, BRL, EUR, $) and value is numeric currency
      if (
        (normWrapper.includes("usd") || normWrapper.includes("brl") || normWrapper.includes("eur") || normWrapper.includes("$")) &&
        /^[0-9]+([.,][0-9]{1,2})?$/.test(val.replace(/[$R€£\s]/g, ""))
      ) {
        return inp;
      }

      // Match 3: Input is geometrically near the "Daily budget" / "Budget strategy" anchor
      if (
        budgetAnchorEl &&
        r.top >= budgetAnchorEl.getBoundingClientRect().top - 20 &&
        r.top <= budgetAnchorEl.getBoundingClientRect().bottom + 160 &&
        /^[0-9]+([.,][0-9]{1,2})?$/.test(val.replace(/[$R€£\s]/g, ""))
      ) {
        return inp;
      }
    }

    return null;
  }

  // Ensure "Bid strategy" stays empty/0 ("X.XX" / "Highest volume") if a value was ever left in it
  async function ensureBidStrategyZero() {
    const bidLabel = findElementByText(
      ["Bid strategy", "Estratégia de lance"],
      ["div", "span", "label", "h3", "h4"]
    );
    if (!bidLabel) return;
    const bidRect = bidLabel.getBoundingClientRect();

    const bidInput = Array.from(document.querySelectorAll("input")).find((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      return (
        r.left > 210 &&
        r.left < window.innerWidth - 240 &&
        r.top >= bidRect.top - 5 &&
        r.top <= bidRect.bottom + 85
      );
    });

    if (bidInput) {
      const val = (bidInput.value || "").trim();
      if (val && /[1-9]/.test(val)) {
        log(`🧹 Limpando valor "${val}" de Bid strategy (mantendo em 0 / Highest volume)...`, "info");
        await setReactInputValue(bidInput, "", true);
        await sleep(180);
      }
    }
  }

  async function updateAdSetBudget(budgetVal = "1.00") {
    await ensureBidStrategyZero();
    log(`Procurando campo de orçamento em "Budget & schedule" para definir $${budgetVal}...`, "info");

    // Retry finding header in case Meta is finishing render after duplication
    for (let r = 0; r < 3; r++) {
      const budgetHeader = findElementByText([
        "Budget & schedule",
        "Orçamento e programação",
        "Budget strategy",
        "Daily budget",
        "Orçamento diário"
      ]);
      if (budgetHeader) {
        budgetHeader.scrollIntoView({ behavior: "instant", block: "center" });
        await sleep(250);
        break;
      }
      await sleep(300);
    }

    let budgetInput = await scrollEditorUntil(findBudgetInput, {
      startFromCurrent: true,
      maxSteps: 12
    });

    if (!budgetInput) {
      // In Drawer View, the Budget field is under the "Budget & schedule" / "Budget" navigation tab
      const navBudgetTab = Array.from(
        document.querySelectorAll('[role="tab"], [role="treeitem"], div, span, a')
      ).find((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const r = el.getBoundingClientRect();
        if (r.left < 210 || r.left > 560) return false;
        const t = normalizeStr(el.innerText || "");
        return t === "budget & schedule" || t === "budget" || t === "orcamento e programacao" || t === "orcamento";
      });
      if (navBudgetTab) {
        log('🔀 Clicando na aba "Budget" na gaveta de edição...', "info");
        simulateClick(navBudgetTab);
        await sleep(350);
        budgetInput = findBudgetInput();
      }
    }

    if (!budgetInput) {
      const visibleVals = Array.from(document.querySelectorAll("input"))
        .filter((el) => isVisible(el) && !el.closest("#mab-root-panel") && el.type !== "checkbox")
        .map((el) => `"${el.value || el.placeholder || ""}"@x=${Math.round(el.getBoundingClientRect().left)}`)
        .join(", ");
      log(`⚠️ Campo de orçamento não encontrado no conjunto (inputs visíveis: ${visibleVals || "nenhum"}).`, "warn");
      return false;
    }

    const oldVal = (budgetInput.value || "").trim();
    budgetInput.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(150);

    // Click and focus first so Meta enters edit mode on the currency input
    simulateClick(budgetInput);
    budgetInput.focus();
    await sleep(180);

    await setReactInputValue(budgetInput, budgetVal, true);
    await sleep(220);
    log(`✅ Orçamento alterado de "${oldVal}" para "$${budgetVal}" (atual: "${budgetInput.value}").`, "ok");
    return true;
  }

  // 2b. Reset Start Date if "This start date is in the past" error appears
  function findResetStartDateButton() {
    const candidates = Array.from(
      document.querySelectorAll('a, button, [role="button"], [role="link"], span, div')
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      return r.left > 280 && r.left < 750 && r.width < 420 && r.height >= 12 && r.height <= 48;
    });

    const matches = [];
    for (const el of candidates) {
      const raw = (el.innerText || el.textContent || "").trim();
      if (!raw || raw.length > 75 || raw.includes("\n")) continue;
      const norm = normalizeStr(raw);
      if (
        norm === "reset your start date to today" ||
        norm.includes("reset your start date") ||
        norm.includes("reset start date") ||
        norm.includes("redefinir a data de inicio") ||
        norm.includes("redefina a data de inicio") ||
        norm.includes("redefina sua data de inicio") ||
        norm.includes("redefinir data de inicio")
      ) {
        const r = el.getBoundingClientRect();
        matches.push({ el, area: r.width * r.height });
      }
    }

    if (matches.length === 0) return null;
    matches.sort((a, b) => a.area - b.area);
    return matches[0].el;
  }

  async function fixPastStartDateIfPresent() {
    let resetBtn = findResetStartDateButton();
    if (!resetBtn) {
      const scroller = findEditorScrollContainer();
      if (scroller) {
        for (let step = 0; step < 3; step++) {
          scroller.scrollTop += 240;
          scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
          await sleep(220);
          resetBtn = findResetStartDateButton();
          if (resetBtn) break;
        }
      }
    }

    if (resetBtn) {
      const btnText = (resetBtn.innerText || "Reset your start date to today").trim();
      log(`🕒 Erro de data no passado detectado! Clicando em "${btnText}"...`, "info");
      resetBtn.scrollIntoView({ behavior: "instant", block: "center" });
      await sleep(150);
      simulateClick(resetBtn);
      const interactiveParent = resetBtn.closest(
        'a, button, [role="button"], [role="link"], [tabindex="0"]'
      );
      if (interactiveParent && interactiveParent !== resetBtn) {
        simulateClick(interactiveParent);
      }
      await sleep(350);
      log("✅ Data de início resetada para hoje com sucesso!", "ok");
      return true;
    }

    return false;
  }

  // 3. Change Location — 4-Step Sequential Workflow:
  //    Step 1: Click collapsed "Locations / Location: Brazil" to open the Locations card
  //    Step 2: Type the new country in "Search locations" FIRST
  //    Step 3: Click the dropdown suggestion that says "Country" / "País" underneath
  //    Step 4: Hover and click 'X' on the old country (e.g. Brazil) to remove it
  function findLocationSearchBoxOrInput() {
    const inputs = Array.from(
      document.querySelectorAll('input, [contenteditable="true"], [role="combobox"], [role="textbox"]')
    )
      .filter((el) => isVisible(el) && !el.closest("#mab-root-panel"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left > 210 && r.left < window.innerWidth - 240 && r.height >= 14 && r.height <= 60;
      });

    // 1. Direct input with placeholder/aria-label "Search locations" / "Pesquisar localizações"
    for (const inp of inputs) {
      const ph = (inp.placeholder || inp.getAttribute?.("aria-placeholder") || "").toLowerCase();
      const aria = (inp.getAttribute?.("aria-label") || "").toLowerCase();
      if (
        ph.includes("search location") ||
        ph.includes("pesquisar localiza") ||
        ph.includes("procurar localiza") ||
        aria.includes("search location") ||
        aria.includes("pesquisar localiza") ||
        ph.includes("location") ||
        aria.includes("location") ||
        ph.includes("localiza") ||
        aria.includes("localiza")
      ) {
        return { inputEl: inp, clickTargetEl: inp };
      }
    }

    // 2. Look for visible text "Search locations" / "Pesquisar localizações" (React overlay span/div inside the search box)
    const searchLocLabel = findElementByText(
      ["Search locations", "Pesquisar localizações", "Procurar localizações", "Search location"],
      ["span", "div", "label", "input"]
    );
    if (searchLocLabel) {
      if (searchLocLabel.tagName === "INPUT") {
        return { inputEl: searchLocLabel, clickTargetEl: searchLocLabel };
      }
      const boxRect = searchLocLabel.getBoundingClientRect();
      const nearbyInput = inputs.find((inp) => {
        const r = inp.getBoundingClientRect();
        return Math.abs(r.top - boxRect.top) < 26 && Math.abs(r.left - boxRect.left) < 140;
      });
      return {
        inputEl: nearbyInput || null,
        clickTargetEl: searchLocLabel
      };
    }

    // 3. Look for input on the same horizontal row between "Include" ("Incluir") and "Browse" ("Procurar" / "Explorar")
    const includeBtn = findElementByText(["Include", "Incluir"], ["span", "div", "button"]);
    const browseBtn = findElementByText(["Browse", "Procurar", "Explorar"], ["span", "div", "button"]);
    if (includeBtn || browseBtn) {
      const anchor = includeBtn || browseBtn;
      const aRect = anchor.getBoundingClientRect();
      const rowInput = inputs.find((inp) => {
        const r = inp.getBoundingClientRect();
        return Math.abs(r.top - aRect.top) < 32 && r.width >= 120;
      });
      if (rowInput) {
        return { inputEl: rowInput, clickTargetEl: rowInput };
      }
    }

    return null;
  }

  function findLocationSearchInput() {
    const res = findLocationSearchBoxOrInput();
    return res ? res.inputEl || res.clickTargetEl : null;
  }

  // Find the collapsed "Locations" / "Location: Brazil" summary row under Audience -> Controls
  function findCollapsedLocationsTrigger() {
    // Look for "Location: ..." or "Localização: ..." summary line first (most specific in Panel 1 of user screenshot)
    const summaryEl = findElementByText(
      ["Location:", "Localização:", "Locations", "Localizações"],
      ["div", "span", "label", "h3", "h4"]
    );
    if (summaryEl) return summaryEl;

    // Fallback: look for "Controls" or "Audience" section header so we can scroll there
    return findElementByText(
      ["Controls", "Controles", "Audience", "Público"],
      ["div", "span", "h2", "h3", "h4"]
    );
  }

  async function expandLocationsSectionIfNeeded() {
    let locFound = findLocationSearchBoxOrInput();
    if (locFound) return locFound;

    // Scroll until either the Search locations box OR the collapsed "Locations / Location: ..." trigger is visible
    await scrollEditorUntil(
      () => findLocationSearchBoxOrInput() || findCollapsedLocationsTrigger(),
      { startFromCurrent: true, maxSteps: 12 }
    );

    locFound = findLocationSearchBoxOrInput();
    if (locFound) return locFound;

    // Look specifically for "Location:" / "Locations" in the center column
    const locSummary = findElementByText(
      ["Location:", "Localização:"],
      ["div", "span"]
    );
    const locHeader = findElementByText(
      ["Locations", "Localizações"],
      ["div", "span", "h3", "h4", "label"]
    );
    const targetToClick = locSummary || locHeader;

    if (!targetToClick) {
      // Maybe Controls is collapsed under "Show more settings" / "Edit"
      const fallbackTrigger = findCollapsedLocationsTrigger();
      if (fallbackTrigger) {
        fallbackTrigger.scrollIntoView({ behavior: "instant", block: "center" });
        await sleep(250);
      }
    }

    const clickCandidates = [
      findElementByText(["Location", "Locations", "Location:", "Localização", "Localizações", "Localização:"], ["div", "span", "h3", "h4", "label"]),
      findElementByText(["Audience controls", "Controles de público"], ["div", "span", "h3", "h4", "label"])
    ].filter(Boolean);

    for (const el of clickCandidates) {
      el.scrollIntoView({ behavior: "instant", block: "center" });
      await sleep(180);

      // Hover over the collapsed Locations row so Meta activates its click/Edit handler
      const rowWrapper =
        el.closest('[role="button"], [tabindex="0"]') || el.parentElement?.parentElement || el;
      for (const node of [el, el.parentElement, rowWrapper]) {
        if (!node) continue;
        node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
        node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        node.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      }
      await sleep(180);

      // Check if an "Edit" / "Editar" button appeared on the same horizontal band on hover
      const elRect = el.getBoundingClientRect();
      const hoverEditBtn = Array.from(
        document.querySelectorAll('[role="button"], button, a, span, div')
      ).find((b) => {
        if (!isVisible(b) || b.closest("#mab-root-panel")) return false;
        const r = b.getBoundingClientRect();
        if (Math.abs(r.top - elRect.top) > 40 || r.left < 210 || r.left > window.innerWidth - 240) return false;
        const t = normalizeStr(b.innerText || b.getAttribute("aria-label") || "");
        return t === "edit" || t === "editar";
      });

      if (hoverEditBtn) {
        log('Clicando em "Edit" na linha de Locations para expandir...', "info");
        simulateClick(hoverEditBtn);
      } else {
        log(`Clicando em "${(el.innerText || "Locations").split("\n")[0].trim()}" para expandir...`, "info");
        simulateClick(el);
        if (rowWrapper && rowWrapper !== el) {
          simulateClick(rowWrapper);
        }
      }

      await sleep(450);
      locFound = findLocationSearchBoxOrInput();
      if (locFound) return locFound;
    }

    return findLocationSearchBoxOrInput();
  }

  // Helper to click a country suggestion option in the dropdown and verify it was selected
  async function clickAndConfirmCountryOption(winnerEl, searchInput, countryObj) {
    if (!winnerEl) return false;
    const optionRow =
      winnerEl.closest('[role="option"], [role="listitem"], li') || winnerEl;

    optionRow.scrollIntoView({ behavior: "instant", block: "nearest" });
    await sleep(60);

    // Hover the option first so Meta's listbox highlights it as active
    for (const node of [winnerEl, optionRow]) {
      if (!node) continue;
      const r = node.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        relatedTarget: document.body
      };
      node.dispatchEvent(new PointerEvent("pointerover", opts));
      node.dispatchEvent(new PointerEvent("pointerenter", opts));
      node.dispatchEvent(new MouseEvent("mouseover", opts));
      node.dispatchEvent(new MouseEvent("mouseenter", opts));
      node.dispatchEvent(new MouseEvent("mousemove", opts));
    }
    await sleep(80);

    simulateClick(optionRow);
    if (winnerEl !== optionRow) {
      simulateClick(winnerEl);
    }
    optionRow.click?.();
    await sleep(420);

    // Verify if the country now appears in the included locations list OR if the search input was cleared by Meta
    const locNow = findLocationSearchBoxOrInput();
    const anchorNow = locNow?.inputEl || locNow?.clickTargetEl || searchInput;
    const rowsAfter = getIncludedLocationRowElements(anchorNow);
    if (rowsAfter.some((r) => doesLocationRowMatchCountry(r.normText, countryObj))) {
      return true;
    }

    // Fallback: if the input still has text (dropdown option remained open), press ArrowDown + Enter or click parent
    const currentVal = (locNow?.inputEl?.value ?? searchInput?.value ?? "").trim();
    if (currentVal.length > 0 && optionRow.parentElement) {
      simulateClick(optionRow.parentElement);
      await sleep(350);
      const rowsRetry = getIncludedLocationRowElements(anchorNow);
      if (rowsRetry.some((r) => doesLocationRowMatchCountry(r.normText, countryObj))) {
        return true;
      }
    }

    // If searchInput cleared to empty string after clicking, Meta accepted the selection
    const valAfter = (locNow?.inputEl?.value ?? searchInput?.value ?? "").trim();
    return valAfter === "";
  }

  // Progressive character-by-character typing for Location Search (crucial for countries like Suíça / Switzerland, Madagascar, Mauritânia)
  async function typeSlowlyInLocationSearch(searchInput, queryText, countryObj) {
    if (!searchInput) return false;
    searchInput.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(120);

    simulateClick(searchInput);
    searchInput.focus();
    await sleep(120);

    const isInputTag =
      searchInput.tagName === "INPUT" || searchInput.tagName === "TEXTAREA";
    const proto =
      searchInput.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const nativeSetter = isInputTag
      ? Object.getOwnPropertyDescriptor(proto, "value")?.set
      : null;

    // 1. Clear existing text completely
    if (isInputTag) {
      searchInput.select?.();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      if (nativeSetter) {
        nativeSetter.call(searchInput, "");
      } else {
        searchInput.value = "";
      }
      searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: "" }));
    } else {
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
    }
    await sleep(160);

    // 2. Type character by character with human pauses so Meta's autocomplete popup opens and refreshes cleanly
    let typedSoFar = "";
    for (let i = 0; i < queryText.length; i++) {
      const ch = queryText[i];
      typedSoFar += ch;

      searchInput.focus();
      if (isInputTag && typeof searchInput.setSelectionRange === "function") {
        const prevLen = typedSoFar.length - 1;
        try {
          searchInput.setSelectionRange(prevLen, prevLen);
        } catch (_) {}
      }

      searchInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: ch, bubbles: true })
      );

      let inserted = document.execCommand("insertText", false, ch);
      if (isInputTag && (!inserted || searchInput.value !== typedSoFar)) {
        if (nativeSetter) {
          nativeSetter.call(searchInput, typedSoFar);
        } else {
          searchInput.value = typedSoFar;
        }
        searchInput.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: ch
          })
        );
      }

      searchInput.dispatchEvent(
        new KeyboardEvent("keyup", { key: ch, bubbles: true })
      );

      // Pause 420ms after the 3rd character (so the autocomplete dropdown opens),
      // and 300ms after each subsequent character so the list updates while typing slowly!
      const waitMs = i < 2 ? 110 : i === 2 ? 420 : 300;
      await sleep(waitMs);

      // Once at least 3 characters have been typed, check if the Country option is already in the dropdown!
      if (i >= 2 && i < queryText.length - 1) {
        const earlyMatch = findBestCountrySuggestionInDOM(
          queryText,
          countryObj,
          i < 4 // require exact country title match on 3-4 letters, allow startsWith on 5+ letters
        );
        if (earlyMatch) {
          const confirmed = await clickAndConfirmCountryOption(
            earlyMatch,
            searchInput,
            countryObj
          );
          if (confirmed) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function doesLocationRowMatchCountry(normRowText, countryObj) {
    if (!normRowText || !countryObj) return false;
    const cleanRow = normRowText.replace(/^[*✓•\s]+/, "").trim();
    const keepNames = [
      countryObj.adSetName,
      countryObj.searchEN,
      countryObj.searchPT,
      ...(countryObj.altSearch || [])
    ]
      .filter(Boolean)
      .map((s) => normalizeStr(s));

    // Prevent "República do Congo" from matching "República Democrática do Congo"
    if (
      normalizeStr(countryObj.adSetName) === "republica do congo" &&
      (cleanRow.includes("democratica") || cleanRow.includes("democratic"))
    ) {
      return false;
    }

    return keepNames.some(
      (k) =>
        cleanRow === k ||
        cleanRow.startsWith(k + " (") ||
        cleanRow.startsWith(k + " -") ||
        (cleanRow === k.split(" ")[0] && k.includes("suica"))
    );
  }

  // Return all individual included country rows inside the Locations card (above "Search locations")
  function getIncludedLocationRowElements(searchBoxEl) {
    const locFound = findLocationSearchBoxOrInput();
    const refEl = searchBoxEl || locFound?.inputEl || locFound?.clickTargetEl;
    if (!refEl) return [];

    const searchRect = refEl.getBoundingClientRect();
    const locHeader = findElementByText(
      ["Locations", "Localizações"],
      ["h2", "h3", "h4", "span", "div", "label"]
    );
    const headerBottom =
      locHeader && locHeader.getBoundingClientRect().bottom < searchRect.top - 35
        ? locHeader.getBoundingClientRect().bottom
        : searchRect.top - 380;
    const minTop = Math.max(80, headerBottom);
    const maxBottom = searchRect.top - 4;

    const ignoreWords = new Set([
      "locations",
      "localizacoes",
      "countries",
      "paises",
      "regions",
      "regioes",
      "include",
      "incluir",
      "browse",
      "procurar",
      "explorar",
      "edit",
      "editar",
      "remove",
      "remover",
      "general",
      "geral",
      "strategy type",
      "tipo de estrategia",
      "customer life cycle strategy",
      "exclude audiences",
      "excluir publicos",
      "value rules",
      "regras de valor",
      "budget & schedule",
      "orcamento e programacao",
      "budget",
      "orcamento",
      "start date",
      "data de inicio",
      "end date",
      "data de termino",
      "minimum spend limit",
      "maximum spend limit",
      "audience controls",
      "controles de publico",
      "location",
      "localizacao",
      "minimum age",
      "idade minima",
      "exclude these custom audiences",
      "audience",
      "publico",
      "custom audience",
      "age",
      "idade",
      "gender",
      "genero",
      "detailed targeting",
      "direcionamento detalhado",
      "ad transparency",
      "transparencia do anuncio",
      "advertiser and payer",
      "placements",
      "posicionamentos",
      "devices",
      "dispositivos",
      "name",
      "nome",
      "ad set name",
      "nome do conjunto",
      "edit all selected ad sets",
      "editar todos os conjuntos selecionados",
      "changes made to",
      "alteracoes feitas em"
    ]);

    // Find leaf text elements (no child elements) in the included locations list area
    const leafNodes = Array.from(document.querySelectorAll("span, div")).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      // Never match items inside navigation bars, drawer tabs, or sidebar trees
      if (el.closest('nav, [role="navigation"], [role="tablist"], [role="tree"], [role="treeitem"]')) return false;
      if (el.children.length > 0) return false;
      const r = el.getBoundingClientRect();
      if (r.top < minTop || r.bottom > maxBottom + 4) return false;
      if (r.left < 210 || r.left > 780) return false;
      if (r.height < 12 || r.height > 44 || r.width < 16) return false;

      const raw = (el.innerText || el.textContent || "").trim();
      if (!raw || raw.length > 65 || raw.includes("\n") || raw.includes(",")) return false;
      if (!/[a-zA-ZÀ-ÿ]{2,}/.test(raw)) return false;

      const norm = normalizeStr(raw);
      if (ignoreWords.has(norm) || norm.startsWith("location:") || norm.startsWith("localizacao:")) {
        return false;
      }
      return true;
    });

    // For each included country, deduplicate by normalized name
    const byNorm = new Map();
    for (const el of leafNodes) {
      const raw = (el.innerText || el.textContent || "").trim();
      const norm = normalizeStr(raw);
      const r = el.getBoundingClientRect();
      const prev = byNorm.get(norm);
      if (!prev || r.top > prev.rect.top + 4 || r.left > prev.rect.left + 8) {
        byNorm.set(norm, { el, text: raw, normText: norm, rect: r });
      }
    }

    const allRows = Array.from(byNorm.values());
    return allRows.sort((a, b) => a.rect.top - b.rect.top);
  }

  async function updateAdSetLocation(countryObj) {
    log(`Trocando localização para: ${countryObj.adSetName} (${countryObj.searchEN})...`, "info");

    // In Drawer View, ensure "Location" tab is selected if present
    const navLocTab = Array.from(
      document.querySelectorAll('[role="tab"], [role="treeitem"], div, span, a')
    ).find((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      if (r.left < 210 || r.left > 560) return false;
      const t = normalizeStr(el.innerText || "");
      return t === "location" || t === "locations" || t === "localizacao" || t === "localizacoes";
    });
    if (navLocTab && navLocTab.closest('nav, [role="navigation"], [role="tablist"]')) {
      simulateClick(navLocTab);
      await sleep(300);
    }

    // STEP 1: Expand "Locations" card if collapsed so "Search locations" input appears
    let locFound = await expandLocationsSectionIfNeeded();

    if (!locFound) {
      log("❌ Campo 'Search locations' / 'Pesquisar localizações' não encontrado!", "err");
      return false;
    }

    const anchorEl = locFound.inputEl || locFound.clickTargetEl;
    // Scroll so both the included countries list above "Search locations" AND the search box are in the middle of the viewport
    const locHeaderEl = findElementByText(
      ["Locations", "Localizações"],
      ["h2", "h3", "h4", "span", "div", "label"]
    );
    if (locHeaderEl && locHeaderEl.getBoundingClientRect().top < 110) {
      locHeaderEl.scrollIntoView({ behavior: "instant", block: "center" });
    } else {
      anchorEl.scrollIntoView({ behavior: "instant", block: "center" });
    }
    await sleep(320);

    // Check if the target country is ALREADY present in the Locations list (re-checking once after 200ms in case React is still hydrating the card)
    let existingRowsBefore = getIncludedLocationRowElements(anchorEl);
    let alreadyHasTarget = existingRowsBefore.some((r) =>
      doesLocationRowMatchCountry(r.normText, countryObj)
    );
    if (!alreadyHasTarget) {
      await sleep(220);
      existingRowsBefore = getIncludedLocationRowElements(anchorEl);
      alreadyHasTarget = existingRowsBefore.some((r) =>
        doesLocationRowMatchCountry(r.normText, countryObj)
      );
    }

    let addedNewCountry = alreadyHasTarget;

    if (alreadyHasTarget) {
      log(`✅ País "${countryObj.adSetName}" já consta selecionado em Locations.`, "ok");
    } else {
      // Detect if Ads Manager UI is in English or Portuguese
      const sampleEl = locFound.inputEl || locFound.clickTargetEl;
      const uiText = (
        sampleEl?.placeholder ||
        sampleEl?.getAttribute?.("aria-label") ||
        locFound.clickTargetEl?.innerText ||
        ""
      ).toLowerCase();
      const isPortugueseUI =
        uiText.includes("pesquisar") || uiText.includes("procurar") || uiText.includes("localiza");

      const searchCandidates = isPortugueseUI
        ? [countryObj.searchPT, countryObj.searchEN, ...(countryObj.altSearch || [])]
        : [countryObj.searchEN, countryObj.searchPT, ...(countryObj.altSearch || [])];

      const uniqueQueries = [...new Set(searchCandidates.filter(Boolean))];

      // STEP 2 & STEP 3: Type the NEW country character-by-character FIRST and click the option with "Country" / "País" underneath
      for (const queryText of uniqueQueries) {
        // Re-acquire fresh searchInput on every attempt so detached React nodes never cause a miss
        const freshLoc = findLocationSearchBoxOrInput() || locFound;
        let searchInput = freshLoc.inputEl;
        if (!searchInput || searchInput.tagName !== "INPUT" || !document.body.contains(searchInput)) {
          const clickTarget = freshLoc.clickTargetEl || anchorEl;
          clickTarget.scrollIntoView({ behavior: "instant", block: "center" });
          await sleep(120);
          simulateClick(clickTarget);
          await sleep(220);
          if (document.activeElement && document.activeElement.tagName === "INPUT") {
            searchInput = document.activeElement;
          } else {
            const refreshed = findLocationSearchBoxOrInput();
            searchInput = refreshed?.inputEl || freshLoc.clickTargetEl;
          }
        }

        log(`Digitando novo país aos poucos: "${queryText}"...`, "info");

        const clickedEarly = await typeSlowlyInLocationSearch(
          searchInput,
          queryText,
          countryObj
        );
        if (clickedEarly) {
          log(`✅ Novo país "${queryText}" (Country/País) adicionado!`, "ok");
          addedNewCountry = true;
          break;
        }

        const selected = await waitAndClickCountrySuggestion(queryText, countryObj, searchInput);
        if (selected) {
          log(`✅ Novo país "${queryText}" (Country/País) adicionado!`, "ok");
          addedNewCountry = true;
          break;
        }
      }
    }

    // Safety net: When a country (like Senegal) is ALREADY included in Locations, Meta hides "Senegal (Country)" from the search dropdown!
    // So if typing didn't find the Country option in the dropdown, clear the search box and check if the target country is already in Locations!
    if (!addedNewCountry) {
      const checkLoc = findLocationSearchBoxOrInput() || locFound;
      if (checkLoc?.inputEl) {
        checkLoc.inputEl.blur?.();
      }
      await sleep(250);
      const rowsNow = getIncludedLocationRowElements(
        checkLoc?.inputEl || checkLoc?.clickTargetEl || anchorEl
      );
      if (rowsNow.some((r) => doesLocationRowMatchCountry(r.normText, countryObj))) {
        log(
          `✅ País "${countryObj.adSetName}" já estava selecionado em Locations (por isso não apareceu duplicado na busca).`,
          "ok"
        );
        addedNewCountry = true;
      }
    }

    if (!addedNewCountry) {
      log(
        `⚠️ Não foi possível clicar na sugestão "Country/País" para ${countryObj.adSetName}. Verifique o campo Locations.`,
        "warn"
      );
      return false;
    }

    // STEP 4: Now that the new country is confirmed, remove all other countries (e.g. "France", "Benin", "Brazil") by clicking their 'X' (Remove) button
    await sleep(450);
    const refreshedLoc = findLocationSearchBoxOrInput() || locFound;
    const currentAnchor = refreshedLoc.inputEl || refreshedLoc.clickTargetEl || anchorEl;
    await removeOldLocationsExcept(currentAnchor, countryObj);
    return true;
  }

  async function removeOldLocationsExcept(searchBoxEl, targetCountryObj) {
    let removedTotal = 0;
    const targetNormEN = normalizeStr(targetCountryObj.searchEN || "");
    const targetNormPT = normalizeStr(targetCountryObj.searchPT || "");
    const targetNormAdSet = normalizeStr(targetCountryObj.adSetName || "");
    const altNorms = (targetCountryObj.altSearch || []).map((a) => normalizeStr(a));
    const targetNames = [targetNormEN, targetNormPT, targetNormAdSet, ...altNorms].filter(Boolean);

    // Run up to 8 passes so each old country row is hovered and removed one by one cleanly
    for (let pass = 0; pass < 8; pass++) {
      const locFound = findLocationSearchBoxOrInput();
      const currentAnchor = locFound?.inputEl || locFound?.clickTargetEl || searchBoxEl;
      if (!currentAnchor) break;

      // Strategy 0: Direct aria-label removal button scan (e.g. "Remove Brazil", "Remover Brasil", "Remove Germany", etc.)
      const directRemoveBtns = Array.from(
        document.querySelectorAll(
          '[aria-label*="remove" i], [aria-label*="remover" i], button[title*="remove" i], button[title*="remover" i]'
        )
      ).filter((btn) => {
        if (!isVisible(btn) || btn.closest("#mab-root-panel")) return false;
        const r = btn.getBoundingClientRect();
        if (r.left < 210 || r.left > window.innerWidth - 240) return false;
        if (r.top < 80 || r.top > window.innerHeight - 80) return false;
        const rawLabel = btn.getAttribute("aria-label") || btn.getAttribute("title") || "";
        const label = normalizeStr(rawLabel);
        // Do NOT remove the target country!
        if (targetNames.some((tn) => label.includes(tn))) return false;
        return (
          label.startsWith("remove ") ||
          label.startsWith("remover ") ||
          label.endsWith(" remove") ||
          label.endsWith(" remover")
        );
      });

      if (directRemoveBtns.length > 0) {
        for (const btn of directRemoveBtns) {
          const rawLabel = btn.getAttribute("aria-label") || btn.getAttribute("title") || "país antigo";
          log(`🗑️ Removendo país antigo "${rawLabel}" de Locations...`, "info");
          btn.scrollIntoView({ behavior: "instant", block: "center" });
          await sleep(100);
          simulateClick(btn);
          btn.click?.();
          await sleep(400);
          removedTotal++;
        }
        await sleep(250);
        continue;
      }

      const allIncludedRows = getIncludedLocationRowElements(currentAnchor);

      // Filter to rows that do NOT match targetCountryObj
      const oldRows = allIncludedRows.filter(
        (row) => !doesLocationRowMatchCountry(row.normText, targetCountryObj)
      );

      if (oldRows.length === 0) {
        break;
      }

      const victim = oldRows[0];
      const victimEl = victim.el;
      victimEl.scrollIntoView({ behavior: "instant", block: "center" });
      await sleep(140);

      // Walk up from victimEl to find the full-width gray pill row "[ 🌐 France   •••   ✕ ]"
      // Note: The gray row is typically 420..650px wide and 30..64px tall, and does NOT contain the Search locations input!
      let grayRow = victimEl.parentElement;
      const ancestorChain = [victimEl];
      let curr = victimEl.parentElement;
      while (curr && curr !== document.body) {
        if (currentAnchor && curr.contains(currentAnchor)) break;
        const rr = curr.getBoundingClientRect();
        if (rr.height > 95) break;
        ancestorChain.push(curr);
        if (rr.width >= 240 && rr.height >= 26 && rr.height <= 68) {
          grayRow = curr;
        }
        curr = curr.parentElement;
      }

      // Hover over every ancestor in the chain (with relatedTarget: document.body so React 18's delegated onMouseEnter/onPointerEnter fires!)
      for (const node of ancestorChain) {
        if (!node) continue;
        const nr = node.getBoundingClientRect();
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: nr.left + nr.width / 2,
          clientY: nr.top + nr.height / 2,
          relatedTarget: document.body
        };
        node.dispatchEvent(new PointerEvent("pointerover", opts));
        node.dispatchEvent(new PointerEvent("pointerenter", opts));
        node.dispatchEvent(new MouseEvent("mouseover", opts));
        node.dispatchEvent(new MouseEvent("mouseenter", opts));
        node.dispatchEvent(new PointerEvent("pointermove", opts));
        node.dispatchEvent(new MouseEvent("mousemove", opts));
      }

      // Also if any action button container inside grayRow is hidden via CSS :hover (opacity: 0 / visibility: hidden / display: none), make it visible!
      if (grayRow) {
        const innerNodes = Array.from(grayRow.querySelectorAll("div, span, button, [role='button']"));
        for (const node of innerNodes) {
          if (node.contains(victimEl)) continue;
          const st = window.getComputedStyle(node);
          if (st.opacity === "0") node.style.opacity = "1";
          if (st.visibility === "hidden") node.style.visibility = "visible";
          if (st.display === "none") node.style.display = "inline-flex";
        }
      }

      await sleep(260);

      const vRect = victimEl.getBoundingClientRect();
      const vCenterY = vRect.top + vRect.height / 2;
      const grayRect = grayRow ? grayRow.getBoundingClientRect() : vRect;

      // Strategy 1: Look inside grayRow (and its immediate parent) for a button with aria-label="Remove" / "Remover" or the rightmost action button
      const scopeRoot = grayRow?.parentElement && !grayRow.parentElement.contains(currentAnchor)
        ? grayRow.parentElement
        : grayRow || document;

      const rowButtons = Array.from(
        scopeRoot.querySelectorAll('[aria-label], [role="button"], button, svg, i')
      ).filter((btn) => {
        if (btn.closest("#mab-root-panel")) return false;
        if (btn.contains(victimEl)) return false;
        const r = btn.getBoundingClientRect();
        if (r.width < 6 || r.width > 56 || r.height < 6 || r.height > 56) return false;
        const btnCenterY = r.top + r.height / 2;
        return Math.abs(btnCenterY - vCenterY) <= 26 && r.left > vRect.right + 15;
      });

      // Also scan document-level buttons on that exact horizontal band (without any 730px cap!)
      const bandButtons = Array.from(
        document.querySelectorAll('[aria-label], [role="button"], button, svg, i')
      ).filter((btn) => {
        if (!isVisible(btn) || btn.closest("#mab-root-panel")) return false;
        if (btn.contains(victimEl)) return false;
        const r = btn.getBoundingClientRect();
        if (r.width < 6 || r.width > 56 || r.height < 6 || r.height > 56) return false;
        const btnCenterY = r.top + r.height / 2;
        if (Math.abs(btnCenterY - vCenterY) > 22) return false;
        return r.left > vRect.right + 15 && r.right <= Math.max(grayRect.right + 24, window.innerWidth - 20);
      });

      const allCandidates = [...new Set([...rowButtons, ...bandButtons])];

      // Priority A: Explicit "Remove" / "Remover" aria-label or title
      let closeBtn = allCandidates.find((btn) => {
        const aria = normalizeStr(
          btn.getAttribute("aria-label") ||
            btn.getAttribute("title") ||
            btn.closest("[aria-label]")?.getAttribute("aria-label") ||
            ""
        );
        return (
          aria === "remove" ||
          aria === "remover" ||
          aria.includes("remove") ||
          aria.includes("remover") ||
          aria.includes("excluir") ||
          aria.includes("delete")
        );
      });

      // Priority B: Rightmost button/icon on that country's row (in "[ 🌐 France  •••  ✕ ]", '✕' is always the rightmost button!)
      if (!closeBtn && allCandidates.length > 0) {
        allCandidates.sort(
          (a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left
        );
        closeBtn = allCandidates[0];
      }

      if (closeBtn) {
        const clickableClose =
          closeBtn.closest('[role="button"], button, [aria-label]') || closeBtn;
        log(`🗑️ Removendo país antigo "${victim.text}" de Locations...`, "info");
        simulateClick(clickableClose);
        if (closeBtn !== clickableClose) {
          simulateClick(closeBtn);
        }
        clickableClose.click?.();
        await sleep(420);

        // Verify if victim was actually removed
        const rowsAfter = getIncludedLocationRowElements(currentAnchor);
        const stillThere = rowsAfter.some((r) => r.normText === victim.normText);
        if (!stillThere) {
          removedTotal++;
          continue;
        }
      }

      // Priority C: Coordinate hit-test at the right end of the gray pill row (grayRect.right - 20, vCenterY)
      if (grayRect && grayRect.width >= 200) {
        const hitX = grayRect.right - 20;
        const hitY = vCenterY;
        const ptEl = document.elementFromPoint(hitX, hitY);
        if (ptEl && !ptEl.closest("#mab-root-panel")) {
          const hitBtn = ptEl.closest('[role="button"], button, [aria-label]') || ptEl;
          log(`🗑️ Removendo país antigo "${victim.text}" (botão X à direita)...`, "info");
          simulateClick(hitBtn);
          hitBtn.click?.();
          await sleep(420);

          const rowsAfterHit = getIncludedLocationRowElements(currentAnchor);
          if (!rowsAfterHit.some((r) => r.normText === victim.normText)) {
            removedTotal++;
            continue;
          }
        }
      }
    }

    if (removedTotal > 0) {
      log(
        `✅ ${removedTotal} localização(ões) antiga(s) removida(s) — ficou apenas "${targetCountryObj.adSetName}"!`,
        "ok"
      );
    }
  }

  function findBestCountrySuggestionInDOM(queryText, countryObj, exactOnly = false) {
    const normQuery = normalizeStr(queryText);
    const normEN = normalizeStr(countryObj.searchEN);
    const normPT = normalizeStr(countryObj.searchPT);
    const altNorms = (countryObj.altSearch || []).map((a) => normalizeStr(a));

    // Note: The dropdown popup can open ABOVE or BELOW the Search locations input, and options can vary in width!
    const optionCandidates = Array.from(
      document.querySelectorAll(
        '[role="option"], [role="listitem"], [role="listbox"] div, [data-visualcompletion] div, ul li, div'
      )
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      return (
        r.left > 260 &&
        r.left < window.innerWidth - 60 &&
        r.width >= 45 &&
        r.width <= 680 &&
        r.height >= 22 &&
        r.height <= 92
      );
    });

    let bestExactCountry = null;
    let bestStartsWithCountry = null;
    let bestFallbackCountry = null;

    for (const opt of optionCandidates) {
      const rawText = (opt.innerText || opt.textContent || "").trim();
      if (!rawText || rawText.length > 140 || !rawText.includes("\n")) continue;

      const lines = rawText
        .split(/\n+/)
        .map((l) => normalizeStr(l))
        .filter(Boolean);
      if (lines.length < 2) continue;

      const titleLine = lines[0];
      const subLine = lines[lines.length - 1];

      // Subline must be "Country" / "País" (or Region/Região), NEVER "City" / "Cidade" / "Neighbourhood" / "State"
      const isCountrySubtitle =
        subLine === "country" ||
        subLine === "pais" ||
        subLine === "region" ||
        subLine === "regiao" ||
        subLine === "territory" ||
        subLine === "territorio" ||
        subLine.startsWith("country") ||
        subLine.startsWith("pais");

      if (!isCountrySubtitle) continue;

      const isExactName =
        titleLine === normEN ||
        titleLine === normPT ||
        titleLine === normQuery ||
        altNorms.includes(titleLine);

      const isStartsWithName =
        !titleLine.includes("export") &&
        (titleLine.startsWith(normEN) ||
          titleLine.startsWith(normPT) ||
          titleLine.startsWith(normQuery) ||
          altNorms.some((a) => a.length >= 4 && titleLine.startsWith(a)));

      const isContainsName =
        !titleLine.includes("export") &&
        (titleLine.includes(normEN) ||
          titleLine.includes(normPT) ||
          titleLine.includes(normQuery));

      if (isExactName && !bestExactCountry) {
        bestExactCountry = opt;
      } else if (isStartsWithName && !bestStartsWithCountry) {
        bestStartsWithCountry = opt;
      } else if (isContainsName && !bestFallbackCountry) {
        bestFallbackCountry = opt;
      }
    }

    if (exactOnly) {
      return bestExactCountry;
    }
    return bestExactCountry || bestStartsWithCountry || bestFallbackCountry;
  }

  async function waitAndClickCountrySuggestion(queryText, countryObj, searchInput = null) {
    for (let attempt = 0; attempt < 9; attempt++) {
      await sleep(260);
      const winner = findBestCountrySuggestionInDOM(
        queryText,
        countryObj,
        attempt < 2
      );
      if (winner) {
        const confirmed = await clickAndConfirmCountryOption(
          winner,
          searchInput,
          countryObj
        );
        if (confirmed) {
          return true;
        }
      }
    }
    return false;
  }

  // 4. Fill Advertiser (optional) under "Ad transparency" -> "Futuretech Dynamics LLC"
  async function updateAdSetAdvertiser(advertiserName = "Futuretech Dynamics LLC") {
    if (!advertiserName) return false;
    log(`Verificando Ad transparency / Advertiser ("${advertiserName}")...`, "info");

    const pageText = document.body.innerText || "";
    if (pageText.toLowerCase().includes(advertiserName.toLowerCase())) {
      log(`✅ Anunciante "${advertiserName}" já consta preenchido.`, "ok");
      return true;
    }

    const transparencyEl = await scrollEditorUntil(
      () =>
        findElementByText(
          [
            "Advertiser (optional)",
            "Anunciante (opcional)",
            "Ad transparency",
            "Transparência do anúncio",
            "Beneficiary and payer",
            "Beneficiário e pagador"
          ],
          ["div", "span", "label", "h3", "h4"]
        ),
      { startFromCurrent: true, maxSteps: 6 }
    );

    if (!transparencyEl) {
      log("ℹ️ Campo 'Ad transparency / Advertiser' não exigido ou oculto para este conjunto.", "info");
      return false;
    }

    transparencyEl.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(250);

    const card =
      transparencyEl.closest("div")?.parentElement?.parentElement?.parentElement ||
      transparencyEl.parentElement;
    if (!card) return false;

    const inputOrCombo = card.querySelector(
      'input[type="text"], input:not([type]), [role="combobox"], [role="button"]'
    );
    if (!inputOrCombo) return false;

    simulateClick(inputOrCombo);
    await sleep(250);

    const activeInput =
      card.querySelector('input[type="text"], input:not([type])') ||
      (document.activeElement?.tagName === "INPUT" ? document.activeElement : null);

    if (activeInput) {
      await setReactInputValue(activeInput, advertiserName, false);
      await sleep(500);
    }

    const matchingOpt = findElementByText([advertiserName], ['[role="option"]', "li", "div", "span"]);
    if (matchingOpt) {
      simulateClick(matchingOpt);
      await sleep(200);
    }

    log(`✅ Anunciante verificado "${advertiserName}" configurado.`, "ok");
    return true;
  }

  // =========================================================================
  // AD LEVEL AUTOMATION (URL LANGUAGE TAG + TRANSLATION + CREATIVES)
  // =========================================================================

  // Insert or replace URL language tag right after the domain (.com/):
  // Base URL: https://app.simplificandocomcafe.com/1409/figurinhas-frases-bom-dia-compartilhar-2/
  // New URL:  https://app.simplificandocomcafe.com/fr/1409/figurinhas-frases-bom-dia-compartilhar-2/
  function replaceUrlLanguageTag(rawUrl, targetLangCode) {
    if (!rawUrl || !targetLangCode) return rawUrl;
    const lang = targetLangCode.trim().toLowerCase();

    if (rawUrl.includes("{lang}")) {
      return rawUrl.replace(/\{lang\}/gi, lang);
    }

    const originMatch = rawUrl.trim().match(/^(https?:\/\/[^\/]+)(\/.*|$)/i);
    if (!originMatch) return rawUrl;

    const origin = originMatch[1]; // e.g. "https://app.simplificandocomcafe.com"
    const rest = originMatch[2] || "/"; // e.g. "/1409/figurinhas-frases-bom-dia-compartilhar-2/"

    // If the first path segment right after the domain is already a 2-3 letter language code (e.g. /fr/1409/...), replace it
    const firstSegLangRegex =
      /^\/(pt|fr|es|en|de|sr|it|nl|ro|hu|cs|sk|hi|th|id|ur|pl|uk|tl|ru|ar|[a-z]{2})(\/.*|[?#].*|$)/i;
    if (firstSegLangRegex.test(rest)) {
      return `${origin}${rest.replace(firstSegLangRegex, `/${lang}$2`)}`;
    }

    // Otherwise, insert /${lang} immediately after the domain (.com/)
    const normalizedRest = rest.startsWith("/") ? rest : `/${rest}`;
    return `${origin}/${lang}${normalizedRest}`;
  }

  function findWebsiteUrlInput() {
    const candidates = Array.from(
      document.querySelectorAll('input[type="text"], input[type="url"], input:not([type]), textarea')
    )
      .filter((el) => isVisible(el) && !el.closest("#mab-root-panel"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left > 210 && r.left < window.innerWidth - 240 && r.height >= 16 && r.height <= 90;
      });

    // Anchor: "* Website URL" / "Website URL" / "URL do site" label
    const urlLabel = findElementByText(
      ["Website URL", "URL do site"],
      ["div", "span", "label", "h3", "h4"]
    );
    const labelRect = urlLabel ? urlLabel.getBoundingClientRect() : null;

    for (const el of candidates) {
      const val = (el.value || "").trim();
      const ph = (el.placeholder || "").toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const r = el.getBoundingClientRect();

      if (
        val.startsWith("http://") ||
        val.startsWith("https://") ||
        ph.includes("http://") ||
        ph.includes("https://") ||
        ph.includes("website url") ||
        ph.includes("url do site") ||
        aria.includes("website url") ||
        aria.includes("url do site")
      ) {
        return el;
      }

      if (
        labelRect &&
        r.top >= labelRect.top - 5 &&
        r.top <= labelRect.bottom + 85 &&
        Math.abs(r.left - labelRect.left) < 180
      ) {
        return el;
      }
    }
    return null;
  }

  async function updateAdWebsiteUrl(targetLangCode) {
    log(`Procurando campo "Website URL" no Anúncio para idioma "${targetLangCode}"...`, "info");

    // If Destination / Website URL header exists, scroll it into view
    const destHeader = findElementByText(
      ["Website URL", "URL do site", "Destination", "Destino"],
      ["div", "span", "label", "h3", "h4"]
    );
    if (destHeader) {
      destHeader.scrollIntoView({ behavior: "instant", block: "center" });
      await sleep(250);
    }

    let urlInput = await scrollEditorUntil(findWebsiteUrlInput, {
      startFromCurrent: true,
      maxSteps: 12
    });

    // Retry briefly if the Ad page is still finishing its initial render
    if (!urlInput) {
      for (let r = 0; r < 4 && !urlInput; r++) {
        await sleep(350);
        urlInput = findWebsiteUrlInput();
      }
    }

    if (!urlInput) {
      log("⚠️ Campo 'Website URL' não encontrado no Anúncio.", "warn");
      return false;
    }

    urlInput.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(150);

    const currentUrl = (urlInput.value || state.baseTexts.urlTemplate || "").trim();
    if (!currentUrl) {
      log("⚠️ O campo Website URL está vazio.", "warn");
      return false;
    }

    const updatedUrl = replaceUrlLanguageTag(currentUrl, targetLangCode);
    if (updatedUrl === currentUrl) {
      log(`✅ Website URL já está com a tag "/${targetLangCode}/": "${currentUrl}"`, "ok");
      return true;
    }

    await setReactInputValue(urlInput, updatedUrl, true);
    log(`✅ URL atualizada: "${currentUrl}" -> "${updatedUrl}"`, "ok");
    return true;
  }

  // Detect if an editable text box belongs to "Advantage+ creative text generation" AI suggestions
  function isElementInsideAdvantagePlusSuggestions(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();

    // Check 1: Walk up ancestors (up to 7 levels, stopping before giant page containers) for Advantage+ AI markers
    let curr = el.parentElement;
    for (let i = 0; i < 7 && curr && curr !== document.body; i++) {
      const cr = curr.getBoundingClientRect();
      if (cr.height > 750) break;
      const txt = normalizeStr(curr.innerText || "");
      if (
        txt.includes("advantage+ creative text") ||
        txt.includes("apply all (") ||
        txt.includes("aplicar tudo (") ||
        txt.includes("generate new variations") ||
        txt.includes("gerar novas variacoes") ||
        txt.includes("used by ")
      ) {
        return true;
      }
      curr = curr.parentElement;
    }

    // Check 2: AI suggestion boxes have a checkbox immediately to their left (within 55px horizontally on the same row)
    const nearbyCheckboxes = Array.from(
      document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
    ).filter((cb) => {
      if (!isVisible(cb) || cb.closest("#mab-root-panel")) return false;
      const cbr = cb.getBoundingClientRect();
      return (
        Math.abs(cbr.top - r.top) < 28 &&
        cbr.left >= 290 &&
        cbr.right <= r.left + 8 &&
        r.left - cbr.left <= 65
      );
    });
    if (nearbyCheckboxes.length > 0) {
      return true;
    }

    return false;
  }

  // Automatically uncheck/disable "Advantage+ creative text generation" ("Apply all (5 of 5)" -> "Apply all (0 of 5)")
  async function disableAdvantagePlusTextSuggestions() {
    const advHeader = findElementByText(
      [
        "Advantage+ creative text generation",
        "Advantage+ creative text",
        "Geração de texto de criativo Advantage+"
      ],
      ["div", "span", "h3", "h4"]
    );
    const applyAllEl = findElementByText(
      ["Apply all (", "Aplicar tudo ("],
      ["div", "span", "label"]
    );

    const anchor = applyAllEl || advHeader;
    if (!anchor) return false;

    // Find the Advantage+ card container wrapping "Advantage+ creative text generation" and its checkboxes
    let card = anchor.parentElement;
    while (card && card !== document.body) {
      const r = card.getBoundingClientRect();
      const txt = normalizeStr(card.innerText || "");
      if (
        r.height >= 80 &&
        r.height <= 750 &&
        (txt.includes("apply all") || txt.includes("aplicar tudo") || txt.includes("advantage+"))
      ) {
        const cbs = card.querySelectorAll('input[type="checkbox"], [role="checkbox"]');
        if (cbs.length >= 1) break;
      }
      card = card.parentElement;
    }

    if (!card || card === document.body) return false;

    const isChecked = (cb) => {
      if (!cb) return false;
      if (cb.tagName === "INPUT" && cb.type === "checkbox" && cb.checked) return true;
      const aria = cb.getAttribute("aria-checked");
      return aria === "true" || aria === "mixed";
    };

    const clickBox = async (cb) => {
      const target = isVisible(cb)
        ? cb
        : cb.closest('label, [role="checkbox"]') || cb.parentElement;
      if (target) {
        target.scrollIntoView({ behavior: "instant", block: "center" });
        await sleep(100);
        simulateClick(target);
        await sleep(220);
      }
    };

    // Check if "Apply all (X of Y)" is currently > 0 (e.g. "Apply all (5 of 5)")
    const applyAllText = normalizeStr((applyAllEl || card).innerText || "");
    const alreadyZero =
      applyAllText.includes("apply all (0 of") || applyAllText.includes("aplicar tudo (0 de");

    const allCheckboxes = Array.from(
      card.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
    );
    const checkedBoxes = allCheckboxes.filter(isChecked);

    if (alreadyZero && checkedBoxes.length === 0) {
      return false;
    }

    if (checkedBoxes.length > 0) {
      log('🧹 Desativando sugestões do "Advantage+ creative text generation"...', "info");
      // Click the first checked box (which is "Apply all (5 of 5)" if all are selected)
      await clickBox(checkedBoxes[0]);
      await sleep(250);

      // If any individual suggestion checkboxes remain checked, uncheck them one by one
      const remainingChecked = Array.from(
        card.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
      ).filter(isChecked);

      for (const cb of remainingChecked) {
        await clickBox(cb);
      }
      log('✅ Sugestões do "Advantage+ creative text generation" desabilitadas (0 selecionadas).', "ok");
      return true;
    }

    return false;
  }

  // Locate ALL Primary Text, Headline, and Description fields in Ad editor (EXCLUDING Advantage+ AI suggestions)
  function findAdTextFieldsInViewport() {
    const primaryLabel = findElementByText(
      ["Primary text", "Texto principal"],
      ["div", "span", "label", "h3", "h4"]
    );
    const headlineLabel = findElementByText(
      ["Headline", "Título", "Titulo"],
      ["div", "span", "label", "h3", "h4"]
    );
    const descLabel = findElementByText(
      ["Description", "Descrição", "Descricao"],
      ["div", "span", "label", "h3", "h4"]
    );

    if (!primaryLabel && !headlineLabel) return null;

    // Ceiling markers so Primary text NEVER bleeds into "Advantage+ creative text generation" below "+ Add text option"
    const addTextOptionBtn = findElementByText(
      ["Add text option", "Adicionar opção de texto"],
      ["div", "span", "button"]
    );
    const advPlusTextHeader = findElementByText(
      [
        "Advantage+ creative text generation",
        "Advantage+ creative text",
        "Geração de texto de criativo Advantage+"
      ],
      ["div", "span", "h3", "h4"]
    );
    const addHeadlineOptionBtn = findElementByText(
      ["Add headline option", "Adicionar opção de título"],
      ["div", "span", "button"]
    );

    const endLabel = findElementByText(
      [
        "Optimise text per person",
        "Optimize text per person",
        "Otimizar texto por pessoa",
        "Call to action",
        "Chamada para ação"
      ],
      ["div", "span", "label", "h3", "h4"]
    );

    const primaryTop = primaryLabel ? primaryLabel.getBoundingClientRect().top : 0;
    const headlineTop = headlineLabel
      ? headlineLabel.getBoundingClientRect().top
      : primaryTop + 450;
    const descTop = descLabel ? descLabel.getBoundingClientRect().top : headlineTop + 260;
    const endTop = endLabel ? endLabel.getBoundingClientRect().top : descTop + 220;

    // Primary text boxes are strictly ABOVE "+ Add text option" and "Advantage+ creative text generation" and "Headline"
    let primaryMaxBottom = headlineTop - 4;
    if (addTextOptionBtn) {
      const btnTop = addTextOptionBtn.getBoundingClientRect().top;
      if (btnTop > primaryTop) primaryMaxBottom = Math.min(primaryMaxBottom, btnTop + 2);
    }
    if (advPlusTextHeader) {
      const advTop = advPlusTextHeader.getBoundingClientRect().top;
      if (advTop > primaryTop) primaryMaxBottom = Math.min(primaryMaxBottom, advTop - 2);
    }

    let headlineMaxBottom = descTop - 4;
    if (addHeadlineOptionBtn) {
      const hBtnTop = addHeadlineOptionBtn.getBoundingClientRect().top;
      if (hBtnTop > headlineTop) headlineMaxBottom = Math.min(headlineMaxBottom, hBtnTop + 2);
    }

    // Collect all visible text inputs, textareas, and contenteditable boxes in the center column
    const websiteUrlEl = findWebsiteUrlInput();
    const rawEditables = Array.from(
      document.querySelectorAll(
        'textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]'
      )
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      if (el.tagName === "BUTTON" || el.closest("button")) return false;
      // NEVER treat the Website URL input (or any input inside Destination / Website URL) as Primary Text / Headline!
      if (websiteUrlEl && (el === websiteUrlEl || el.contains(websiteUrlEl))) return false;
      const r = el.getBoundingClientRect();
      // Center form column is between x=210 and preview column
      if (r.left < 210 || r.left > Math.min(window.innerWidth - 240, 780)) return false;
      if (r.width < 120 || r.height < 18 || r.height > 180) return false;
      const ph = (el.placeholder || el.getAttribute("aria-placeholder") || "").toLowerCase();
      if (
        ph.includes("http") ||
        ph.includes("website") ||
        ph.includes("url") ||
        ph.includes("search") ||
        ph.includes("pesquisar")
      ) {
        return false;
      }
      const nearContainerTxt = normalizeStr(
        (el.closest("div")?.parentElement?.parentElement?.innerText || "").slice(0, 120)
      );
      if (
        nearContainerTxt.startsWith("website url") ||
        nearContainerTxt.startsWith("* website url") ||
        nearContainerTxt.startsWith("url do site") ||
        nearContainerTxt.startsWith("display link")
      ) {
        return false;
      }
      // Exclude any box inside "Advantage+ creative text generation" AI suggestions!
      if (isElementInsideAdvantagePlusSuggestions(el)) return false;
      return true;
    });

    // Deduplicate nested elements (e.g. a div[role="textbox"] containing a div[contenteditable="true"] at the same top)
    rawEditables.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    const uniqueEditables = [];
    for (const el of rawEditables) {
      const r = el.getBoundingClientRect();
      const existingIdx = uniqueEditables.findIndex(
        (u) => Math.abs(u.getBoundingClientRect().top - r.top) < 12
      );
      if (existingIdx >= 0) {
        if (
          el.getAttribute("contenteditable") === "true" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "INPUT"
        ) {
          uniqueEditables[existingIdx] = el;
        }
      } else {
        uniqueEditables.push(el);
      }
    }

    const primaryTextEls = [];
    const headlineEls = [];
    const descriptionEls = [];

    for (const el of uniqueEditables) {
      const top = el.getBoundingClientRect().top;
      if (primaryLabel && top > primaryTop && top < primaryMaxBottom) {
        primaryTextEls.push(el);
      } else if (headlineLabel && top > headlineTop && top < headlineMaxBottom) {
        headlineEls.push(el);
      } else if (descLabel && top > descTop && top < endTop - 4) {
        descriptionEls.push(el);
      }
    }

    if (primaryTextEls.length === 0 && headlineEls.length === 0 && descriptionEls.length === 0) {
      return null;
    }

    return {
      primaryTextEl: primaryTextEls[0] || null,
      headlineEl: headlineEls[0] || null,
      descriptionEl: descriptionEls[0] || null,
      primaryTextEls,
      headlineEls,
      descriptionEls,
      headlineLabel
    };
  }

  function findAdTextFields() {
    return (
      findAdTextFieldsInViewport() || {
        primaryTextEl: null,
        headlineEl: null,
        descriptionEl: null,
        primaryTextEls: [],
        headlineEls: [],
        descriptionEls: []
      }
    );
  }

  async function translateBatchViaBackground(items, targetLang, sourceLang = "auto") {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "TRANSLATE_BATCH",
          items,
          targetLang,
          sourceLang
        },
        (response) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (!response || !response.ok) {
            return reject(new Error(response?.error || "Falha ao traduzir textos"));
          }
          const map = {};
          (response.results || []).forEach((r) => {
            map[r.key] = r.translated;
          });
          resolve(map);
        }
      );
    });
  }

  function readEditableText(el) {
    if (!el) return "";
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      return (el.value || "").trim();
    }
    return (el.innerText || el.textContent || "").trim();
  }

  async function translateAndFillAdTexts(targetLangCode, useCustomPreview = false) {
    log(`Procurando campos de Texto Principal / Título / Descrição para traduzir (${targetLangCode})...`, "info");

    // Scroll until Primary text / Headline section is visible
    let fields = await scrollEditorUntil(findAdTextFieldsInViewport, {
      startFromCurrent: true,
      maxSteps: 12
    });

    // Always disable Advantage+ creative text generation AI suggestions if present
    await disableAdvantagePlusTextSuggestions();

    if (fields && fields.headlineLabel) {
      // Center on "Headline" so Primary text (above), Headline (center), and Description (below) are all in viewport!
      fields.headlineLabel.scrollIntoView({ behavior: "instant", block: "center" });
      await sleep(250);
      await disableAdvantagePlusTextSuggestions();
      fields = findAdTextFieldsInViewport() || fields;
    }

    if (
      !fields ||
      (fields.primaryTextEls.length === 0 &&
        fields.headlineEls.length === 0 &&
        fields.descriptionEls.length === 0)
    ) {
      log("⚠️ Campos de Texto Principal / Título não encontrados no Anúncio.", "warn");
      return false;
    }

    log(
      `📝 Campos detectados no Anúncio (sem Advantage+): ${fields.primaryTextEls.length} Texto(s), ${fields.headlineEls.length} Título(s), ${fields.descriptionEls.length} Descrição(ões).`,
      "info"
    );

    // Build list of all fields to translate (preferring original PT/EN texts captured in "Conferir" so translations are always faithful to the original!)
    const tasks = [];

    fields.primaryTextEls.forEach((el, idx) => {
      const screenTxt = readEditableText(el);
      const conferirTxt = state.conferirSource?.primaryTexts?.[idx] || "";
      const sourceTxt =
        useCustomPreview && idx === 0 && state.previewTranslations.primaryText
          ? state.previewTranslations.primaryText
          : conferirTxt || screenTxt || (idx === 0 ? state.baseTexts.primaryText : "");
      if (sourceTxt && /\p{L}/u.test(sourceTxt)) {
        tasks.push({
          key: `primary_${idx}`,
          label: `Texto Principal #${idx + 1}`,
          el,
          text: sourceTxt,
          alreadyTranslated: Boolean(
            useCustomPreview && idx === 0 && state.previewTranslations.primaryText
          )
        });
      }
    });

    fields.headlineEls.forEach((el, idx) => {
      const screenTxt = readEditableText(el);
      const conferirTxt = state.conferirSource?.headlines?.[idx] || "";
      const sourceTxt =
        useCustomPreview && idx === 0 && state.previewTranslations.headline
          ? state.previewTranslations.headline
          : conferirTxt || screenTxt || (idx === 0 ? state.baseTexts.headline : "");
      if (sourceTxt && /\p{L}/u.test(sourceTxt)) {
        tasks.push({
          key: `headline_${idx}`,
          label: `Título #${idx + 1}`,
          el,
          text: sourceTxt,
          alreadyTranslated: Boolean(
            useCustomPreview && idx === 0 && state.previewTranslations.headline
          )
        });
      }
    });

    fields.descriptionEls.forEach((el, idx) => {
      const screenTxt = readEditableText(el);
      const conferirTxt = state.conferirSource?.descriptions?.[idx] || "";
      const sourceTxt =
        useCustomPreview && idx === 0 && state.previewTranslations.description
          ? state.previewTranslations.description
          : conferirTxt || screenTxt || (idx === 0 ? state.baseTexts.description : "");
      // Note: if description is only emojis (e.g. "⭐⭐⭐⭐⭐"), /\p{L}/u is false so it stays untouched!
      if (sourceTxt && /\p{L}/u.test(sourceTxt)) {
        tasks.push({
          key: `desc_${idx}`,
          label: `Descrição #${idx + 1}`,
          el,
          text: sourceTxt,
          alreadyTranslated: Boolean(
            useCustomPreview && idx === 0 && state.previewTranslations.description
          )
        });
      }
    });

    if (tasks.length === 0) {
      log("ℹ️ Nenhum texto com palavras para traduzir nos campos encontrados.", "info");
      return false;
    }

    const itemsToRequest = tasks
      .filter((t) => !t.alreadyTranslated)
      .map((t) => ({ key: t.key, text: t.text }));

    let translatedMap = {};
    if (itemsToRequest.length > 0) {
      try {
        translatedMap = await translateBatchViaBackground(itemsToRequest, targetLangCode, "auto");
      } catch (err) {
        log(`❌ Erro na tradução automática: ${err.message}`, "err");
        return false;
      }
    }

    for (const task of tasks) {
      const finalTxt = task.alreadyTranslated ? task.text : translatedMap[task.key];
      if (finalTxt) {
        await setReactInputValue(task.el, finalTxt, false);
        log(`✅ ${task.label} (${targetLangCode}): "${finalTxt}"`, "ok");
        await sleep(180);
      }
    }

    return true;
  }

  async function removeCurrentAdCreatives() {
    log("Procurando criativos antigos para remover...", "info");
    const creativeHeader = await scrollEditorUntil(
      () =>
        findElementByText(
          ["Ad creative", "Criativo do anúncio", "Media", "Mídia"],
          ["div", "span", "h3", "h4"]
        ),
      { startFromCurrent: true, maxSteps: 8 }
    );
    if (creativeHeader) {
      creativeHeader.scrollIntoView({ behavior: "instant", block: "center" });
      await sleep(300);
    }

    const removeBtn = findElementByText(
      ["Remove all", "Remover tudo", "Delete all", "Excluir tudo"],
      ['[role="button"]', "button", "div", "span"]
    );
    if (removeBtn) {
      simulateClick(removeBtn);
      await sleep(300);
      log("✅ Criativos antigos removidos.", "ok");
      return true;
    }

    const trashBtns = Array.from(
      document.querySelectorAll(
        '[aria-label="Remove"], [aria-label="Delete"], [aria-label="Remover"], [aria-label="Excluir"]'
      )
    ).filter(
      (el) =>
        isVisible(el) &&
        !el.closest("#mab-root-panel") &&
        el.getBoundingClientRect().left > 270 &&
        el.getBoundingClientRect().left < 750
    );

    if (trashBtns.length > 0) {
      for (const btn of trashBtns) {
        simulateClick(btn);
        await sleep(250);
      }
      log(`✅ ${trashBtns.length} mídia(s) removida(s).`, "ok");
      return true;
    }

    log("ℹ️ Nenhum botão direto de lixeira encontrado em Mídia.", "info");
    return false;
  }

  // =========================================================================
  // STATUS ACTIVATION HELPERS (CAMPAIGN / AD SET / AD TOGGLE SWITCHES)
  // =========================================================================

  // Find the Status toggle switch located in the top-right header area
  // (adjacent to "In draft" / "Em rascunho" and the "..." menu button)
  function findTopHeaderStatusToggle() {
    try {
      // 1. Primary Strategy: Locate via proximity to "In draft" / "Em rascunho" / "Draft"
      const draftBadges = Array.from(document.querySelectorAll("span, div, p")).filter((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const txt = (el.textContent || "").trim();
        if (!/^(In draft|Em rascunho|Draft|Rascunho|Active|Ativo|Inactive|Desativado)$/i.test(txt)) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.top <= 120 && r.left >= 200;
      });

      for (const badge of draftBadges) {
        const bRect = badge.getBoundingClientRect();
        let p = badge.parentElement;
        for (let depth = 0; depth < 5 && p && p !== document.body; depth++) {
          const cands = Array.from(
            p.querySelectorAll('[role="switch"], [aria-checked], input[type="checkbox"], [tabindex="0"], div, button')
          ).filter((el) => {
            if (!isVisible(el) || el.closest("#mab-root-panel") || el === badge || el.contains(badge)) return false;
            const textLower = (el.textContent || "").toLowerCase();
            if (textLower.includes("partnership") || textLower.includes("parceria")) return false;
            const r = el.getBoundingClientRect();
            if (Math.abs(r.top + r.height / 2 - (bRect.top + bRect.height / 2)) > 28) return false;
            if (r.left < bRect.left - 5) return false;
            return r.width >= 22 && r.width <= 80 && r.height >= 12 && r.height <= 44;
          });
          if (cands.length > 0) {
            const best =
              cands.find(
                (c) =>
                  c.getAttribute("role") === "switch" ||
                  c.hasAttribute("aria-checked") ||
                  c.tagName === "INPUT"
              ) || cands[0];
            return best;
          }
          p = p.parentElement;
        }
      }

      // 2. Secondary Strategy: Locate via proximity to the "..." (More / Mais) button in top-right
      const moreBtns = Array.from(
        document.querySelectorAll(
          'button[aria-label*="More" i], button[aria-label*="Mais" i], button'
        )
      ).filter((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const r = el.getBoundingClientRect();
        return (
          r.top >= 0 &&
          r.top <= 100 &&
          r.right >= window.innerWidth - 180 &&
          r.width >= 20 &&
          r.width <= 60 &&
          r.height >= 20 &&
          r.height <= 60
        );
      });

      for (const moreBtn of moreBtns) {
        const mRect = moreBtn.getBoundingClientRect();
        let p = moreBtn.parentElement;
        for (let depth = 0; depth < 4 && p && p !== document.body; depth++) {
          const cands = Array.from(
            p.querySelectorAll('[role="switch"], [aria-checked], input[type="checkbox"], [tabindex="0"], div, button')
          ).filter((el) => {
            if (!isVisible(el) || el.closest("#mab-root-panel") || el === moreBtn || el.contains(moreBtn)) return false;
            const textLower = (el.textContent || "").toLowerCase();
            if (textLower.includes("partnership") || textLower.includes("parceria")) return false;
            const r = el.getBoundingClientRect();
            if (Math.abs(r.top + r.height / 2 - (mRect.top + mRect.height / 2)) > 28) return false;
            if (r.right > mRect.left + 5 || r.left < mRect.left - 170) return false;
            return r.width >= 22 && r.width <= 80 && r.height >= 12 && r.height <= 44;
          });
          if (cands.length > 0) {
            const best =
              cands.find(
                (c) =>
                  c.getAttribute("role") === "switch" ||
                  c.hasAttribute("aria-checked") ||
                  c.tagName === "INPUT"
              ) || cands[0];
            return best;
          }
          p = p.parentElement;
        }
      }

      // 3. Tertiary Strategy: Global query in top header region (top <= 120, right >= window.innerWidth - 450)
      const headerSwitches = Array.from(
        document.querySelectorAll(
          '[role="switch"], input[type="checkbox"][role="switch"], input[type="checkbox"], [aria-checked]'
        )
      ).filter((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const textLower = (el.textContent || "").toLowerCase();
        if (textLower.includes("partnership") || textLower.includes("parceria")) return false;
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.top > 120) return false;
        if (r.left < 200 || r.right < window.innerWidth - 450) return false;
        return r.width >= 20 && r.width <= 85 && r.height >= 12 && r.height <= 45;
      });

      if (headerSwitches.length > 0) {
        headerSwitches.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
        return headerSwitches[0];
      }

      // 4. Fallback for Table View (/manage/adsets): Selected row toggle
      const selectedRows = Array.from(
        document.querySelectorAll('tr[aria-selected="true"], tr[class*="selected"], [role="row"][aria-selected="true"]')
      );
      for (const row of selectedRows) {
        const sw = row.querySelector('[role="switch"], input[type="checkbox"]');
        if (sw && isVisible(sw)) return sw;
      }
    } catch (_) {}
    return null;
  }

  // Physical knob position check: In standard switch UI, knob on left = OFF, knob on right = ON
  function getSwitchKnobState(sw) {
    try {
      const swRect = sw.getBoundingClientRect();
      if (swRect.width < 15) return null;
      const allChildren = Array.from(sw.querySelectorAll("*")).filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width >= 8 &&
          r.width <= swRect.width * 0.85 &&
          r.height >= 8 &&
          r.height <= swRect.height + 6
        );
      });
      if (allChildren.length === 0) return null;
      allChildren.sort((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return Math.abs(ra.width - ra.height) - Math.abs(rb.width - rb.height);
      });
      const knob = allChildren[0];
      const knobRect = knob.getBoundingClientRect();
      const knobCenter = knobRect.left + knobRect.width / 2;
      const swCenter = swRect.left + swRect.width / 2;
      if (knobCenter < swCenter - 2) return "off";
      if (knobCenter > swCenter + 2) return "on";
    } catch (_) {}
    return null;
  }

  // Checks whether the switch element is in the OFF state
  function isSwitchElementOff(sw) {
    if (!sw) return false;

    // 1. Direct aria-checked
    const ariaChecked = sw.getAttribute("aria-checked");
    if (ariaChecked === "false") return true;
    if (ariaChecked === "true") return false;

    // 2. Child or self checkbox input
    const input = sw.tagName === "INPUT" ? sw : sw.querySelector('input[type="checkbox"]');
    if (input) {
      if (input.checked === false) return true;
      if (input.checked === true) return false;
    }

    // 3. aria-pressed
    const ariaPressed = sw.getAttribute("aria-pressed");
    if (ariaPressed === "false") return true;
    if (ariaPressed === "true") return false;

    // 4. data-state
    const dataState = sw.getAttribute("data-state");
    if (dataState === "unchecked" || dataState === "off") return true;
    if (dataState === "checked" || dataState === "on") return false;

    // 5. aria-label or title text
    const label = (sw.getAttribute("aria-label") || sw.getAttribute("title") || "").toLowerCase();
    if (
      label.includes("off") ||
      label.includes("desativad") ||
      label.includes("inactive") ||
      label.includes("inativ")
    )
      return true;
    if (label.includes("on") || label.includes("ativad") || label.includes("active")) return false;

    // 6. Knob physical position (left = off, right = on)
    const knobState = getSwitchKnobState(sw);
    if (knobState === "off") return true;
    if (knobState === "on") return false;

    // 7. Class names
    const cls = (sw.className || "").toString().toLowerCase();
    if (cls.includes("off") || cls.includes("inactive") || cls.includes("unchecked")) return true;
    if (cls.includes("on") || cls.includes("active") || cls.includes("checked")) return false;

    return false;
  }

  // Confirm modal if Meta pops up a "Turn on" / "Publish and turn on" dialog
  async function confirmAnyActivationModal() {
    try {
      const confirmBtn = findElementByText(
        ["Turn on", "Ativar", "Publish & turn on", "Publicar e ativar", "Confirm", "Confirmar"],
        ["button", '[role="button"]', "a", "span", "div"]
      );
      if (confirmBtn && isVisible(confirmBtn) && !confirmBtn.closest("#mab-root-panel")) {
        const dialog = confirmBtn.closest(
          '[role="dialog"], [role="alertdialog"], .modal, div[data-dialog]'
        );
        if (dialog) {
          log("🟢 Modal de confirmação detectado: clicando para ativar...", "info");
          simulateClick(confirmBtn);
          confirmBtn.click?.();
          await sleep(350);
        }
      }
    } catch (_) {}
  }

  // Check if the Campaign is turned off (via banner or sidebar) and turn it ON
  async function ensureCampaignActive() {
    try {
      // 1. Look for "Turn on campaign" / "Ativar campanha" warning banners
      const turnOnBtn = findElementByText(
        [
          "Turn on campaign",
          "Ativar campanha",
          "Turn campaign on",
          "Ligar campanha",
          "Publish & turn on",
          "Publicar e ativar"
        ],
        ["button", '[role="button"]', "a", "span", "div"]
      );
      if (turnOnBtn && isVisible(turnOnBtn) && !turnOnBtn.closest("#mab-root-panel")) {
        log('🟢 Banner de campanha inativa detectado! Clicando em "Ativar campanha"...', "info");
        simulateClick(turnOnBtn);
        turnOnBtn.click?.();
        await sleep(400);
        await confirmAnyActivationModal();
        return true;
      }

      // 2. Check the Campaign row switch in the sidebar tree
      const sidebarItems = getSidebarItems();
      if (sidebarItems.length > 0) {
        const campaignRow = sidebarItems[0];
        const rowEl = campaignRow.textEl?.parentElement?.parentElement || campaignRow.textEl?.parentElement;
        if (rowEl) {
          const sw = rowEl.querySelector('[role="switch"], input[type="checkbox"]');
          if (sw && isSwitchElementOff(sw)) {
            log("🟢 Ativando switch da Campanha na barra lateral (estava OFF)...", "info");
            simulateClick(sw);
            sw.click?.();
            await sleep(350);
            await confirmAnyActivationModal();
            return true;
          }
        }
      }
    } catch (_) {}
    return false;
  }

  // Ensure the top header toggle switch (next to "In draft") is turned ON (Active)
  async function ensureStatusToggleActive(entityLabel = "") {
    try {
      const sw = findTopHeaderStatusToggle();
      if (!sw) {
        log(
          `⚠️ Switch de status ${entityLabel ? `(${entityLabel}) ` : ""}não encontrado no topo direito.`,
          "debug"
        );
        return false;
      }

      const isOff = isSwitchElementOff(sw);
      if (!isOff) {
        log(
          `ℹ️ Switch de status ${entityLabel ? `(${entityLabel}) ` : ""}já está ligado (ON).`,
          "ok"
        );
        return true;
      }

      log(
        `🟢 Ativando switch de status ${entityLabel ? `(${entityLabel}) ` : ""}(canto superior direito: OFF -> ON)...`,
        "info"
      );

      const target =
        sw.querySelector('[role="switch"]') ||
        sw.querySelector('input[type="checkbox"]') ||
        sw;

      // Click attempt 1: Pointer + Mouse events
      simulateClick(target);
      target.click?.();
      if (target !== sw) {
        simulateClick(sw);
        sw.click?.();
      }

      // Keyboard space toggle as well
      target.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true }));
      target.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));

      await sleep(400);
      await confirmAnyActivationModal();

      // Check if it turned ON
      if (!isSwitchElementOff(sw)) {
        log(
          `✅ Switch de status ${entityLabel ? `(${entityLabel}) ` : ""}ativado para ON com sucesso!`,
          "ok"
        );
        return true;
      }

      // Attempt 2: Click the knob or parent
      const knob = sw.querySelector("div, span");
      if (knob) {
        simulateClick(knob);
        knob.click?.();
        await sleep(350);
        await confirmAnyActivationModal();
      }

      if (sw.parentElement && isSwitchElementOff(sw)) {
        simulateClick(sw.parentElement);
        sw.parentElement.click?.();
        await sleep(350);
        await confirmAnyActivationModal();
      }

      if (!isSwitchElementOff(sw)) {
        log(
          `✅ Switch de status ${entityLabel ? `(${entityLabel}) ` : ""}ativado para ON com sucesso!`,
          "ok"
        );
        return true;
      } else {
        log(
          `⚠️ Tentativa de ligar o switch ${entityLabel ? `(${entityLabel}) ` : ""}concluída. Verifique no topo direito.`,
          "warn"
        );
      }
    } catch (err) {
      log(`⚠️ Erro ao ativar switch de status ${entityLabel}: ${err.message}`, "warn");
    }
    return false;
  }

  // =========================================================================
  // WORKFLOW ORCHESTRATOR (SINGLE COUNTRY OR BATCH "- COPY")
  // =========================================================================

  async function applyCountryToCurrentAdSet(countryObj, { forceFullBaseSetup = false } = {}) {
    if (countryObj.note) {
      log(countryObj.note, "warn");
    }

    const doName = forceFullBaseSetup || state.options.updateName;
    const doBudget = forceFullBaseSetup || state.options.updateBudget;
    const doCountry = forceFullBaseSetup || state.options.updateCountry;
    const doAdvertiser = forceFullBaseSetup || state.options.updateAdvertiser;
    const doAdChild = forceFullBaseSetup || state.options.updateAdChild;

    // Make sure we are on the Ad Set (Conjunto) page before editing Ad Set fields
    await ensureOnAdSetPage(countryObj.adSetName);

    if (state.options.ensureActive !== false) {
      await ensureStatusToggleActive(countryObj.adSetName);
    }

    if (doName) {
      await updateAdSetName(countryObj.adSetName);
      await sleep(state.options.stepDelayMs);
    }

    if (doBudget) {
      await updateAdSetBudget(state.options.budgetValue || "1.00");
      await sleep(state.options.stepDelayMs);
    }

    // Always check if "This start date is in the past" error is present and click "Reset your start date to today"
    await fixPastStartDateIfPresent();

    if (doCountry) {
      await updateAdSetLocation(countryObj);
      await sleep(state.options.stepDelayMs);
    }

    if (doAdvertiser) {
      await updateAdSetAdvertiser(state.options.advertiserName || "Futuretech Dynamics LLC");
      await sleep(state.options.stepDelayMs);
    }

    // If user also wants to update the child Ad (URL + Translation) or if preparing the Base Ad Set
    if (doAdChild) {
      const openedAd = await ensureOnAdPage(countryObj.adSetName);
      if (openedAd && getCurrentEditorLevel() === "ad") {
        await sleep(800);
        if (state.options.ensureActive !== false) {
          await ensureStatusToggleActive("Anúncio");
        }
        if (state.options.updateAdName !== false) {
          await updateAdName(countryObj);
          await sleep(250);
        }
        if (forceFullBaseSetup || state.options.updateUrlLang) {
          await updateAdWebsiteUrl(countryObj.langCode);
          await sleep(state.options.stepDelayMs);
        }
        if (forceFullBaseSetup || state.options.translateTexts) {
          await translateAndFillAdTexts(countryObj.langCode, false);
          await sleep(state.options.stepDelayMs);
        }
        if (state.options.removeOldCreatives) {
          await removeCurrentAdCreatives();
          await sleep(state.options.stepDelayMs);
        }
        // Switch back to the Ad Set page via the top breadcrumb bar when done with the Ad
        await ensureOnAdSetPage(countryObj.adSetName);
        if (state.options.ensureActive !== false) {
          await ensureStatusToggleActive(countryObj.adSetName);
        }
      } else {
        log("⚠️ Pulando edição do Anúncio pois a página permaneceu no Conjunto.", "warn");
      }
    }

    state.doneCountries[state.selectedBlockId][countryObj.adSetName] = true;
    state.checkedCountries[state.selectedBlockId][countryObj.adSetName] = false;
    saveState();
    renderCountryList();
  }

  // Check if the currently open Ad Set is already an unpublished Draft ("In draft" / "- Copy" / green in sidebar)
  function isCurrentAdSetDraft() {
    const crumbs = getTopBreadcrumbItems();
    if (crumbs.some((c) => COPY_REGEX.test(c.text))) {
      return true;
    }

    // Check top bar for "In draft" / "Em rascunho" vs "Active" / "Ativo"
    const topTexts = Array.from(document.querySelectorAll("span, div"))
      .filter((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const r = el.getBoundingClientRect();
        return r.top >= 40 && r.top <= 115 && r.left > 320 && r.width < 180 && r.height < 42;
      })
      .map((el) => normalizeStr(el.innerText || ""));

    if (topTexts.some((t) => t === "in draft" || t === "em rascunho")) {
      return true;
    }
    if (topTexts.some((t) => t === "active" || t === "ativo")) {
      return false;
    }

    // Check if the Ad Set name input in the center pane ends with "- Copy"
    const topNameInput = Array.from(
      document.querySelectorAll('input[type="text"], input:not([type])')
    ).find((inp) => {
      if (!isVisible(inp) || inp.closest("#mab-root-panel")) return false;
      const r = inp.getBoundingClientRect();
      return r.left > 280 && r.top > 120 && r.top < 360;
    });
    if (topNameInput && COPY_REGEX.test(topNameInput.value || "")) {
      return true;
    }

    return false;
  }

  function isCurrentlyOnConferirAdSet() {
    if (isBulkEditActive()) return false; // NEVER return true if bulk editing multiple ad sets!
    // Must be on the Ad Set level (never return true if we are inside the child Ad page!)
    if (getCurrentEditorLevel() !== "adset") {
      return false;
    }
    const crumbs = getTopBreadcrumbItems();
    if (crumbs.length >= 2 && normalizeStr(crumbs[1].text) === "conferir") {
      return true;
    }
    const topNameInput = Array.from(
      document.querySelectorAll('input[type="text"], input:not([type])')
    ).find((inp) => {
      if (!isVisible(inp) || inp.closest("#mab-root-panel")) return false;
      const r = inp.getBoundingClientRect();
      return r.left > 210 && r.top > 100 && r.top < 360;
    });
    if (topNameInput && normalizeStr(topNameInput.value || "") === "conferir") {
      return true;
    }
    return false;
  }

  function findConferirInSidebar() {
    const items = getAdSetSidebarItems();
    return items.find((item) => normalizeStr(item.text) === "conferir") || null;
  }

  async function findConferirInSidebarWithScroll() {
    let found = findConferirInSidebar();
    if (found) return found;

    const scrollContainer = findSidebarScrollContainer();
    if (!scrollContainer || scrollContainer.scrollHeight <= scrollContainer.clientHeight + 10) {
      return null;
    }

    scrollContainer.scrollTop = 0;
    scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(220);
    found = findConferirInSidebar();
    if (found) return found;

    const step = Math.max(160, Math.floor(scrollContainer.clientHeight * 0.7));
    let pos = 0;
    while (pos < scrollContainer.scrollHeight) {
      pos += step;
      scrollContainer.scrollTop = pos;
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(220);
      found = findConferirInSidebar();
      if (found) return found;
      if (
        scrollContainer.scrollTop + scrollContainer.clientHeight >=
        scrollContainer.scrollHeight - 4
      ) {
        break;
      }
    }
    return null;
  }

  // Inspects the Ad inside "Conferir" WITHOUT translating it:
  // Verifies Website URL, disables Advantage+ AI text suggestions, and caches the original PT/EN texts/titles/descriptions!
  async function inspectAndCacheConferirAd() {
    const openedAd = await ensureOnAdPage("Conferir");
    if (!openedAd || getCurrentEditorLevel() !== "ad") {
      log("⚠️ Não foi possível abrir a página do Anúncio de 'Conferir' para verificação.", "warn");
      return false;
    }

    await sleep(750);
    if (state.options.ensureActive !== false) {
      await ensureStatusToggleActive("Anúncio");
    }

    // 1. Check Website URL
    const destHeader = findElementByText(
      ["Website URL", "URL do site", "Destination", "Destino"],
      ["div", "span", "label", "h3", "h4"]
    );
    if (destHeader) {
      destHeader.scrollIntoView({ behavior: "instant", block: "center" });
      await sleep(220);
    }

    let urlVal = "";
    for (let uAttempt = 0; uAttempt < 2; uAttempt++) {
      let urlInput = await scrollEditorUntil(findWebsiteUrlInput, {
        startFromCurrent: true,
        maxSteps: 10
      });
      if (!urlInput) {
        await sleep(350);
        urlInput = findWebsiteUrlInput();
      }
      urlVal = urlInput ? (urlInput.value || "").trim() : "";
      if (urlVal) break;
      await sleep(300);
    }

    state.conferirSource.url = urlVal;
    if (urlVal) {
      log(`✅ URL Base conferida: "${urlVal}"`, "ok");
    } else {
      log("⚠️ Atenção: Website URL não encontrada ou vazia no anúncio!", "warn");
    }

    // 2. Scroll to Primary Text / Headline / Description & disable Advantage+ AI suggestions
    let primaryTexts = [];
    let headlines = [];
    let descriptions = [];

    for (let attempt = 0; attempt < 3; attempt++) {
      let fields = await scrollEditorUntil(findAdTextFieldsInViewport, {
        startFromCurrent: true,
        maxSteps: 10
      });

      await disableAdvantagePlusTextSuggestions();

      if (fields && fields.headlineLabel) {
        fields.headlineLabel.scrollIntoView({ behavior: "instant", block: "center" });
        await sleep(250);
        await disableAdvantagePlusTextSuggestions();
        fields = findAdTextFieldsInViewport() || fields;
      }

      primaryTexts = (fields?.primaryTextEls || [])
        .map((el) => readEditableText(el))
        .filter(Boolean);
      headlines = (fields?.headlineEls || [])
        .map((el) => readEditableText(el))
        .filter(Boolean);
      descriptions = (fields?.descriptionEls || [])
        .map((el) => readEditableText(el))
        .filter(Boolean);

      if (primaryTexts.length > 0 || headlines.length > 0) break;
      await sleep(500);
    }

    state.conferirSource.primaryTexts = primaryTexts;
    state.conferirSource.headlines = headlines;
    state.conferirSource.descriptions = descriptions;
    state.conferirReady = primaryTexts.length > 0 || headlines.length > 0;
    saveState();

    log(
      `📋 Textos originais (PT/EN) salvos do conjunto "Conferir": ${primaryTexts.length} Texto(s), ${headlines.length} Título(s), ${descriptions.length} Descrição(ões).`,
      primaryTexts.length > 0 && headlines.length > 0 ? "ok" : "warn"
    );
    if (primaryTexts[0]) {
      log(`   • 1º Texto: "${primaryTexts[0].slice(0, 55)}${primaryTexts[0].length > 55 ? "..." : ""}"`, "info");
    }
    if (headlines[0]) {
      log(`   • 1º Título: "${headlines[0].slice(0, 55)}${headlines[0].length > 55 ? "..." : ""}"`, "info");
    }

    // Return to the "Conferir" Ad Set page so it is ready to be duplicated
    await ensureOnAdSetPage("Conferir");
    if (state.options.ensureActive !== false) {
      await ensureStatusToggleActive("Conferir");
    }
    return true;
  }

  // Prepare or Re-verify the "Conferir" Base Ad Set (kept in original PT/EN so translations are 100% faithful!):
  // 1) If not re-verifying and not already on a draft/"Conferir", duplicates 1 clean copy from the current PT/EN Ad Set
  // 2) Renames to "Conferir", sets Budget to $1.00, resets Start Date, verifies Advertiser
  // 3) Opens the Ad to verify URL & capture original PT/EN texts/titles/descriptions (WITHOUT translating yet!)
  // 4) Transforms the button into "▶️ INICIAR" and "🔄 VERIFICAR NOVAMENTE"
  async function prepareBaseAdSetForBlock(isReverify = false) {
    if (state.isRunning) return;

    state.isRunning = true;
    state.stopRequested = false;
    updateActionButtonsUI();

    try {
      const edOk = await ensureEditorOpen();
      if (!edOk) {
        state.isRunning = false;
        updateActionButtonsUI();
        return;
      }

      const modalAlreadyOpen = Boolean(getActiveDuplicateModal());
      const onConferirNow = isCurrentlyOnConferirAdSet();
      const alreadyInDraft = isCurrentAdSetDraft() || onConferirNow;

      if (isReverify && !onConferirNow) {
        const conferirRow = await findConferirInSidebarWithScroll();
        if (conferirRow) {
          conferirRow.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(220);
          simulateClick(conferirRow.textEl);
          await sleep(Math.max(1000, state.options.stepDelayMs));
        }
      } else if (!isReverify && (modalAlreadyOpen || !alreadyInDraft)) {
        log(
          '🛠️ Criando 1 cópia limpa do conjunto atual (PT/EN) para montar o conjunto "Conferir"...',
          "info"
        );
        const dupOk = await duplicateCurrentAdSet(1);
        if (!dupOk) {
          log("⚠️ Não foi possível concluir a duplicação automática do conjunto 'Conferir'.", "warn");
          return;
        }
        await sleep(600);

        if (!isCurrentAdSetDraft()) {
          const nextCopy = await findNextCopyInSidebarWithScroll();
          if (nextCopy) {
            nextCopy.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
            await sleep(220);
            simulateClick(nextCopy.textEl);
            await sleep(Math.max(1100, state.options.stepDelayMs));
          }
        }
      } else {
        log(
          isReverify
            ? '🔄 Verificando novamente o conjunto "Conferir" ($1.00 + URL + Textos originais)...'
            : '🛠️ Conjunto atual já está em rascunho! Configurando como "Conferir"...',
          "info"
        );
      }

      if (state.stopRequested) return;

      await ensureOnAdSetPage("Conferir");
      if (state.options.ensureActive !== false) {
        await ensureStatusToggleActive("Conferir");
      }
      await updateAdSetName("Conferir");
      await sleep(state.options.stepDelayMs);

      await updateAdSetBudget(state.options.budgetValue || "1.00");
      await sleep(state.options.stepDelayMs);

      await fixPastStartDateIfPresent();

      if (state.options.updateAdvertiser) {
        await updateAdSetAdvertiser(state.options.advertiserName || "Futuretech Dynamics LLC");
        await sleep(state.options.stepDelayMs);
      }

      if (state.stopRequested) return;

      await inspectAndCacheConferirAd();

      state.conferirReady = true;
      log(
        '✅ Conjunto "Conferir" pronto e verificado ($1.00 + textos originais em PT/EN)! Confira se está tudo ok e clique em "▶️ INICIAR" (ou "🔄 VERIFICAR NOVAMENTE" se fizer alguma alteração).',
        "ok"
      );
    } catch (err) {
      if (err?.name === "AutomationStoppedError") {
        log("🛑 Preparação parada imediatamente pelo usuário.", "warn");
      } else {
        log(`❌ Erro: ${err?.message || err}`, "err");
      }
    } finally {
      state.isRunning = false;
      state.stopRequested = false;
      updateActionButtonsUI();
    }
  }

  // =========================================================================
  // AUTO-DUPLICATE AD SET IN META ADS MANAGER (2-STEP MODAL HANDLER)
  // =========================================================================
  async function duplicateCurrentAdSet(numCopies = 1, targetAdSetName = "") {
    const copiesCount = Math.max(1, parseInt(numCopies, 10) || 1);
    const targetLabel = targetAdSetName ? ` "${targetAdSetName}"` : "";
    log(`📋 Iniciando duplicação automática do conjunto${targetLabel} (${copiesCount} cópia(s))...`, "info");

    // Check if the user already has the Duplicate modal open on screen
    let activeDialog = getActiveDuplicateModal();

    if (!activeDialog) {
      // 0. ABSOLUTE GUARD: Ensure we are explicitly on the AD SET level before opening any menu!
      if (getCurrentEditorLevel() !== "adset") {
        await ensureOnAdSetPage(targetAdSetName);
        await sleep(500);
        if (getCurrentEditorLevel() === "ad") {
          log(
            "❌ A tela ainda está no Anúncio e não no Conjunto! Tentando selecionar o Conjunto na barra lateral...",
            "warn"
          );
          const adSetRows = getAdSetSidebarItems();
          if (adSetRows.length > 0) {
            simulateClick(adSetRows[0].textEl);
            await sleep(600);
          }
        }
        if (getCurrentEditorLevel() === "ad") {
          log(
            "🛑 BLOQUEIO DE SEGURANÇA: A tela atual é de um ANÚNCIO! Duplicação cancelada para proteger seus anúncios. Por favor, clique no CONJUNTO desejado na barra lateral antes de duplicar.",
            "err"
          );
          return false;
        }
      }

      // 1. Try to open the duplicate modal / action menu on the target Ad Set in the sidebar
      const menuOpened = await openAdSetActionMenu(targetAdSetName);
      activeDialog = getActiveDuplicateModal();

      // 2. Click "Duplicate" / "Duplicar" in the opened menu (never Quick Duplicate)
      if (!activeDialog && isActionMenuOpen()) {
        await sleep(250);
        const dupItem = findDuplicateMenuItem();
        if (dupItem && dupItem.container) {
          const menuItemContainer = dupItem.container;
          const menuItemLeaf = dupItem.leaf;

          // Hover over the menu item first so React Aria / Comet registers active menu item
          for (const node of [menuItemContainer, menuItemLeaf]) {
            if (!node) continue;
            node.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
            node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
            node.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
            node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          }
          await sleep(100);

          simulateClick(menuItemLeaf);
          if (menuItemContainer !== menuItemLeaf) {
            simulateClick(menuItemContainer);
          }
          menuItemContainer.click?.();

          // Also dispatch Enter key on the menu item in case Comet menu listens to keyboard activation
          menuItemContainer.focus?.();
          menuItemContainer.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true })
          );
          menuItemContainer.dispatchEvent(
            new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true })
          );

          log(`Clicou em "${(menuItemContainer.innerText || "Duplicate").split("\n")[0].trim()}"...`, "info");

          // Poll up to 3.6 seconds for the Duplicate modal to open
          for (let attempt = 0; attempt < 12; attempt++) {
            await sleep(300);
            activeDialog = getActiveDuplicateModal();
            if (activeDialog) break;
          }
        }
      }

      // 3. Fallback: If modal still didn't open, prompt user to press Ctrl+D and wait
      if (!activeDialog) {
        log(`💡 DICA: Pressione Ctrl+D no teclado com o conjunto selecionado para abrir a duplicação...`, "info");
        for (let w = 0; w < 16; w++) {
          await sleep(500);
          activeDialog = getActiveDuplicateModal();
          if (activeDialog) break;
        }
      }

      if (!activeDialog) {
        log("⚠️ Janela de duplicação não detectada automaticamente.", "warn");
        return false;
      }
    }

    // SAFETY CHECK: Never allow duplicating an AD ("Duplicate your ad" without "set")!
    if (activeDialog) {
      const dlgTxt = normalizeStr(activeDialog.innerText || "");
      const isAdModalOnly =
        (dlgTxt.includes("duplicate your ad") && !dlgTxt.includes("duplicate your ad set")) ||
        (dlgTxt.includes("duplique seu anuncio") && !dlgTxt.includes("conjunto")) ||
        (dlgTxt.includes("duplicar seu anuncio") && !dlgTxt.includes("conjunto"));
      if (isAdModalOnly) {
        log("🛑 Detectado modal de duplicar ANÚNCIO em vez de CONJUNTO! Cancelando modal...", "err");
        const cancelBtn = findModalFooterButton(activeDialog, ["Cancel", "Cancelar", "Close", "Fechar"]);
        if (cancelBtn) {
          simulateClick(cancelBtn);
          cancelBtn.click?.();
        }
        return false;
      }
    }

    // 3. STEP 1 MODAL: "Duplicate your ad set" / "Apply recommendation" (Recomendações da Meta)
    if (activeDialog && isRecommendationsStepModal(activeDialog)) {
      log("🧹 Modal de Recomendações detectado: desmarcando recomendações...", "info");
      await uncheckAllCheckboxesInModal(activeDialog);
      await sleep(280);

      // Click "Continuar" / "Continue" button
      const continueBtn = findModalFooterButton(activeDialog, [
        "Continuar",
        "Continue",
        "Avançar",
        "Next"
      ]);
      if (continueBtn) {
        const clickTarget = continueBtn.closest('[role="button"], button') || continueBtn;
        simulateClick(clickTarget);
        if (clickTarget !== continueBtn) simulateClick(continueBtn);
        clickTarget.click?.();
        log("➡️ Clicou em 'Continue / Continuar' após desmarcar recomendações.", "ok");

        // Wait for the modal to either transition to Step 2 ("Number of copies" / "Duplicate") or close if it duplicated directly
        for (let w = 0; w < 8; w++) {
          await sleep(320);
          const nextDlg = getActiveDuplicateModal();
          if (!nextDlg || !isRecommendationsStepModal(nextDlg)) {
            activeDialog = nextDlg;
            break;
          }
        }
      } else {
        log("⚠️ Botão 'Continue / Continuar' não encontrado no modal de recomendações.", "warn");
      }
    }

    // 4. STEP 2 MODAL: "Duplicate your ad set" (Number of copies + Uncheck Show Existing Reactions)
    if (!activeDialog) {
      await sleep(450);
      activeDialog = getActiveDuplicateModal();
    }

    if (activeDialog) {
      // If the modal is STILL on the Recommendations step (e.g. if it just opened late), click Continue first!
      const lateContinueBtn =
        isRecommendationsStepModal(activeDialog) &&
        findModalFooterButton(activeDialog, ["Continuar", "Continue"]);
      if (lateContinueBtn) {
        await uncheckAllCheckboxesInModal(activeDialog);
        await sleep(220);
        const ct = lateContinueBtn.closest('[role="button"], button') || lateContinueBtn;
        simulateClick(ct);
        ct.click?.();
        log("➡️ Clicou em 'Continue / Continuar' no modal de recomendações.", "ok");
        await sleep(900);
        activeDialog = getActiveDuplicateModal();
      }
    }

    if (activeDialog) {
      // 4a. Uncheck "Mostrar reações, comentários e compartilhamentos existentes em novos anúncios" (and A/B test if checked)
      log("🧹 Desmarcando caixinhas extras do modal de duplicação...", "info");
      await uncheckAllCheckboxesInModal(activeDialog);
      await sleep(250);

      // 4b. Fill "Quantidade de cópias" / "Number of copies"
      const scopeForInputs = activeDialog.parentElement || activeDialog;
      const inputs = Array.from(
        scopeForInputs.querySelectorAll('input[type="number"], input[type="text"], input:not([type])')
      ).filter((el) => {
        if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
        const type = (el.type || "").toLowerCase();
        return type !== "checkbox" && type !== "radio";
      });

      const copiesInput =
        inputs.find((inp) => /^\d+$/.test((inp.value || "").trim())) || inputs[inputs.length - 1];

      if (copiesInput) {
        log(`🔢 Definindo Quantidade de cópias para ${copiesCount}...`, "info");
        await setReactInputValue(copiesInput, String(copiesCount), false);
        await sleep(350);
      }

      // Double-check reactions checkbox right before clicking Duplicar (in case typing re-rendered the modal)
      await uncheckAllCheckboxesInModal(activeDialog);
      await sleep(200);

      // 4c. Click "Duplicar" / "Duplicate" (or "Continue" if Meta uses Continue as final button) in modal footer
      const confirmDupBtn = findModalFooterButton(activeDialog, [
        "Duplicar",
        "Duplicate",
        "Continuar",
        "Continue"
      ]);
      if (confirmDupBtn) {
        const clickTarget = confirmDupBtn.closest('[role="button"], button') || confirmDupBtn;
        simulateClick(clickTarget);
        if (clickTarget !== confirmDupBtn) simulateClick(confirmDupBtn);
        clickTarget.click?.();
        log(`⏳ Gerando ${copiesCount} cópia(s) limpas no Facebook Ads... aguarde.`, "info");

        for (let w = 0; w < 12; w++) {
          await sleep(1000);
          if (findCopyAdSetsInSidebar().length > 0 || isCurrentAdSetDraft()) break;
        }
        await sleep(800);
        await dismissAnyBulkEditOrUnsavedModal();
        log(`✅ ${copiesCount} cópia(s) criada(s) com sucesso (sem recomendações e sem reações)!`, "ok");
        renderCountryList();
        return true;
      }
    } else if (copiesCount === 1 && (findCopyAdSetsInSidebar().length > 0 || isCurrentAdSetDraft())) {
      // In case clicking Continue immediately created the single duplicate without a Step 2 modal
      await dismissAnyBulkEditOrUnsavedModal();
      log(`✅ Cópia criada com sucesso!`, "ok");
      renderCountryList();
      return true;
    }

    log("⚠️ Janela de duplicação não detectada automaticamente.", "warn");
    return false;
  }

  function getActiveDuplicateModal() {
    const promoteToModalCard = (el) => {
      if (!el) return null;
      let best = el;
      let curr = el.parentElement;
      for (let i = 0; i < 6 && curr && curr !== document.body; i++) {
        const r = curr.getBoundingClientRect();
        if (r.width >= 300 && r.width <= 860 && r.height >= 160 && r.height <= 760 && r.left > 80) {
          best = curr;
        }
        curr = curr.parentElement;
      }
      return best;
    };

    const isDupModalContent = (el) => {
      if (!el) return false;
      const txt = normalizeStr(el.innerText || "");
      if (!txt) return false;

      // STRICT EXCLUSION: If it contains ad editor section headers or cards, it is NEVER a duplicate modal!
      if (
        txt.includes("url do site") ||
        txt.includes("website url") ||
        txt.includes("texto principal") ||
        txt.includes("primary text") ||
        txt.includes("opportunity score") ||
        txt.includes("review defaults") ||
        txt.includes("personalised destinations") ||
        txt.includes("creative setup") ||
        txt.includes("ad creative") ||
        txt.includes("criativo do anuncio")
      ) {
        return false;
      }

      // MUST contain duplication or recommendation-step keywords
      const hasDupTitle =
        txt.includes("duplicar conjunto") ||
        txt.includes("duplicate ad set") ||
        txt.includes("duplique seu conjunto") ||
        txt.includes("duplicate your ad set") ||
        txt.includes("campanha original") ||
        txt.includes("original campaign") ||
        txt.includes("quantidade de copias") ||
        txt.includes("number of copies") ||
        txt.includes("mostrar reacoes") ||
        txt.includes("show existing reactions") ||
        txt.includes("aplicar recomendac") ||
        txt.includes("apply recommendation") ||
        (txt.includes("duplic") && (txt.includes("conjunto") || txt.includes("ad set") || txt.includes("copia")));

      if (!hasDupTitle) return false;

      // Must have at least a Cancel or Confirm/Continue button
      const hasButtons = Array.from(el.querySelectorAll('button, [role="button"], span, div')).some((btn) => {
        const bt = normalizeStr(btn.innerText || "");
        return (
          bt === "cancel" ||
          bt === "cancelar" ||
          bt === "duplicate" ||
          bt === "duplicar" ||
          bt === "continue" ||
          bt === "continuar"
        );
      });

      return hasButtons;
    };

    // Candidates: elements with role="dialog" or aria-modal="true" or modal containers
    const dialogs = Array.from(
      document.querySelectorAll('[role="dialog"], [aria-modal="true"], div[data-testid*="modal"]')
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      return r.width >= 260 && r.height >= 120;
    });

    for (let i = dialogs.length - 1; i >= 0; i--) {
      const card = promoteToModalCard(dialogs[i]) || dialogs[i];
      if (isDupModalContent(card)) {
        return card;
      }
    }

    const foundByText = findModalContainerByText([
      "Duplique seu conjunto",
      "Duplicar seu conjunto",
      "Duplicate your ad set",
      "Duplicate ad set",
      "Quantidade de cópias",
      "Number of copies",
      "Campanha original",
      "Original campaign"
    ]);

    if (foundByText) {
      const card = promoteToModalCard(foundByText) || foundByText;
      if (isDupModalContent(card)) {
        return card;
      }
    }

    return null;
  }

  function isRecommendationsStepModal(modalEl) {
    if (!modalEl) return false;
    const txt = normalizeStr(modalEl.innerText || "");
    const hasCopiesField =
      txt.includes("quantidade de copias") ||
      txt.includes("number of copies") ||
      txt.includes("campanha original") ||
      txt.includes("original campaign");
    if (hasCopiesField) return false;

    const isRecommendations =
      txt.includes("aplicar recomendac") ||
      txt.includes("apply recommendation") ||
      txt.includes("selecione as recomendacoes") ||
      txt.includes("select recommendations") ||
      txt.includes("recomendações da meta") ||
      txt.includes("meta recommendations");

    const hasContinueBtn = Boolean(
      findModalFooterButton(modalEl, ["Continuar", "Continue", "Avançar", "Next"])
    );
    const hasDuplicateBtn = Boolean(
      findModalFooterButton(modalEl, ["Duplicar", "Duplicate"])
    );

    return isRecommendations && hasContinueBtn && !hasDuplicateBtn;
  }

  async function uncheckAllCheckboxesInModal(modalEl) {
    if (!modalEl) return;

    const isBoxChecked = (el) => {
      if (!el) return false;
      if (el.tagName === "INPUT" && el.type === "checkbox") {
        if (el.checked) return true;
      }
      const aria = el.getAttribute("aria-checked");
      return aria === "true" || aria === "mixed";
    };

    const clickCheckboxElement = async (el) => {
      // Prefer clicking the visible wrapper or label if the input itself has opacity 0
      const target =
        isVisible(el)
          ? el
          : el.closest("label, [role='checkbox']") || el.parentElement;
      if (target) {
        simulateClick(target);
        await sleep(220);
      }
    };

    // Pass 1: Look for all standard and ARIA checkboxes inside the modal (excluding radio buttons!)
    for (let pass = 0; pass < 2; pass++) {
      const checkboxes = Array.from(
        modalEl.querySelectorAll('input[type="checkbox"], [role="checkbox"]')
      );
      let clickedAny = false;

      for (const box of checkboxes) {
        if (isBoxChecked(box)) {
          await clickCheckboxElement(box);
          clickedAny = true;
        }
      }
      if (!clickedAny) break;
      await sleep(180);
    }

    // Pass 2: Specifically verify "Mostrar reações..." / "Aplicar recomendações" by label text if custom-styled
    const targetPhrases = [
      "aplicar recomendacoes",
      "apply recommendations",
      "mostrar reacoes, comentarios",
      "show existing reactions"
    ];
    const allSpansAndLabels = Array.from(modalEl.querySelectorAll("label, span, div")).filter(
      (el) => isVisible(el) && el.children.length <= 2
    );

    for (const el of allSpansAndLabels) {
      const txt = normalizeStr(el.innerText || "");
      if (!txt || txt.length > 110) continue;
      if (targetPhrases.some((p) => txt.startsWith(p))) {
        const containerRow = el.closest("label") || el.parentElement?.parentElement;
        if (!containerRow) continue;
        const innerCheck = containerRow.querySelector(
          'input[type="checkbox"], [role="checkbox"]'
        );
        if (innerCheck && isBoxChecked(innerCheck)) {
          await clickCheckboxElement(innerCheck);
        }
      }
    }
  }

  function findModalFooterButton(modalEl, buttonTexts) {
    const norms = buttonTexts.map((t) => normalizeStr(t));
    const matchesButtonText = (el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 36 || r.width > 240 || r.height < 14 || r.height > 60) return false;
      const raw = (el.innerText || el.textContent || "").trim();
      if (!raw || raw.length > 35 || raw.includes("\n")) return false;
      const t = normalizeStr(raw);
      return norms.includes(t);
    };

    let candidates = modalEl
      ? Array.from(modalEl.querySelectorAll('[role="button"], button, div, span')).filter(
          matchesButtonText
        )
      : [];

    // Fallback: if the modal footer is in a sibling container outside modalEl, scan the center modal region of the screen
    if (candidates.length === 0) {
      candidates = Array.from(
        document.querySelectorAll('[role="button"], button, div, span')
      ).filter((el) => {
        if (!matchesButtonText(el)) return false;
        const r = el.getBoundingClientRect();
        return (
          r.left > 220 &&
          r.right < window.innerWidth - 150 &&
          r.top > 150 &&
          r.bottom < window.innerHeight - 50
        );
      });
    }

    if (candidates.length === 0) return null;
    // Sort by bottom-most and right-most (footer primary action button)
    candidates.sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      if (Math.abs(rB.top - rA.top) > 10) return rB.top - rA.top;
      return rB.left - rA.left;
    });
    return candidates[0].closest('[role="button"], button') || candidates[0];
  }

  function findModalContainerByText(keywords) {
    const norms = keywords.map((k) => normalizeStr(k));
    const divs = Array.from(document.querySelectorAll("div")).filter((el) => isVisible(el));
    for (const d of divs) {
      const r = d.getBoundingClientRect();
      if (r.width < 280 || r.width > 800 || r.height < 150 || r.height > 700) continue;
      const txt = normalizeStr(d.innerText || "");
      if (norms.some((k) => txt.includes(k))) {
        return d;
      }
    }
    return null;
  }

  function isDuplicateMenuItemText(raw) {
    const firstLine = normalizeStr((raw || "").split("\n")[0]);
    const full = normalizeStr(raw || "");
    if (full.includes("quick") || full.includes("rapida")) return false;

    // STRICT REJECTION: NEVER duplicate an Ad!
    if (
      (full.includes(" ad") && !full.includes("ad set")) ||
      (full.includes("anuncio") && !full.includes("conjunto"))
    ) {
      return false;
    }

    return (
      firstLine === "duplicate" ||
      firstLine === "duplicate..." ||
      firstLine === "duplicar" ||
      firstLine === "duplicar..." ||
      full.includes("duplicate ad set") ||
      full.includes("duplicar conjunto") ||
      (full.startsWith("duplicate") && full.length < 30) ||
      (full.startsWith("duplicar") && full.length < 30)
    );
  }

  function triggerDuplicateKeyboardShortcut() {
    const isMac = (navigator.platform || "").toUpperCase().includes("MAC");
    const target = document.activeElement || document.body;
    const keyEventInit = {
      key: "d",
      code: "KeyD",
      keyCode: 68,
      which: 68,
      charCode: 100,
      ctrlKey: !isMac,
      metaKey: isMac,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    target.dispatchEvent(new KeyboardEvent("keydown", keyEventInit));
    document.dispatchEvent(new KeyboardEvent("keydown", keyEventInit));
    window.dispatchEvent(new KeyboardEvent("keydown", keyEventInit));
  }

  function getActiveFloatingMenus() {
    return Array.from(
      document.querySelectorAll('[role="menu"], [data-testid*="menu"], div[role="dialog"][data-ownerid]')
    ).filter((el) => {
      if (!isVisible(el) || el.closest("#mab-root-panel")) return false;
      const r = el.getBoundingClientRect();
      // Menus in Meta are floating panels (never the full sidebar tree or page body)
      if (r.width < 60 || r.height < 30) return false;
      if (r.left < 220 && r.height > 350 && r.top < 120) return false; // Left sidebar tree exclusion
      return true;
    });
  }

  function isActionMenuOpen() {
    const menus = getActiveFloatingMenus();
    for (const menu of menus) {
      const hasDupItem = Array.from(
        menu.querySelectorAll('[role="menuitem"], [role="option"], li, div, span')
      ).some((el) => isVisible(el) && isDuplicateMenuItemText(el.innerText || el.textContent || ""));
      if (hasDupItem) return true;
    }
    return false;
  }

  function findDuplicateMenuItem() {
    const menus = getActiveFloatingMenus();
    for (const menu of menus) {
      const candidates = Array.from(
        menu.querySelectorAll('[role="menuitem"], [role="option"], li, div, span')
      ).filter((el) => {
        if (!isVisible(el)) return false;
        const txt = (el.innerText || el.textContent || "").trim();
        if (!txt || txt.length > 40) return false;
        return isDuplicateMenuItemText(txt);
      });

      if (candidates.length > 0) {
        // Sort by area ascending so we get the leaf element
        candidates.sort((a, b) => {
          const rA = a.getBoundingClientRect();
          const rB = b.getBoundingClientRect();
          return rA.width * rA.height - rB.width * rB.height;
        });

        const leaf = candidates[0];
        // Container must be a menuitem / option / li or the leaf itself.
        // NEVER search for [tabindex] as that can escape into the sidebar tree!
        const container =
          leaf.closest('[role="menuitem"], [role="option"], li') || leaf;

        return { container, leaf };
      }
    }
    return null;
  }

  async function openAdSetActionMenu(targetAdSetName = "") {
    const crumbs = getTopBreadcrumbItems();
    const activeAdSetCrumbNorm = crumbs.length >= 2 ? crumbs[1].normText : "";
    const targetNorm = normalizeStr(targetAdSetName);

    // 1. Find the target Ad Set row in the left sidebar
    const adSetRows = getAdSetSidebarItems();
    let targetRow = null;

    if (targetNorm) {
      targetRow =
        adSetRows.find((r) => r.normText === targetNorm) ||
        adSetRows.find((r) => doesSidebarTextMatchCountry(r.text, { adSetName: targetAdSetName }));
      if (!targetRow) {
        // Try scrolling to find it
        await navigateToSidebarAdSetByName(targetAdSetName);
        await sleep(300);
        const freshRows = getAdSetSidebarItems();
        targetRow =
          freshRows.find((r) => r.normText === targetNorm) ||
          freshRows.find((r) => doesSidebarTextMatchCountry(r.text, { adSetName: targetAdSetName }));
      }
    }

    if (!targetRow) {
      targetRow =
        (activeAdSetCrumbNorm && adSetRows.find((r) => r.normText === activeAdSetCrumbNorm)) ||
        adSetRows.find((r) => r.normText === "conferir") ||
        adSetRows[0];
    }

    if (!targetRow || !targetRow.textEl) return false;

    // STEP 1: Always click the Ad Set text element to FORCE selection on the Ad Set!
    targetRow.textEl.scrollIntoView({ behavior: "instant", block: "center" });
    await sleep(80);
    simulateClick(targetRow.textEl);
    if (targetRow.rowEl && targetRow.rowEl !== targetRow.textEl) {
      simulateClick(targetRow.rowEl);
    }
    await sleep(300);

    if (getActiveDuplicateModal() || isActionMenuOpen()) return true;

    // STEP 2: Dispatch Ctrl+D keyboard shortcut
    triggerDuplicateKeyboardShortcut();
    await sleep(350);
    if (getActiveDuplicateModal()) return true;

    // STEP 3: Right-Click (contextmenu) on the Ad Set row
    const tRect = targetRow.textEl.getBoundingClientRect();
    const centerY = tRect.top + tRect.height / 2;
    const clientX = tRect.left + 25;

    for (const el of [targetRow.textEl, targetRow.rowEl]) {
      if (!el) continue;
      el.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          buttons: 2,
          clientX,
          clientY
        })
      );
      await sleep(250);
      if (isActionMenuOpen() || getActiveDuplicateModal()) return true;
    }

    // STEP 4: Hover over the Ad Set row to reveal its '...' action button
    const hoverRow =
      targetRow.rowEl ||
      targetRow.textEl.closest('[role="treeitem"], [role="row"]') ||
      targetRow.textEl.parentElement;

    const hoverEvents = ["pointerenter", "pointerover", "mouseenter", "mouseover", "mousemove"];
    for (const ev of hoverEvents) {
      hoverRow.dispatchEvent(
        new PointerEvent(ev, { bubbles: true, clientX: tRect.right + 20, clientY: centerY })
      );
      targetRow.textEl.dispatchEvent(
        new PointerEvent(ev, { bubbles: true, clientX: tRect.right + 20, clientY: centerY })
      );
    }
    await sleep(300);

    // Look for the '...' button strictly aligned with THIS Ad Set row's vertical center
    const candidateBtns = Array.from(
      document.querySelectorAll('[aria-haspopup="menu"], [role="button"], button')
    ).filter((btn) => {
      if (!isVisible(btn) || btn.closest("#mab-root-panel")) return false;
      const b = btn.getBoundingClientRect();
      if (b.left < 60 || b.right > 280) return false;
      if (b.left < tRect.left) return false;
      const btnCenterY = b.top + b.height / 2;
      if (Math.abs(btnCenterY - centerY) > 10) return false;
      if (b.width > 42 || b.height > 42 || b.width < 10 || b.height < 10) return false;
      return true;
    });

    if (candidateBtns.length > 0) {
      candidateBtns.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
      const menuBtn = candidateBtns[0];
      simulateClick(menuBtn);
      menuBtn.click?.();
      await sleep(350);
      if (isActionMenuOpen() || getActiveDuplicateModal()) return true;
    }

    return isActionMenuOpen() || Boolean(getActiveDuplicateModal());
  }

  // =========================================================================
  // DRAFT (GREEN) AD SETS VERIFIER & FIXER
  // =========================================================================

  // Detect if a sidebar item has the light-green "In Draft" background tint (as opposed to white published rows)
  function hasGreenDraftBackground(el) {
    let curr = el;
    for (let i = 0; i < 7 && curr && curr !== document.body; i++) {
      const r = curr.getBoundingClientRect();
      if (r.width > 340) break;
      const bg = window.getComputedStyle(curr).backgroundColor || "";
      const m = bg.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
      if (m) {
        const red = parseInt(m[1], 10);
        const green = parseInt(m[2], 10);
        const blue = parseInt(m[3], 10);
        const alpha = m[4] !== undefined ? parseFloat(m[4]) : 1;
        // Draft rows in Meta Ads Manager have a pale green tint (e.g. rgb(233, 244, 238) -> green > red + 3 and green >= 200)
        if (alpha > 0.05 && green >= 200 && green - red >= 4 && green >= blue) {
          return true;
        }
      }
      curr = curr.parentElement;
    }
    return false;
  }

  function getVisibleGreenDraftAdSetsInSidebar() {
    const adSetItems = getAdSetSidebarItems();
    const allItems = getSidebarItems();
    const draftAdSets = [];

    for (const it of adSetItems) {
      // Find if the item immediately below this Ad Set in the full sidebar list is its child Ad
      const idxInAll = allItems.findIndex((x) => x.textEl === it.textEl);
      const nextItem = idxInAll >= 0 ? allItems[idxInAll + 1] : null;
      const hasChildAdNext =
        nextItem &&
        (nextItem.normText.startsWith("novo anuncio") ||
          nextItem.normText.startsWith("new ") ||
          nextItem.left > it.left + 8);

      // Check if this ad set matches a country in the currently selected block
      const currentBlock = BLOCKS[state.selectedBlockId];
      const isCountryInBlock =
        currentBlock &&
        currentBlock.countries.some((c) => doesSidebarTextMatchCountry(it.text, c));

      // A row is a green draft Ad Set if:
      // 1) It matches a country belonging to the current block, OR
      // 2) Its name ends with "- Copy" / "– Copy" or is "Conferir", OR
      // 3) The Ad Set row itself has the green draft background, OR
      // 4) It is currently selected (blue highlight) and its child Ad row right below it has the green draft background
      const isGreenDraft =
        isCountryInBlock ||
        COPY_REGEX.test(it.text) ||
        it.normText === "conferir" ||
        hasGreenDraftBackground(it.textEl) ||
        (hasChildAdNext && hasGreenDraftBackground(nextItem.textEl));

      if (isGreenDraft) {
        draftAdSets.push(it);
      }
    }

    return draftAdSets;
  }

  function findCountryObjectByName(rawName, preferredBlockId) {
    if (!rawName || COPY_REGEX.test(rawName)) return null;
    const preferredBlock = BLOCKS[preferredBlockId];
    if (preferredBlock) {
      const matchInBlock = preferredBlock.countries.find((c) =>
        doesSidebarTextMatchCountry(rawName, c)
      );
      if (matchInBlock) return matchInBlock;
    }
    for (const blk of Object.values(BLOCKS)) {
      const match = blk.countries.find((c) => doesSidebarTextMatchCountry(rawName, c));
      if (match) return match;
    }
    return null;
  }

  // Full campaign audit: Scans all Ad Sets in the campaign (sidebar tree with full scroll)
  // Identifies:
  // - which countries from the active block are ALREADY PRESENT (unique)
  // - which countries are MISSING
  // - which drafts are SURPLUS / REPEATED (e.g. 2nd or 3rd Filipinas, extra Sérvia, unmodified copies)
  async function auditBlockCampaignAdSets(blockId) {
    const block = BLOCKS[blockId];
    if (!block) return null;

    log("🔍 Realizando varredura completa da campanha na barra lateral...", "info");
    const allItems = await scanAllSidebarAdSetsWithScroll();

    const existingUniqueMap = new Map(); // country.adSetName -> item
    const surplusDraftList = [];         // array of { item, originalName, reason }
    const countryCounts = new Map();     // country.adSetName -> count

    for (const it of allItems) {
      const matchedCountry = block.countries.find((c) =>
        doesSidebarTextMatchCountry(it.text, c)
      );

      if (matchedCountry) {
        const cName = matchedCountry.adSetName;
        const currentCount = countryCounts.get(cName) || 0;
        countryCounts.set(cName, currentCount + 1);

        if (currentCount === 0) {
          existingUniqueMap.set(cName, it);
        } else {
          // DUPLICATE ROW! (e.g. 2nd Filipinas, 3rd Filipinas, 2nd Sérvia)
          surplusDraftList.push({
            item: it,
            originalName: it.text,
            country: matchedCountry,
            reason: `duplicado de "${cName}" (#${currentCount + 1})`
          });
        }
      } else if (
        COPY_REGEX.test(it.text) ||
        it.normText === "conferir" ||
        hasGreenDraftBackground(it.textEl)
      ) {
        surplusDraftList.push({
          item: it,
          originalName: it.text,
          country: null,
          reason: `rascunho não configurado ("${it.text}")`
        });
      }
    }

    // Update real-time memory and UI checkboxes immediately
    for (const c of block.countries) {
      if (existingUniqueMap.has(c.adSetName)) {
        state.doneCountries[blockId][c.adSetName] = true;
        state.checkedCountries[blockId][c.adSetName] = false;
      } else {
        state.doneCountries[blockId][c.adSetName] = false;
        state.checkedCountries[blockId][c.adSetName] = true;
      }
    }
    saveState();
    renderCountryList();

    const missingCountries = block.countries.filter(
      (c) => !existingUniqueMap.has(c.adSetName)
    );

    log(`📊 Diagnóstico do Bloco ${block.id}:`, "ok");
    log(`   • ${existingUniqueMap.size} de ${block.countries.length} países prontos no bloco.`, "info");
    if (surplusDraftList.length > 0) {
      log(
        `   • ${surplusDraftList.length} rascunho(s) sobressalente(s)/duplicado(s) para substituição: ${surplusDraftList.map((s) => s.originalName).join(", ")}.`,
        "warn"
      );
    }
    if (missingCountries.length > 0) {
      log(
        `   • Faltam ${missingCountries.length} país(es): ${missingCountries.map((c) => c.adSetName).join(", ")}.`,
        "info"
      );
    } else {
      log(`   • Todos os ${block.countries.length} países do bloco já estão presentes!`, "ok");
    }

    return {
      allItems,
      existingUniqueMap,
      surplusDraftList,
      missingCountries,
      totalBlockCount: block.countries.length,
      existingCount: existingUniqueMap.size,
      missingCount: missingCountries.length,
      surplusCount: surplusDraftList.length
    };
  }

  async function verifyAndFixDraftAdSets() {
    if (state.isRunning) return;

    const block = BLOCKS[state.selectedBlockId];
    if (!block) return;

    state.isRunning = true;
    state.stopRequested = false;
    updateActionButtonsUI();

    try {
      const edOk = await ensureEditorOpen();
      if (!edOk) {
        state.isRunning = false;
        updateActionButtonsUI();
        return;
      }

      if (state.options.ensureActive !== false) {
        await ensureCampaignActive();
      }

      // -------------------------------------------------------------
      // FASE 1: VARREDURA INICIAL & DIAGNÓSTICO (Auditoria Completa)
      // -------------------------------------------------------------
      log("🔍 [1/3] Realizando varredura completa da campanha na barra lateral...", "info");
      const audit = await auditBlockCampaignAdSets(state.selectedBlockId);
      if (!audit) throw new Error("Não foi possível auditar a campanha.");

      const { existingUniqueMap, surplusDraftList, missingCountries } = audit;

      if (state.stopRequested) return;

      // -------------------------------------------------------------
      // FASE 2: SUBSTITUIÇÃO INTELIGENTE (Elimina duplicatas e preenche faltantes)
      // -------------------------------------------------------------
      if (missingCountries.length > 0) {
        log(
          `🛠️ [2/3] Substituindo rascunhos sobressalentes pelos ${missingCountries.length} país(es) faltantes...`,
          "info"
        );

        for (let i = 0; i < missingCountries.length; i++) {
          if (state.stopRequested) break;
          const missingCountry = missingCountries[i];

          let targetDraftItem = null;
          if (surplusDraftList.length > 0) {
            const surplus = surplusDraftList.shift();
            targetDraftItem = surplus.item;
            log(
              `✏️ Rascunho sobressalente (${surplus.reason}) -> transformando em "${missingCountry.adSetName}" (${missingCountry.langName})...`,
              "info"
            );
          } else {
            log(
              `📋 Sem rascunhos sobressalentes. Duplicando 1 cópia de "Conferir" para "${missingCountry.adSetName}"...`,
              "info"
            );
            const conferirItem = await findConferirInSidebarWithScroll();
            if (conferirItem) {
              await scrollToAndClickSidebarItem(conferirItem);
            }
            const dupOk = await duplicateCurrentAdSet(1, "Conferir");
            if (dupOk) {
              await sleep(1000);
              const newCopies = findCopyAdSetsInSidebar();
              targetDraftItem = newCopies[0];
            }
          }

          if (targetDraftItem) {
            await scrollToAndClickSidebarItem(targetDraftItem);
            await ensureOnAdSetPage();
            await applyCountryToCurrentAdSet(missingCountry);

            existingUniqueMap.set(missingCountry.adSetName, targetDraftItem);
            state.doneCountries[block.id][missingCountry.adSetName] = true;
            state.checkedCountries[block.id][missingCountry.adSetName] = false;
            saveState();
            renderCountryList();
            log(
              `✅ [${i + 1}/${missingCountries.length}] "${missingCountry.adSetName}" criado e configurado!`,
              "ok"
            );
          }
        }
      } else {
        log(
          `✅ [2/3] Nenhum país faltando! Todos os ${block.countries.length} países do bloco já estão presentes.`,
          "ok"
        );
      }

      if (state.stopRequested) return;

      // -------------------------------------------------------------
      // FASE 3: VERIFICAÇÃO & ATIVAÇÃO DE STATUS DE TODOS OS PAÍSES DO BLOCO
      // -------------------------------------------------------------
      log(
        `🔍 [3/3] Verificando e ativando chaves de status de todos os ${block.countries.length} países do bloco...`,
        "info"
      );

      let verifiedCount = 0;
      for (let idx = 0; idx < block.countries.length; idx++) {
        if (state.stopRequested) {
          log("⏹️ Verificação interrompida pelo usuário.", "warn");
          break;
        }

        const countryObj = block.countries[idx];
        log(
          `🔎 [${idx + 1}/${block.countries.length}] Verificando "${countryObj.adSetName}" (${countryObj.langCode})...`,
          "info"
        );

        const opened = await navigateToSidebarAdSetByName(countryObj.adSetName);
        if (!opened) {
          log(`⚠️ Não foi possível abrir o conjunto "${countryObj.adSetName}".`, "warn");
          continue;
        }

        await ensureOnAdSetPage(countryObj.adSetName);

        // 1. Ensure Status Toggle is ON
        if (state.options.ensureActive !== false) {
          await ensureStatusToggleActive(countryObj.adSetName);
        }

        // 2. Budget $1.00
        if (state.options.updateBudget) {
          await updateAdSetBudget(state.options.budgetValue || "1.00");
          await sleep(state.options.stepDelayMs);
        }

        // 3. Fix start date
        await fixPastStartDateIfPresent();

        // 4. Advertiser
        if (state.options.updateAdvertiser) {
          await updateAdSetAdvertiser(state.options.advertiserName || "Futuretech Dynamics LLC");
          await sleep(state.options.stepDelayMs);
        }

        // 5. Location
        if (state.options.updateCountry) {
          await updateAdSetLocation(countryObj);
          await sleep(state.options.stepDelayMs);
        }

        // 6. Child Ad (Status ON, Name, URL, Translations)
        if (state.options.updateAdChild) {
          const openedAd = await ensureOnAdPage(countryObj.adSetName);
          if (openedAd && getCurrentEditorLevel() === "ad") {
            await sleep(500);

            // Ad Status ON
            if (state.options.ensureActive !== false) {
              await ensureStatusToggleActive("Anúncio");
            }

            // Ad Name
            if (state.options.updateAdName !== false) {
              await updateAdName(countryObj);
              await sleep(250);
            }

            // Website URL
            if (state.options.updateUrlLang) {
              await updateAdWebsiteUrl(countryObj.langCode);
              await sleep(state.options.stepDelayMs);
            }

            // Translations
            if (state.options.translateTexts) {
              await translateAndFillAdTexts(countryObj.langCode, false);
              await sleep(state.options.stepDelayMs);
            }

            // Return to Ad Set
            await ensureOnAdSetPage(countryObj.adSetName);

            // Re-verify Ad Set Status ON
            if (state.options.ensureActive !== false) {
              await ensureStatusToggleActive(countryObj.adSetName);
            }
          }
        }

        state.doneCountries[block.id][countryObj.adSetName] = true;
        state.checkedCountries[block.id][countryObj.adSetName] = false;
        saveState();
        renderCountryList();

        verifiedCount++;
        await sleep(350);
      }

      log(
        `🎉 Bloco ${block.id} 100% verificado e ativado! ${verifiedCount} conjunto(s) conferidos, sem duplicatas e com chaves ativadas (ON).`,
        "ok"
      );
    } catch (err) {
      if (err?.name === "AutomationStoppedError") {
        log("🛑 Verificação parada imediatamente pelo usuário.", "warn");
      } else {
        log(`❌ Erro na verificação: ${err?.message || err}`, "err");
      }
    } finally {
      state.isRunning = false;
      state.stopRequested = false;
      updateActionButtonsUI();
    }
  }

  async function runBatchAutomationOnCopies() {
    if (state.isRunning) return;

    const block = BLOCKS[state.selectedBlockId];
    if (!block) return;

    const queue = block.countries.filter(
      (c) => state.checkedCountries[state.selectedBlockId][c.adSetName]
    );

    if (queue.length === 0) {
      log("⚠️ Nenhum país marcado na lista! Marque os países que deseja preencher.", "warn");
      return;
    }

    state.isRunning = true;
    state.stopRequested = false;
    updateActionButtonsUI();

    log(`🚀 Iniciando automação em lote (${queue.length} país(es) na fila)...`, "info");

    visitedBatchTargetKeys.clear();
    let processed = 0;

    try {
      const edOk = await ensureEditorOpen();
      if (!edOk) {
        state.isRunning = false;
        updateActionButtonsUI();
        return;
      }

      await dismissAnyBulkEditOrUnsavedModal();

      if (state.options.ensureActive !== false) {
        await ensureCampaignActive();
      }

      // Check if we have the "Conferir" Base Ad Set ready in the sidebar or currently open
      let conferirItem = await findConferirInSidebarWithScroll();
      const onConferir = isCurrentlyOnConferirAdSet() || Boolean(conferirItem);

      if (onConferir) {
        if (!isCurrentlyOnConferirAdSet() && conferirItem) {
          conferirItem.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
          await sleep(220);
          simulateClick(conferirItem.textEl);
          await sleep(Math.max(1050, state.options.stepDelayMs));
          await dismissAnyBulkEditOrUnsavedModal();
        }

        if (block.singleLanguage) {
          // SINGLE-LANGUAGE BLOCK (e.g. BLOCO 03 Francês, BLOCO 04 Espanhol, BLOCO 01 Inglês):
          // 1) Turn "Conferir" into the 1st country (translating its Ad once from PT/EN -> target language)
          // 2) Duplicate the remaining (queue.length - 1) copies from that 1st country (so copies already inherit the translated Ad!)
          const firstCountry = queue[0];
          log(
            `👉 [1/${queue.length}] Configurando "Conferir" como 1º país do bloco (${firstCountry.adSetName} - ${firstCountry.langCode}) e traduzindo Anúncio...`,
            "info"
          );
          await applyCountryToCurrentAdSet(firstCountry, { forceFullBaseSetup: true });
          processed++;
          await sleep(550);

          const remainingAfterFirst = queue.length - processed;
          if (!state.stopRequested && remainingAfterFirst > 0) {
            const existingCopies = await countAllCopyAdSetsInSidebarWithScroll();
            const toDup = Math.max(0, remainingAfterFirst - existingCopies);
            if (toDup > 0) {
              log(
                `📋 Duplicando "${firstCountry.adSetName}" (${toDup} cópia(s) restantes já traduzidas em ${firstCountry.langCode})...`,
                "info"
              );
              await duplicateCurrentAdSet(toDup, firstCountry.adSetName);
              await sleep(800);
              await dismissAnyBulkEditOrUnsavedModal();
            } else {
              log(
                `ℹ️ Já existem ${existingCopies} cópia(s) na barra lateral. Reaproveitando as cópias existentes sem duplicar!`,
                "info"
              );
            }
          }
        } else {
          // MULTI-LANGUAGE BLOCK (e.g. BLOCO 02 Multi-Idiomas):
          // Each country in queue needs its own copy from "Conferir"
          const existingCopies = findCopyAdSetsInSidebar().length;
          const neededCopies = Math.max(0, queue.length - existingCopies);
          if (neededCopies > 0) {
            log(
              `📋 Duplicando conjunto base "Conferir" (${neededCopies} cópia(s) para cobrir todos os ${queue.length} países do bloco)...`,
              "info"
            );
            await duplicateCurrentAdSet(neededCopies, "Conferir");
            await sleep(800);
            await dismissAnyBulkEditOrUnsavedModal();
            await sleep(400);

            // Re-fetch "Conferir" and force a clean click on it to escape multi-selection
            const freshConferir = await findConferirInSidebarWithScroll();
            if (freshConferir) {
              freshConferir.textEl.scrollIntoView({ behavior: "instant", block: "center" });
              await sleep(180);
              simulateClick(freshConferir.textEl);
              await sleep(Math.max(1000, state.options.stepDelayMs));
              await dismissAnyBulkEditOrUnsavedModal();
            }
          } else {
            log(
              `ℹ️ Já existem ${existingCopies} cópia(s) na barra lateral. Reaproveitando as cópias existentes para cobrir o lote!`,
              "info"
            );
          }
        }
      } else {
        // "Conferir" is not in the sidebar. Check if an already completed country from this block exists (e.g. "França" in BLOCO-03)
        const baseDoneCountry = block.countries.find(
          (c) => state.doneCountries[block.id]?.[c.adSetName] && !state.checkedCountries[block.id]?.[c.adSetName]
        );

        const existingCopies = await countAllCopyAdSetsInSidebarWithScroll();
        const neededCopies = Math.max(0, queue.length - existingCopies);

        if (neededCopies > 0 && !state.stopRequested) {
          const crumbs = getTopBreadcrumbItems();
          const activeCrumbCountry =
            crumbs.length >= 2 &&
            block.countries.find((c) => doesSidebarTextMatchCountry(crumbs[1].text, c));

          let baseName = "";
          if (activeCrumbCountry && !state.checkedCountries[block.id]?.[activeCrumbCountry.adSetName]) {
            baseName = activeCrumbCountry.adSetName;
            log(`🎯 Usando conjunto já selecionado "${baseName}" (${activeCrumbCountry.langCode}) como base...`, "info");
          } else if (baseDoneCountry) {
            baseName = baseDoneCountry.adSetName;
            log(`🔍 "Conferir" não encontrado. Usando conjunto já pronto "${baseName}" (${baseDoneCountry.langCode}) como base...`, "info");
            await navigateToSidebarAdSetByName(baseName);
            await sleep(500);
            await ensureOnAdSetPage(baseName);
          } else {
            // Use currently active ad set as base
            await ensureOnAdSetPage();
            const freshCrumbs = getTopBreadcrumbItems();
            baseName = freshCrumbs.length >= 2 ? freshCrumbs[1].text : "Conjunto atual";
            log(`📋 Duplicando ${neededCopies} cópia(s) a partir de "${baseName}"...`, "info");
          }

          await sleep(400);
          const dupOk = await duplicateCurrentAdSet(neededCopies, baseName);
          if (!dupOk) {
            log("⚠️ A duplicação não foi concluída. Interrompendo automação.", "warn");
            state.isRunning = false;
            updateActionButtonsUI();
            return;
          }
          await sleep(800);
          await dismissAnyBulkEditOrUnsavedModal();
        } else if (existingCopies > 0) {
          log(`ℹ️ Já existem ${existingCopies} cópia(s) na barra lateral. Reaproveitando-as para preencher os países restantes!`, "info");
        }
      }

      const remainingQueue = queue.slice(processed);

      for (const country of remainingQueue) {
        if (state.stopRequested) {
          log("⏹️ Automação interrompida pelo usuário.", "warn");
          break;
        }

        await dismissAnyBulkEditOrUnsavedModal();

        // Find next available "- Copy" / "- Cópia", or duplicate-named ad set, or "Conferir"
        let targetCopy = await findNextCopyInSidebarWithScroll();
        if (!targetCopy) {
          targetCopy = await findNextDuplicateNamedAdSetInSidebarWithScroll();
        }
        if (!targetCopy) {
          targetCopy = await findConferirInSidebarWithScroll();
        }

        if (!targetCopy) {
          // Re-try scrolling to top of sidebar and scanning again
          const sidebarScroller = findSidebarScrollContainer();
          if (sidebarScroller) {
            sidebarScroller.scrollTop = 0;
            sidebarScroller.dispatchEvent(new Event("scroll", { bubbles: true }));
            await sleep(300);
            targetCopy =
              (await findNextCopyInSidebarWithScroll()) ||
              (await findNextDuplicateNamedAdSetInSidebarWithScroll()) ||
              (await findConferirInSidebarWithScroll());
          }
        }

        if (!targetCopy) {
          const remainingToCreate = queue.length - processed;
          if (remainingToCreate > 0 && !state.stopRequested) {
            const conferirItem = await findConferirInSidebarWithScroll();
            let baseName = "Conferir";
            if (conferirItem) {
              conferirItem.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
              await sleep(200);
              simulateClick(conferirItem.textEl);
              await sleep(600);
            } else {
              const baseDone = block.countries.find(
                (c) => state.doneCountries[block.id]?.[c.adSetName] && !state.checkedCountries[block.id]?.[c.adSetName]
              );
              if (baseDone) {
                baseName = baseDone.adSetName;
                await navigateToSidebarAdSetByName(baseDone.adSetName);
                await sleep(500);
                await ensureOnAdSetPage(baseDone.adSetName);
              } else {
                await ensureOnAdSetPage();
              }
            }

            log(
              `📋 Faltam cópias para ${remainingToCreate} país(es) restante(s) do bloco. Duplicando a partir de "${baseName}"...`,
              "info"
            );
            const dupOk = await duplicateCurrentAdSet(remainingToCreate, baseName);
            if (dupOk) {
              await sleep(800);
              await dismissAnyBulkEditOrUnsavedModal();
              const sidebarScroller = findSidebarScrollContainer();
              if (sidebarScroller) {
                sidebarScroller.scrollTop = 0;
                sidebarScroller.dispatchEvent(new Event("scroll", { bubbles: true }));
                await sleep(300);
              }
              targetCopy =
                (await findNextCopyInSidebarWithScroll()) ||
                (await findNextDuplicateNamedAdSetInSidebarWithScroll());
            }
          }
        }

        if (!targetCopy) {
          log(
            `⚠️ Não há mais conjuntos disponíveis na barra lateral! (${processed}/${queue.length} concluídos).`,
            "warn"
          );
          break;
        }

        log(
          `👉 [${processed + 1}/${queue.length}] Selecionando "${targetCopy.text}" -> ${country.adSetName} (${country.langCode})`,
          "info"
        );

        state.currentAdSetSidebarEl = targetCopy.textEl;
        targetCopy.textEl.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(250);
        simulateClick(targetCopy.textEl);

        // Wait for Meta Ads Manager to load the selected Ad Set pane
        await sleep(Math.max(1100, state.options.stepDelayMs));
        await dismissAnyBulkEditOrUnsavedModal();

        if (state.stopRequested) break;

        await applyCountryToCurrentAdSet(country);
        processed++;

        await sleep(600);
      }

      if (processed > 0) {
        state.conferirReady = false;
      }
      log(`🎉 Lote finalizado! ${processed} conjunto(s) configurado(s).`, "ok");
    } catch (err) {
      if (err?.name === "AutomationStoppedError") {
        log(`🛑 Automação parada imediatamente pelo usuário! (${processed}/${queue.length} concluídos).`, "warn");
      } else {
        log(`❌ Erro no lote: ${err?.message || err}`, "err");
      }
    } finally {
      state.isRunning = false;
      state.stopRequested = false;
      updateActionButtonsUI();
    }
  }

  // =========================================================================
  // FLOATING UI PANEL BUILDER
  // =========================================================================

  function createFloatingPanel() {
    if (document.getElementById("mab-root-panel")) return;

    const panel = document.createElement("div");
    panel.id = "mab-root-panel";
    panel.innerHTML = `
      <div class="mab-header" id="mab-drag-handle">
        <div class="mab-brand">
          <span class="mab-brand-icon">⚡</span>
          <div class="mab-brand-info">
            <span class="mab-brand-title">AutoAds</span>
            <span class="mab-badge">v3.4</span>
          </div>
        </div>
        <div class="mab-header-actions">
          <button class="mab-header-pill mab-pill-on" id="mab-btn-toggle-on" title="Ativar Switch no Canto Superior Direito (Ligar ON)">
            <span class="mab-pulse-dot"></span> Ligar ON
          </button>
          <button class="mab-header-pill" id="mab-btn-open-standalone" title="Abrir no Editor Standalone (Completo)">
            🔀 Standalone
          </button>
          <button class="mab-icon-btn" id="mab-btn-minimize" title="Minimizar painel">−</button>
        </div>
      </div>

      <div class="mab-nav-subbar">
        <button class="mab-nav-subbar-btn" id="mab-btn-go-adset" title="Alternar para a página do Conjunto pelo menu superior">
          ⊞ Ir para Conjunto
        </button>
        <button class="mab-nav-subbar-btn" id="mab-btn-go-ad" title="Alternar para a página do Anúncio (1 Ad) pelo menu superior">
          ◪ Ir para Anúncio
        </button>
      </div>

      <div id="mab-view-warning" style="display:none;" class="mab-note-warning">
        ⚠️ Modo Gaveta (/manage/ads). Para traduzir anúncios, <a href="#" id="mab-link-switch-standalone" style="color:#f59e0b; font-weight:bold; text-decoration:underline;">abra o Editor Standalone</a>.
      </div>

      <div class="mab-tabs" id="mab-tabs-bar">
        <button class="mab-tab active" data-tab="tab-blocks">
          <span class="mab-tab-icon">📦</span> 1. Blocos & Cópias
        </button>
        <button class="mab-tab" data-tab="tab-config">
          <span class="mab-tab-icon">⚙️</span> 2. Configurações
        </button>
      </div>

      <!-- TAB 1: BLOCOS & CÓPIAS -->
      <div class="mab-body" id="tab-blocks">
        <div class="mab-section">
          <div class="mab-section-header">
            <div class="mab-section-header-left">
              <div class="mab-section-icon-box">🌍</div>
              <div class="mab-section-title-wrap">
                <span class="mab-section-title-text">Bloco de Países</span>
                <span class="mab-section-subtitle-text">Selecione os países para clonar e traduzir</span>
              </div>
            </div>
            <button class="mab-btn mab-btn-secondary mab-btn-sm" id="mab-btn-detect-done" title="Lê a barra lateral esquerda e desmarca os países que já estão prontos">
              🔍 Detectar feitos
            </button>
          </div>
          <select class="mab-select" id="mab-select-block"></select>

          <div class="mab-row" style="justify-content: space-between; font-size: 11px; color: #94a3b8; margin-top: 2px;">
            <span id="mab-countries-counter">0 selecionados</span>
            <div style="display:flex; gap:6px;">
              <a href="#" id="mab-link-check-all" class="mab-link-action">Todos</a>
              <span style="color:#334155;">·</span>
              <a href="#" id="mab-link-uncheck-all" class="mab-link-action mab-link-muted">Nenhum</a>
              <span style="color:#334155;">·</span>
              <a href="#" id="mab-link-reset-done" class="mab-link-action mab-link-danger">Limpar feitos</a>
            </div>
          </div>

          <div class="mab-country-list" id="mab-country-list"></div>
          <div id="mab-block-warning-box" style="display:none;" class="mab-note-warning"></div>
        </div>

        <div class="mab-section">
          <div class="mab-section-header">
            <div class="mab-section-header-left">
              <div class="mab-section-icon-box" style="background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);">⚡</div>
              <div class="mab-section-title-wrap">
                <span class="mab-section-title-text">Regras de Automação</span>
                <span class="mab-section-subtitle-text">Configurações aplicadas em cada duplicata</span>
              </div>
            </div>
          </div>
          <div class="mab-checkboxes-group">
            <label class="mab-checkbox-row">
              <input type="checkbox" id="mab-opt-name" checked />
              <span>Renomear Conjunto com nome do País</span>
            </label>
            <label class="mab-checkbox-row" style="color:#38bdf8; font-weight:600;">
              <input type="checkbox" id="mab-opt-adname" checked />
              <span>Renomear Anúncio com nome do País ("Novo anúncio...")</span>
            </label>
            <label class="mab-checkbox-row">
              <input type="checkbox" id="mab-opt-country" checked />
              <span>Trocar Localização (remover antigo + adicionar país)</span>
            </label>
            <label class="mab-checkbox-row">
              <input type="checkbox" id="mab-opt-budget" checked />
              <span>Voltar Orçamento para $<span id="mab-lbl-budget">1.00</span> + Resetar Data</span>
            </label>
            <label class="mab-checkbox-row">
              <input type="checkbox" id="mab-opt-advertiser" checked />
              <span>Preencher Anunciante Verificado (<span id="mab-lbl-adv">Futuretech...</span>)</span>
            </label>
            <label class="mab-checkbox-row" style="color:#38bdf8; font-weight:600;">
              <input type="checkbox" id="mab-opt-adchild" />
              <span>Também entrar no Anúncio (trocar URL + Traduzir)</span>
            </label>
            <label class="mab-checkbox-row" style="color:#4ade80; font-weight:600;">
              <input type="checkbox" id="mab-opt-activate" checked />
              <span>Ativar Campanha / Conjunto se estiver desligado (Toggle ON)</span>
            </label>
          </div>
        </div>

        <button class="mab-btn mab-btn-danger" id="mab-btn-stop" style="display:none; width:100%; font-weight:800; font-size:12.5px; padding:11px;">
          🛑 PARAR AGORA (Interromper na hora)
        </button>

        <button class="mab-btn mab-btn-outline-cyan" id="mab-btn-prepare-base" title="Cria 1 cópia limpa chamada 'Conferir', muda orçamento para $1.00 e confere URL/Textos/Descrições mantendo o idioma original (PT/EN) para você revisar antes de traduzir">
          🛠️ Preparar Conjunto Base ("Conferir" $1.00)
        </button>

        <div id="mab-conferir-ready-row" style="display:none; flex-direction:column; gap:6px;">
          <div class="mab-row" style="gap:6px;">
            <button class="mab-btn mab-btn-primary" id="mab-btn-start-conferir" style="flex:1;" title="Duplica o conjunto 'Conferir' e faz todas as traduções a partir do original (PT/EN)">
              ▶️ INICIAR (Duplicar e Traduzir)
            </button>
            <button class="mab-btn mab-btn-secondary" id="mab-btn-reverify-conferir" style="padding:9px 12px;" title="Se você alterou algum texto ou URL no 'Conferir', clique aqui para reler e verificar novamente">
              🔄 Reverificar
            </button>
          </div>
          <a href="#" id="mab-link-recreate-base" style="font-size:10.5px; color:#64748b; text-align:center; text-decoration:underline;">↺ Criar outro conjunto base "Conferir" do zero</a>
        </div>

        <div class="mab-row">
          <button class="mab-btn mab-btn-primary" id="mab-btn-run-copies" style="flex:1;">
            🚀 Duplicar / Preencher Todos os "- Copy"
          </button>
          <input type="number" class="mab-input" id="mab-input-dup-count" value="5" min="1" max="50" style="width:56px; text-align:center; font-weight:700;" title="Quantidade de cópias restantes a criar" />
        </div>

        <button class="mab-btn mab-btn-outline-green" id="mab-btn-verify-drafts" title="Percorre apenas os conjuntos em Rascunho (verdes na barra lateral), verificando se o nome do país está certo e se apenas ele está selecionado em Locations">
          ✅ Verificar / Corrigir Rascunhos (Verdes)
        </button>

        <button class="mab-btn mab-btn-outline-danger" id="mab-btn-reset-all" title="Limpa o estado da extensão, reativa o botão de criar 'Conferir' e permite recomeçar o bloco do zero">
          🔄 Resetar / Reiniciar Bloco do Zero
        </button>
      </div>

      <!-- TAB 2: CONFIGURAÇÕES -->
      <div class="mab-body" id="tab-config" style="display:none;">
        <div class="mab-section">
          <div class="mab-section-header">
            <div class="mab-section-header-left">
              <div class="mab-section-icon-box" style="background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);">⚙️</div>
              <div class="mab-section-title-wrap">
                <span class="mab-section-title-text">Padrões do Conjunto e Anúncio</span>
                <span class="mab-section-subtitle-text">Configurações globais de texto, orçamento e delay</span>
              </div>
            </div>
          </div>

          <div class="mab-field-group">
            <label class="mab-field-label">Formato do Nome do Anúncio</label>
            <select class="mab-select" id="mab-cfg-adname-format">
              <option value="country_only">Apenas o País (ex: Filipinas)</option>
              <option value="prefix_country">Nome Original + País (ex: Novo anúncio de Vendas - Filipinas)</option>
              <option value="country_suffix">País + Nome Original (ex: Filipinas - Novo anúncio de Vendas)</option>
            </select>
          </div>

          <div class="mab-field-group">
            <label class="mab-field-label">Orçamento Padrão ($)</label>
            <input type="text" class="mab-input" id="mab-cfg-budget" value="1.00" />
          </div>

          <div class="mab-field-group">
            <label class="mab-field-label">Anunciante Verificado (Ad Transparency)</label>
            <input type="text" class="mab-input" id="mab-cfg-advertiser" value="Futuretech Dynamics LLC" />
          </div>

          <div class="mab-field-group">
            <label class="mab-field-label">Intervalo entre ações (ms)</label>
            <input type="number" class="mab-input" id="mab-cfg-delay" value="900" min="300" max="4000" step="100" />
          </div>
        </div>

        <button class="mab-btn mab-btn-primary" id="mab-btn-save-cfg">
          💾 Salvar Configurações
        </button>
      </div>

      <!-- PERSISTENT LOG BOX & COPY LOG BUTTON -->
      <div id="mab-log-footer">
        <div class="mab-row" style="justify-content: space-between; padding-top: 2px;">
          <span class="mab-log-title">📜 Log de Execução</span>
          <div style="display: flex; gap: 5px;">
            <button class="mab-btn-log-action" id="mab-btn-copy-log" title="Copia todo o log para você colar no chat">
              📋 Copiar Log
            </button>
            <button class="mab-btn-log-action" id="mab-btn-clear-log" title="Limpar log">
              🧹 Limpar
            </button>
          </div>
        </div>
        <div class="mab-status-box" id="mab-log-container">
          <div class="mab-log-entry mab-log-info">Pronto! Selecione o Bloco ou clique em "Detectar já feitos".</div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);
    bindPanelEvents(panel);
    populateBlockSelector();
    syncInputsFromState();
    renderCountryList();
  }

  function populateBlockSelector() {
    const select = document.getElementById("mab-select-block");
    if (!select) return;
    select.innerHTML = "";
    Object.values(BLOCKS).forEach((blk) => {
      const opt = document.createElement("option");
      opt.value = blk.id;
      opt.textContent = `${blk.title} (${blk.countries.length} países)`;
      if (blk.id === state.selectedBlockId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function syncInputsFromState() {
    const setCheck = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!val;
    };
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val ?? "";
    };

    setCheck("mab-opt-name", state.options.updateName);
    setCheck("mab-opt-adname", state.options.updateAdName !== false);
    setCheck("mab-opt-country", state.options.updateCountry);
    setCheck("mab-opt-budget", state.options.updateBudget);
    setCheck("mab-opt-advertiser", state.options.updateAdvertiser);
    setCheck("mab-opt-adchild", state.options.updateAdChild);
    setCheck("mab-opt-activate", state.options.ensureActive !== false);

    setVal("mab-cfg-adname-format", state.options.adNameFormat || "country_only");

    setVal("mab-base-primary", state.baseTexts.primaryText);
    setVal("mab-base-headline", state.baseTexts.headline);
    setVal("mab-base-desc", state.baseTexts.description);
    setVal("mab-select-lang", state.manualTranslateLang);

    setVal("mab-cfg-budget", state.options.budgetValue);
    setVal("mab-cfg-advertiser", state.options.advertiserName);
    setVal("mab-cfg-delay", state.options.stepDelayMs);

    const lblBudget = document.getElementById("mab-lbl-budget");
    if (lblBudget) lblBudget.textContent = state.options.budgetValue;
    const lblAdv = document.getElementById("mab-lbl-adv");
    if (lblAdv) lblAdv.textContent = (state.options.advertiserName || "").slice(0, 18);
  }

  function renderCountryList() {
    const listEl = document.getElementById("mab-country-list");
    const counterEl = document.getElementById("mab-countries-counter");
    const warnBox = document.getElementById("mab-block-warning-box");
    if (!listEl) return;

    const block = BLOCKS[state.selectedBlockId];
    if (!block) return;

    listEl.innerHTML = "";
    let checkedCount = 0;
    const activeNotes = [];

    block.countries.forEach((country) => {
      const isChecked = !!state.checkedCountries[block.id]?.[country.adSetName];
      const isDone = !!state.doneCountries[block.id]?.[country.adSetName];
      if (isChecked) checkedCount++;
      if (isChecked && country.note) activeNotes.push(`${country.adSetName}: ${country.note}`);

      const row = document.createElement("div");
      row.className = `mab-country-item ${isDone ? "mab-done" : ""}`;

      const left = document.createElement("label");
      left.className = "mab-country-left";
      left.style.cursor = "pointer";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = isChecked;
      cb.addEventListener("change", () => {
        state.checkedCountries[block.id][country.adSetName] = cb.checked;
        saveState();
        renderCountryList();
      });

      const nameSpan = document.createElement("span");
      nameSpan.className = "mab-country-name";
      nameSpan.textContent = `${isDone ? "✓ " : ""}${country.adSetName}${country.note ? " ⚠️" : ""}`;
      nameSpan.title = `${country.adSetName} -> Busca FB: ${country.searchEN} / ${country.searchPT} (${country.langName})`;

      left.appendChild(cb);
      left.appendChild(nameSpan);

      const meta = document.createElement("div");
      meta.className = "mab-country-meta";

      const pill = document.createElement("span");
      pill.className = "mab-lang-pill";
      pill.textContent = country.langCode;

      const singleBtn = document.createElement("button");
      singleBtn.className = "mab-apply-single-btn";
      singleBtn.textContent = "Aplicar";
      singleBtn.title = `Aplicar ${country.adSetName} no conjunto aberto agora`;
      singleBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (state.isRunning) return;
        state.isRunning = true;
        state.stopRequested = false;
        updateActionButtonsUI();
        try {
          await applyCountryToCurrentAdSet(country);
        } catch (err) {
          if (err?.name === "AutomationStoppedError") {
            log("🛑 Aplicação parada imediatamente pelo usuário.", "warn");
          }
        } finally {
          state.isRunning = false;
          state.stopRequested = false;
          updateActionButtonsUI();
        }
      });

      meta.appendChild(pill);
      meta.appendChild(singleBtn);

      row.appendChild(left);
      row.appendChild(meta);
      listEl.appendChild(row);
    });

    const copiesInSidebar = findCopyAdSetsInSidebar().length;
    if (counterEl) {
      counterEl.textContent = `${checkedCount}/${block.countries.length} marcados · ${copiesInSidebar} "- Copy" na tela`;
    }

    const dupInput = document.getElementById("mab-input-dup-count");
    if (dupInput && checkedCount > 0) {
      dupInput.value = String(Math.max(1, checkedCount - copiesInSidebar));
    }

    if (warnBox) {
      if (activeNotes.length > 0) {
        warnBox.style.display = "block";
        warnBox.textContent = activeNotes.join(" | ");
      } else {
        warnBox.style.display = "none";
      }
    }
  }

  function updateActionButtonsUI() {
    const prepBtn = document.getElementById("mab-btn-prepare-base");
    const conferirRow = document.getElementById("mab-conferir-ready-row");
    const startConferirBtn = document.getElementById("mab-btn-start-conferir");
    const reverifyConferirBtn = document.getElementById("mab-btn-reverify-conferir");
    const runBtn = document.getElementById("mab-btn-run-copies");
    const verifyBtn = document.getElementById("mab-btn-verify-drafts");
    const stopBtn = document.getElementById("mab-btn-stop");
    if (!runBtn || !stopBtn) return;

    // Show either "🛠️ Preparar Conjunto Base" OR the transformed "▶️ INICIAR" + "🔄 VERIFICAR NOVAMENTE" row
    const hasConferir = Boolean(findConferirInSidebar());
    const showConferirReady = Boolean(state.conferirReady && hasConferir);
    if (prepBtn && conferirRow) {
      prepBtn.style.display = showConferirReady ? "none" : "flex";
      conferirRow.style.display = showConferirReady ? "flex" : "none";
    }

    if (state.isRunning) {
      if (prepBtn) prepBtn.disabled = true;
      if (startConferirBtn) startConferirBtn.disabled = true;
      if (reverifyConferirBtn) reverifyConferirBtn.disabled = true;
      runBtn.disabled = true;
      runBtn.textContent = "⏳ Executando...";
      if (verifyBtn) verifyBtn.disabled = true;
      stopBtn.style.display = "flex";
    } else {
      if (prepBtn) prepBtn.disabled = false;
      if (startConferirBtn) startConferirBtn.disabled = false;
      if (reverifyConferirBtn) reverifyConferirBtn.disabled = false;
      runBtn.disabled = false;
      runBtn.textContent = '🚀 Duplicar / Preencher Todos os "- Copy"';
      if (verifyBtn) verifyBtn.disabled = false;
      stopBtn.style.display = "none";
    }
  }

  function bindPanelEvents(panel) {
    // Draggable header
    const handle = panel.querySelector("#mab-drag-handle");
    const minBtn = panel.querySelector("#mab-btn-minimize");
    let isDragging = false;
    let movedDuringDrag = false;
    let startX = 0,
      startY = 0,
      initialRight = 18,
      initialTop = 64;

    const setMinimizedState = (minimized) => {
      state.minimized = minimized;
      panel.classList.toggle("mab-minimized", state.minimized);
      if (minBtn) {
        minBtn.textContent = state.minimized ? "▢" : "−";
        minBtn.title = state.minimized ? "Expandir painel" : "Minimizar painel";
      }
    };

    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      isDragging = true;
      movedDuringDrag = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      initialRight = window.innerWidth - rect.right;
      initialTop = rect.top;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        movedDuringDrag = true;
      }
      panel.style.right = `${Math.max(4, initialRight - dx)}px`;
      panel.style.top = `${Math.max(4, initialTop + dy)}px`;
    });

    window.addEventListener("mouseup", () => {
      if (isDragging && !movedDuringDrag && state.minimized) {
        setMinimizedState(false);
      }
      isDragging = false;
    });

    // Minimize toggle button
    minBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMinimizedState(!state.minimized);
    });

    // Standalone switcher helper
    const switchStandalone = () => {
      const currentUrl = window.location.href;
      if (currentUrl.includes("/edit/standalone")) {
        log("ℹ️ Você já está no Editor Standalone!", "info");
        return;
      }
      const standaloneUrl = currentUrl.replace(
        /\/adsmanager\/manage\/(ads|adsets|campaigns)(\/edit)?/i,
        "/adsmanager/manage/adsets/edit/standalone"
      );
      log("🔀 Redirecionando para o Editor Completo (Standalone)...", "ok");
      window.location.href = standaloneUrl;
    };

    panel.querySelector("#mab-btn-open-standalone")?.addEventListener("click", switchStandalone);
    panel.querySelector("#mab-link-switch-standalone")?.addEventListener("click", (e) => {
      e.preventDefault();
      switchStandalone();
    });

    // Check if in drawer mode and display warning
    if (!window.location.href.includes("/edit/standalone")) {
      const warnBox = panel.querySelector("#mab-view-warning");
      if (warnBox) warnBox.style.display = "block";
    }

    // Quick top header switch ON button
    panel.querySelector("#mab-btn-toggle-on")?.addEventListener("click", async () => {
      // Check if in table view
      const tableRows = Array.from(document.querySelectorAll('tr, div[role="row"]')).filter(
        (r) => isVisible(r) && !r.closest("#mab-root-panel")
      );
      const isTableMode =
        tableRows.length > 3 &&
        !window.location.href.includes("/edit/standalone") &&
        getAdSetSidebarItems().length === 0;

      if (isTableMode) {
        log("🟢 Modo Tabela detectado! Ativando chavinhas de todas as linhas desligadas...", "info");
        let activated = 0;
        for (const row of tableRows) {
          const sw = row.querySelector('[role="switch"], input[type="checkbox"][role="switch"]');
          if (sw && isSwitchElementOff(sw)) {
            simulateClick(sw);
            sw.click?.();
            activated++;
            await sleep(200);
          }
        }
        await confirmAnyActivationModal();
        log(`✅ ${activated} chavinha(s) ativada(s) na tabela!`, "ok");
      } else {
        log("🟢 Forçando ativação do switch no canto superior direito...", "info");
        const lvl = getCurrentEditorLevel() === "ad" ? "Anúncio" : "Conjunto";
        await ensureStatusToggleActive(lvl);
      }
    });

    // Quick top breadcrumb switchers (Conjunto <-> Anúncio)
    panel.querySelector("#mab-btn-go-adset").addEventListener("click", async () => {
      await ensureOnAdSetPage();
    });

    panel.querySelector("#mab-btn-go-ad").addEventListener("click", async () => {
      await ensureOnAdPage();
    });

    // Copy Log & Clear Log buttons
    panel.querySelector("#mab-btn-copy-log").addEventListener("click", async () => {
      const box = document.getElementById("mab-log-container");
      const lines = box
        ? Array.from(box.querySelectorAll(".mab-log-entry")).map((el) => el.textContent)
        : [];
      const crumbs = getTopBreadcrumbItems().map((c) => c.text).join(" > ");
      const scroller = findEditorScrollContainer();
      const scrollerInfo = scroller
        ? `ok (${Math.round(scroller.scrollTop)}/${Math.round(scroller.scrollHeight)}px)`
        : "none";
      const diagHeader = [
        "=== AUTOADS BLOCOS LOG v3.4 ===",
        `Nível atual: ${getCurrentEditorLevel()}`,
        `Topo (Breadcrumbs): ${crumbs || "(nenhum detectado)"}`,
        `Scroll Central: ${scrollerInfo}`,
        `Bloco: ${state.selectedBlockId}`,
        `URL: ${window.location.pathname}`,
        "--------------------------"
      ];
      const fullText = [...diagHeader, ...lines].join("\n");

      const copyBtn = panel.querySelector("#mab-btn-copy-log");
      try {
        await navigator.clipboard.writeText(fullText);
        if (copyBtn) {
          const orig = copyBtn.textContent;
          copyBtn.textContent = "✅ Copiado!";
          setTimeout(() => {
            copyBtn.textContent = orig;
          }, 1800);
        }
      } catch (err) {
        const ta = document.createElement("textarea");
        ta.value = fullText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        if (copyBtn) {
          copyBtn.textContent = "✅ Copiado!";
          setTimeout(() => {
            copyBtn.textContent = "📋 Copiar Log";
          }, 1800);
        }
      }
    });

    panel.querySelector("#mab-btn-clear-log").addEventListener("click", () => {
      const box = document.getElementById("mab-log-container");
      if (box) {
        box.innerHTML = '<div class="mab-log-entry mab-log-info">Log limpo.</div>';
      }
    });

    // Tabs switching
    panel.querySelectorAll(".mab-tab").forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        panel.querySelectorAll(".mab-tab").forEach((b) => b.classList.remove("active"));
        tabBtn.classList.add("active");
        const targetId = tabBtn.getAttribute("data-tab");
        ["tab-blocks", "tab-config"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.style.display = id === targetId ? "flex" : "none";
        });
      });
    });

    // Block selection
    panel.querySelector("#mab-select-block").addEventListener("change", (e) => {
      state.selectedBlockId = e.target.value;
      const blk = BLOCKS[state.selectedBlockId];
      if (blk) {
        // In BLOCO-02 (Multi-Language), automatically check "updateAdChild" to help user;
        // In single-language blocks (e.g. BLOCO-03 Francês), uncheck it by default so copies don't re-enter the Ad!
        if (!blk.singleLanguage) {
          state.options.updateAdChild = true;
          const adChildCb = document.getElementById("mab-opt-adchild");
          if (adChildCb) adChildCb.checked = true;
        } else {
          state.options.updateAdChild = false;
          const adChildCb = document.getElementById("mab-opt-adchild");
          if (adChildCb) adChildCb.checked = false;
        }
      }
      saveState();
      renderCountryList();
    });

    // Detect already done countries in sidebar (with automatic sidebar scrolling)
    panel.querySelector("#mab-btn-detect-done").addEventListener("click", async () => {
      const btn = panel.querySelector("#mab-btn-detect-done");
      btn.disabled = true;
      btn.textContent = "⏳ Analisando...";
      try {
        await auditBlockCampaignAdSets(state.selectedBlockId);
      } catch (err) {
        log(`❌ Erro na varredura: ${err.message}`, "err");
      } finally {
        btn.disabled = false;
        btn.textContent = "🔍 Detectar já feitos";
      }
    });

    // Check All / Uncheck All / Reset Done
    panel.querySelector("#mab-link-check-all").addEventListener("click", (e) => {
      e.preventDefault();
      const blk = BLOCKS[state.selectedBlockId];
      blk.countries.forEach((c) => (state.checkedCountries[blk.id][c.adSetName] = true));
      saveState();
      renderCountryList();
    });

    panel.querySelector("#mab-link-uncheck-all").addEventListener("click", (e) => {
      e.preventDefault();
      const blk = BLOCKS[state.selectedBlockId];
      blk.countries.forEach((c) => (state.checkedCountries[blk.id][c.adSetName] = false));
      saveState();
      renderCountryList();
    });

    panel.querySelector("#mab-link-reset-done").addEventListener("click", (e) => {
      e.preventDefault();
      const blk = BLOCKS[state.selectedBlockId];
      if (blk) {
        state.doneCountries[blk.id] = {};
        blk.countries.forEach((c) => {
          state.checkedCountries[blk.id][c.adSetName] = true;
        });
      }
      state.conferirReady = false;
      state.currentAdSetSidebarEl = null;
      saveState();
      renderCountryList();
      updateActionButtonsUI();
      log('🧹 Feitos limpos e botão "🛠️ Preparar Conjunto Base" reativado!', "ok");
    });

    // Reset whole block and prepare new base
    const handleResetAll = () => {
      state.conferirReady = false;
      state.currentAdSetSidebarEl = null;
      const blk = BLOCKS[state.selectedBlockId];
      if (blk) {
        state.doneCountries[blk.id] = {};
        blk.countries.forEach((c) => {
          state.checkedCountries[blk.id][c.adSetName] = true;
        });
      }
      saveState();
      renderCountryList();
      updateActionButtonsUI();
      log(
        '🔄 Bloco resetado com sucesso! O botão "🛠️ Preparar Conjunto Base ("Conferir" $1.00)" está pronto para você recomeçar do zero.',
        "ok"
      );
    };

    panel.querySelector("#mab-btn-reset-all")?.addEventListener("click", handleResetAll);
    panel.querySelector("#mab-link-recreate-base")?.addEventListener("click", (e) => {
      e.preventDefault();
      handleResetAll();
    });

    // Options checkboxes
    const bindOpt = (id, key) => {
      panel.querySelector(`#${id}`).addEventListener("change", (e) => {
        state.options[key] = e.target.checked;
        saveState();
      });
    };
    bindOpt("mab-opt-name", "updateName");
    bindOpt("mab-opt-adname", "updateAdName");
    bindOpt("mab-opt-country", "updateCountry");
    bindOpt("mab-opt-budget", "updateBudget");
    bindOpt("mab-opt-advertiser", "updateAdvertiser");
    bindOpt("mab-opt-adchild", "updateAdChild");
    bindOpt("mab-opt-activate", "ensureActive");

    // Prepare Base Ad Set ("Conferir" $1.00 + verify URL & PT/EN texts without translating)
    panel.querySelector("#mab-btn-prepare-base").addEventListener("click", () => {
      prepareBaseAdSetForBlock(false);
    });

    // Transformed buttons after "Conferir" is created:
    // 1) "▶️ INICIAR (Duplicar e Traduzir)"
    panel.querySelector("#mab-btn-start-conferir").addEventListener("click", () => {
      runBatchAutomationOnCopies();
    });

    // 2) "🔄 VERIFICAR NOVAMENTE" (re-checks "Conferir" $1.00 + URL + re-reads PT/EN texts if user edited them)
    panel.querySelector("#mab-btn-reverify-conferir").addEventListener("click", () => {
      prepareBaseAdSetForBlock(true);
    });

    // Run Batch on "- Copy"
    panel.querySelector("#mab-btn-run-copies").addEventListener("click", () => {
      runBatchAutomationOnCopies();
    });

    // Stop Batch immediately on click
    panel.querySelector("#mab-btn-stop").addEventListener("click", () => {
      state.stopRequested = true;
      log("🛑 PARANDO AGORA! Interrompendo ação imediatamente...", "warn");
    });

    // Verify & fix all green Draft Ad Sets in sidebar
    panel.querySelector("#mab-btn-verify-drafts").addEventListener("click", () => {
      verifyAndFixDraftAdSets();
    });

    // TAB 2: Save Config
    panel.querySelector("#mab-btn-save-cfg").addEventListener("click", () => {
      state.options.budgetValue =
        document.getElementById("mab-cfg-budget").value.trim() || "1.00";
      state.options.advertiserName =
        document.getElementById("mab-cfg-advertiser").value.trim() ||
        "Futuretech Dynamics LLC";
      state.options.adNameFormat =
        document.getElementById("mab-cfg-adname-format")?.value || "country_only";
      state.options.stepDelayMs =
        parseInt(document.getElementById("mab-cfg-delay").value, 10) || 900;
      syncInputsFromState();
      saveState();
      log("💾 Configurações salvas com sucesso!", "ok");
    });
  }

  // Listen for messages from popup.js to toggle/focus the floating panel
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "TOGGLE_PANEL") {
      const panel = document.getElementById("mab-root-panel");
      if (panel) {
        state.minimized = false;
        panel.classList.remove("mab-minimized");
        const minBtn = panel.querySelector("#mab-btn-minimize");
        if (minBtn) minBtn.textContent = "−";
        panel.style.display = "flex";
      } else {
        createFloatingPanel();
      }
      sendResponse({ ok: true });
    }
  });

  // Boot panel once storage state is loaded
  loadState(() => {
    createFloatingPanel();
  });
})();
