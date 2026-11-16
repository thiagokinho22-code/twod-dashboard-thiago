// ========================================================
// FÁBRICA AUTOMÁTICA DE CRIATIVOS IA (CLOUDFLARE + CANVAS)
// Gera cenas limpas grátis via Cloudflare Workers AI, compõe
// layouts Feed (1080x1080) e Reels (1080x1920) em PT/ES/EN
// e envia direto para o OneDrive no padrão Studio V2.
// ========================================================

const CREATIVE_PROMPTS_STORAGE_KEY = 'twod_creative_prompts_pdf_v1';

const cfFactoryState = {
    promptsBySlug: {},   // { [slug]: { A1, A2, A3, B1, B2, B3, title } }
    loadedBlockAName: '',
    loadedBlockBName: '',
    collapsed: false,
    running: false,
    stopRequested: false,
    // Preview do último nicho gerado para inspeção / regeneração pontual
    preview: {
        slug: '',
        title: '',
        dateIso: '',
        plan: null,        // { prompts_en, copy_by_lang }
        baseImages: {},    // { A1: dataUrl, A2: ..., B3: ... }
        activeLang: 'pt',
        activeBlock: 'Bloco A',
        composedBlobs: {}, // { 'Bloco A|pt|1': Blob, ... }
    },
};

function _cfEsc(str) {
    if (typeof window.escHtml === 'function') return window.escHtml(str);
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function loadSavedPromptPdfsFromStorage() {
    try {
        const raw = localStorage.getItem(CREATIVE_PROMPTS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.promptsBySlug === 'object') {
            cfFactoryState.promptsBySlug = parsed.promptsBySlug || {};
            cfFactoryState.loadedBlockAName = parsed.loadedBlockAName || '';
            cfFactoryState.loadedBlockBName = parsed.loadedBlockBName || '';
        }
    } catch (e) { }
}

function savePromptPdfsToStorage() {
    try {
        localStorage.setItem(CREATIVE_PROMPTS_STORAGE_KEY, JSON.stringify({
            promptsBySlug: cfFactoryState.promptsBySlug,
            loadedBlockAName: cfFactoryState.loadedBlockAName,
            loadedBlockBName: cfFactoryState.loadedBlockBName,
        }));
    } catch (e) { }
}

function syncStudioCloudflareBanner() {
    const pill = document.getElementById('studio-cf-status-pill');
    const inlineWrap = document.getElementById('studio-cf-inline-wrap');
    const hasCf = Boolean(window.metaState && window.metaState.hasCloudflare);

    if (pill) {
        if (hasCf) {
            pill.textContent = '🟢 Cloudflare AI no Servidor';
            pill.classList.remove('status-off', 'muted');
            pill.classList.add('status-ok');
        } else {
            pill.textContent = '⚪ Configurar Cloudflare Grátis';
            pill.classList.remove('status-ok', 'ok');
            pill.classList.add('status-off');
        }
    }
    if (inlineWrap) {
        inlineWrap.classList.toggle('twod-hidden', hasCf);
    }
}

function initCreativeFactoryUI() {
    loadSavedPromptPdfsFromStorage();
    syncStudioCloudflareBanner();
    updateCfPromptBadgesUI();
    refreshCfTargetSummary();
}

function toggleCreativeFactoryCard() {
    const body = document.getElementById('cf-factory-body');
    const btn = document.getElementById('btn-cf-factory-toggle');
    cfFactoryState.collapsed = !cfFactoryState.collapsed;
    if (body) body.classList.toggle('twod-hidden', cfFactoryState.collapsed);
    if (btn) btn.textContent = cfFactoryState.collapsed ? 'Expandir' : 'Recolher';
}

function updateCfPromptBadgesUI() {
    const aBadge = document.getElementById('cf-pdf-a-status');
    const bBadge = document.getElementById('cf-pdf-b-status');
    const countA = Object.values(cfFactoryState.promptsBySlug).filter(p => p && (p.A1 || p.A2 || p.A3)).length;
    const countB = Object.values(cfFactoryState.promptsBySlug).filter(p => p && (p.B1 || p.B2 || p.B3)).length;

    if (aBadge) {
        aBadge.textContent = countA > 0
            ? `✅ Bloco A (${countA} nichos)`
            : '📄 PDF Bloco A (opcional)';
        aBadge.className = `studio-mini-badge ${countA > 0 ? 'ok' : 'muted'}`;
    }
    if (bBadge) {
        bBadge.textContent = countB > 0
            ? `✅ Bloco B (${countB} nichos)`
            : '📄 PDF Bloco B (opcional)';
        bBadge.className = `studio-mini-badge ${countB > 0 ? 'ok' : 'muted'}`;
    }
}

function refreshCfTargetSummary() {
    const el = document.getElementById('cf-factory-target-info');
    if (!el) return;
    const weeklyCount = (typeof weeklyPackState !== 'undefined' && Array.isArray(weeklyPackState.items))
        ? weeklyPackState.items.filter(it => it.selected).length
        : 0;
    const { niche, fullName } = (typeof getStudioTargetCampaignAndDate === 'function')
        ? getStudioTargetCampaignAndDate()
        : { niche: '', fullName: '' };

    const parts = [];
    if (fullName || niche) parts.push(`Nicho atual do Studio: <strong>${_cfEsc(fullName || niche)}</strong>`);
    if (weeklyCount > 0) parts.push(`Semana PDF: <strong>${weeklyCount} nicho(s) marcado(s)</strong>`);
    el.innerHTML = parts.length
        ? parts.join(' &nbsp;•&nbsp; ')
        : 'Digite um Nicho/Data no Studio ou suba o PDF da Semana acima.';
}

// ========================================================
// PARSER DOS PDFs DE PROMPTS (BLOCO A & BLOCO B)
// ========================================================

function extractPromptCardText(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return '';
    const cleaned = lines.filter(l => !/^REELS\s*:/i.test(l));
    const startIdx = cleaned.findIndex(l => /^Crie um criativo\b/i.test(l));
    if (startIdx >= 0) {
        return cleaned.slice(startIdx).join(' ').replace(/\s+/g, ' ').trim();
    }
    const assuntoIdx = cleaned.findIndex(l => /^ASSUNTO\s*:/i.test(l));
    if (assuntoIdx >= 0 && assuntoIdx + 1 < cleaned.length) {
        return cleaned.slice(assuntoIdx + 1).join(' ').replace(/\s+/g, ' ').trim();
    }
    return cleaned.join(' ').replace(/\s+/g, ' ').trim();
}

function parseCreativePromptPdfPagesData(pagesData, blockHint = '') {
    const parser = window.twodWeeklyPdfParser;
    if (!parser || typeof parser.clusterPdfItemsToLines !== 'function') {
        throw new Error('Parser base de PDF não disponível.');
    }

    let detectedBlock = (blockHint || '').toUpperCase();
    const result = {};

    for (let p = 0; p < pagesData.length; p++) {
        const page = pagesData[p];
        const allLines = parser.clusterPdfItemsToLines(page.items);
        if (allLines.length === 0) continue;

        if (!detectedBlock) {
            const joined = allLines.slice(0, 6).join(' ');
            if (/Bloco\s+A\b|Estilo\s+FOTO/i.test(joined)) detectedBlock = 'A';
            else if (/Bloco\s+B\b|Estilo\s+GR[ÁA]FICO/i.test(joined)) detectedBlock = 'B';
        }

        // Páginas 2+ têm cabeçalho: "1. Rastrear Avião · Segunda  UTILIDADE  ·  RastrearAviao"
        const headLine = allLines.find(l => /^\d+\.\s+.+/.test(l) && /·/.test(l));
        if (!headLine) continue;

        const slugMatch = headLine.match(/([A-Z][A-Za-z0-9]{3,})\s*$/);
        const slug = slugMatch ? slugMatch[1].trim() : '';
        if (!slug) continue;

        const titlePart = headLine.replace(/^\d+\.\s*/, '').split('·')[0].trim();

        const w = Number(page.width) || 842;
        const h = Number(page.height) || 595;
        // Cards ficam no meio (acima do rodapé REELS: e abaixo do banner azul de áudio)
        const cardItems = page.items.filter(it => it.y > h * 0.14);

        const col1 = parser.clusterPdfItemsToLines(cardItems.filter(it => it.x < w * 0.34));
        const col2 = parser.clusterPdfItemsToLines(cardItems.filter(it => it.x >= w * 0.34 && it.x < w * 0.66));
        const col3 = parser.clusterPdfItemsToLines(cardItems.filter(it => it.x >= w * 0.66));

        const p1 = extractPromptCardText(col1);
        const p2 = extractPromptCardText(col2);
        const p3 = extractPromptCardText(col3);

        const blk = detectedBlock === 'B' ? 'B' : 'A';
        if (!result[slug]) result[slug] = { title: titlePart };
        if (p1) result[slug][`${blk}1`] = p1;
        if (p2) result[slug][`${blk}2`] = p2;
        if (p3) result[slug][`${blk}3`] = p3;
    }

    return { block: detectedBlock || 'A', promptsBySlug: result };
}

async function handleCreativePromptPdfSelected(files, blockHint = '') {
    const file = files && files[0];
    if (!file) return;
    try {
        if (typeof ensurePdfJsLoaded !== 'function') {
            throw new Error('Leitor PDF.js não disponível.');
        }
        const pdfjs = await ensurePdfJsLoaded();
        const buf = await file.arrayBuffer();
        const pdfDoc = await pdfjs.getDocument({ data: buf }).promise;

        const pagesData = [];
        for (let p = 1; p <= pdfDoc.numPages; p++) {
            const page = await pdfDoc.getPage(p);
            const vp = page.getViewport({ scale: 1.0 });
            const tc = await page.getTextContent();
            const items = (tc.items || []).map(it => ({
                str: it.str || '',
                x: Array.isArray(it.transform) ? it.transform[4] : 0,
                y: Array.isArray(it.transform) ? it.transform[5] : 0,
                width: Number(it.width) || 0,
            }));
            pagesData.push({ pageNum: p, width: vp.width, height: vp.height, items });
        }

        const parsed = parseCreativePromptPdfPagesData(pagesData, blockHint);
        const slugs = Object.keys(parsed.promptsBySlug);
        if (slugs.length === 0) {
            throw new Error('Não identifiquei prompts de nicho neste PDF.');
        }

        for (const s of slugs) {
            cfFactoryState.promptsBySlug[s] = {
                ...(cfFactoryState.promptsBySlug[s] || {}),
                ...parsed.promptsBySlug[s],
            };
        }
        if (parsed.block === 'B') cfFactoryState.loadedBlockBName = file.name;
        else cfFactoryState.loadedBlockAName = file.name;

        savePromptPdfsToStorage();
        updateCfPromptBadgesUI();
    } catch (err) {
        alert(`Erro ao ler PDF de prompts: ${err.message}`);
    }
}

// ========================================================
// COMPOSITOR HTML5 CANVAS — FEED (1080x1080) & REELS (1080x1920)
// ========================================================

function loadCanvasImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Falha ao decodificar imagem gerada.'));
        img.src = src;
    });
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
}

function wrapTextToWidth(ctx, text, maxWidth) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const lines = [];
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
        const test = `${current} ${words[i]}`;
        if (ctx.measureText(test).width <= maxWidth) {
            current = test;
        } else {
            lines.push(current);
            current = words[i];
        }
    }
    lines.push(current);
    return lines;
}

function fitTextLines(ctx, text, maxWidth, startPx, minPx, maxLines, weight = 900) {
    for (let px = startPx; px >= minPx; px -= 3) {
        ctx.font = `${weight} ${px}px "Segoe UI", Arial, Helvetica, sans-serif`;
        const lines = wrapTextToWidth(ctx, text, maxWidth);
        const maxWordW = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
        if (lines.length <= maxLines && maxWordW <= maxWidth) {
            return { px, lines, lineHeight: Math.round(px * 1.18) };
        }
    }
    ctx.font = `${weight} ${minPx}px "Segoe UI", Arial, Helvetica, sans-serif`;
    const fallbackLines = wrapTextToWidth(ctx, text, maxWidth).slice(0, maxLines);
    return { px: minPx, lines: fallbackLines, lineHeight: Math.round(minPx * 1.18) };
}

function drawCoverRoundedImage(ctx, img, x, y, w, h, radius = 24, desaturate = false) {
    ctx.save();
    drawRoundedRectPath(ctx, x, y, w, h, radius);
    ctx.clip();
    if (desaturate) {
        ctx.filter = 'grayscale(70%) brightness(0.75) blur(1px)';
    }
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
}

function drawContainOnWhite(ctx, img, x, y, w, h) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const scale = Math.min(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
}

function drawCtaButton(ctx, label, cx, centerY, w, h, bgColor, textColor = '#ffffff', fontPx = 46) {
    const x = cx - w / 2;
    const y = centerY - h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    drawRoundedRectPath(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.restore();

    const cleanLabel = String(label || 'SAIBA MAIS').toUpperCase();
    let usePx = fontPx;
    ctx.save();
    while (usePx > 32) {
        ctx.font = `900 ${usePx}px "Segoe UI", Arial, Helvetica, sans-serif`;
        if (ctx.measureText(cleanLabel).width <= w - 44) break;
        usePx -= 2;
    }
    ctx.font = `900 ${usePx}px "Segoe UI", Arial, Helvetica, sans-serif`;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cleanLabel, cx, centerY + 2, w - 40);
    ctx.restore();
}

function drawCenteredTextLines(ctx, lines, cx, startY, lineHeight, fill, stroke = null, strokeWidth = 0) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    lines.forEach((line, i) => {
        const ly = startY + i * lineHeight;
        if (stroke && strokeWidth > 0) {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = strokeWidth;
            ctx.strokeText(line, cx, ly);
        }
        ctx.fillStyle = fill;
        ctx.fillText(line, cx, ly);
    });
    ctx.restore();
}

function drawComparisonMockups(ctx, img, x, y, w, h, copy) {
    const phoneW = Math.round(w * 0.415);
    const phoneH = Math.round(h * 0.94);
    const leftX = x;
    const rightX = x + w - phoneW;
    const phoneY = y + Math.round((h - phoneH) / 2);

    const drawOnePhone = (px, py, pw, ph, headerBg, headerText, isAfter) => {
        ctx.save();
        ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 8;
        drawRoundedRectPath(ctx, px, py, pw, ph, 38);
        ctx.fillStyle = isAfter ? '#0f172a' : '#334155';
        ctx.fill();
        ctx.restore();

        // Tela interna
        const pad = 14;
        const sx = px + pad;
        const sy = py + pad;
        const sw = pw - pad * 2;
        const sh = ph - pad * 2;
        ctx.save();
        drawRoundedRectPath(ctx, sx, sy, sw, sh, 26);
        ctx.fillStyle = isAfter ? '#f8fafc' : '#e2e8f0';
        ctx.fill();
        ctx.clip();

        // Faixa topo (antes / depois)
        const bannerH = 108;
        ctx.fillStyle = headerBg;
        ctx.fillRect(sx, sy, sw, bannerH);

        const fitLbl = fitTextLines(ctx, headerText, sw - 22, 32, 22, 2, 900);
        ctx.font = `900 ${fitLbl.px}px "Segoe UI", Arial, sans-serif`;
        const totalTxtH = fitLbl.lines.length * fitLbl.lineHeight;
        drawCenteredTextLines(ctx, fitLbl.lines, sx + sw / 2, sy + (bannerH - totalTxtH) / 2, fitLbl.lineHeight, '#ffffff');

        // Área da cena dentro do smartphone
        const innerImgY = sy + bannerH + 14;
        const innerImgH = sh - bannerH - 28;
        if (img) {
            drawCoverRoundedImage(ctx, img, sx + 12, innerImgY, sw - 24, innerImgH, 16, !isAfter);
        }

        // Badge X vermelho / Check verde
        ctx.beginPath();
        ctx.arc(sx + sw - 34, sy + bannerH + 34, 22, 0, Math.PI * 2);
        ctx.fillStyle = isAfter ? '#16a34a' : '#dc2626';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '900 24px "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isAfter ? '✓' : '✕', sx + sw - 34, sy + bannerH + 35);
        ctx.restore();
    };

    drawOnePhone(leftX, phoneY, phoneW, phoneH, '#dc2626', copy.before_b3 || 'ANTES', false);
    drawOnePhone(rightX, phoneY, phoneW, phoneH, '#16a34a', copy.after_b3 || 'DEPOIS', true);

    // Seta vermelha central apontando esquerda -> direita
    const cy = phoneY + phoneH / 2;
    const ax1 = leftX + phoneW + 14;
    const ax2 = rightX - 14;
    ctx.save();
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax1, cy);
    ctx.lineTo(ax2 - 18, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ax2, cy);
    ctx.lineTo(ax2 - 30, cy - 22);
    ctx.lineTo(ax2 - 30, cy + 22);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

async function composeCreativeToPngBlob(styleKey, baseImgDataUrl, copy, isReels = false) {
    const W = 1080;
    const H = isReels ? 1920 : 1080;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const img = baseImgDataUrl ? await loadCanvasImage(baseImgDataUrl) : null;
    const safeTop = isReels ? 265 : 46;
    const safeBottom = isReels ? 365 : 46;
    const usableH = H - safeTop - safeBottom;
    const padX = 48;
    const maxTextW = W - padX * 2;
    const ctaText = copy.cta || 'SAIBA MAIS';
    const ctaCenterY = H - safeBottom - 58;

    if (styleKey === 'A3') {
        // ESTILO 3 BLOCO A: Fundo Branco Puro #FFFFFF + Título Vermelho Contorno Preto + Foto Central + Texto Preto + Botão Verde
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        const fitTop = fitTextLines(ctx, copy.headline_a3 || copy.headline_a1 || '', maxTextW, isReels ? 90 : 78, 48, 2, 900);
        ctx.font = `900 ${fitTop.px}px "Segoe UI", Arial, sans-serif`;
        drawCenteredTextLines(ctx, fitTop.lines, W / 2, safeTop, fitTop.lineHeight, '#e11d48', '#0f172a', 12);

        const capFit = fitTextLines(ctx, copy.caption_a3 || '', maxTextW, isReels ? 54 : 48, 34, 2, 900);
        const capH = capFit.lines.length * capFit.lineHeight;
        const capY = ctaCenterY - 76 - capH;

        const topEnd = safeTop + fitTop.lines.length * fitTop.lineHeight + 22;
        const imgBoxH = Math.max(250, capY - 22 - topEnd);
        if (img) drawContainOnWhite(ctx, img, padX + 20, topEnd, maxTextW - 40, imgBoxH);

        ctx.font = `900 ${capFit.px}px "Segoe UI", Arial, sans-serif`;
        drawCenteredTextLines(ctx, capFit.lines, W / 2, capY, capFit.lineHeight, '#0f172a');
        drawCtaButton(ctx, ctaText, W / 2, ctaCenterY, 520, 108, '#16a34a', '#ffffff', 46);
    } else if (styleKey === 'B3') {
        // ESTILO 3 BLOCO B: Comparativo em Fundo Branco Puro #FFFFFF (2 Smartphones Antes/Depois + Seta Vermelha + Botão Verde)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        const badgeTxt = String(copy.category_badge || 'APP').toUpperCase();
        ctx.font = '800 28px "Segoe UI", Arial, sans-serif';
        const bw = Math.min(390, ctx.measureText(badgeTxt).width + 52);
        drawRoundedRectPath(ctx, (W - bw) / 2, safeTop, bw, 52, 26);
        ctx.fillStyle = '#e0f2fe';
        ctx.fill();
        ctx.fillStyle = '#0369a1';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeTxt, W / 2, safeTop + 27);

        const capFit = fitTextLines(ctx, copy.caption_b3 || copy.caption_a3 || '', maxTextW, isReels ? 54 : 48, 34, 2, 900);
        const capH = capFit.lines.length * capFit.lineHeight;
        const capY = ctaCenterY - 76 - capH;

        const phonesTop = safeTop + 72;
        const phonesH = Math.max(350, capY - 22 - phonesTop);
        drawComparisonMockups(ctx, img, 48, phonesTop, W - 96, phonesH, copy);

        ctx.font = `900 ${capFit.px}px "Segoe UI", Arial, sans-serif`;
        drawCenteredTextLines(ctx, capFit.lines, W / 2, capY, capFit.lineHeight, '#0f172a');
        drawCtaButton(ctx, ctaText, W / 2, ctaCenterY, 520, 108, '#16a34a', '#ffffff', 46);
    } else if (styleKey === 'A1') {
        // ESTILO 1 BLOCO A: Advertorial Escuro de Alto Contraste
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(1, '#1e3a8a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        const badgeTxt = String(copy.category_badge || 'UTILIDADE').toUpperCase();
        ctx.font = '800 28px "Segoe UI", Arial, sans-serif';
        const bw = Math.min(390, ctx.measureText(badgeTxt).width + 52);
        drawRoundedRectPath(ctx, padX, safeTop, bw, 52, 14);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeTxt, padX + bw / 2, safeTop + 27);

        const headFit = fitTextLines(ctx, copy.headline_a1 || '', maxTextW, isReels ? 84 : 74, 46, 2, 900);
        ctx.font = `900 ${headFit.px}px "Segoe UI", Arial, sans-serif`;
        const headY = safeTop + 70;
        drawCenteredTextLines(ctx, headFit.lines, W / 2, headY, headFit.lineHeight, '#ffffff');

        const subFit = fitTextLines(ctx, copy.sub_a1 || '', maxTextW, isReels ? 46 : 40, 30, 2, 700);
        const subY = headY + headFit.lines.length * headFit.lineHeight + 12;
        ctx.font = `700 ${subFit.px}px "Segoe UI", Arial, sans-serif`;
        drawCenteredTextLines(ctx, subFit.lines, W / 2, subY, subFit.lineHeight, '#f1f5f9');

        const imgY = subY + subFit.lines.length * subFit.lineHeight + 24;
        const imgH = Math.max(250, (ctaCenterY - 76) - imgY);
        if (img) drawCoverRoundedImage(ctx, img, padX, imgY, maxTextW, imgH, 28);

        drawCtaButton(ctx, copy.download_cta || ctaText, W / 2, ctaCenterY, 640, 108, '#16a34a', '#ffffff', 44);
    } else if (styleKey === 'A2') {
        // ESTILO 2 BLOCO A: Clean Moderno com Foto
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#f8fafc');
        grad.addColorStop(1, '#e0f2fe');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        const headFit = fitTextLines(ctx, copy.headline_a2 || copy.headline_a1 || '', maxTextW, isReels ? 82 : 70, 44, 3, 900);
        ctx.font = `900 ${headFit.px}px "Segoe UI", Arial, sans-serif`;
        drawCenteredTextLines(ctx, headFit.lines, W / 2, safeTop + 6, headFit.lineHeight, '#0f172a');

        const imgY = safeTop + headFit.lines.length * headFit.lineHeight + 30;
        const imgH = Math.max(260, (ctaCenterY - 78) - imgY);
        if (img) drawCoverRoundedImage(ctx, img, padX, imgY, maxTextW, imgH, 32);

        drawCtaButton(ctx, ctaText, W / 2, ctaCenterY, 600, 108, '#0f172a', '#ffffff', 46);
    } else if (styleKey === 'B1') {
        // ESTILO 1 BLOCO B: Ilustração Flat Moderna
        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, '#eff6ff');
        grad.addColorStop(1, '#fef3c7');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        const headFit = fitTextLines(ctx, copy.headline_b1 || copy.headline_a1 || '', maxTextW, isReels ? 82 : 72, 44, 2, 900);
        ctx.font = `900 ${headFit.px}px "Segoe UI", Arial, sans-serif`;
        drawCenteredTextLines(ctx, headFit.lines, W / 2, safeTop + 6, headFit.lineHeight, '#1e293b');

        const imgY = safeTop + headFit.lines.length * headFit.lineHeight + 30;
        const imgH = Math.max(260, (ctaCenterY - 78) - imgY);
        ctx.save();
        ctx.shadowColor = 'rgba(15, 23, 42, 0.14)';
        ctx.shadowBlur = 24;
        drawRoundedRectPath(ctx, padX, imgY, maxTextW, imgH, 32);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.restore();
        if (img) drawCoverRoundedImage(ctx, img, padX + 12, imgY + 12, maxTextW - 24, imgH - 24, 24);

        drawCtaButton(ctx, ctaText, W / 2, ctaCenterY, 540, 108, '#2563eb', '#ffffff', 46);
    } else {
        // ESTILO 2 BLOCO B: Render 3D Estúdio
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, '#f1f5f9');
        grad.addColorStop(1, '#dbeafe');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        const headFit = fitTextLines(ctx, copy.headline_b2 || copy.headline_a2 || '', maxTextW, isReels ? 80 : 70, 44, 3, 900);
        ctx.font = `900 ${headFit.px}px "Segoe UI", Arial, sans-serif`;
        drawCenteredTextLines(ctx, headFit.lines, W / 2, safeTop + 6, headFit.lineHeight, '#0f172a');

        const imgY = safeTop + headFit.lines.length * headFit.lineHeight + 30;
        const imgH = Math.max(260, (ctaCenterY - 78) - imgY);
        if (img) drawCoverRoundedImage(ctx, img, padX, imgY, maxTextW, imgH, 34);

        drawCtaButton(ctx, ctaText, W / 2, ctaCenterY, 540, 108, '#4f46e5', '#ffffff', 46);
    }

    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('Falha ao exportar PNG do Canvas.'));
        }, 'image/png');
    });
}

// ========================================================
// FLUXO AUTOMÁTICO: PLANO GEMINI + CLOUDFLARE + CANVAS + ONEDRIVE
// ========================================================

function getCfSelectedLanguages() {
    const langs = Array.from(document.querySelectorAll('input[name="studio-tts-lang"]:checked'))
        .map(cb => cb.value)
        .filter(Boolean);
    if (!langs.includes('pt')) langs.unshift('pt');
    return langs;
}

function getCfInlineCredentials() {
    return {
        accountId: (document.getElementById('studio-cf-account-inline')?.value || '').trim(),
        apiToken: (document.getElementById('studio-cf-token-inline')?.value || '').trim(),
        geminiKey: (document.getElementById('studio-gemini-key-inline')?.value || '').trim(),
        model: (document.getElementById('cf-model-select')?.value || '@cf/black-forest-labs/flux-1-schnell').trim(),
    };
}

function setCfFactoryProgress(pct, labelText) {
    const wrap = document.getElementById('cf-factory-progress-wrap');
    const lbl = document.getElementById('cf-factory-progress-label');
    const pctEl = document.getElementById('cf-factory-progress-pct');
    const fill = document.getElementById('cf-factory-progress-fill');
    if (wrap) wrap.classList.remove('twod-hidden');
    const cleanPct = Math.max(0, Math.min(100, Math.round(pct)));
    if (lbl) lbl.textContent = labelText || '';
    if (pctEl) pctEl.textContent = `${cleanPct}%`;
    if (fill) fill.style.width = `${cleanPct}%`;
}

const STYLE_META_LABELS = {
    A1: 'Bloco A · Estilo 1 — Advertorial (Foto)',
    A2: 'Bloco A · Estilo 2 — Clean Moderno (Foto)',
    A3: 'Bloco A · Estilo 3 — Fundo Branco (#FFFFFF)',
    B1: 'Bloco B · Estilo 1 — Ilustração Flat',
    B2: 'Bloco B · Estilo 2 — Render 3D Estúdio',
    B3: 'Bloco B · Estilo 3 — Comparativo Smartphones (#FFFFFF)',
};

function logCfTerminal(message, type = 'info') {
    const body = document.getElementById('cf-terminal-body');
    const clearBtn = document.getElementById('btn-clear-cf-log');
    if (clearBtn) clearBtn.classList.remove('twod-hidden');
    if (!body) return;
    const empty = body.querySelector('.terminal-log-empty');
    if (empty) empty.remove();

    const timeStr = new Date().toTimeString().split(' ')[0];
    const line = document.createElement('div');
    line.className = `terminal-entry ${type}`;
    line.innerHTML = `<span class="term-time">[${timeStr}]</span> <span class="term-text">${_cfEsc(message)}</span>`;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
}

function setCfTerminalLiveStatus(text) {
    const el = document.getElementById('cf-terminal-live-status');
    if (el) el.textContent = text || '';
}

function clearCfLog() {
    const body = document.getElementById('cf-terminal-body');
    const clearBtn = document.getElementById('btn-clear-cf-log');
    if (body) {
        body.innerHTML = '<div class="terminal-log-empty">Terminal limpo. Pronto para iniciar geração de criativos.</div>';
    }
    if (clearBtn) clearBtn.classList.add('twod-hidden');
    setCfTerminalLiveStatus('Pronto para iniciar');
}

function renderCfStyleQueue(queueItems) {
    const wrap = document.getElementById('cf-style-queue');
    if (!wrap) return;
    if (!Array.isArray(queueItems) || queueItems.length === 0) {
        wrap.classList.add('twod-hidden');
        wrap.innerHTML = '';
        return;
    }

    wrap.classList.remove('twod-hidden');
    wrap.innerHTML = queueItems.map(it => {
        const cls = it.status === 'done' ? 'is-done'
            : (it.status === 'skipped' ? 'is-skipped'
                : (it.status === 'error' ? 'is-error'
                    : (it.status === 'running' ? 'is-running' : 'is-pending')));
        const icon = it.status === 'done' ? '✅'
            : (it.status === 'skipped' ? '⏭️'
                : (it.status === 'error' ? '❌'
                    : (it.status === 'running' ? '⏳' : '🕒')));
        const pct = Math.max(0, Math.min(100, Math.round(Number(it.pct) || 0)));
        return `
            <div class="cf-queue-item ${cls}">
                <div class="cf-queue-head">
                    <span><strong>${icon} ${_cfEsc(it.title || it.key)}</strong></span>
                    <span class="text-muted" style="font-size:11px;">${_cfEsc(it.detail || 'Na fila...')} • <strong>${pct}%</strong></span>
                </div>
                <div class="cf-queue-mini-track">
                    <div class="cf-queue-mini-fill" style="width:${pct}%;"></div>
                </div>
            </div>
        `;
    }).join('');
}

function _buildCampFullName(slug, dateIso) {
    const dShort = (typeof formatStudioDateShort === 'function') ? formatStudioDateShort(dateIso) : dateIso;
    if (!slug) return '';
    return dShort ? `${slug} ${dShort}` : slug;
}

async function auditAndFilterPendingBlocks(nicheSpec, blocks, languages) {
    const campFullName = _buildCampFullName(nicheSpec.slug, nicheSpec.dateIso);
    if (!campFullName) {
        return { pendingBlocks: [...blocks], doneBlocks: [], campFullName };
    }

    try {
        const resp = await window.apiFetch(`/api/studio/audit?name=${encodeURIComponent(campFullName)}`);
        if (!resp.ok) {
            return { pendingBlocks: [...blocks], doneBlocks: [], campFullName, auditError: `HTTP ${resp.status}` };
        }
        const audit = await resp.json();
        if (!audit || !audit.success || !Array.isArray(audit.blocks) || audit.blocks.length === 0) {
            return { pendingBlocks: [...blocks], doneBlocks: [], campFullName };
        }

        const pendingBlocks = [];
        const doneBlocks = [];
        for (const blk of blocks) {
            const bEntry = audit.blocks.find(b => String(b.block || '').toLowerCase() === blk.toLowerCase());
            if (!bEntry || !Array.isArray(bEntry.languages)) {
                pendingBlocks.push(blk);
                continue;
            }
            const allLangsReady = languages.every(lc => {
                const lEntry = bEntry.languages.find(x => String(x.lang_code || '').toLowerCase() === lc.toLowerCase());
                return lEntry && (Number(lEntry.imgs_count) >= 6 || Number(lEntry.videos_count) >= 6);
            });
            if (allLangsReady) doneBlocks.push(blk);
            else pendingBlocks.push(blk);
        }
        return { pendingBlocks, doneBlocks, campFullName };
    } catch (e) {
        return { pendingBlocks: [...blocks], doneBlocks: [], campFullName, auditError: e.message };
    }
}

async function uploadComposedBlockLangToOneDrive(campaignSlug, dateIso, blockName, langCode, blobsMap) {
    const batchId = `cf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    for (let slot = 1; slot <= 6; slot++) {
        const key = `${blockName}|${langCode}|${slot}`;
        const blob = blobsMap[key];
        if (!blob) continue;
        const q = new URLSearchParams({ batch_id: batchId, filename: `${slot}.png` });
        const stResp = await window.apiFetch(`/api/studio/stage-file?${q.toString()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: blob,
        });
        const stData = await stResp.json();
        if (!stData.success) throw new Error(stData.error || `Falha no envio ${slot}.png`);
    }

    const commitResp = await window.apiFetch('/api/studio/commit-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            batch_id: batchId,
            campaign: campaignSlug,
            date: dateIso,
            block: blockName,
            lang: langCode,
        }),
    });
    const commitData = await commitResp.json();
    if (!commitResp.ok || !commitData.success) {
        throw new Error(commitData.error || 'Erro ao salvar imagens no OneDrive.');
    }
    return commitData;
}

async function generateAllVariantsForNiche(nicheSpec, options) {
    const { blocks, languages, creds, autoUpload, skipExisting = true, onProgress, onStage } = options;
    const campFullName = _buildCampFullName(nicheSpec.slug, nicheSpec.dateIso) || nicheSpec.slug;

    let activeBlocks = [...blocks];
    let skippedBlocks = [];
    if (skipExisting && autoUpload) {
        logCfTerminal(`🔍 Auditando OneDrive para "${campFullName}"...`, 'info');
        if (onProgress) onProgress(0.03, `🔍 Verificando o que já está pronto em ${campFullName}...`);
        const auditRes = await auditAndFilterPendingBlocks(nicheSpec, blocks, languages);
        activeBlocks = auditRes.pendingBlocks;
        skippedBlocks = auditRes.doneBlocks;
        if (skippedBlocks.length > 0) {
            logCfTerminal(`⏭️ ${campFullName}: ${skippedBlocks.join(', ')} já completo(s) no OneDrive (${languages.map(l => l.toUpperCase()).join('/')}) — pulando sem gastar cota.`, 'warning');
        }
    }

    const allStyleKeys = [];
    if (blocks.includes('Bloco A')) allStyleKeys.push('A1', 'A2', 'A3');
    if (blocks.includes('Bloco B')) allStyleKeys.push('B1', 'B2', 'B3');

    const queueItems = allStyleKeys.map(sk => {
        const blkName = sk.startsWith('B') ? 'Bloco B' : 'Bloco A';
        const isSkipped = skippedBlocks.includes(blkName);
        return {
            key: sk,
            title: `${nicheSpec.slug} • ${STYLE_META_LABELS[sk] || sk}`,
            status: isSkipped ? 'skipped' : 'pending',
            pct: isSkipped ? 100 : 0,
            detail: isSkipped ? '⏭️ Bloco já completo no OneDrive' : 'Na fila...',
        };
    });
    renderCfStyleQueue(queueItems);

    const setStyleItem = (sk, status, pct, detail) => {
        const q = queueItems.find(x => x.key === sk);
        if (q) {
            q.status = status;
            q.pct = pct;
            q.detail = detail;
            renderCfStyleQueue(queueItems);
        }
    };

    if (activeBlocks.length === 0) {
        if (onStage) onStage(1, 1, '⏭️ Já completo no OneDrive');
        return { skippedAll: true, skippedBlocks, plan: null, baseImages: {}, composedBlobs: {} };
    }

    const styleKeys = [];
    if (activeBlocks.includes('Bloco A')) styleKeys.push('A1', 'A2', 'A3');
    if (activeBlocks.includes('Bloco B')) styleKeys.push('B1', 'B2', 'B3');

    const promptPack = cfFactoryState.promptsBySlug[nicheSpec.slug] || {};
    const stylePrompts = {};
    styleKeys.forEach(k => {
        if (promptPack[k]) stylePrompts[k] = promptPack[k];
    });

    const totalStageSteps = styleKeys.length + (activeBlocks.length * languages.length);
    let doneStageSteps = 0;
    if (onStage) onStage(0, totalStageSteps, '🧠 Preparando copys...');
    if (onProgress) onProgress(0.06, `🧠 Preparando copys e prompts (${nicheSpec.slug})...`);
    logCfTerminal(`🧠 ${campFullName}: planejando copys (${languages.map(l => l.toUpperCase()).join(', ')}) para ${activeBlocks.join(' + ')}...`, 'info');

    const planResp = await window.apiFetch('/api/studio/prepare-creative-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            niche: {
                title: nicheSpec.title,
                slug: nicheSpec.slug,
                category: nicheSpec.category,
                audio_script: nicheSpec.audioScript,
                creative_phrases: nicheSpec.creativePhrases || [],
                seo_titles: nicheSpec.seoTitles || [],
                style_prompts: stylePrompts,
            },
            languages,
            gemini_api_key: creds.geminiKey,
        }),
    });
    const planData = await planResp.json();
    if (!planResp.ok || !planData.success) {
        throw new Error(planData.error || 'Erro ao preparar copys e prompts.');
    }
    logCfTerminal(`📝 Plano pronto (${planData.source || 'gemini'}) para ${campFullName}.`, 'info');

    const baseImages = {};
    for (let i = 0; i < styleKeys.length; i++) {
        if (cfFactoryState.stopRequested) throw new Error('Cancelado pelo usuário.');
        const sk = styleKeys[i];
        const frac = 0.1 + (0.58 * (i / Math.max(1, styleKeys.length)));
        setStyleItem(sk, 'running', 35, '⏳ Gerando cena limpa na Cloudflare AI...');
        if (onProgress) onProgress(frac, `🎨 [${i + 1}/${styleKeys.length}] Gerando imagem limpa ${sk} na Cloudflare AI...`);
        logCfTerminal(`🎨 [${i + 1}/${styleKeys.length}] Gerando ${sk} (${STYLE_META_LABELS[sk] || sk}) via ${creds.model}...`, 'info');

        const imgResp = await window.apiFetch('/api/studio/generate-base-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt_en: planData.prompts_en[sk] || `${nicheSpec.title} commercial visual, no text`,
                model: creds.model,
                cloudflare_account_id: creds.accountId,
                cloudflare_api_token: creds.apiToken,
            }),
        });
        const imgData = await imgResp.json();
        if (!imgResp.ok || !imgData.success || !imgData.data_url) {
            const errMsg = imgData.error || `Falha na Cloudflare (${sk})`;
            const isQuota = Boolean(
                imgResp.status === 429 ||
                imgData.quota_exceeded ||
                /cota|limite|429|quota|exceeded|neurons/i.test(errMsg)
            );
            setStyleItem(sk, 'error', 35, isQuota ? '❌ Cota diária atingida' : `❌ ${errMsg.slice(0, 60)}`);
            logCfTerminal(`❌ Erro em ${sk}: ${errMsg}`, isQuota ? 'warning' : 'error');
            const errObj = new Error(errMsg);
            errObj.isQuotaExceeded = isQuota;
            throw errObj;
        }
        baseImages[sk] = imgData.data_url;
        doneStageSteps++;
        setStyleItem(sk, 'running', 65, `🎨 Cena base pronta (${imgData.model}) — compondo Canvas...`);
        logCfTerminal(`✅ Cena base ${sk} recebida (${imgData.model}).`, 'success');
        if (onStage) onStage(doneStageSteps, totalStageSteps, `🎨 Cena ${sk} gerada`);
    }

    if (onProgress) onProgress(0.72, `🖼️ Montando Feed (1..3) e Reels (4..6) em ${languages.map(l => l.toUpperCase()).join(', ')}...`);
    logCfTerminal(`🖼️ Compondo artes 1080×1080 (Feed) e 1080×1920 (Reels) para ${languages.map(l => l.toUpperCase()).join(', ')}...`, 'info');
    const composedBlobs = await composeAllFormatsForNiche(activeBlocks, languages, planData.copy_by_lang, baseImages, (styleKey) => {
        setStyleItem(styleKey, autoUpload ? 'running' : 'done', autoUpload ? 82 : 100, autoUpload ? '🖼️ Canvas pronto — aguardando upload' : '✅ Prévia pronta!');
    });

    if (autoUpload) {
        const totalUploads = activeBlocks.length * languages.length;
        let doneUp = 0;
        for (const blk of activeBlocks) {
            const prefix = blk === 'Bloco B' ? 'B' : 'A';
            for (const lc of languages) {
                doneUp++;
                doneStageSteps++;
                const frac = 0.8 + (0.2 * (doneUp / Math.max(1, totalUploads)));
                if (onProgress) onProgress(frac, `☁️ Salvando ${blk} › ${lc.toUpperCase()} (1..6.png) no OneDrive...`);
                logCfTerminal(`☁️ Enviando ${campFullName} › ${blk} › ${lc.toUpperCase()} (1..6.png) para o OneDrive...`, 'info');
                await uploadComposedBlockLangToOneDrive(nicheSpec.slug, nicheSpec.dateIso, blk, lc, composedBlobs);
                if (onStage) onStage(doneStageSteps, totalStageSteps, `☁️ ${blk} ${lc.toUpperCase()} enviado`);
            }
            ['1', '2', '3'].forEach(n => {
                setStyleItem(`${prefix}${n}`, 'done', 100, `✅ Salvo no OneDrive (${languages.map(l => l.toUpperCase()).join('/')})`);
            });
            logCfTerminal(`✅ ${campFullName} › ${blk} finalizado (pasta '1. Imagens' + 'Português' vazia + idiomas)!`, 'success');
        }
    }

    return { skippedAll: false, skippedBlocks, activeBlocks, plan: planData, baseImages, composedBlobs };
}

async function composeAllFormatsForNiche(blocks, languages, copyByLang, baseImages, onStyleComposed = null) {
    const blobs = {};
    for (const blk of blocks) {
        const prefix = blk === 'Bloco B' ? 'B' : 'A';
        for (let styleIdx = 1; styleIdx <= 3; styleIdx++) {
            const styleKey = `${prefix}${styleIdx}`;
            const baseUrl = baseImages[styleKey];
            for (const lc of languages) {
                const copy = (copyByLang && copyByLang[lc]) || (copyByLang && copyByLang.pt) || {};
                // Slot 1..3 Feed (1080x1080) e Slot 4..6 Reels (1080x1920)
                blobs[`${blk}|${lc}|${styleIdx}`] = await composeCreativeToPngBlob(styleKey, baseUrl, copy, false);
                blobs[`${blk}|${lc}|${styleIdx + 3}`] = await composeCreativeToPngBlob(styleKey, baseUrl, copy, true);
            }
            if (typeof onStyleComposed === 'function') onStyleComposed(styleKey);
        }
    }
    return blobs;
}

function getSelectedBlocksFromUI() {
    const mode = document.getElementById('cf-blocks-select')?.value || 'both';
    if (mode === 'A') return ['Bloco A'];
    if (mode === 'B') return ['Bloco B'];
    return ['Bloco A', 'Bloco B'];
}

function ensureCfCredentialsReady(creds) {
    const hasServerCf = Boolean(window.metaState && window.metaState.hasCloudflare);
    if (hasServerCf) return true;
    if (creds.accountId && creds.apiToken) return true;
    syncStudioCloudflareBanner();
    alert('Informe seu Account ID e API Token da Cloudflare Workers AI (grátis, 10k Neurons/dia) no card ou em Configurações.');
    document.getElementById('studio-cf-account-inline')?.focus();
    return false;
}

async function runCreativeFactorySingle(customNicheSpec = null) {
    if (cfFactoryState.running) return;
    const creds = getCfInlineCredentials();
    if (!ensureCfCredentialsReady(creds)) return;

    let nicheSpec = customNicheSpec;
    if (!nicheSpec) {
        const { niche, dateIso } = (typeof getStudioTargetCampaignAndDate === 'function')
            ? getStudioTargetCampaignAndDate()
            : { niche: '', dateIso: getTodayIsoDate() };
        if (!niche) {
            alert('Informe o Nicho no campo abaixo (ou clique em "🎨 Gerar Imagens" em um item da Semana).');
            document.getElementById('studio-niche-input')?.focus();
            return;
        }
        const weeklyMatch = (typeof weeklyPackState !== 'undefined' && Array.isArray(weeklyPackState.items))
            ? weeklyPackState.items.find(it => it.slug.toLowerCase() === niche.toLowerCase())
            : null;
        const scriptVal = (document.getElementById('studio-tts-script')?.value || '').trim();
        nicheSpec = {
            slug: weeklyMatch ? weeklyMatch.slug : niche,
            title: weeklyMatch ? weeklyMatch.title : niche,
            category: weeklyMatch ? weeklyMatch.category : 'APLICATIVO',
            dateIso: dateIso || (weeklyMatch ? weeklyMatch.dateIso : getTodayIsoDate()),
            audioScript: scriptVal || (weeklyMatch ? weeklyMatch.audioScript : ''),
            creativePhrases: weeklyMatch ? weeklyMatch.creativePhrases : [],
            seoTitles: weeklyMatch ? weeklyMatch.seoTitles : [],
        };
    }

    const blocks = getSelectedBlocksFromUI();
    const languages = getCfSelectedLanguages();
    const autoUpload = Boolean(document.getElementById('cf-auto-upload-check')?.checked);
    const skipExisting = Boolean(document.getElementById('cf-skip-existing-check')?.checked);

    cfFactoryState.running = true;
    cfFactoryState.stopRequested = false;
    toggleCfButtonsState(true);
    setCfTerminalLiveStatus(`Gerando ${nicheSpec.slug}...`);
    logCfTerminal(`🚀 Iniciando geração de criativos para ${nicheSpec.slug} (${blocks.join(' + ')} • ${languages.map(l => l.toUpperCase()).join(', ')})...`, 'info');

    try {
        const res = await generateAllVariantsForNiche(nicheSpec, {
            blocks,
            languages,
            creds,
            autoUpload,
            skipExisting,
            onProgress: (frac, msg) => setCfFactoryProgress(frac * 100, msg),
        });

        if (res.skippedAll) {
            setCfFactoryProgress(100, `⏭️ ${nicheSpec.slug}: todos os blocos selecionados já estavam prontos no OneDrive.`);
            setCfTerminalLiveStatus('Concluído (já pronto)');
            return;
        }

        const generatedBlocks = res.activeBlocks || blocks;
        cfFactoryState.preview = {
            slug: nicheSpec.slug,
            title: nicheSpec.title,
            dateIso: nicheSpec.dateIso,
            plan: res.plan,
            baseImages: res.baseImages,
            activeLang: languages[0] || 'pt',
            activeBlock: generatedBlocks[0] || 'Bloco A',
            composedBlobs: res.composedBlobs,
        };

        setCfFactoryProgress(
            100,
            autoUpload
                ? `✅ ${nicheSpec.slug} concluído e salvo no OneDrive (${generatedBlocks.length * languages.length * 6} imagens)!`
                : `✅ Prévia pronta! Revise abaixo e clique em "☁️ Salvar no OneDrive".`
        );
        setCfTerminalLiveStatus('Concluído');
        renderCfPreviewGrid();

        if (autoUpload && typeof loadStudioCampaigns === 'function') {
            await loadStudioCampaigns();
        }
    } catch (err) {
        setCfFactoryProgress(0, `❌ ${err.message}`);
        setCfTerminalLiveStatus(err.isQuotaExceeded ? 'Cota diária atingida' : 'Erro');
        alert(err.isQuotaExceeded
            ? `Cota diária da Cloudflare Workers AI atingida (10k Neurons/dia). O que já foi concluído foi salvo no OneDrive. Retome após as 21:00 (BRT) — o sistema pula automaticamente o que já está pronto!\n\nDetalhe: ${err.message}`
            : `Erro ao gerar criativos: ${err.message}`);
    } finally {
        cfFactoryState.running = false;
        toggleCfButtonsState(false);
    }
}

async function runCreativeFactoryWeeklyBatch() {
    if (cfFactoryState.running) return;
    const creds = getCfInlineCredentials();
    if (!ensureCfCredentialsReady(creds)) return;

    const targets = (typeof weeklyPackState !== 'undefined' && Array.isArray(weeklyPackState.items))
        ? weeklyPackState.items.filter(it => it.selected)
        : [];
    if (targets.length === 0) {
        alert('Suba o PDF da Semana acima e marque os nichos desejados para gerar em lote.');
        return;
    }

    const blocks = getSelectedBlocksFromUI();
    const languages = getCfSelectedLanguages();
    const skipExisting = Boolean(document.getElementById('cf-skip-existing-check')?.checked);

    cfFactoryState.running = true;
    cfFactoryState.stopRequested = false;
    toggleCfButtonsState(true);
    setCfTerminalLiveStatus(`Lote Semana (0/${targets.length})`);
    logCfTerminal(`🚀 Lote da Semana iniciado: ${targets.length} nicho(s) • Blocos: ${blocks.join(' + ')} • Modelo: ${creds.model} • Pular prontos: ${skipExisting ? 'SIM' : 'NÃO'}.`, 'info');

    let ok = 0;
    let skippedCnt = 0;
    let errCnt = 0;
    let quotaStopped = false;
    try {
        for (let i = 0; i < targets.length; i++) {
            if (cfFactoryState.stopRequested) {
                logCfTerminal('⏹️ Lote interrompido manualmente pelo usuário.', 'warning');
                break;
            }
            const item = targets[i];
            const basePct = (i / targets.length);
            const span = (1 / targets.length);
            setCfTerminalLiveStatus(`Nicho ${i + 1}/${targets.length}: ${item.slug}`);

            item.imgStatus = 'running';
            item.imgProgressTotal = 1;
            item.imgProgressDone = 0;
            item.imgProgressLabel = 'Verificando OneDrive...';
            if (typeof renderWeeklyPdfPreview === 'function') renderWeeklyPdfPreview();

            try {
                const res = await generateAllVariantsForNiche(item, {
                    blocks,
                    languages,
                    creds,
                    autoUpload: true,
                    skipExisting,
                    onStage: (done, total, lbl) => {
                        item.imgProgressDone = done;
                        item.imgProgressTotal = Math.max(1, total);
                        item.imgProgressLabel = lbl;
                        if (typeof renderWeeklyPdfPreview === 'function') renderWeeklyPdfPreview();
                    },
                    onProgress: (frac, msg) => {
                        setCfFactoryProgress((basePct + frac * span) * 100, `[Nicho ${i + 1}/${targets.length}] ${msg}`);
                    },
                });

                if (res.skippedAll) {
                    skippedCnt++;
                    item.imgStatus = 'skipped';
                    item.imgProgressDone = 1;
                    item.imgProgressTotal = 1;
                    item.imgProgressLabel = `⏭️ Já completo no OneDrive (${(res.skippedBlocks || blocks).join(' + ')})`;
                } else {
                    ok++;
                    item.imgStatus = 'done';
                    item.imgProgressDone = item.imgProgressTotal;
                    item.imgProgressLabel = `✅ Imagens salvas (${(res.activeBlocks || blocks).join(' + ')})`;
                    cfFactoryState.preview = {
                        slug: item.slug,
                        title: item.title,
                        dateIso: item.dateIso,
                        plan: res.plan,
                        baseImages: res.baseImages,
                        activeLang: languages[0] || 'pt',
                        activeBlock: (res.activeBlocks && res.activeBlocks[0]) || blocks[0] || 'Bloco A',
                        composedBlobs: res.composedBlobs,
                    };
                    renderCfPreviewGrid();
                }
                if (typeof saveWeeklyPackToStorage === 'function') saveWeeklyPackToStorage();
                if (typeof renderWeeklyPdfPreview === 'function') renderWeeklyPdfPreview();
            } catch (err) {
                errCnt++;
                item.imgStatus = 'error';
                item.imgProgressLabel = err.isQuotaExceeded ? '⏸️ Cota diária Cloudflare atingida' : `❌ ${err.message}`;
                if (typeof renderWeeklyPdfPreview === 'function') renderWeeklyPdfPreview();
                console.warn(`Erro no nicho ${item.slug}:`, err);
                if (err.isQuotaExceeded) {
                    quotaStopped = true;
                    logCfTerminal(
                        `⏸️ Cota diária da Cloudflare (10k Neurons/dia) atingida! ${ok} nicho(s) gerados hoje + ${skippedCnt} já estavam prontos no OneDrive. Rode novamente após as 21:00 (BRT) — o restante continuará de onde parou!`,
                        'warning'
                    );
                    break;
                }
            }
        }

        const summaryText = quotaStopped
            ? `⏸️ Pausa automática por cota diária: ${ok} gerado(s), ${skippedCnt} já pronto(s). Retome após 21:00 BRT para finalizar o restante.`
            : `🎉 Semana concluída: ${ok} gerado(s)${skippedCnt ? ` • ⏭️ ${skippedCnt} já pronto(s)` : ''}${errCnt ? ` • ⚠️ ${errCnt} erro(s)` : ''}.`;
        setCfFactoryProgress(quotaStopped ? Math.round(((ok + skippedCnt) / targets.length) * 100) : 100, summaryText);
        setCfTerminalLiveStatus(quotaStopped ? 'Pausado (cota diária)' : 'Concluído');
        logCfTerminal(summaryText, quotaStopped ? 'warning' : 'success');
        if (typeof loadStudioCampaigns === 'function') await loadStudioCampaigns();
    } finally {
        cfFactoryState.running = false;
        cfFactoryState.stopRequested = false;
        toggleCfButtonsState(false);
    }
}

function stopCreativeFactoryBatch() {
    if (!cfFactoryState.running) return;
    cfFactoryState.stopRequested = true;
}

function toggleCfButtonsState(isRunning) {
    const b1 = document.getElementById('btn-cf-gen-single');
    const b2 = document.getElementById('btn-cf-gen-week');
    const bStop = document.getElementById('btn-cf-gen-stop');
    if (b1) b1.disabled = isRunning;
    if (b2) b2.disabled = isRunning;
    if (bStop) bStop.classList.toggle('twod-hidden', !isRunning);
}

async function regenerateSingleCfBaseStyle(styleKey) {
    if (cfFactoryState.running || !cfFactoryState.preview.plan) return;
    const creds = getCfInlineCredentials();
    if (!ensureCfCredentialsReady(creds)) return;

    cfFactoryState.running = true;
    toggleCfButtonsState(true);
    try {
        setCfFactoryProgress(35, `🔄 Regerando imagem base ${styleKey} na Cloudflare...`);
        const pv = cfFactoryState.preview;
        const promptEn = (pv.plan.prompts_en && pv.plan.prompts_en[styleKey]) || `${pv.title}, no text`;
        const imgResp = await window.apiFetch('/api/studio/generate-base-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt_en: promptEn,
                model: creds.model,
                cloudflare_account_id: creds.accountId,
                cloudflare_api_token: creds.apiToken,
            }),
        });
        const imgData = await imgResp.json();
        if (!imgResp.ok || !imgData.success) throw new Error(imgData.error || 'Erro ao regerar imagem');

        pv.baseImages[styleKey] = imgData.data_url;
        const blocks = ['Bloco A', 'Bloco B'].filter(b => {
            const p = b === 'Bloco A' ? 'A' : 'B';
            return pv.baseImages[`${p}1`] || pv.baseImages[`${p}2`] || pv.baseImages[`${p}3`];
        });
        const langs = Object.keys(pv.plan.copy_by_lang || { pt: {} });
        pv.composedBlobs = await composeAllFormatsForNiche(blocks, langs, pv.plan.copy_by_lang, pv.baseImages);
        setCfFactoryProgress(100, `✅ Estilo ${styleKey} regerado e recomposicionado!`);
        renderCfPreviewGrid();
    } catch (err) {
        alert(`Erro ao regerar ${styleKey}: ${err.message}`);
    } finally {
        cfFactoryState.running = false;
        toggleCfButtonsState(false);
    }
}

async function uploadCurrentPreviewToOneDrive() {
    const pv = cfFactoryState.preview;
    if (!pv.slug || !pv.composedBlobs || Object.keys(pv.composedBlobs).length === 0) {
        alert('Gere primeiro os criativos para salvar no OneDrive.');
        return;
    }
    if (cfFactoryState.running) return;
    cfFactoryState.running = true;
    toggleCfButtonsState(true);
    try {
        const combos = new Set(Object.keys(pv.composedBlobs).map(k => k.split('|').slice(0, 2).join('|')));
        let done = 0;
        for (const pair of combos) {
            const [blk, lc] = pair.split('|');
            done++;
            setCfFactoryProgress((done / combos.size) * 100, `☁️ Salvando ${blk} › ${lc.toUpperCase()} no OneDrive...`);
            await uploadComposedBlockLangToOneDrive(pv.slug, pv.dateIso, blk, lc, pv.composedBlobs);
        }
        setCfFactoryProgress(100, `✅ Todas as imagens de ${pv.slug} salvas no OneDrive!`);
        if (typeof loadStudioCampaigns === 'function') await loadStudioCampaigns();
    } catch (err) {
        alert(`Erro ao enviar para o OneDrive: ${err.message}`);
    } finally {
        cfFactoryState.running = false;
        toggleCfButtonsState(false);
    }
}

function setCfPreviewFilter(block, lang) {
    if (block) cfFactoryState.preview.activeBlock = block;
    if (lang) cfFactoryState.preview.activeLang = lang;
    renderCfPreviewGrid();
}

let _cfActivePreviewUrls = [];

function renderCfPreviewGrid() {
    const wrap = document.getElementById('cf-preview-wrap');
    const grid = document.getElementById('cf-preview-grid');
    const titleEl = document.getElementById('cf-preview-title');
    const tabsEl = document.getElementById('cf-preview-tabs');
    if (!wrap || !grid) return;

    while (_cfActivePreviewUrls.length) {
        try { URL.revokeObjectURL(_cfActivePreviewUrls.pop()); } catch (e) { }
    }

    const pv = cfFactoryState.preview;
    const keys = Object.keys(pv.composedBlobs || {});
    if (keys.length === 0) {
        wrap.classList.add('twod-hidden');
        grid.innerHTML = '';
        return;
    }

    wrap.classList.remove('twod-hidden');
    if (titleEl) {
        titleEl.textContent = `Prévia: ${pv.slug} (${typeof formatStudioDateShort === 'function' ? formatStudioDateShort(pv.dateIso) : pv.dateIso})`;
    }

    const availBlocks = ['Bloco A', 'Bloco B'].filter(b => keys.some(k => k.startsWith(`${b}|`)));
    if (!availBlocks.includes(pv.activeBlock) && availBlocks.length) pv.activeBlock = availBlocks[0];
    const availLangs = Array.from(new Set(keys.map(k => k.split('|')[1])));
    if (!availLangs.includes(pv.activeLang) && availLangs.length) pv.activeLang = availLangs[0];

    if (tabsEl) {
        const bBtns = availBlocks.map(b =>
            `<button type="button" class="btn btn-sm ${b === pv.activeBlock ? 'btn-primary' : 'btn-outline'}" onclick="setCfPreviewFilter('${b}', null)">${b}</button>`
        ).join('');
        const lBtns = availLangs.map(l =>
            `<button type="button" class="btn btn-sm ${l === pv.activeLang ? 'btn-secondary' : 'btn-outline'}" onclick="setCfPreviewFilter(null, '${l}')">${l.toUpperCase()}</button>`
        ).join('');
        tabsEl.innerHTML = `<div style="display:flex; gap:6px; flex-wrap:wrap;">${bBtns} <span style="opacity:.4;">|</span> ${lBtns}</div>`;
    }

    const prefix = pv.activeBlock === 'Bloco B' ? 'B' : 'A';
    const cards = [];
    for (let slot = 1; slot <= 6; slot++) {
        const blob = pv.composedBlobs[`${pv.activeBlock}|${pv.activeLang}|${slot}`];
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        _cfActivePreviewUrls.push(url);
        const styleNum = slot <= 3 ? slot : slot - 3;
        const styleKey = `${prefix}${styleNum}`;
        const fmtLabel = slot <= 3 ? 'Feed 1:1' : 'Reels 9:16';
        cards.push(`
            <div class="cf-preview-card">
                <div class="cf-preview-card-head">
                    <span><strong>${slot}.png</strong> • Estilo ${styleNum} (${fmtLabel})</span>
                    ${slot <= 3 ? `<button type="button" class="btn btn-outline btn-sm" style="padding:2px 6px; font-size:10.5px;" onclick="regenerateSingleCfBaseStyle('${styleKey}')" title="Gerar nova foto/ilustração base na Cloudflare">🔄 Regerar IA</button>` : ''}
                </div>
                <img src="${url}" alt="${slot}.png" class="${slot > 3 ? 'is-reels' : ''}">
            </div>
        `);
    }
    grid.innerHTML = cards.join('');
}

async function runCreativeFactoryForWeeklyIndex(idx) {
    const item = (typeof weeklyPackState !== 'undefined' && Array.isArray(weeklyPackState.items))
        ? weeklyPackState.items[idx]
        : null;
    if (!item) return;

    if (cfFactoryState.collapsed) {
        toggleCreativeFactoryCard();
    }
    const card = document.getElementById('cf-creative-factory-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    await runCreativeFactorySingle({
        slug: item.slug,
        title: item.title,
        category: item.category || 'APLICATIVO',
        dateIso: item.dateIso,
        audioScript: item.audioScript || '',
        creativePhrases: item.creativePhrases || [],
        seoTitles: item.seoTitles || [],
    });
}

window.initCreativeFactoryUI = initCreativeFactoryUI;
window.toggleCreativeFactoryCard = toggleCreativeFactoryCard;
window.syncStudioCloudflareBanner = syncStudioCloudflareBanner;
window.refreshCfTargetSummary = refreshCfTargetSummary;
window.handleCreativePromptPdfSelected = handleCreativePromptPdfSelected;
window.runCreativeFactorySingle = runCreativeFactorySingle;
window.runCreativeFactoryForWeeklyIndex = runCreativeFactoryForWeeklyIndex;
window.runCreativeFactoryWeeklyBatch = runCreativeFactoryWeeklyBatch;
window.stopCreativeFactoryBatch = stopCreativeFactoryBatch;
window.regenerateSingleCfBaseStyle = regenerateSingleCfBaseStyle;
window.uploadCurrentPreviewToOneDrive = uploadCurrentPreviewToOneDrive;
window.setCfPreviewFilter = setCfPreviewFilter;
window.clearCfLog = clearCfLog;
window.logCfTerminal = logCfTerminal;
window.twodCreativePdfParser = {
    parseCreativePromptPdfPagesData,
    extractPromptCardText,
};
window.twodCreativeAuditHelper = {
    auditAndFilterPendingBlocks,
};
