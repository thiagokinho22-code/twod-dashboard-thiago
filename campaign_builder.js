// ========================================================
// TWOD HUB - GERADOR PADRÃO DE CAMPANHAS META ADS
// Integrado com OneDrive Nuvem 24/7 + Meta Marketing API
// ========================================================

const TRANSLATEX_LANGS = new Set([
    'ro', 'ar', 'no', 'iw', 'vi', 'ko', 'bg', 'cs', 'hr', 'th', 'lt', 'uk', 'fi', 'hi', 'hu',
    'bn', 'sk', 'sl', 'id', 'en', 'fr', 'es', 'de', 'it', 'nl', 'ru', 'pt', 'ja', 'tr', 'pl',
    'sv', 'da', 'zh-CN', 'zh-TW', 'el', 'tl', 'ms', 'et', 'ca', 'lv', 'ur', 'sr', 'fa', 'sw',
    'sq', 'hy', 'is', 'bs', 'lb', 'af'
]);

const ONEDRIVE_LANG_ALIASES = {
    pt: ['PT', 'PORTUGUES', 'PROTUGUES', 'PT-BR', 'BRASIL', 'PORTUGAL', 'BR'],
    es: ['ES', 'ESPANHOL', 'SPANISH', 'CHILE', 'ARGENTINA', 'COLOMBIA', 'MEXICO', 'PERU', 'BOLIVIA'],
    en: ['EN', 'INGLES', 'ENGLISH', 'ESTADOS UNIDOS', 'REINO UNIDO', 'AUSTRALIA', 'NOVA ZELANDIA', 'CANADA', 'IRLANDA', 'AFRICA DO SUL', 'JAMAICA', 'NIGERIA', 'BOTSUANA', 'EMIRADOS ARABES UNIDOS', 'GUIANA'],
    fr: ['FR', 'FRANCES', 'FRENCH', 'FRANCA', 'CANADA'],
    de: ['DE', 'ALEMAO', 'GERMAN'],
    it: ['IT', 'ITALIANO', 'ITALIA', 'ITALIAN'],
    nl: ['NL', 'HOLANDES', 'DUTCH'],
    ru: ['RU', 'RUSSO', 'RUSSIAN'],
    ar: ['AR', 'ARABE', 'ARABIC'],
    ro: ['RO', 'ROMENO', 'ROMENIA', 'ROMANIAN'],
    hu: ['HU', 'HUNGARO', 'HUNGRIA', 'HUNGARIAN'],
    cs: ['CS', 'TCHECO', 'REPUBLICA TCHECA', 'CZECH'],
    sk: ['SK', 'ESLOVACO', 'ESLOVAQUIA', 'SLOVAK'],
    hi: ['HI', 'HINDI', 'INDIA'],
    id: ['ID', 'INDONESIO', 'INDONESIA', 'INDONESIAN'],
    ur: ['UR', 'URDU'],
    pl: ['PL', 'POLONES', 'POLONIA', 'POLISH'],
    uk: ['UK', 'UCRANIANO', 'UCRANIA', 'UKRAINIAN'],
    tl: ['TL', 'FILIPINO', 'TAGALOG'],
    sr: ['SR', 'SERVIO', 'SERVIA', 'SERBIAN'],
    bn: ['BN', 'BENGALI', 'BANGLADESH'],
    ja: ['JA', 'JAPONES', 'JAPAO', 'JAPANESE'],
    'zh-cn': ['ZH-CN', 'CHINES', 'CHINESE'],
    ko: ['KO', 'COREANO', 'KOREAN'],
    bg: ['BG', 'BULGARO', 'BULGARIA', 'BULGARIAN'],
    hr: ['HR', 'CROATA', 'CROACIA', 'CROATIAN'],
    da: ['DA', 'DINAMARQUES', 'DINAMARCA', 'DANISH'],
    el: ['EL', 'GREGO', 'GRECIA', 'GREEK'],
    tr: ['TR', 'TURCO', 'TURKISH']
};

let cbState = {
    selectedAccountId: '',
    selectedAccount: null,
    bmId: '',
    bmName: '',
    pages: [],
    selectedPageIds: new Set(),
    pixels: [],
    customConversions: [],
    campaigns: [],
    selectedNicheName: '',
    selectedNicheObj: null,
    selectedSlots: new Set([1, 2, 3, 4, 5, 6]),
    selectedCountries: [
        { adSetName: 'Brasil', code: 'BR', langCode: 'pt', langName: 'PORTUGUÊS', useSpanishAll: false }
    ],
    calibratedModel: null,
    spanishLocaleIds: null,
    isLaunching: false,
    translationCache: {}
};

// ========================================================
// SINCRONIZAÇÃO COM APP PRINCIPAL & STATUS META
// ========================================================

window.onCampaignBuilderTabOpened = function () {
    const token = getMetaToken();
    if (!token) {
        toggleCampaignBuilderTokenBox(true);
    }
    const authorInput = document.getElementById('cb-author');
    if (authorInput && !authorInput.value && typeof currentUser !== 'undefined' && currentUser && currentUser.name) {
        authorInput.value = currentUser.name.split(' ')[0];
    }
    window.onCampaignBuilderMetaStatus(!!metaState.user, null, metaState.user);
    window.onCampaignBuilderAccountsReady();
    window.onCampaignBuilderNichesReady();
    renderBuilderCountriesGrid();
    updateCampaignNamePreview();
    updateUrlPreview();
};

window.onCampaignBuilderMetaStatus = function (isSuccess, errorMessage, userData) {
    const nameEl = document.getElementById('cb-user-name');
    const badgeEl = document.getElementById('cb-api-badge');
    const subEl = document.getElementById('cb-user-sub');

    if (isSuccess && userData) {
        if (nameEl) nameEl.innerText = userData.name;
        if (badgeEl) {
            badgeEl.className = 'badge-status status-active';
            badgeEl.innerText = `🟢 Meta API ${META_GRAPH_VERSION} Online`;
        }
        if (subEl) subEl.innerText = `ID: ${userData.id} • Conectado para criação de campanhas, pixels e páginas por BM.`;
        toggleCampaignBuilderTokenBox(false);
    } else {
        if (nameEl) nameEl.innerText = 'Gerador de Campanhas Padrão TwoD';
        if (badgeEl) {
            badgeEl.className = 'badge-status status-pending';
            badgeEl.innerText = '🔴 Sem Token Ativo';
        }
        if (subEl) {
            subEl.innerHTML = `⚠️ ${errorMessage || 'Nenhum token configurado.'} <a href="javascript:void(0)" onclick="toggleCampaignBuilderTokenBox(true)" style="color: var(--accent-primary); text-decoration: underline; font-weight: 600; margin-left: 6px;">Conectar Token aqui →</a>`;
        }
    }
};

function toggleCampaignBuilderTokenBox(forceState) {
    const box = document.getElementById('cb-token-box');
    const input = document.getElementById('cb-token-input');
    if (!box) return;

    const shouldShow = (typeof forceState === 'boolean') ? forceState : box.classList.contains('twod-hidden');
    if (shouldShow) {
        box.classList.remove('twod-hidden');
        if (input) input.value = metaState.token || '';
    } else {
        box.classList.add('twod-hidden');
    }
}

window.onCampaignBuilderAccountsReady = function () {
    const select = document.getElementById('cb-account-select');
    if (!select) return;

    const prev = select.value || cbState.selectedAccountId || metaState.selectedAccountId || metaState.defaultAccountId;
    select.innerHTML = '';

    if (!metaState.accounts || metaState.accounts.length === 0) {
        select.innerHTML = '<option value="">Conecte seu Token Meta acima...</option>';
        return;
    }

    const ph = document.createElement('option');
    ph.value = '';
    ph.innerText = 'Selecione uma conta de anúncios...';
    select.appendChild(ph);

    metaState.accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id;
        const statusIcon = acc.account_status === 1 ? '🟢' : '⏸️';
        const bmLabel = acc.business && acc.business.name ? ` • BM: ${acc.business.name}` : '';
        opt.innerText = `${statusIcon} ${acc.name || acc.id}${bmLabel} [${acc.currency || 'USD'}]`;
        select.appendChild(opt);
    });

    if (prev && metaState.accounts.some(a => a.id === prev)) {
        select.value = prev;
        if (cbState.selectedAccountId !== prev) {
            onCampaignBuilderAccountChanged();
        }
    }
};

window.onCampaignBuilderNichesReady = function () {
    const datalist = document.getElementById('cb-niche-datalist');
    const countLabel = document.getElementById('cb-niche-count-label');
    if (!datalist) return;

    const niches = oneDriveData.niches || [];
    datalist.innerHTML = '';
    niches.forEach(n => {
        const opt = document.createElement('option');
        opt.value = n.name;
        datalist.appendChild(opt);
    });

    if (countLabel) {
        countLabel.innerText = niches.length > 0
            ? `(${niches.length} nichos carregados)`
            : '(Aguardando conexão do OneDrive...)';
    }
};

// ========================================================
// PASSO 1: CONTA, PIXELS, PÁGINAS DA BM & LEITOR MODELO
// ========================================================

async function onCampaignBuilderAccountChanged() {
    const select = document.getElementById('cb-account-select');
    if (!select) return;

    const accountId = select.value;
    cbState.selectedAccountId = accountId;
    cbState.selectedAccount = (metaState.accounts || []).find(a => a.id === accountId) || null;
    cbState.bmId = cbState.selectedAccount?.business?.id || '';
    cbState.bmName = cbState.selectedAccount?.business?.name || '';
    cbState.calibratedModel = null;
    cbState.customConversions = [];

    const bmBadge = document.getElementById('cb-bm-badge');
    if (bmBadge) {
        bmBadge.innerText = cbState.bmName ? `(BM: ${cbState.bmName})` : '';
    }

    const accountCodeInput = document.getElementById('cb-account-code');
    if (accountCodeInput && cbState.selectedAccount?.name) {
        accountCodeInput.value = cbState.selectedAccount.name.trim();
        updateCampaignNamePreview();
    }

    const inspectorBox = document.getElementById('cb-model-inspector-box');
    if (inspectorBox) inspectorBox.classList.add('twod-hidden');

    if (!accountId) return;

    await Promise.all([
        loadBuilderPixels(accountId),
        loadBuilderCustomConversions(accountId),
        loadBuilderPagesForBM(accountId, cbState.bmId),
        loadBuilderModelCampaigns(accountId)
    ]);
}

function extractSiteKeywordFromAccountName(accName = '') {
    const cleaned = accName.toUpperCase().replace(/[^A-Z0-9-]+/g, '');
    const parts = cleaned.split('-').filter(Boolean);
    if (parts.length >= 2) return parts[1];
    return cleaned.replace(/[0-9]/g, '');
}

async function loadBuilderPixels(accountId) {
    const token = getMetaToken();
    const select = document.getElementById('cb-pixel-select');
    const countEl = document.getElementById('cb-pixel-count');
    if (!select || !token) return;

    select.innerHTML = '<option value="">Carregando pixels...</option>';
    try {
        const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/adspixels?access_token=${encodeURIComponent(token)}&fields=id,name`);
        const data = await resp.json();
        const pixels = Array.isArray(data.data) ? data.data : [];
        cbState.pixels = pixels;

        select.innerHTML = '';
        if (pixels.length === 0) {
            select.innerHTML = '<option value="">Nenhum pixel encontrado nesta conta</option>';
            if (countEl) countEl.innerText = '(0 pixels)';
            return;
        }

        const siteKey = extractSiteKeywordFromAccountName(cbState.selectedAccount?.name || '');
        let matchedId = pixels[0].id;

        pixels.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.innerText = `${p.name} (${p.id})`;
            select.appendChild(opt);

            if (siteKey && (p.name || '').toUpperCase().replace(/\s+/g, '').includes(siteKey)) {
                matchedId = p.id;
            }
        });

        select.value = matchedId;
        if (countEl) countEl.innerText = `(${pixels.length} disponíveis)`;
    } catch (e) {
        select.innerHTML = '<option value="">Erro ao buscar pixels</option>';
    }
}

async function loadBuilderCustomConversions(accountId) {
    const token = getMetaToken();
    if (!token || !accountId) return;
    try {
        const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/customconversions?access_token=${encodeURIComponent(token)}&fields=id,name,custom_event_type,pixel&limit=50`);
        const data = await resp.json();
        cbState.customConversions = Array.isArray(data.data) ? data.data : [];
    } catch (e) {
        cbState.customConversions = [];
    }
}

async function loadBuilderPagesForBM(accountId, bmId) {
    const token = getMetaToken();
    const grid = document.getElementById('cb-pages-grid');
    const metaEl = document.getElementById('cb-pages-meta');
    if (!grid || !token) return;

    grid.innerHTML = '<div class="text-muted" style="font-size: 12px;">Carregando páginas pertencentes a esta BM...</div>';

    try {
        const promoteResp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/promote_pages?access_token=${encodeURIComponent(token)}&fields=id,name,business{id,name}&limit=100`);
        const promoteData = await promoteResp.json();
        let allPages = Array.isArray(promoteData.data) ? promoteData.data : [];

        // Se a conta pertence a uma BM e conseguirmos listar owned_pages/client_pages da BM, filtra estritamente por ela
        let bmOwnedIds = new Set();
        if (bmId) {
            for (const edge of ['owned_pages', 'client_pages']) {
                try {
                    const bmResp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${bmId}/${edge}?access_token=${encodeURIComponent(token)}&fields=id,name&limit=100`);
                    const bmJson = await bmResp.json();
                    if (Array.isArray(bmJson.data)) {
                        bmJson.data.forEach(p => bmOwnedIds.add(p.id));
                    }
                } catch (err) {
                    // Permissão opcional não bloqueia promote_pages
                }
            }
        }

        let filteredPages = allPages;
        if (bmId) {
            const strictMatched = allPages.filter(p => {
                if (p.business && p.business.id) return p.business.id === bmId;
                if (bmOwnedIds.size > 0) return bmOwnedIds.has(p.id);
                return true;
            });
            if (strictMatched.length > 0) filteredPages = strictMatched;
        }

        cbState.pages = filteredPages;
        cbState.selectedPageIds = new Set(filteredPages.map(p => p.id));

        if (metaEl) {
            metaEl.innerText = bmId
                ? `${filteredPages.length} páginas da BM ${cbState.bmName || bmId} selecionadas p/ alternância • IG/Threads usa a página`
                : `${filteredPages.length} páginas da conta • IG/Threads usa a página`;
        }

        renderBuilderPagesGrid();
    } catch (e) {
        grid.innerHTML = '<div class="text-muted" style="font-size: 12px;">Erro ao carregar páginas da conta.</div>';
    }
}

function renderBuilderPagesGrid() {
    const grid = document.getElementById('cb-pages-grid');
    if (!grid) return;

    if (!cbState.pages || cbState.pages.length === 0) {
        grid.innerHTML = '<div class="text-muted" style="font-size: 12px;">Nenhuma página encontrada para esta conta/BM.</div>';
        return;
    }

    grid.innerHTML = '';
    cbState.pages.forEach(page => {
        const selected = cbState.selectedPageIds.has(page.id);
        const label = document.createElement('label');
        label.className = `cb-page-chip ${selected ? 'selected' : ''}`;

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = selected;
        chk.onchange = () => {
            if (chk.checked) cbState.selectedPageIds.add(page.id);
            else cbState.selectedPageIds.delete(page.id);
            label.classList.toggle('selected', chk.checked);
        };

        const info = document.createElement('div');
        info.innerHTML = `<strong>${page.name}</strong><br><span class="text-muted" style="font-size:10px;">ID: ${page.id}</span>`;

        label.appendChild(chk);
        label.appendChild(info);
        grid.appendChild(label);
    });
}

function toggleAllBuilderPages(checked) {
    cbState.selectedPageIds = checked ? new Set(cbState.pages.map(p => p.id)) : new Set();
    renderBuilderPagesGrid();
}

async function loadBuilderModelCampaigns(accountId) {
    const token = getMetaToken();
    const select = document.getElementById('cb-model-campaign-select');
    if (!select || !token) return;

    select.innerHTML = '<option value="">Carregando campanhas da conta...</option>';
    try {
        const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/campaigns?access_token=${encodeURIComponent(token)}&fields=id,name,objective,status&limit=50`);
        const data = await resp.json();
        const camps = Array.isArray(data.data) ? data.data : [];
        cbState.campaigns = camps;

        select.innerHTML = '<option value="">Selecione uma campanha existente p/ espelhar...</option>';
        camps.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = `${c.status === 'ACTIVE' ? '🟢' : '⏸️'} ${c.name}`;
            select.appendChild(opt);
        });
    } catch (e) {
        select.innerHTML = '<option value="">Erro ao carregar campanhas</option>';
    }
}

async function inspectModelCampaign() {
    const token = getMetaToken();
    const campId = document.getElementById('cb-model-campaign-select')?.value;
    const box = document.getElementById('cb-model-inspector-box');
    if (!token || !campId) {
        alert('Selecione uma campanha existente ao lado para ler os parâmetros dela (somente leitura).');
        return;
    }

    if (box) {
        box.classList.remove('twod-hidden');
        box.innerHTML = '⏳ Lendo 1 Conjunto e 1 Anúncio modelo via GET (nenhuma alteração será feita)...';
    }

    try {
        const campResp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${campId}?access_token=${encodeURIComponent(token)}&fields=id,name,objective,buying_type,is_adset_budget_sharing_enabled`);
        const campData = await campResp.json();

        const adsetsResp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${campId}/adsets?access_token=${encodeURIComponent(token)}&fields=id,name,optimization_goal,billing_event,bid_strategy,destination_type,promoted_object,targeting,dsa_beneficiary,dsa_payor,regional_regulated_categories,regional_regulation_identities,daily_budget&limit=1`);
        const adsetsData = await adsetsResp.json();
        const sampleAdSet = (adsetsData.data && adsetsData.data[0]) || null;

        let sampleAd = null;
        let sampleCreative = null;
        if (sampleAdSet) {
            const adsResp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${sampleAdSet.id}/ads?access_token=${encodeURIComponent(token)}&fields=id,name,url_tags,creative{id,object_story_spec,asset_feed_spec,degrees_of_freedom_spec}&limit=1`);
            const adsData = await adsResp.json();
            sampleAd = (adsData.data && adsData.data[0]) || null;
            sampleCreative = sampleAd?.creative || null;
        }

        cbState.calibratedModel = {
            campaign: campData,
            adset: sampleAdSet,
            ad: sampleAd,
            creative: sampleCreative
        };

        if (sampleAdSet?.promoted_object?.pixel_id) {
            const pxSel = document.getElementById('cb-pixel-select');
            if (pxSel && [...pxSel.options].some(o => o.value === sampleAdSet.promoted_object.pixel_id)) {
                pxSel.value = sampleAdSet.promoted_object.pixel_id;
            }
        }
        if (sampleAdSet?.dsa_beneficiary) {
            const advInput = document.getElementById('cb-advertiser-name');
            if (advInput) advInput.value = sampleAdSet.dsa_beneficiary;
        }

        if (box) {
            const po = sampleAdSet?.promoted_object ? JSON.stringify(sampleAdSet.promoted_object) : 'Não detectado';
            const optType = sampleCreative?.asset_feed_spec?.optimization_type || 'STANDARD';
            const regInfo = sampleAdSet?.dsa_beneficiary
                || (sampleAdSet?.regional_regulation_identities?.universal_beneficiary ? `BM ID ${sampleAdSet.regional_regulation_identities.universal_beneficiary}` : 'Não definido na amostra');
            box.innerHTML = `
                <strong>✅ Parâmetros espelhados do modelo:</strong> <code>${campData.name}</code><br>
                • <b>Objective:</b> <code>${campData.objective}</code> |
                <b>Optimization:</b> <code>${sampleAdSet?.optimization_goal || 'VALUE'}</code> |
                <b>Destination:</b> <code>${sampleAdSet?.destination_type || 'WEBSITE'}</code><br>
                • <b>Promoted Object (Pixel/Evento):</b> <code>${po}</code><br>
                • <b>Transparency / DSA:</b> <code>${regInfo}</code> |
                <b>Criativo API:</b> <code>${sampleCreative?.asset_feed_spec ? `video_data + ${optType} (2-3-2)` : 'object_story_spec'}</code>
            `;
        }
    } catch (e) {
        if (box) box.innerHTML = `❌ Falha ao ler modelo: ${e.message}`;
    }
}

// ========================================================
// PASSO 2: NOMENCLATURA & URL LOCALIZADA (TRANSLATEX)
// ========================================================

function sanitizeNicheSlug(name = '') {
    const clean = name
        .replace(/\d{2}\.\d{2}\.\d{2,4}/g, '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .trim();
    return clean
        .split(/\s+/)
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
}

function updateCampaignNamePreview() {
    const postId = (document.getElementById('cb-post-id')?.value || '').trim() || 'PostID';
    const nicheSlug = (document.getElementById('cb-niche-slug')?.value || '').trim() || 'NomeDoNicho';
    const accCode = (document.getElementById('cb-account-code')?.value || '').trim() || 'XXX-NOMEDOSITE-00';
    const author = (document.getElementById('cb-author')?.value || '').trim() || 'Quempostou';
    const cType = (document.getElementById('cb-campaign-type')?.value || '').trim() || 'PostID-01';

    const preview = document.getElementById('cb-campaign-name-preview');
    if (preview) {
        preview.value = `${postId},${nicheSlug},${accCode},${author},${cType}`;
    }
}

function setCampaignTypePreset(val) {
    const input = document.getElementById('cb-campaign-type');
    if (input) {
        input.value = val;
        onCampaignTypeChanged();
    }
}

function onCampaignTypeChanged() {
    const cType = (document.getElementById('cb-campaign-type')?.value || '').trim().toUpperCase();
    const utmChk = document.getElementById('cb-use-utm');
    const utmTag = document.getElementById('cb-utm-status-tag');
    const isUtm = cType.startsWith('UTM');
    if (utmChk) utmChk.checked = isUtm;
    if (utmTag) {
        utmTag.innerText = isUtm ? '✅ UTM Dinâmica Ativada' : 'Sem UTM (PostID)';
    }
    updateCampaignNamePreview();
    updateUrlPreview();
}

function stripTranslateXPrefix(pathname = '/') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length > 0) {
        const firstLower = parts[0].toLowerCase();
        for (const code of TRANSLATEX_LANGS) {
            if (code.toLowerCase() === firstLower) {
                parts.shift();
                break;
            }
        }
    }
    return '/' + parts.join('/') + (pathname.endsWith('/') && parts.length > 0 ? '/' : '');
}

function buildLocalizedAdUrl(rawUrl, langCode = 'pt') {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return '';
    try {
        const u = new URL(trimmed);
        const cleanPath = stripTranslateXPrefix(u.pathname);
        if (!langCode || langCode.toLowerCase() === 'pt') {
            u.pathname = cleanPath;
        } else {
            u.pathname = `/${langCode}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
        }
        return u.toString();
    } catch (e) {
        return trimmed;
    }
}

function extractPostIdFromUrl(rawUrl = '') {
    const m = rawUrl.match(/\/(\d{4,6})\//);
    return m ? m[1] : '';
}

function updateUrlPreview() {
    const rawUrl = (document.getElementById('cb-base-url')?.value || '').trim();
    const previewEl = document.getElementById('cb-localized-url-preview');
    const postIdInput = document.getElementById('cb-post-id');

    if (rawUrl && postIdInput && !postIdInput.value.trim()) {
        const extracted = extractPostIdFromUrl(rawUrl);
        if (extracted) {
            postIdInput.value = extracted;
            updateCampaignNamePreview();
        }
    }

    if (!previewEl) return;
    if (!rawUrl) {
        previewEl.innerHTML = 'Português mantém URL limpa sem <code>/pt/</code>; outros idiomas inserem <code>/es/</code>, <code>/fr/</code>, <code>/de/</code> etc.';
        return;
    }

    const ptExample = buildLocalizedAdUrl(rawUrl, 'pt');
    const esExample = buildLocalizedAdUrl(rawUrl, 'es');
    previewEl.innerHTML = `🇧🇷 PT: <code>${ptExample}</code> • 🇪🇸 ES: <code>${esExample}</code>`;
}

// ========================================================
// PASSO 3: ONEDRIVE VÍDEOS (1 CRIATIVO POR ANÚNCIO 01..06 + 4x3)
// ========================================================

function normalizeStr(s = '') {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}

function onCampaignBuilderNicheInput() {
    const val = (document.getElementById('cb-niche-search')?.value || '').trim();
    const match = (oneDriveData.niches || []).find(n => n.name === val);
    if (match) onCampaignBuilderNicheSelected();
}

function onCampaignBuilderNicheSelected() {
    const nicheName = (document.getElementById('cb-niche-search')?.value || '').trim();
    const niche = (oneDriveData.niches || []).find(n => n.name === nicheName) || null;
    cbState.selectedNicheName = nicheName;
    cbState.selectedNicheObj = niche;

    const slugInput = document.getElementById('cb-niche-slug');
    if (slugInput && nicheName) {
        slugInput.value = sanitizeNicheSlug(nicheName);
        updateCampaignNamePreview();
    }

    const langSelect = document.getElementById('cb-video-lang-select');
    if (langSelect) {
        langSelect.innerHTML = '<option value="AUTO">✨ Automático (pelo idioma do país/bloco)</option>';
        if (niche) {
            const allVids = [...(niche.videos.feed || []), ...(niche.videos.reels || [])];
            const langs = Array.from(new Set(allVids.map(v => v.lang).filter(Boolean))).sort();
            langs.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l;
                opt.innerText = `📁 ${l}`;
                langSelect.appendChild(opt);
            });
        }
    }

    renderBuilderCreativesGrid();
}

function getAllVideosForNiche(niche) {
    if (!niche || !niche.videos) return [];
    return [...(niche.videos.feed || []), ...(niche.videos.reels || [])];
}

function pickVideoFolderLangForTarget(niche, targetLangCode, targetCountryName = '') {
    const allVids = getAllVideosForNiche(niche);
    const availableLangs = Array.from(new Set(allVids.map(v => v.lang).filter(Boolean)));
    if (availableLangs.length === 0) return '';

    // Se o nicho foi salvo direto em Feed/Reels sem subpasta de idioma, usa todos
    if (availableLangs.every(l => ['FEED', 'REELS'].includes(normalizeStr(l)))) {
        return '__ALL__';
    }

    // Prioridade 1: pasta exata com nome do país (ex: Chile, Estados Unidos)
    if (targetCountryName) {
        const normCountry = normalizeStr(targetCountryName.replace(/\(.*?\)/g, ''));
        const countryMatch = availableLangs.find(l => normalizeStr(l) === normCountry);
        if (countryMatch) return countryMatch;
    }

    const codeKey = (targetLangCode || 'pt').toLowerCase();
    const aliases = ONEDRIVE_LANG_ALIASES[codeKey] || [codeKey.toUpperCase()];

    // Prioridade 2: correspondência exata do alias
    for (const alias of aliases) {
        const exact = availableLangs.find(l => normalizeStr(l) === alias);
        if (exact) return exact;
    }
    // Prioridade 3: substring segura (alias >= 4 chars, ex: "ESPANHOL (NEW 07.07.25)")
    for (const alias of aliases) {
        if (alias.length >= 4) {
            const partial = availableLangs.find(l => normalizeStr(l).includes(alias));
            if (partial) return partial;
        }
    }
    return availableLangs[0];
}

function resolveCreativesForLanguage(niche, langCode, countryName = '') {
    if (!niche) return [];
    const selectedLangOverride = document.getElementById('cb-video-lang-select')?.value || 'AUTO';
    const folderLang = selectedLangOverride !== 'AUTO'
        ? selectedLangOverride
        : pickVideoFolderLangForTarget(niche, langCode, countryName);

    const allVids = getAllVideosForNiche(niche).filter(v => !folderLang || folderLang === '__ALL__' || v.lang === folderLang);
    const bySlot = [];

    for (let slot = 1; slot <= 6; slot++) {
        const video = allVids.find(v => Number(v.num) === slot || (v.name && v.name.startsWith(`${slot}.`)));
        if (video) {
            bySlot.push({
                slot,
                adName: String(slot).padStart(2, '0'),
                formatLabel: slot <= 3 ? 'Quadrado (Feed)' : 'Vertical (Reels)',
                video
            });
        }
    }

    if (bySlot.length === 0 && allVids.length > 0) {
        allVids.slice(0, 6).forEach((v, idx) => {
            const slot = idx + 1;
            bySlot.push({
                slot,
                adName: String(slot).padStart(2, '0'),
                formatLabel: slot <= 3 ? 'Quadrado (Feed)' : 'Vertical (Reels)',
                video: v
            });
        });
    }

    return bySlot;
}

function renderBuilderCreativesGrid() {
    const grid = document.getElementById('cb-creatives-grid');
    const summaryEl = document.getElementById('cb-creatives-summary');
    if (!grid) return;

    const niche = cbState.selectedNicheObj;
    if (!niche) {
        grid.innerHTML = '<div class="text-muted" style="font-size: 13px; grid-column: 1 / -1;">Escolha um nicho do OneDrive acima para listar Feed (01–03), Reels (04–06) e 4x3 (07–09 Em construção).</div>';
        return;
    }

    const sampleCountry = cbState.selectedCountries[0];
    const slots = resolveCreativesForLanguage(niche, sampleCountry?.langCode || 'pt', sampleCountry?.adSetName || '');

    if (summaryEl) {
        const activeSelected = slots.filter(s => cbState.selectedSlots.has(s.slot)).length;
        summaryEl.innerText = `${slots.length} vídeo(s) encontrados neste nicho → criará ${activeSelected} anúncio(s) individuais (01 a ${String(activeSelected).padStart(2, '0')}) por conjunto.`;
    }

    grid.innerHTML = '';

    for (let slotNum = 1; slotNum <= 6; slotNum++) {
        const found = slots.find(s => s.slot === slotNum);
        const adName = String(slotNum).padStart(2, '0');
        const formatLabel = slotNum <= 3 ? '📐 Quadrado (Feed)' : '📱 Vertical (Reels)';

        const card = document.createElement('div');
        card.className = `cb-creative-card ${found ? 'found' : ''}`;

        if (found) {
            const checked = cbState.selectedSlots.has(slotNum);
            const streamUrl = found.video.url ? `${API_BASE_URL}${found.video.url}` : '';
            card.innerHTML = `
                <div class="cb-creative-head">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-weight:700;">
                        <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleBuilderCreativeSlot(${slotNum}, this.checked)">
                        <span>Anúncio ${adName}</span>
                    </label>
                    <span class="cb-rule-pill">${found.video.lang || 'PT'}</span>
                </div>
                <div class="text-muted">${formatLabel}</div>
                <div style="font-family:monospace;font-size:11px;word-break:break-all;">${found.video.name}</div>
                ${streamUrl ? `<a href="${streamUrl}" target="_blank" class="btn btn-outline btn-sm" style="text-align:center;">▶️ Abrir Vídeo</a>` : ''}
            `;
        } else {
            card.innerHTML = `
                <div class="cb-creative-head">
                    <strong>Anúncio ${adName}</strong>
                    <span class="text-muted" style="font-size:10px;">Não encontrado</span>
                </div>
                <div class="text-muted">${formatLabel}</div>
                <div class="text-muted" style="font-size:11px;">Arquivo ${slotNum}.mp4 ausente nesta pasta.</div>
            `;
        }
        grid.appendChild(card);
    }

    // Slots futuros 07..09 (4x3 Em Construção)
    const wipCard = document.createElement('div');
    wipCard.className = 'cb-creative-card wip';
    wipCard.innerHTML = `
        <div class="cb-creative-head">
            <strong>Anúncios 07 – 09</strong>
            <span class="badge-wip" style="font-size:9px;padding:2px 6px;">EM CONSTRUÇÃO</span>
        </div>
        <div>📺 Formato 4x3 (3 vídeos)</div>
        <div class="text-muted" style="font-size:11px;">Espaço reservado para os próximos formatos horizontais 4:3 da TwoD.</div>
    `;
    grid.appendChild(wipCard);

    updateLaunchSummary();
}

function toggleBuilderCreativeSlot(slotNum, checked) {
    if (checked) cbState.selectedSlots.add(slotNum);
    else cbState.selectedSlots.delete(slotNum);
    updateLaunchSummary();
}

// ========================================================
// PASSO 4: TRADUÇÃO 2-3-2, PAÍSES & PUBLICAÇÃO META API
// ========================================================

function uppercasePrimaryText1() {
    const el = document.getElementById('cb-primary-1');
    if (el && el.value) el.value = el.value.toUpperCase();
}

async function translateTextsBatch(texts, targetLang, sourceLang = 'pt') {
    const cacheKey = `${sourceLang}->${targetLang}::${JSON.stringify(texts)}`;
    if (cbState.translationCache[cacheKey]) return cbState.translationCache[cacheKey];

    try {
        const res = await fetch(`${API_BASE_URL}/api/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts, target_lang: targetLang, source_lang: sourceLang })
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.translations)) {
            cbState.translationCache[cacheKey] = data.translations;
            return data.translations;
        }
    } catch (e) {
        console.warn('Tradutor indisponível, mantendo textos originais:', e);
    }
    return texts;
}

async function translateBuilderTexts() {
    const targetLang = document.getElementById('cb-translate-lang-select')?.value || 'es';
    const btn = document.getElementById('btn-cb-translate');
    const ids = ['cb-primary-1', 'cb-primary-2', 'cb-headline-1', 'cb-headline-2', 'cb-headline-3', 'cb-desc-2'];
    const current = ids.map(id => document.getElementById(id)?.value || '');

    if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Traduzindo...';
    }
    try {
        const out = await translateTextsBatch(current, targetLang, 'pt');
        ids.forEach((id, idx) => {
            const el = document.getElementById(id);
            if (el && out[idx]) {
                el.value = id === 'cb-primary-1' ? out[idx].toUpperCase() : out[idx];
            }
        });
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '🌐 Traduzir Agora';
        }
    }
}

function applyBuilderCountryPreset(presetKey) {
    if (presetKey === 'BR') {
        cbState.selectedCountries = [
            { adSetName: 'Brasil', code: 'BR', langCode: 'pt', langName: 'PORTUGUÊS', useSpanishAll: false }
        ];
    } else if (presetKey === 'US_EN') {
        cbState.selectedCountries = [
            { adSetName: 'Estados Unidos (inglês)', code: 'US', langCode: 'en', langName: 'INGLÊS', useSpanishAll: false }
        ];
    } else if (presetKey === 'US_ES') {
        cbState.selectedCountries = [
            { adSetName: 'Estados Unidos (espanhol)', code: 'US', langCode: 'es', langName: 'ESPANHOL', useSpanishAll: true }
        ];
    } else if (META_COUNTRY_BLOCKS[presetKey]) {
        cbState.selectedCountries = META_COUNTRY_BLOCKS[presetKey].countries.map(c => ({
            ...c,
            useSpanishAll: false,
            checked: true
        }));
    }

    cbState.selectedCountries.forEach(c => {
        if (typeof c.checked !== 'boolean') c.checked = true;
    });
    renderBuilderCountriesGrid();
    renderBuilderCreativesGrid();
}

function renderBuilderCountriesGrid() {
    const grid = document.getElementById('cb-countries-grid');
    const badge = document.getElementById('cb-selected-countries-badge');
    if (!grid) return;

    cbState.selectedCountries.forEach(c => {
        if (typeof c.checked !== 'boolean') c.checked = true;
    });

    grid.innerHTML = '';
    cbState.selectedCountries.forEach((c, idx) => {
        const card = document.createElement('div');
        card.className = `country-check-card ${c.checked ? 'checked' : ''}`;
        card.onclick = (e) => {
            if (e.target.tagName !== 'INPUT') {
                c.checked = !c.checked;
                renderBuilderCountriesGrid();
            }
        };

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = c.checked;
        chk.onchange = () => {
            c.checked = chk.checked;
            card.classList.toggle('checked', c.checked);
            updateLaunchSummary();
        };

        const info = document.createElement('div');
        info.className = 'country-info';
        const extraTag = c.useSpanishAll ? ' • Filtro: Spanish (All)' : '';
        info.innerHTML = `
            <div class="country-name">${c.adSetName} <span style="opacity:0.65;font-size:11px;">(${c.code})</span></div>
            <div class="country-lang">Tag URL: /${c.langCode}/${extraTag}</div>
        `;

        card.appendChild(chk);
        card.appendChild(info);
        grid.appendChild(card);
    });

    const activeCount = cbState.selectedCountries.filter(c => c.checked).length;
    if (badge) badge.innerText = `${activeCount} selecionado(s)`;
    updateLaunchSummary();
}

function updateLaunchSummary() {
    const summaryEl = document.getElementById('cb-launch-summary');
    const activeCountries = cbState.selectedCountries.filter(c => c.checked).length;
    const adsPerSet = cbState.selectedSlots.size || 0;
    if (summaryEl) {
        summaryEl.innerText = `1 Campanha Sales (ABO) • ${activeCountries} Conjunto(s) ($${activeCountries}.00 USD/dia) • até ${activeCountries * adsPerSet} Anúncio(s)`;
    }
}

function logBuilderTerminal(msg, type = 'info') {
    const term = document.getElementById('cb-terminal-body');
    const clearBtn = document.getElementById('btn-cb-clear-log');
    if (clearBtn) clearBtn.style.display = 'inline-block';
    if (!term) return;

    const empty = term.querySelector('.terminal-log-empty');
    if (empty) empty.remove();

    const timeStr = new Date().toTimeString().split(' ')[0];
    const line = document.createElement('div');
    line.className = `terminal-entry ${type}`;
    line.innerHTML = `<span class="term-time">[${timeStr}]</span> <span class="term-text">${msg}</span>`;
    term.appendChild(line);
    term.scrollTop = term.scrollHeight;
}

function clearBuilderTerminal() {
    const term = document.getElementById('cb-terminal-body');
    if (term) {
        term.innerHTML = '<div class="terminal-log-empty">Terminal limpo. Pronto para criar campanha padrão.</div>';
    }
}

async function resolveSpanishAllLocaleIds(token) {
    if (cbState.spanishLocaleIds) return cbState.spanishLocaleIds;
    try {
        const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/search?type=adlocale&q=Spanish&access_token=${encodeURIComponent(token)}`);
        const data = await resp.json();
        if (Array.isArray(data.data) && data.data.length > 0) {
            const allEs = data.data.find(l => /spanish\s*\(all\)|espanhol\s*\(todos\)/i.test(l.name));
            if (allEs && allEs.key) {
                cbState.spanishLocaleIds = [Number(allEs.key)];
                return cbState.spanishLocaleIds;
            }
            const genericEs = data.data.filter(l => /spanish/i.test(l.name)).map(l => Number(l.key)).filter(Boolean);
            if (genericEs.length > 0) {
                cbState.spanishLocaleIds = genericEs;
                return cbState.spanishLocaleIds;
            }
        }
    } catch (e) {
        console.warn('Falha ao buscar locales Spanish (All):', e);
    }
    return [23]; // fallback padrão espanhol na Meta
}

async function metaFormPost(endpoint, paramsObj, token) {
    const form = new URLSearchParams();
    form.append('access_token', token);
    Object.entries(paramsObj).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') {
            form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        }
    });
    const resp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form.toString()
    });
    return resp.json();
}

async function uploadOneDriveVideoToMeta(accountId, video, token, uploadCache) {
    const cacheKey = video.id || video.url || video.name;
    if (uploadCache[cacheKey]) return uploadCache[cacheKey];

    let videoId = null;

    // 1. Tenta resolver link direto da CDN Microsoft (OneDrive Nuvem) e enviar via file_url
    if (video.id) {
        try {
            const dlResp = await fetch(`${API_BASE_URL}/api/graph/file/${video.id}?format=json`);
            const dlData = await dlResp.json();
            if (dlData.success && dlData.download_url) {
                const upRes = await metaFormPost(`/${accountId}/advideos`, {
                    file_url: dlData.download_url,
                    title: video.name
                }, token);
                if (upRes.id) videoId = upRes.id;
            }
        } catch (e) {
            console.warn('Fallback upload direto via backend:', e);
        }
    }

    // 2. Fallback / Local: envia via proxy multipart do backend Python
    if (!videoId) {
        const upProxy = await fetch(`${API_BASE_URL}/api/meta/upload-video`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                account_id: accountId,
                access_token: token,
                title: video.name,
                local_url: !video.id && video.url ? video.url : '',
                graph_item_id: video.id || '',
                graph_version: META_GRAPH_VERSION
            })
        });
        const upJson = await upProxy.json();
        if (upJson.success && upJson.result?.id) {
            videoId = upJson.result.id;
        } else {
            throw new Error(`Falha ao subir vídeo ${video.name}: ${upJson.error || JSON.stringify(upJson)}`);
        }
    }

    // Aguarda processamento + thumbnail pronta na Meta (até ~60s)
    let thumbnailUrl = '';
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(r => setTimeout(r, 3000));
        const stResp = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${videoId}?access_token=${encodeURIComponent(token)}&fields=status,picture,thumbnails`);
        const stData = await stResp.json();
        const thumbUri = stData.thumbnails?.data?.[0]?.uri || stData.picture || '';
        if (thumbUri) thumbnailUrl = thumbUri;
        if (stData.status?.video_status === 'ready') break;
    }

    const result = { video_id: videoId, thumbnail_url: thumbnailUrl };
    uploadCache[cacheKey] = result;
    return result;
}

function buildPromotedObjectForPixel(pixelId, modelAdSet) {
    const modelPo = modelAdSet?.promoted_object;
    if (modelPo && modelPo.pixel_id === pixelId) {
        const sanitized = {
            pixel_id: pixelId,
            custom_event_type: modelPo.custom_event_type || 'OTHER',
            smart_pse_enabled: false
        };
        if (modelPo.custom_conversion_id) {
            sanitized.custom_conversion_id = modelPo.custom_conversion_id;
        } else if (modelPo.custom_event_str) {
            sanitized.custom_event_str = modelPo.custom_event_str;
        } else {
            sanitized.custom_event_str = 'ad_click';
        }
        return sanitized;
    }

    const matchedCc = (cbState.customConversions || []).find(cc =>
        cc.pixel?.id === pixelId && /ad[_\s-]*click/i.test(cc.name || '')
    );
    if (matchedCc) {
        return {
            pixel_id: pixelId,
            custom_event_type: matchedCc.custom_event_type || 'OTHER',
            custom_conversion_id: matchedCc.id,
            smart_pse_enabled: false
        };
    }

    return {
        pixel_id: pixelId,
        custom_event_type: 'OTHER',
        custom_event_str: 'ad_click',
        smart_pse_enabled: false
    };
}

const EU_DSA_COUNTRIES = new Set([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
]);

async function createAdSetWithFallbacks(accountId, adSetPayload, token) {
    let res = await metaFormPost(`/${accountId}/adsets`, adSetPayload, token);
    const tried = new Set();

    for (let attempt = 0; attempt < 5 && res.error; attempt++) {
        const msg = (res.error.message || '').toLowerCase();
        const sub = String(res.error.error_subcode || '');

        if (!tried.has('dsa') && (msg.includes('dsa_beneficiary') || msg.includes('dsa_payor') || msg.includes('beneficiary'))) {
            tried.add('dsa');
            delete adSetPayload.dsa_beneficiary;
            delete adSetPayload.dsa_payor;
        } else if (!tried.has('reg') && (msg.includes('regional_regulat') || msg.includes('universal_beneficiary') || msg.includes('voluntary_verification'))) {
            tried.add('reg');
            delete adSetPayload.regional_regulation_identities;
            delete adSetPayload.regional_regulated_categories;
        } else if (!tried.has('dest') && (msg.includes('destination_type') || msg.includes('promoted_object') || sub === '1487877')) {
            tried.add('dest');
            delete adSetPayload.destination_type;
        } else if (!tried.has('locale') && adSetPayload.targeting?.locales && (msg.includes('locale') || msg.includes('targeting'))) {
            tried.add('locale');
            adSetPayload.targeting.locales = [7, 23];
        } else if (!tried.has('value') && msg.includes('value')) {
            tried.add('value');
            adSetPayload.optimization_goal = 'OFFSITE_CONVERSIONS';
        } else {
            break;
        }
        res = await metaFormPost(`/${accountId}/adsets`, adSetPayload, token);
    }
    return res;
}

async function launchStandardCampaign() {
    if (cbState.isLaunching) return;

    const token = getMetaToken();
    const accountId = cbState.selectedAccountId;
    const pixelId = document.getElementById('cb-pixel-select')?.value;
    const campaignName = (document.getElementById('cb-campaign-name-preview')?.value || '').trim();
    const baseUrl = (document.getElementById('cb-base-url')?.value || '').trim();
    const useUtm = Boolean(document.getElementById('cb-use-utm')?.checked);
    const utmParams = (document.getElementById('cb-utm-params')?.value || '').trim();
    const advertiserName = (document.getElementById('cb-advertiser-name')?.value || 'Futuretech Dynamics LLC').trim();
    const initialStatus = document.getElementById('cb-initial-status')?.value || 'PAUSED';
    const scheduleRaw = (document.getElementById('cb-schedule-start')?.value || '').trim();
    const autoTranslate = Boolean(document.getElementById('cb-auto-translate-per-country')?.checked);

    const activePages = cbState.pages.filter(p => cbState.selectedPageIds.has(p.id));
    const targetCountries = cbState.selectedCountries.filter(c => c.checked);
    const niche = cbState.selectedNicheObj;

    if (!token) return alert('Conecte seu Token da Meta antes de publicar.');
    if (!accountId) return alert('Selecione uma Conta de Anúncios.');
    if (!pixelId) return alert('Selecione o Pixel (Dataset) do site.');
    if (!campaignName) return alert('Preencha os campos do Nome da Campanha.');
    if (!baseUrl) return alert('Informe a URL Base do Post.');
    if (activePages.length === 0) return alert('Selecione ao menos 1 Página da BM para os anúncios.');
    if (targetCountries.length === 0) return alert('Selecione ao menos 1 País/Conjunto.');
    if (!niche || cbState.selectedSlots.size === 0) return alert('Selecione o Nicho no OneDrive e ao menos 1 criativo (01–06).');

    const p1 = (document.getElementById('cb-primary-1')?.value || '').trim();
    const p2 = (document.getElementById('cb-primary-2')?.value || '').trim();
    const h1 = (document.getElementById('cb-headline-1')?.value || '').trim();
    const h2 = (document.getElementById('cb-headline-2')?.value || '').trim();
    const h3 = (document.getElementById('cb-headline-3')?.value || '').trim();
    const d1 = (document.getElementById('cb-desc-1')?.value || '').trim();
    const d2 = (document.getElementById('cb-desc-2')?.value || '').trim();

    if (!p1 || !p2 || !h1 || !h2 || !h3) {
        return alert('Preencha todos os textos principais (2) e headlines (3) no bloco 2-3-2.');
    }

    const confirmText = `Confirmar criação da Campanha Padrão TwoD?\n\n` +
        `• Campanha: ${campaignName}\n` +
        `• Objetivo / Budget: Sales (ABO • $1.00 USD/dia por conjunto)\n` +
        `• Conjuntos (Países): ${targetCountries.length}\n` +
        `• Páginas em rotação (BM): ${activePages.length}\n` +
        `• Criativos selecionados por conjunto: até ${cbState.selectedSlots.size} anúncios individuais\n` +
        `• Status inicial: ${initialStatus === 'PAUSED' ? 'PAUSADO' : 'ATIVO'}`;

    if (!confirm(confirmText)) return;

    cbState.isLaunching = true;
    const launchBtn = document.getElementById('btn-cb-launch');
    const progWrap = document.getElementById('cb-progress-wrapper');
    const progFill = document.getElementById('cb-progress-fill');
    const progStatus = document.getElementById('cb-progress-status');
    const progPct = document.getElementById('cb-progress-pct');
    const termStatus = document.getElementById('cb-terminal-status');

    if (launchBtn) {
        launchBtn.disabled = true;
        launchBtn.innerText = '⏳ Publicando Campanha via Meta API...';
    }
    if (progWrap) progWrap.classList.remove('twod-hidden');
    if (termStatus) termStatus.innerText = 'Em execução...';

    const updateProgress = (pct, msg) => {
        if (progFill) progFill.style.width = `${pct}%`;
        if (progPct) progPct.innerText = `${pct}%`;
        if (progStatus) progStatus.innerText = msg;
    };

    try {
        updateProgress(5, 'Criando campanha Sales (ABO)...');
        logBuilderTerminal(`🚀 Criando campanha '${campaignName}' (Sales • ABO)...`, 'info');

        const campRes = await metaFormPost(`/${accountId}/campaigns`, {
            name: campaignName,
            objective: 'OUTCOME_SALES',
            buying_type: 'AUCTION',
            status: initialStatus,
            special_ad_categories: ['NONE'],
            is_adset_budget_sharing_enabled: 'false'
        }, token);

        if (campRes.error || !campRes.id) {
            throw new Error(`Campanha falhou: ${campRes.error?.message || JSON.stringify(campRes)}`);
        }
        const campaignId = campRes.id;
        logBuilderTerminal(`✅ Campanha criada! ID: ${campaignId}`, 'success');

        const uploadCache = {};
        let pageCursor = 0;

        for (let i = 0; i < targetCountries.length; i++) {
            const country = targetCountries[i];
            const pctBase = 10 + Math.round((i / targetCountries.length) * 85);
            updateProgress(pctBase, `[${i + 1}/${targetCountries.length}] Configurando ${country.adSetName}...`);

            // 1. Resolve vídeos do OneDrive para o idioma do país
            const creatives = resolveCreativesForLanguage(niche, country.langCode, country.adSetName)
                .filter(c => cbState.selectedSlots.has(c.slot));

            if (creatives.length === 0) {
                logBuilderTerminal(`⚠️ [${country.adSetName}] Nenhum vídeo encontrado no OneDrive para '${country.langCode}'. Pulando conjunto.`, 'warn');
                continue;
            }

            // 2. Upload dos vídeos (cacheado por arquivo no OneDrive)
            const uploadedAssets = [];
            for (const item of creatives) {
                logBuilderTerminal(`☁️ Subindo criativo ${item.adName} (${item.video.name}) para ${accountId}...`, 'info');
                const media = await uploadOneDriveVideoToMeta(accountId, item.video, token, uploadCache);
                uploadedAssets.push({ ...item, ...media });
            }

            // 3. Targeting + Language Spanish (All) apenas para US espanhol
            const targeting = {
                geo_locations: {
                    countries: [country.code],
                    location_types: ['frequently_in', 'home', 'recent']
                },
                age_min: 18,
                targeting_automation: { advantage_audience: 0 }
            };
            if (country.useSpanishAll) {
                targeting.locales = await resolveSpanishAllLocaleIds(token);
            }

            const modelAdSet = cbState.calibratedModel?.adset;
            const promotedObj = buildPromotedObjectForPixel(pixelId, modelAdSet);

            const adSetPayload = {
                name: country.adSetName,
                campaign_id: campaignId,
                daily_budget: '100',
                billing_event: 'IMPRESSIONS',
                optimization_goal: modelAdSet?.optimization_goal || 'VALUE',
                bid_strategy: modelAdSet?.bid_strategy || 'LOWEST_COST_WITHOUT_CAP',
                status: initialStatus,
                promoted_object: promotedObj,
                targeting
            };
            if (modelAdSet?.destination_type && modelAdSet.destination_type !== 'UNDEFINED') {
                adSetPayload.destination_type = modelAdSet.destination_type;
            } else if (!modelAdSet) {
                adSetPayload.destination_type = 'WEBSITE';
            }

            const universalEntityId = modelAdSet?.regional_regulation_identities?.universal_beneficiary || cbState.bmId;
            if (universalEntityId) {
                adSetPayload.regional_regulation_identities = {
                    universal_beneficiary: universalEntityId,
                    universal_payer: modelAdSet?.regional_regulation_identities?.universal_payer || universalEntityId
                };
            }
            if (country.code === 'BR') {
                adSetPayload.regional_regulated_categories = ['BRAZIL_REGULATION', 'VOLUNTARY_VERIFICATION'];
            } else if (country.code === 'ES') {
                adSetPayload.regional_regulated_categories = ['SPAIN_FINSERV', 'VOLUNTARY_VERIFICATION'];
            } else if (universalEntityId) {
                adSetPayload.regional_regulated_categories = ['VOLUNTARY_VERIFICATION'];
            }

            if (advertiserName && (EU_DSA_COUNTRIES.has(country.code) || modelAdSet?.dsa_beneficiary)) {
                adSetPayload.dsa_beneficiary = advertiserName;
                adSetPayload.dsa_payor = advertiserName;
            }
            if (scheduleRaw) {
                adSetPayload.start_time = new Date(scheduleRaw).toISOString();
            }

            const adSetRes = await createAdSetWithFallbacks(accountId, adSetPayload, token);

            if (adSetRes.error || !adSetRes.id) {
                logBuilderTerminal(`❌ [${country.adSetName}] Erro ao criar conjunto: ${adSetRes.error?.message || JSON.stringify(adSetRes)}`, 'error');
                continue;
            }
            const adSetId = adSetRes.id;
            logBuilderTerminal(`✅ Conjunto '${country.adSetName}' criado ($1/dia | ID: ${adSetId})`, 'success');

            // 4. Traduz textos 2-3-2 caso autoTranslate esteja ligado e idioma != pt
            let tTexts = [p1, p2, h1, h2, h3, d2];
            if (autoTranslate && country.langCode && country.langCode.toLowerCase() !== 'pt') {
                tTexts = await translateTextsBatch(tTexts, country.langCode, 'pt');
            }
            const [tp1, tp2, th1, th2, th3, td2] = tTexts;
            const localizedUrl = buildLocalizedAdUrl(baseUrl, country.langCode);

            // 5. Cria 1 Anúncio por criativo (01, 02... 06) alternando Página da BM
            let adsOk = 0;
            for (const asset of uploadedAssets) {
                const page = activePages[pageCursor % activePages.length];
                pageCursor++;

                const videoData = {
                    video_id: asset.video_id,
                    call_to_action: {
                        type: 'DOWNLOAD',
                        value: { link: localizedUrl }
                    }
                };
                if (asset.thumbnail_url) {
                    videoData.image_url = asset.thumbnail_url;
                }

                const creativePayload = {
                    name: `${country.adSetName} - ${asset.adName}`,
                    object_story_spec: {
                        page_id: page.id,
                        video_data: videoData
                    },
                    asset_feed_spec: {
                        bodies: [{ text: tp1 }, { text: tp2 }],
                        titles: [{ text: th1 }, { text: th2 }, { text: th3 }],
                        descriptions: [{ text: d1 }, { text: td2 }],
                        optimization_type: 'DEGREES_OF_FREEDOM'
                    },
                    degrees_of_freedom_spec: {
                        creative_features_spec: {
                            standard_enhancements: { enroll_status: 'OPT_OUT' }
                        }
                    }
                };

                let creativeRes = await metaFormPost(`/${accountId}/adcreatives`, creativePayload, token);
                if (creativeRes.error && /degrees_of_freedom_spec|standard_enhancements/i.test(creativeRes.error.message || '')) {
                    delete creativePayload.degrees_of_freedom_spec;
                    creativeRes = await metaFormPost(`/${accountId}/adcreatives`, creativePayload, token);
                }

                if (creativeRes.error || !creativeRes.id) {
                    logBuilderTerminal(`⚠️ Anúncio ${asset.adName} (${country.adSetName}) falhou no AdCreative: ${creativeRes.error?.message || JSON.stringify(creativeRes)}`, 'warn');
                    continue;
                }

                const adPayload = {
                    name: asset.adName,
                    adset_id: adSetId,
                    creative: { creative_id: creativeRes.id },
                    status: initialStatus
                };
                if (useUtm && utmParams) {
                    adPayload.url_tags = utmParams;
                }

                const adRes = await metaFormPost(`/${accountId}/ads`, adPayload, token);
                if (adRes.id) {
                    adsOk++;
                } else {
                    logBuilderTerminal(`⚠️ Falha ao publicar anúncio ${asset.adName}: ${adRes.error?.message || JSON.stringify(adRes)}`, 'warn');
                }
            }

            logBuilderTerminal(`🎬 [${country.adSetName}] ${adsOk}/${uploadedAssets.length} anúncios publicados (URL: ${localizedUrl})`, 'success');
        }

        updateProgress(100, 'Publicação concluída!');
        if (termStatus) termStatus.innerText = 'Finalizado';
        alert(`🎉 Campanha '${campaignName}' finalizada!\nConfira os detalhes e IDs no terminal abaixo.`);
    } catch (err) {
        logBuilderTerminal(`❌ Erro fatal na publicação: ${err.message}`, 'error');
        alert(`Erro ao criar campanha: ${err.message}`);
    } finally {
        cbState.isLaunching = false;
        if (launchBtn) {
            launchBtn.disabled = false;
            launchBtn.innerText = '🚀 CRIAR CAMPANHA PADRÃO + CONJUNTOS + ANÚCIOS VIA API';
        }
    }
}

// Exportações globais
window.toggleCampaignBuilderTokenBox = toggleCampaignBuilderTokenBox;
window.onCampaignBuilderAccountChanged = onCampaignBuilderAccountChanged;
window.toggleAllBuilderPages = toggleAllBuilderPages;
window.inspectModelCampaign = inspectModelCampaign;
window.updateCampaignNamePreview = updateCampaignNamePreview;
window.setCampaignTypePreset = setCampaignTypePreset;
window.onCampaignTypeChanged = onCampaignTypeChanged;
window.updateUrlPreview = updateUrlPreview;
window.onCampaignBuilderNicheInput = onCampaignBuilderNicheInput;
window.onCampaignBuilderNicheSelected = onCampaignBuilderNicheSelected;
window.renderBuilderCreativesGrid = renderBuilderCreativesGrid;
window.toggleBuilderCreativeSlot = toggleBuilderCreativeSlot;
window.uppercasePrimaryText1 = uppercasePrimaryText1;
window.translateBuilderTexts = translateBuilderTexts;
window.applyBuilderCountryPreset = applyBuilderCountryPreset;
window.launchStandardCampaign = launchStandardCampaign;
window.clearBuilderTerminal = clearBuilderTerminal;
