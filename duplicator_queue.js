// ========================================================
// FILA DE TAREFAS INTELIGENTE (.DOCX / GOOGLE DOCS) - DUPLICADOR
// ========================================================

const DUP_QUEUE_STORAGE_KEY = 'twod_dup_queue_v1';

const dupQueueState = {
    tasks: [],
    sites: [],
    activeTaskId: '',
    hideDone: true,
    siteFilter: 'all',
    searchQuery: '',
    sourceLabel: '',
    collapsed: false,
    preparing: false
};

function _dqEsc(str) {
    if (typeof window.escHtml === 'function') return window.escHtml(str);
    return String(str || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _dqNorm(str) {
    if (typeof normalizeText === 'function') return normalizeText(str || '');
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function parseRgbFromCssColor(colorStr) {
    const raw = String(colorStr || '').trim().toLowerCase();
    if (!raw) return null;
    const hexM = raw.match(/^#([0-9a-f]{6})$/);
    if (hexM) {
        const h = hexM[1];
        return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
    }
    const shortM = raw.match(/^#([0-9a-f]{3})$/);
    if (shortM) {
        const h = shortM[1];
        return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
    }
    const rgbM = raw.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (rgbM) {
        return { r: parseInt(rgbM[1], 10), g: parseInt(rgbM[2], 10), b: parseInt(rgbM[3], 10) };
    }
    return null;
}

function isCssColorGreen(colorStr) {
    const rgb = parseRgbFromCssColor(colorStr);
    if (!rgb) return false;
    return rgb.g >= 65 && rgb.g >= rgb.r + 18 && rgb.g >= rgb.b + 12;
}

function isCssColorOrange(colorStr) {
    const rgb = parseRgbFromCssColor(colorStr);
    if (!rgb) return false;
    return rgb.r >= 180 && rgb.g >= 65 && rgb.g <= 200 && rgb.b <= 90 && rgb.r > rgb.g + 30;
}

function extractParagraphsFromGoogleDocsHtml(htmlStr) {
    if (!htmlStr || typeof DOMParser === 'undefined') return [];
    const doc = new DOMParser().parseFromString(htmlStr, 'text/html');
    const blocks = doc.querySelectorAll('p, li, h1, h2, h3, h4, div');
    const seen = new Set();
    const out = [];

    const checkNodeColors = (rootEl) => {
        let isGreen = false;
        let isOrange = false;
        const nodes = [rootEl, ...rootEl.querySelectorAll('span, font, b, strong, em, a, u, s, strike')];
        nodes.forEach(n => {
            const c = n.style?.color || n.getAttribute?.('color') || '';
            const bg = n.style?.backgroundColor || '';
            const txtDec = n.style?.textDecoration || n.style?.textDecorationLine || '';
            const tag = (n.tagName || '').toUpperCase();
            if (isCssColorGreen(c) || isCssColorGreen(bg) || tag === 'S' || tag === 'STRIKE' || txtDec.includes('line-through')) {
                isGreen = true;
            }
            if (isCssColorOrange(c)) {
                isOrange = true;
            }
        });
        return { isGreen, isOrange };
    };

    if (blocks.length > 0) {
        blocks.forEach(el => {
            // Ignora containers que encapsulam outros <p>/<li>
            if (el.querySelector('p, li, div')) return;
            const txt = (el.textContent || '').replace(/\u00a0/g, ' ').trim();
            if (!txt) return;
            const key = `${out.length}:${txt}`;
            if (seen.has(key)) return;
            seen.add(key);
            const { isGreen, isOrange } = checkNodeColors(el);
            out.push({ text: txt, is_green: isGreen, is_orange: isOrange });
        });
    }

    if (out.length === 0) {
        const plain = (doc.body?.textContent || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        return plain.map(text => ({ text, is_green: false, is_orange: false }));
    }
    return out;
}

const KNOWN_QUEUE_COUNTRY_REFS = [
    { key: 'eua_ing', patterns: ['eua ing', 'estados unidos ing', 'us ing'], label: 'EUA (Inglês)', searchAccountSet: 'estados unidos', blockId: null, countryName: 'EUA' },
    { key: 'eua_esp', patterns: ['eua esp', 'eua ing/esp', 'estados unidos esp'], label: 'EUA (Espanhol)', searchAccountSet: 'estados unidos', blockId: null, countryName: 'EUA' },
    { key: 'eua', patterns: ['eua', 'estados unidos', 'usa'], label: 'EUA', searchAccountSet: 'estados unidos', blockId: null, countryName: 'EUA' },
    { key: 'brasil', patterns: ['brasil', 'brazil'], label: 'Brasil', searchAccountSet: 'brasil', blockId: null, countryName: 'Brasil' },
    { key: 'espanha', patterns: ['espanha', 'spain'], label: 'Espanha', blockId: 'BLOCO-01', countryName: 'Espanha' },
    { key: 'polonia', patterns: ['polonia', 'poland'], label: 'Polônia', blockId: 'BLOCO-02', countryName: 'Polônia' },
    { key: 'reino_unido', patterns: ['reino unido', 'uk', 'united kingdom'], label: 'Reino Unido', blockId: 'BLOCO-06', countryName: 'Reino Unido' },
    { key: 'australia', patterns: ['australia'], label: 'Austrália', blockId: 'BLOCO-06', countryName: 'Austrália' },
    { key: 'canada', patterns: ['canada'], label: 'Canadá', blockId: 'BLOCO-03', countryName: 'Canadá' },
    { key: 'franca', patterns: ['franca', 'france'], label: 'França', blockId: 'BLOCO-03', countryName: 'França' },
    { key: 'italia', patterns: ['italia', 'italy'], label: 'Itália', blockId: 'BLOCO-02', countryName: 'Itália' },
    { key: 'alemanha', patterns: ['alemanha', 'germany'], label: 'Alemanha', blockId: 'BLOCO-02', countryName: 'Alemanha' },
    { key: 'suica', patterns: ['suica', 'switzerland'], label: 'Suíça', blockId: 'BLOCO-02', countryName: 'Suíça' }
];

function parseDupTaskActionSpec(rawAction) {
    const raw = String(rawAction || '').trim();
    const norm = _dqNorm(raw);

    const hasBloco = /\bbloco\b/.test(norm);

    let countriesCount = 0;
    const countMatch = norm.match(/\b(\d+)\s*paises\b|\b(\d+)\s*pais\b/);
    if (countMatch) {
        countriesCount = parseInt(countMatch[1] || countMatch[2], 10) || 0;
    } else if (/^\s*paises\s*$/i.test(norm) || /(?:^|[,;\-\s])paises(?=$|[,;])/.test(norm)) {
        countriesCount = 5;
    }

    let reactivate = null;
    const reactMatch = norm.match(/\breativar\s+(\d+|todos)\b/);
    if (reactMatch) {
        reactivate = {
            count: reactMatch[1] === 'todos' ? 'all' : (parseInt(reactMatch[1], 10) || 10),
            label: reactMatch[1] === 'todos' ? 'Todos pausados' : `${reactMatch[1]} conjuntos`
        };
    }

    const extraCopies = [];
    const segments = raw.split(/[,;]+|\be\b(?=\s*\d+\s*c[oó]pia)/i).map(s => s.trim()).filter(Boolean);
    segments.forEach(seg => {
        const sNorm = _dqNorm(seg);
        const cpM = sNorm.match(/(\d+)\s*copias?\b(.*)/);
        if (!cpM) return;
        const copyCount = parseInt(cpM[1], 10) || 1;
        const restNorm = cpM[2] || sNorm;
        const matchedCountries = [];
        KNOWN_QUEUE_COUNTRY_REFS.forEach(ref => {
            if (ref.key === 'eua' && (matchedCountries.some(c => c.key === 'eua_ing' || c.key === 'eua_esp'))) return;
            if (ref.patterns.some(pat => new RegExp(`\\b${pat}\\b`, 'i').test(restNorm))) {
                matchedCountries.push(ref);
            }
        });
        const utmMatches = seg.match(/utm[\s\-_]*\d+(?:\s*(?:e|,)\s*\d+)?/gi) || [];
        const activeCountriesFlag = /cada pais ativo|paises na utm|dos paises/.test(restNorm);
        extraCopies.push({
            raw: seg,
            count: copyCount,
            countries: matchedCountries,
            utms: utmMatches.map(u => u.toUpperCase()),
            activeCountriesFlag
        });
    });

    const badges = [];
    if (hasBloco) badges.push({ kind: 'bloco', text: '📦 Bloco' });
    if (countriesCount > 0) badges.push({ kind: 'countries', text: `🌍 ${countriesCount} países` });
    extraCopies.forEach(ec => {
        const cTxt = ec.countries.length ? ec.countries.map(c => c.label).join(' + ') : (ec.activeCountriesFlag ? 'Países ativos/UTM' : 'Cópia');
        const uTxt = ec.utms.length ? ` (${ec.utms.join(', ')})` : '';
        badges.push({ kind: 'copies', text: `📑 ${ec.count}x ${cTxt}${uTxt}` });
    });
    if (reactivate) badges.push({ kind: 'reactivate', text: `▶️ Reativar ${reactivate.label}` });

    return { hasBloco, countriesCount, extraCopies, reactivate, badges };
}

function normalizeSiteKey(siteName) {
    const n = _dqNorm(siteName).replace(/\s+/g, '');
    if (!n) return 'geral';
    if (n.includes('twodcompany')) return n.includes('blog') ? 'blog.twodcompany' : 'twodcompany';
    if (n.includes('app.simplificando')) return 'app.simplificando';
    if (n.includes('hub.simplificando')) return 'hub.simplificando';
    if (n.includes('ai.simplificando')) return 'ai.simplificando';
    if (n.includes('kiuvix')) return 'kiuvix';
    if (n.includes('blingalax')) return 'blog.blingalax';
    return n;
}

function isLikelySiteHeaderLine(txt, pObj) {
    const clean = String(txt || '').trim();
    if (!clean) return false;
    if (/^\d{2,7}\s+\d{1,3}\s*[-–—:]/.test(clean)) return false;
    if (pObj?.is_orange) return true;
    const norm = _dqNorm(clean);
    if (/^(ai|app|hub|blog)\.[a-z0-9.-]+$/i.test(clean)) return true;
    if (/^(twodcompany|kiuvix|blingalax|simplificando|f4rol|kiocom|thehatsune)(\s|$)/i.test(norm) && !/\d/.test(norm)) return true;
    return false;
}

function parseDupQueueParagraphs(paragraphs, sourceLabel = '') {
    let currentSite = 'Geral';
    let currentSiteKey = 'geral';
    const sitesSet = new Set();
    const tasks = [];

    (paragraphs || []).forEach((pObj, idx) => {
        const text = String(pObj?.text || '').trim();
        if (!text) return;

        if (isLikelySiteHeaderLine(text, pObj)) {
            currentSite = text;
            currentSiteKey = normalizeSiteKey(text);
            sitesSet.add(currentSite);
            return;
        }

        const taskM = text.match(/^\s*(\d{2,7})\s+(\d{1,3})\s*[-–—:]\s*(.+)$/);
        if (!taskM) return;

        const postId = taskM[1];
        const accountNum = parseInt(taskM[2], 10);
        const rawAction = taskM[3].trim();
        const actionSpec = parseDupTaskActionSpec(rawAction);
        const done = Boolean(pObj?.is_green);

        sitesSet.add(currentSite);
        tasks.push({
            id: `dq_${idx}_${postId}_${accountNum}`,
            site: currentSite,
            siteKey: currentSiteKey,
            postId,
            accountNum,
            accountNumPad: String(accountNum).padStart(2, '0'),
            rawText: text,
            rawAction,
            actionSpec,
            done,
            autoGreen: done,
            orderIdx: tasks.length
        });
    });

    return {
        tasks,
        sites: Array.from(sitesSet),
        sourceLabel: sourceLabel || 'Lista importada'
    };
}

function saveDupQueueState() {
    try {
        localStorage.setItem(DUP_QUEUE_STORAGE_KEY, JSON.stringify({
            tasks: dupQueueState.tasks,
            sites: dupQueueState.sites,
            activeTaskId: dupQueueState.activeTaskId,
            hideDone: dupQueueState.hideDone,
            siteFilter: dupQueueState.siteFilter,
            sourceLabel: dupQueueState.sourceLabel
        }));
    } catch (_) { }
}

function loadDupQueueState() {
    try {
        const raw = localStorage.getItem(DUP_QUEUE_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.tasks)) {
            dupQueueState.tasks = parsed.tasks;
            dupQueueState.sites = Array.isArray(parsed.sites) ? parsed.sites : [];
            dupQueueState.activeTaskId = parsed.activeTaskId || '';
            dupQueueState.hideDone = parsed.hideDone !== false;
            dupQueueState.siteFilter = parsed.siteFilter || 'all';
            dupQueueState.sourceLabel = parsed.sourceLabel || '';
        }
    } catch (_) { }
}

function getSiteSearchTokens(siteKey) {
    const k = normalizeSiteKey(siteKey);
    if (k === 'blog.twodcompany') return { required: ['blog', 'twod'], fallback: ['twodcompany', 'twod'], exclude: [] };
    if (k === 'twodcompany') return { required: ['twodcompany'], fallback: ['twod'], exclude: ['blog'] };
    if (k === 'app.simplificando') return { required: ['app', 'simplificando'], fallback: ['app'], exclude: [] };
    if (k === 'hub.simplificando') return { required: ['hub', 'simplificando'], fallback: ['hub'], exclude: [] };
    if (k === 'ai.simplificando') return { required: ['ai', 'simplificando'], fallback: ['simplificando'], exclude: [] };
    if (k === 'kiuvix') return { required: ['kiuvix'], fallback: [], exclude: [] };
    if (k === 'blog.blingalax') return { required: ['blingalax'], fallback: ['bling'], exclude: [] };
    return { required: [_dqNorm(k).split('.')[0]], fallback: [], exclude: [] };
}

function findMetaAccountForQueueTask(task, accountsList = null) {
    const accounts = Array.isArray(accountsList) ? accountsList : (metaState?.accounts || []);
    if (!task || accounts.length === 0) return null;

    const numInt = String(task.accountNum);
    const numPad = task.accountNumPad || String(task.accountNum).padStart(2, '0');
    const tokens = getSiteSearchTokens(task.siteKey || task.site);
    const numRe = new RegExp(`(?:^|[-_\\s#])0?${numInt}(?:$|[-_\\s\\]])`);

    let best = null;
    let bestScore = -1;

    accounts.forEach(acc => {
        const normName = _dqNorm(acc?.name || '');
        if (!normName) return;
        const hasNum = numRe.test(normName) || normName.includes(`-${numPad}`) || normName.endsWith(numPad);
        if (!hasNum) return;

        let score = 0;
        if (tokens.required.every(t => normName.includes(t))) {
            score += 100;
        } else if (tokens.fallback.length > 0 && tokens.fallback.some(t => normName.includes(t))) {
            score += 45;
        } else {
            return;
        }

        if (tokens.exclude.some(ex => normName.includes(ex))) {
            score -= 60;
        }
        if (acc.account_status === 1) score += 20;
        if (normName.includes(`-${numPad}`) || normName.includes(` ${numPad}`)) score += 10;

        if (score > bestScore) {
            bestScore = score;
            best = acc;
        }
    });

    return bestScore >= 40 ? best : null;
}

function setDupQueueStatusMsg(msg, tone = 'info') {
    const el = document.getElementById('dup-queue-status');
    if (!el) return;
    if (!msg) {
        el.classList.add('twod-hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('twod-hidden');
    const palette = {
        info: { bg: 'rgba(59,130,246,0.12)', bd: 'rgba(59,130,246,0.35)', fg: '#93c5fd' },
        success: { bg: 'rgba(16,185,129,0.12)', bd: 'rgba(16,185,129,0.35)', fg: '#34d399' },
        warn: { bg: 'rgba(245,158,11,0.12)', bd: 'rgba(245,158,11,0.35)', fg: '#fbbf24' },
        error: { bg: 'rgba(239,68,68,0.12)', bd: 'rgba(239,68,68,0.4)', fg: '#fca5a5' }
    }[tone] || { bg: 'rgba(59,130,246,0.12)', bd: 'rgba(59,130,246,0.35)', fg: '#93c5fd' };
    el.style.cssText = `background:${palette.bg}; border:1px solid ${palette.bd}; color:${palette.fg}; padding:9px 12px; border-radius:8px; font-size:12px; margin-top:10px;`;
    el.innerHTML = msg;
}

function applyParsedQueueResult(parsed, resetFilters = true) {
    dupQueueState.tasks = parsed.tasks || [];
    dupQueueState.sites = parsed.sites || [];
    dupQueueState.sourceLabel = parsed.sourceLabel || '';
    dupQueueState.activeTaskId = '';
    if (resetFilters) {
        dupQueueState.siteFilter = 'all';
    }
    saveDupQueueState();
    populateDupQueueSiteFilter();
    renderDupQueueList();

    const total = dupQueueState.tasks.length;
    const doneN = dupQueueState.tasks.filter(t => t.done).length;
    const pendingN = total - doneN;
    if (total === 0) {
        setDupQueueStatusMsg('⚠️ Nenhuma linha no formato <code>PostID Conta - tarefa</code> foi encontrada. Ex: <code>24572 1 - 5 países</code>.', 'warn');
    } else {
        setDupQueueStatusMsg(`✅ Fila carregada (${_dqEsc(dupQueueState.sourceLabel)}): <strong>${pendingN} pendente(s)</strong> e <strong>${doneN} já feito(s) em verde</strong>.`, 'success');
    }
}

function populateDupQueueSiteFilter() {
    const sel = document.getElementById('dup-queue-site-filter');
    if (!sel) return;
    const prev = dupQueueState.siteFilter || 'all';
    const uniqSites = Array.from(new Set((dupQueueState.tasks || []).map(t => t.site).filter(Boolean)));
    sel.innerHTML = '<option value="all">Todos os Sites (' + uniqSites.length + ')</option>';
    uniqSites.forEach(s => {
        const count = dupQueueState.tasks.filter(t => t.site === s && !t.done).length;
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = `${s} (${count} pend.)`;
        sel.appendChild(opt);
    });
    if (prev !== 'all' && uniqSites.includes(prev)) {
        sel.value = prev;
    } else {
        dupQueueState.siteFilter = 'all';
        sel.value = 'all';
    }
}

function renderDupQueueList() {
    const listEl = document.getElementById('dup-queue-list');
    const summaryEl = document.getElementById('dup-queue-summary-pills');
    const bodyWrap = document.getElementById('dup-queue-loaded-wrap');
    if (!listEl) return;

    const allTasks = dupQueueState.tasks || [];
    if (allTasks.length === 0) {
        if (bodyWrap) bodyWrap.classList.add('twod-hidden');
        listEl.innerHTML = '';
        if (summaryEl) summaryEl.innerHTML = '<span class="studio-mini-badge muted">Nenhuma lista carregada</span>';
        return;
    }

    if (bodyWrap) bodyWrap.classList.remove('twod-hidden');

    const hideDoneChk = document.getElementById('dup-queue-hide-done');
    if (hideDoneChk) hideDoneChk.checked = dupQueueState.hideDone;

    const total = allTasks.length;
    const doneCount = allTasks.filter(t => t.done).length;
    const pendingCount = total - doneCount;

    if (summaryEl) {
        summaryEl.innerHTML = `
            <span class="studio-mini-badge warn">⏳ ${pendingCount} pendente(s)</span>
            <span class="studio-mini-badge ok">✅ ${doneCount} concluído(s)</span>
        `;
    }

    const qNorm = _dqNorm(dupQueueState.searchQuery || '');
    const filtered = allTasks.filter(t => {
        if (dupQueueState.hideDone && t.done) return false;
        if (dupQueueState.siteFilter !== 'all' && t.site !== dupQueueState.siteFilter) return false;
        if (qNorm) {
            const hay = _dqNorm(`${t.site} ${t.postId} ${t.accountNumPad} ${t.rawAction}`);
            if (!hay.includes(qNorm)) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="text-muted" style="font-size:12px; padding:12px;">Nenhum item visível com os filtros atuais (desmarque "Ocultar verdes" se quiser rever os concluídos).</div>';
        return;
    }

    listEl.innerHTML = filtered.map(task => {
        const matchedAcc = findMetaAccountForQueueTask(task);
        const isActive = dupQueueState.activeTaskId === task.id;
        const accBadge = matchedAcc
            ? `<span class="studio-mini-badge ok" title="${_dqEsc(matchedAcc.name)} (${_dqEsc(matchedAcc.id)})">🟢 ${_dqEsc(matchedAcc.name)}</span>`
            : `<span class="studio-mini-badge muted" title="Esta conta/BM não apareceu no token atual da Meta API">⚠️ BM/Conta #${_dqEsc(task.accountNumPad)} não conectada</span>`;
        const badgesHtml = (task.actionSpec?.badges || []).map(b =>
            `<span class="dup-queue-chip is-${_dqEsc(b.kind)}">${_dqEsc(b.text)}</span>`
        ).join('');

        return `
            <div class="dup-queue-row ${task.done ? 'is-done' : ''} ${isActive ? 'is-active' : ''}" id="dup-queue-row-${_dqEsc(task.id)}">
                <label class="dup-queue-done-chk" title="${task.done ? 'Marcado como concluído (verde)' : 'Marcar como feito'}">
                    <input type="checkbox" ${task.done ? 'checked' : ''} onchange="toggleDupQueueTaskDone('${_dqEsc(task.id)}', this.checked)">
                </label>
                <div class="dup-queue-main">
                    <div class="dup-queue-top">
                        <span class="dup-queue-site-pill">${_dqEsc(task.site)}</span>
                        <strong class="dup-queue-postid">Post ${_dqEsc(task.postId)}</strong>
                        <span class="dup-queue-acc-num">Conta ${_dqEsc(task.accountNumPad)}</span>
                        ${accBadge}
                    </div>
                    <div class="dup-queue-action-txt">${_dqEsc(task.rawAction)}</div>
                    <div class="dup-queue-chips">${badgesHtml}</div>
                </div>
                <div class="dup-queue-actions">
                    <button type="button" class="btn ${isActive ? 'btn-secondary' : 'btn-primary'} btn-sm" ${dupQueueState.preparing ? 'disabled' : ''} onclick="prepareDupQueueTask('${_dqEsc(task.id)}')">
                        ${isActive ? '⚡ Recarregar' : '⚡ Preparar'}
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function toggleDupQueueCard() {
    const body = document.getElementById('dup-queue-body');
    const btn = document.getElementById('btn-dup-queue-toggle');
    if (!body) return;
    dupQueueState.collapsed = !dupQueueState.collapsed;
    body.classList.toggle('twod-hidden', dupQueueState.collapsed);
    if (btn) btn.textContent = dupQueueState.collapsed ? 'Expandir' : 'Recolher';
}

function toggleDupQueueHideDone(val) {
    dupQueueState.hideDone = Boolean(val);
    saveDupQueueState();
    renderDupQueueList();
}

function onDupQueueSiteFilterChanged(val) {
    dupQueueState.siteFilter = val || 'all';
    renderDupQueueList();
}

function onDupQueueSearchInput(val) {
    dupQueueState.searchQuery = val || '';
    renderDupQueueList();
}

function toggleDupQueueTaskDone(taskId, isDone) {
    const t = (dupQueueState.tasks || []).find(x => x.id === taskId);
    if (!t) return;
    t.done = Boolean(isDone);
    saveDupQueueState();
    populateDupQueueSiteFilter();
    renderDupQueueList();
    if (dupQueueState.activeTaskId === taskId) {
        renderActiveQueueBanner(t, null);
    }
}

function clearDupQueue() {
    if ((dupQueueState.tasks || []).length > 0 && !confirm('Limpar a fila de campanhas carregada?')) return;
    dupQueueState.tasks = [];
    dupQueueState.sites = [];
    dupQueueState.activeTaskId = '';
    dupQueueState.sourceLabel = '';
    try { localStorage.removeItem(DUP_QUEUE_STORAGE_KEY); } catch (_) { }
    const pasteEl = document.getElementById('dup-queue-paste-box');
    if (pasteEl) pasteEl.value = '';
    const banner = document.getElementById('dup-queue-active-banner');
    if (banner) banner.classList.add('twod-hidden');
    setDupQueueStatusMsg('');
    populateDupQueueSiteFilter();
    renderDupQueueList();
}

async function handleDupQueueDocxUpload(fileList) {
    const file = Array.from(fileList || []).find(f => /\.docx$/i.test(f.name));
    if (!file) {
        alert('Selecione um arquivo .docx exportado do Google Docs ou Word.');
        return;
    }
    setDupQueueStatusMsg(`⏳ Lendo <strong>${_dqEsc(file.name)}</strong> e detectando linhas verdes (já feitas)...`, 'info');
    try {
        const resp = await apiFetch('/api/duplicator/parse-docx', {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: file
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            throw new Error(data.error || `Erro HTTP ${resp.status}`);
        }
        const parsed = parseDupQueueParagraphs(data.paragraphs || [], file.name);
        applyParsedQueueResult(parsed, true);
    } catch (e) {
        setDupQueueStatusMsg(`❌ Erro ao ler .docx: ${_dqEsc(e.message)}`, 'error');
    }
}

function handleDupQueuePasteFromClipboard(e) {
    const html = e?.clipboardData?.getData ? e.clipboardData.getData('text/html') : '';
    const plain = e?.clipboardData?.getData ? e.clipboardData.getData('text/plain') : '';
    if (!html && !plain) return;

    if (html) {
        e.preventDefault();
        const pasteEl = document.getElementById('dup-queue-paste-box');
        if (pasteEl) pasteEl.value = plain || '';
        const paragraphs = extractParagraphsFromGoogleDocsHtml(html);
        const parsed = parseDupQueueParagraphs(paragraphs, 'Colado do Google Docs');
        if (parsed.tasks.length > 0) {
            applyParsedQueueResult(parsed, true);
            return;
        }
    }
}

function loadDupQueueFromPasteBox() {
    const pasteEl = document.getElementById('dup-queue-paste-box');
    const txt = (pasteEl?.value || '').trim();
    if (!txt) {
        alert('Cole o texto do Google Docs ou suba um arquivo .docx primeiro.');
        return;
    }
    const paragraphs = txt.split(/\r?\n/).map(line => ({ text: line.trim(), is_green: false, is_orange: false })).filter(p => p.text);
    const parsed = parseDupQueueParagraphs(paragraphs, 'Texto colado');
    applyParsedQueueResult(parsed, true);
}

// ========================================================
// PREPARAÇÃO INTELIGENTE NA CAMPANHA ("PRÉ-PRONTO")
// ========================================================

function selectBestBlockForTask(campaignId, adsetObj) {
    const blockIds = Object.keys(META_COUNTRY_BLOCKS).filter(id => id !== 'BLOCO-OBS');
    let bestReadyIncomplete = null;
    let firstIncomplete = null;
    const summaryRows = [];

    blockIds.forEach(bId => {
        const stats = getBlockStats(bId);
        const crStats = getBlockCreativeSummary(bId);
        const hasCreative = crStats.status === 'ok' || crStats.status === 'partial';
        summaryRows.push({
            blockId: bId,
            title: META_COUNTRY_BLOCKS[bId].title,
            existing: stats.existing,
            total: stats.total,
            missing: stats.missing,
            isComplete: stats.isComplete,
            hasCreative,
            creativeStatus: crStats.status
        });
        if (!stats.isComplete) {
            if (!firstIncomplete) firstIncomplete = bId;
            if (!bestReadyIncomplete && hasCreative) bestReadyIncomplete = bId;
        }
    });

    const chosenBlock = bestReadyIncomplete || firstIncomplete || 'BLOCO-01';
    metaState.checkedCountries = {};
    metaState.expandedBlocks = {};
    selectCountryBlock(chosenBlock);
    if (typeof selectMissingCountriesOnly === 'function') {
        selectMissingCountriesOnly(chosenBlock);
    }
    return { chosenBlock, summaryRows };
}

function rankAndSelectNCountries(targetCount, campaignId, adsetObj) {
    const candidates = [];
    const blockIds = Object.keys(META_COUNTRY_BLOCKS).filter(id => id !== 'BLOCO-OBS');

    blockIds.forEach((bId, bIdx) => {
        const blk = META_COUNTRY_BLOCKS[bId];
        (blk.countries || []).forEach((country, cIdx) => {
            if (findExistingAdSetForCountry(country)) return;
            const cLang = (country.langCode || (blk.langCode && blk.langCode !== 'multi' ? blk.langCode : 'es')).toLowerCase();
            const crReady = Boolean(isCreativeReadyForLang(campaignId, adsetObj, cLang)?.ready);
            const isPriority = Boolean(country.priority);
            const score = (crReady ? 1000 : 0) + (isPriority ? 200 : 0) - bIdx * 10 - cIdx;
            candidates.push({
                blockId: bId,
                blockTitle: blk.title,
                country,
                lang: cLang,
                crReady,
                isPriority,
                score
            });
        });
    });

    candidates.sort((a, b) => b.score - a.score);
    const picked = candidates.slice(0, Math.max(1, targetCount));

    if (picked.length === 0) {
        return { chosenBlock: 'BLOCO-01', picked: [], inBlockNames: [], reason: 'Todos os países dos blocos já estão criados nesta campanha!' };
    }

    const chosenBlock = picked[0].blockId;
    metaState.checkedCountries = {};
    metaState.expandedBlocks = {};

    picked.forEach(p => {
        if (!metaState.checkedCountries[p.blockId]) metaState.checkedCountries[p.blockId] = {};
        metaState.checkedCountries[p.blockId][p.country.adSetName] = true;
        metaState.expandedBlocks[p.blockId] = true;
    });

    metaState.activeBlockId = chosenBlock;
    if (typeof renderBlockNav === 'function') renderBlockNav();
    if (typeof updateBlockCounter === 'function') updateBlockCounter();
    else if (typeof updateDuplicatorLanguageNotice === 'function') updateDuplicatorLanguageNotice();

    const touchedBlocks = [...new Set(picked.map(p => p.blockId))];
    const readyCount = picked.filter(p => p.crReady).length;
    const prioCount = picked.filter(p => p.isPriority).length;
    const blockSummary = touchedBlocks.length === 1
        ? (META_COUNTRY_BLOCKS[chosenBlock]?.title || chosenBlock)
        : `${touchedBlocks.length} blocos (${touchedBlocks.map(b => b.replace('BLOCO-', 'B')).join(' + ')})`;
    const reason = `${picked.length} país(es) marcado(s) em ${blockSummary}` +
        (readyCount > 0 ? ` • ${readyCount} com idioma/criativo pronto` : '') +
        (prioCount > 0 ? ` • ${prioCount} prioritário(s) ⭐` : '');

    return {
        chosenBlock,
        picked,
        inBlockNames: picked.map(p => p.country.adSetName),
        reason
    };
}

function jumpQueueCountryReference(blockId, countryName) {
    if (blockId && META_COUNTRY_BLOCKS[blockId]) {
        metaState.checkedCountries = {};
        if (!metaState.expandedBlocks) metaState.expandedBlocks = {};
        metaState.expandedBlocks[blockId] = true;
        metaState.activeBlockId = blockId;
        const blk = META_COUNTRY_BLOCKS[blockId];
        metaState.checkedCountries[blockId] = {};
        (blk.countries || []).forEach(c => {
            metaState.checkedCountries[blockId][c.adSetName] = _dqNorm(c.adSetName) === _dqNorm(countryName);
        });
        if (typeof renderBlockNav === 'function') renderBlockNav();
        if (typeof updateBlockCounter === 'function') updateBlockCounter();
        document.querySelector(`.block-acc-item[data-block="${blockId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        alert(`"${countryName}" é um conjunto mestre/especial (ex.: EUA ou Brasil) fora da grade de blocos — selecione o conjunto "${countryName}" no Conjunto Base ou duplique direto no Gerenciador com a UTM indicada.`);
    }
}

async function reactivatePausedAdSetsFromQueue(limitCount) {
    if (!hasActiveMetaAuth() || !metaState.selectedCampaignId) {
        alert('Selecione uma campanha primeiro.');
        return;
    }
    const paused = (metaState.adsets || []).filter(a => a.status === 'PAUSED');
    if (paused.length === 0) {
        alert('Nenhum conjunto PAUSED encontrado nesta campanha.');
        return;
    }
    const count = limitCount === 'all' ? paused.length : Math.min(paused.length, Number(limitCount) || 10);
    const targets = paused.slice(0, count);
    const previewNames = targets.map(a => `• ${a.name}`).join('\n');
    if (!confirm(`Reativar ${targets.length} conjunto(s) PAUSED para ACTIVE na campanha?\n\n${previewNames}`)) {
        return;
    }
    let ok = 0;
    let fail = 0;
    for (const adset of targets) {
        try {
            const res = await metaGraphPost(`/${META_GRAPH_VERSION}/${adset.id}`, { status: 'ACTIVE' });
            if (res && !res.error) {
                adset.status = 'ACTIVE';
                ok++;
            } else {
                fail++;
            }
        } catch (_) {
            fail++;
        }
    }
    renderBlockNav();
    renderCountriesGrid();
    const t = (dupQueueState.tasks || []).find(x => x.id === dupQueueState.activeTaskId);
    if (t) renderActiveQueueBanner(t, { reactivateResult: `▶️ Reativados: ${ok} OK${fail ? ` • ⚠️ ${fail} falha(s)` : ''}` });
    alert(`Reativação concluída: ${ok} conjunto(s) ligados em ACTIVE${fail ? `, ${fail} erro(s)` : ''}.`);
}

function renderActiveQueueBanner(task, prepMeta = null) {
    const banner = document.getElementById('dup-queue-active-banner');
    if (!banner || !task) return;
    banner.classList.remove('twod-hidden');

    const blockSummaryHtml = (prepMeta?.blockSummary || []).map(b => {
        const cls = b.isComplete ? 'ok' : (b.hasCreative ? 'ready' : 'muted');
        const icon = b.isComplete ? '✅' : (b.hasCreative ? '🎬' : '⏳');
        const active = b.blockId === metaState.activeBlockId ? 'is-current' : '';
        return `<button type="button" class="dup-queue-block-pill is-${cls} ${active}" onclick="selectCountryBlock('${_dqEsc(b.blockId)}')" title="Ir para ${_dqEsc(b.title)}">${icon} ${_dqEsc(b.blockId.replace('BLOCO-', 'B'))}: ${b.existing}/${b.total}</button>`;
    }).join('');

    const copiesBtns = (task.actionSpec?.extraCopies || []).flatMap(ec =>
        (ec.countries || []).map(c =>
            `<button type="button" class="btn-chip" onclick="jumpQueueCountryReference('${_dqEsc(c.blockId || '')}', '${_dqEsc(c.countryName)}')">📑 ${_dqEsc(ec.count)}x ${_dqEsc(c.label)}${ec.utms?.length ? ` (${_dqEsc(ec.utms.join(', '))})` : ''}</button>`
        )
    ).join('');

    const pausedCount = (metaState.adsets || []).filter(a => a.status === 'PAUSED').length;
    const reactivateBtn = task.actionSpec?.reactivate
        ? `<button type="button" class="btn-chip btn-chip-primary" onclick="reactivatePausedAdSetsFromQueue('${_dqEsc(String(task.actionSpec.reactivate.count))}')">▶️ Reativar ${task.actionSpec.reactivate.count === 'all' ? `Todos (${pausedCount})` : `${task.actionSpec.reactivate.count} de ${pausedCount}`} Pausado(s)</button>`
        : '';

    const reasonLine = prepMeta?.reasonText
        ? `<div style="margin-top:6px; font-size:12px; color:#bfdbfe;">${_dqEsc(prepMeta.reasonText)}</div>`
        : '';
    const reactResLine = prepMeta?.reactivateResult
        ? `<div style="margin-top:6px; font-size:12px; color:#34d399; font-weight:600;">${_dqEsc(prepMeta.reactivateResult)}</div>`
        : '';

    banner.innerHTML = `
        <div class="dup-queue-banner-head">
            <div>
                <span class="dup-queue-site-pill">${_dqEsc(task.site)}</span>
                <strong>Tarefa Ativa: Post ${_dqEsc(task.postId)} (Conta ${_dqEsc(task.accountNumPad)})</strong>
                <span style="color:#cbd5e1;"> — ${_dqEsc(task.rawAction)}</span>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <button type="button" class="btn btn-sm ${task.done ? 'btn-secondary' : 'btn-primary'}" onclick="toggleDupQueueTaskDone('${_dqEsc(task.id)}', ${!task.done})">
                    ${task.done ? '✅ Concluído (Desfazer)' : '✅ Marcar como Feito'}
                </button>
                <button type="button" class="btn-chip" onclick="document.getElementById('dup-queue-active-banner').classList.add('twod-hidden')">✕</button>
            </div>
        </div>
        ${reasonLine}
        ${reactResLine}
        ${blockSummaryHtml ? `<div class="dup-queue-block-pills">${blockSummaryHtml}</div>` : ''}
        ${(copiesBtns || reactivateBtn) ? `<div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">${copiesBtns}${reactivateBtn}</div>` : ''}
    `;
}

async function findAndSelectCampaignByPostId(accountId, postId, accountNum) {
    const campRegex = new RegExp(`(?:^|[^0-9])${postId}(?:$|[^0-9])`);
    const findInList = (list) => {
        const matches = (list || []).filter(c => campRegex.test(c?.name || ''));
        if (matches.length === 0) return null;
        matches.sort((a, b) => (a.status === 'ACTIVE' ? -1 : 1) - (b.status === 'ACTIVE' ? -1 : 1));
        return matches[0];
    };

    let targetCamp = findInList(metaState.campaigns || []);
    if (!targetCamp && accountId) {
        const filtering = JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: String(postId) }]);
        const data = await metaGraphGet(`/${META_GRAPH_VERSION}/${accountId}/campaigns?fields=id,name,status,objective&filtering=${encodeURIComponent(filtering)}&limit=50`);
        const remoteList = Array.isArray(data?.data) ? data.data : [];
        if (remoteList.length > 0) {
            const existingIds = new Set((metaState.campaigns || []).map(c => c.id));
            remoteList.forEach(rc => { if (!existingIds.has(rc.id)) metaState.campaigns.push(rc); });
            targetCamp = findInList(remoteList);
        }
    }

    if (!targetCamp) return null;

    const searchInput = document.getElementById('search-meta-campaign');
    const selectCamp = document.getElementById('select-meta-campaign');
    if (searchInput) searchInput.value = String(postId);
    renderMetaCampaignOptions([targetCamp, ...(metaState.campaigns || []).filter(c => c.id !== targetCamp.id && campRegex.test(c.name || ''))], false);
    if (selectCamp) {
        selectCamp.value = targetCamp.id;
    }
    await onMetaCampaignSelected();
    return targetCamp;
}

async function prepareDupQueueTask(taskId) {
    if (dupQueueState.preparing) return;
    const task = (dupQueueState.tasks || []).find(t => t.id === taskId);
    if (!task) return;

    if (!hasActiveMetaAuth()) {
        alert('Conecte o token da Meta antes de preparar uma tarefa da fila.');
        return;
    }

    const matchedAcc = findMetaAccountForQueueTask(task);
    if (!matchedAcc) {
        setDupQueueStatusMsg(
            `⚠️ Conta <strong>#${_dqEsc(task.accountNumPad)} (${_dqEsc(task.site)})</strong> não encontrada nas contas conectadas ao token atual (${(metaState.accounts || []).length} contas carregadas). Conecte a BM correspondente ou atribua os ativos ao Usuário do Sistema.`,
            'warn'
        );
        return;
    }

    dupQueueState.preparing = true;
    dupQueueState.activeTaskId = taskId;
    saveDupQueueState();
    renderDupQueueList();
    setDupQueueStatusMsg(`⏳ Preparando <strong>${_dqEsc(task.site)} • Conta ${_dqEsc(task.accountNumPad)} • Post ${_dqEsc(task.postId)}</strong>...`, 'info');

    try {
        const selectAcc = document.getElementById('select-meta-account');
        if (selectAcc && selectAcc.value !== matchedAcc.id) {
            selectAcc.value = matchedAcc.id;
            await onMetaAccountSelected();
        } else if (!metaState.campaigns || metaState.campaigns.length === 0) {
            await onMetaAccountSelected();
        }

        const camp = await findAndSelectCampaignByPostId(matchedAcc.id, task.postId, task.accountNum);
        if (!camp) {
            setDupQueueStatusMsg(
                `❌ Campanha com Post ID <strong>${_dqEsc(task.postId)}</strong> não encontrada na conta <strong>${_dqEsc(matchedAcc.name)}</strong>.`,
                'error'
            );
            return;
        }

        try {
            if (typeof ensureLinkedPackHydrated === 'function') {
                await ensureLinkedPackHydrated(camp.id, false);
            }
        } catch (_) { }

        const spec = task.actionSpec || {};
        let reasonText = `Campanha "${camp.name}" carregada (${(metaState.adsets || []).length} conjunto(s)).`;
        let blockSummary = [];

        if (spec.hasBloco) {
            const bRes = selectBestBlockForTask(camp.id, metaState.selectedAdSet);
            blockSummary = bRes.summaryRows;
            const blkTitle = META_COUNTRY_BLOCKS[bRes.chosenBlock]?.title || bRes.chosenBlock;
            const bStats = getBlockStats(bRes.chosenBlock);
            reasonText = `Bloco pendente selecionado: ${blkTitle} (${bStats.missing} país(es) faltante(s) marcado(s)).`;
        } else if (spec.countriesCount > 0) {
            const pRes = rankAndSelectNCountries(spec.countriesCount, camp.id, metaState.selectedAdSet);
            reasonText = pRes.reason;
            blockSummary = Object.keys(META_COUNTRY_BLOCKS).filter(id => id !== 'BLOCO-OBS').map(bId => {
                const st = getBlockStats(bId);
                const cr = getBlockCreativeSummary(bId);
                return { blockId: bId, title: META_COUNTRY_BLOCKS[bId].title, existing: st.existing, total: st.total, missing: st.missing, isComplete: st.isComplete, hasCreative: cr.status !== 'pending' };
            });
        }

        renderActiveQueueBanner(task, { reasonText, blockSummary });
        setDupQueueStatusMsg(`✅ Pré-pronto: <strong>${_dqEsc(camp.name)}</strong> — ${_dqEsc(reasonText)}`, 'success');

        document.getElementById('dup-queue-active-banner')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
        setDupQueueStatusMsg(`❌ Erro ao preparar Post ${_dqEsc(task.postId)}: ${_dqEsc(e.message)}`, 'error');
    } finally {
        dupQueueState.preparing = false;
        renderDupQueueList();
    }
}

function initDupQueueModule() {
    loadDupQueueState();
    populateDupQueueSiteFilter();
    renderDupQueueList();
    const pasteEl = document.getElementById('dup-queue-paste-box');
    if (pasteEl && !pasteEl.dataset.pasteBound) {
        pasteEl.dataset.pasteBound = '1';
        pasteEl.addEventListener('paste', handleDupQueuePasteFromClipboard);
    }
}

window.toggleDupQueueCard = toggleDupQueueCard;
window.handleDupQueueDocxUpload = handleDupQueueDocxUpload;
window.loadDupQueueFromPasteBox = loadDupQueueFromPasteBox;
window.toggleDupQueueHideDone = toggleDupQueueHideDone;
window.onDupQueueSiteFilterChanged = onDupQueueSiteFilterChanged;
window.onDupQueueSearchInput = onDupQueueSearchInput;
window.toggleDupQueueTaskDone = toggleDupQueueTaskDone;
window.clearDupQueue = clearDupQueue;
window.prepareDupQueueTask = prepareDupQueueTask;
window.jumpQueueCountryReference = jumpQueueCountryReference;
window.reactivatePausedAdSetsFromQueue = reactivatePausedAdSetsFromQueue;
window.renderDupQueueList = renderDupQueueList;
window.parseDupQueueParagraphs = parseDupQueueParagraphs;
window.extractParagraphsFromGoogleDocsHtml = extractParagraphsFromGoogleDocsHtml;
window.findMetaAccountForQueueTask = findMetaAccountForQueueTask;
window.rankAndSelectNCountries = rankAndSelectNCountries;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDupQueueModule);
} else {
    initDupQueueModule();
}
