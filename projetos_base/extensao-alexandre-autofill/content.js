// TwoD AutoFill - Content Script
(function () {
    if (document.getElementById('twod-floating-root')) return;

    // Detectar ambiente atual
    const isFunDigital = window.location.hostname.includes('fundigital.net.br');
    const isMetaAds = window.location.hostname.includes('facebook.com') && window.location.pathname.includes('adsmanager');
    const isWordPressPosts = window.location.pathname.includes('wp-admin/edit.php') ||
                             (window.location.pathname.includes('wp-admin') && (window.location.search.includes('post_type=post') || !window.location.search.includes('post_type='))) ||
                             !!document.querySelector('table.wp-list-table.posts');
    const isWordPress = isWordPressPosts || window.location.pathname.includes('wp-admin') || !!document.querySelector('#wpadminbar');

    // Estado da extensão
    let currentDay = localStorage.getItem('twod_selected_day') || 'Segunda';
    let currentPostIdx = parseInt(localStorage.getItem('twod_selected_post_idx') || '0', 10);
    let activeTab = isWordPressPosts ? 'wp' : (isMetaAds ? 'meta' : 'fun');

    // Estado da Automação WordPress
    let isWordPressRunning = false;
    let wpStopRequested = false;
    let currentWpStep = -1;
    let currentWpStatus = '';
    let wpTargetCount = parseInt(localStorage.getItem('twod_wp_count') || '8', 10);
    let wpCustomNicheAssignments = {};

    // Dados dos posts
    let data = (typeof postsData !== 'undefined') ? postsData : {};

    // Lista dos 9 sites em ordem (com seus índices visuais e mapeamento dos títulos SEO: 7 em PT e 2 em ES)
    const SITES_QUEUE = [
        { name: 'Ai', index: 0, lang: 'pt', seoIndex: 0 },
        { name: 'App', index: 1, lang: 'pt', seoIndex: 1 },
        { name: 'Twodcompany (1º)', index: 3, lang: 'pt', seoIndex: 2 },
        { name: 'F4rol', index: 4, lang: 'pt', seoIndex: 3 },
        { name: 'Hub', index: 5, lang: 'pt', seoIndex: 4 },
        { name: 'Kiocom', index: 6, lang: 'pt', seoIndex: 5 },
        { name: 'Kiuvix', index: 7, lang: 'es', seoIndex: 7 }, // 1º título em Espanhol
        { name: 'Thehatsune', index: 8, lang: 'pt', seoIndex: 6 }, // 7º título em Português
        { name: 'Twodcompany (Último)', index: 9, lang: 'es', seoIndex: 8 } // 2º título em Espanhol
    ];

    // Lista dos 9 sites para o Meta Ads (com distinção crucial entre blog.twodcompany [1º/PT] e twodcompany [Último/ES])
    const SITES_META = [
        { key: 'ai', name: 'Ai', lang: 'pt', domain: 'ai.simplificandocomcafe.com' },
        { key: 'app', name: 'App', lang: 'pt', domain: 'app.simplificandocomcafe.com' },
        { key: 'twod_pt', name: 'Twodcompany (1º)', lang: 'pt', domain: 'blog.twodcompany.com' },
        { key: 'f4rol', name: 'F4rol', lang: 'pt', domain: 'f4rol.com' },
        { key: 'hub', name: 'Hub', lang: 'pt', domain: 'hub.simplificandocomcafe.com' },
        { key: 'kiocom', name: 'Kiocom', lang: 'pt', domain: 'kiocom.com' },
        { key: 'kiuvix', name: 'Kiuvix', lang: 'es', domain: 'kiuvix.com' },
        { key: 'thehatsune', name: 'Thehatsune', lang: 'pt', domain: 'thehatsune.com' },
        { key: 'twod_es', name: 'Twodcompany (Último)', lang: 'es', domain: 'twodcompany.com' }
    ];

    // Blocos de Países para Duplicação em Massa no Meta Ads
    const COUNTRY_BLOCKS = [
        {
            id: 'bloco_01',
            name: 'BLOCO-01 (Espanhol - 15 Países)',
            lang: 'es',
            baseSetKey: 'es',
            baseSetName: 'Estados Unidos (Espanhol)',
            countries: [
                { name: 'Espanha', query: 'Espanha' },
                { name: 'Chile', query: 'Chile' },
                { name: 'Argentina', query: 'Argentina' },
                { name: 'Colômbia', query: 'Colômbia' },
                { name: 'Venezuela', query: 'Venezuela' },
                { name: 'Peru', query: 'Peru' },
                { name: 'Porto Rico', query: 'Porto Rico' },
                { name: 'Costa Rica', query: 'Costa Rica' },
                { name: 'Equador', query: 'Equador' },
                { name: 'Honduras', query: 'Honduras' },
                { name: 'Panamá', query: 'Panamá' },
                { name: 'Nicarágua', query: 'Nicarágua' },
                { name: 'El Salvador', query: 'El Salvador' },
                { name: 'Guatemala', query: 'Guatemala' },
                { name: 'República Dominicana', query: 'República Dominicana' }
            ]
        },
        {
            id: 'bloco_06',
            name: 'BLOCO-06 (Inglês - 9 Países)',
            lang: 'en',
            baseSetKey: 'en',
            baseSetName: 'Estados Unidos (Inglês)',
            countries: [
                { name: 'Irlanda', query: 'Irlanda' },
                { name: 'África do Sul', query: 'África do Sul' },
                { name: 'Reino Unido', query: 'Reino Unido' },
                { name: 'Emirados Árabes Unidos', query: 'Emirados Árabes Unidos' },
                { name: 'Nova Zelândia', query: 'Nova Zelândia' },
                { name: 'Austrália', query: 'Austrália' },
                { name: 'Nigéria', query: 'Nigéria' },
                { name: 'Jamaica', query: 'Jamaica' },
                { name: 'Singapura', query: 'Singapura' }
            ]
        }
    ];

    let isLinksManagerOpen = false;
    let selectedMetaSiteKey = null; // Auto-detecta por padrão

    let isQueueRunning = false;
    let currentQueueStep = -1;
    let isMetaRunning = false;

    // Estado da Duplicação por Países
    let isCountryDuplicationRunning = false;
    let selectedCountryBlockId = localStorage.getItem('twod_country_block') || 'bloco_01';
    let countryDuplicationBudget = localStorage.getItem('twod_country_budget') || '1,00';
    let countryDuplicationSkipExisting = localStorage.getItem('twod_country_skip_existing') !== 'false';
    let countryDuplicationCurrentCountry = '';
    let countryDuplicationProgress = { current: 0, total: 0 };

    // Helper sleep
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

    // Injetar Root Container
    const root = document.createElement('div');
    root.id = 'twod-floating-root';
    document.body.appendChild(root);

    // Criar Botão Flutuante Minimalista (Bolinha FAB)
    const launcher = document.createElement('button');
    launcher.className = 'twod-launcher-btn';
    const currentMode = isFunDigital ? 'fun' : (isMetaAds ? 'meta' : (isWordPressPosts || isWordPress ? 'wp' : 'default'));
    const modeName = isFunDigital ? 'FUN Digital' : (isMetaAds ? 'Meta Ads' : (isWordPressPosts || isWordPress ? 'WordPress' : 'Ativo'));
    launcher.setAttribute('title', `TwoD AutoFill (${modeName}) - Clique para abrir ou arraste para mover`);
    launcher.innerHTML = `
        <svg viewBox="0 0 24 24">
            <path d="M13 2L3 14h8l-1 8 11-12h-8l1-8z" />
        </svg>
        <span class="twod-launcher-dot twod-dot-${currentMode}"></span>
    `;

    // Restaurar posição salva se existir
    try {
        const savedPos = localStorage.getItem('twod_launcher_pos_v2');
        if (savedPos) {
            const { x, y } = JSON.parse(savedPos);
            const maxX = window.innerWidth - 54;
            const maxY = window.innerHeight - 54;
            const clampedX = Math.max(8, Math.min(maxX, x));
            const clampedY = Math.max(8, Math.min(maxY, y));
            launcher.style.left = `${clampedX}px`;
            launcher.style.top = `${clampedY}px`;
            launcher.style.right = 'auto';
            launcher.style.bottom = 'auto';
        }
    } catch (e) {
        // Fallback para CSS default (bottom: 115px; right: 18px)
    }

    root.appendChild(launcher);

    // Criar Painel Gaveta
    const panel = document.createElement('div');
    panel.className = 'twod-drawer-panel twod-hidden';
    root.appendChild(panel);

    // Sistema de Arrastar (Draggable) + Clique
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let elemStartX = 0;
    let elemStartY = 0;
    let hasMoved = false;

    launcher.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        isDragging = true;
        hasMoved = false;
        dragStartX = e.clientX;
        dragStartY = e.clientY;

        const rect = launcher.getBoundingClientRect();
        elemStartX = rect.left;
        elemStartY = rect.top;

        launcher.setPointerCapture(e.pointerId);
    });

    launcher.addEventListener('pointermove', (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;

        // Limiar de 5px para diferenciar clique de arrasto
        if (Math.hypot(deltaX, deltaY) > 5) {
            hasMoved = true;
            launcher.style.cursor = 'grabbing';
            launcher.style.transition = 'none';

            let newX = elemStartX + deltaX;
            let newY = elemStartY + deltaY;

            const maxX = window.innerWidth - launcher.offsetWidth - 8;
            const maxY = window.innerHeight - launcher.offsetHeight - 8;
            newX = Math.max(8, Math.min(maxX, newX));
            newY = Math.max(8, Math.min(maxY, newY));

            launcher.style.left = `${newX}px`;
            launcher.style.top = `${newY}px`;
            launcher.style.right = 'auto';
            launcher.style.bottom = 'auto';
        }
    });

    const onPointerEnd = (e) => {
        if (!isDragging) return;
        isDragging = false;
        launcher.style.cursor = 'grab';
        launcher.style.transition = '';

        if (hasMoved) {
            const rect = launcher.getBoundingClientRect();
            try {
                localStorage.setItem('twod_launcher_pos_v2', JSON.stringify({
                    x: Math.round(rect.left),
                    y: Math.round(rect.top)
                }));
            } catch (err) { }
        } else {
            const willOpen = panel.classList.contains('twod-hidden');
            panel.classList.toggle('twod-hidden');
            if (willOpen) {
                renderPanel();
            }
        }
    };

    launcher.addEventListener('pointerup', onPointerEnd);
    launcher.addEventListener('pointercancel', onPointerEnd);

    function showToast(message, isError = false) {
        const existing = panel.querySelector('.twod-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'twod-toast';
        if (isError) toast.style.background = '#ef4444';
        toast.innerHTML = `<span>${isError ? '⚠️' : '✅'}</span> <span>${message}</span>`;
        panel.appendChild(toast);

        setTimeout(() => toast.remove(), 3500);
    }

    // Helper robusto para preencher input React 16/17/18 / Vue / HTML nativo
    function setReactValue(input, value) {
        if (!input) return false;
        input.focus();

        const tracker = input._valueTracker;
        if (tracker) {
            tracker.setValue(input.value + '_prev');
        }

        const proto = Object.getPrototypeOf(input);
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
            || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
            || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;

        if (nativeSetter) {
            nativeSetter.call(input, value);
        } else {
            input.value = value;
        }

        if (tracker) {
            tracker.setValue(value);
        }

        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        return true;
    }

    // Helper para copiar texto
    function copyToClipboard(text, btnElement) {
        navigator.clipboard.writeText(text).then(() => {
            if (btnElement) {
                const origText = btnElement.textContent;
                btnElement.textContent = 'Copiado!';
                btnElement.classList.add('twod-copied');
                setTimeout(() => {
                    btnElement.textContent = origText;
                    btnElement.classList.remove('twod-copied');
                }, 1500);
            }
            showToast('Copiado para a área de transferência!');
        });
    }

    // Renderizar Conteúdo do Painel
    function renderPanel() {
        try {
            const days = Object.keys(data);
            if (days.length === 0) {
                panel.innerHTML = `<div style="padding: 20px; text-align: center; color: #94a3b8;">Nenhum dado encontrado em posts_data.js</div>`;
                return;
            }

            if (!days.includes(currentDay)) currentDay = days[0];
            const postsForDay = data[currentDay] || [];
            if (currentPostIdx >= postsForDay.length) currentPostIdx = 0;
            const currentCampaign = postsForDay[currentPostIdx] || {};

            let siteIndicatorClass = 'twod-site-generic';
            let siteIndicatorText = 'Navegador';
            if (isFunDigital) {
                siteIndicatorClass = 'twod-site-fun';
                siteIndicatorText = 'FUN Digital';
            } else if (isMetaAds) {
                siteIndicatorClass = 'twod-site-meta';
                siteIndicatorText = 'Meta Ads';
            } else if (isWordPressPosts || isWordPress) {
                siteIndicatorClass = 'twod-site-wp';
                siteIndicatorText = 'WordPress';
            }

            panel.innerHTML = `
                <div class="twod-header">
                    <div class="twod-header-title">
                        <span>⚡ TwoD AutoFill</span>
                        <span class="twod-site-indicator ${siteIndicatorClass}">${siteIndicatorText}</span>
                    </div>
                    <div class="twod-header-actions">
                        <button class="twod-icon-btn" id="twod-btn-close" title="Fechar">✕</button>
                    </div>
                </div>

                <div class="twod-selectors">
                    <div class="twod-select-group">
                        <label class="twod-select-label">Dia</label>
                        <select class="twod-select" id="twod-select-day">
                            ${days.map(d => `<option value="${d}" ${d === currentDay ? 'selected' : ''}>${d}</option>`).join('')}
                        </select>
                    </div>
                    <div class="twod-select-group" style="flex: 1.8;">
                        <label class="twod-select-label">Post / Nicho</label>
                        <select class="twod-select" id="twod-select-post">
                            ${postsForDay.map((p, idx) => `<option value="${idx}" ${idx === currentPostIdx ? 'selected' : ''}>${p.titulo || `Post ${idx + 1}`}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <div class="twod-tabs">
                    <div class="twod-tab-item ${activeTab === 'fun' ? 'twod-active' : ''}" data-tab="fun">🌐 FUN Digital</div>
                    <div class="twod-tab-item ${activeTab === 'meta' ? 'twod-active' : ''}" data-tab="meta">🎯 Meta Ads</div>
                    <div class="twod-tab-item ${activeTab === 'wp' ? 'twod-active' : ''}" data-tab="wp">📝 WordPress</div>
                </div>

                <div class="twod-body">
                    ${renderTabBody(currentCampaign)}
                </div>
            `;

            // Eventos dos Controles
            panel.querySelector('#twod-btn-close')?.addEventListener('click', () => {
                panel.classList.add('twod-hidden');
            });

            panel.querySelector('#twod-select-day')?.addEventListener('change', (e) => {
                currentDay = e.target.value;
                currentPostIdx = 0;
                localStorage.setItem('twod_selected_day', currentDay);
                localStorage.setItem('twod_selected_post_idx', '0');
                renderPanel();
            });

            panel.querySelector('#twod-select-post')?.addEventListener('change', (e) => {
                currentPostIdx = parseInt(e.target.value, 10);
                localStorage.setItem('twod_selected_post_idx', currentPostIdx.toString());
                renderPanel();
            });

            panel.querySelectorAll('.twod-tab-item').forEach(tab => {
                tab.addEventListener('click', () => {
                    activeTab = tab.dataset.tab;
                    renderPanel();
                });
            });

            attachActionEvents(currentCampaign);
        } catch (err) {
            console.error('[TwoD AutoFill] Erro ao renderizar painel:', err);
            panel.innerHTML = `
                <div class="twod-header">
                    <div class="twod-header-title">
                        <span>⚡ TwoD AutoFill</span>
                        <span style="font-size: 10px; background: rgba(239, 68, 68, 0.2); color: #f87171; padding: 2px 6px; border-radius: 4px;">Aviso</span>
                    </div>
                    <button class="twod-icon-btn" id="twod-btn-close-err" title="Fechar">✕</button>
                </div>
                <div style="padding: 16px; color: #cbd5e1; font-size: 12px; line-height: 1.5;">
                    <div style="color: #f87171; font-weight: 700; margin-bottom: 6px;">Erro ao carregar visualização</div>
                    <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 11px; margin-bottom: 10px; color: #fca5a5; word-break: break-all;">
                        ${err.message || err}
                    </div>
                    <button class="twod-btn-secondary" id="twod-btn-retry-render" style="color: #38bdf8; border-color: rgba(56, 189, 248, 0.4); justify-content: center;">
                        🔄 Recarregar Painel
                    </button>
                </div>
            `;
            panel.querySelector('#twod-btn-close-err')?.addEventListener('click', () => panel.classList.add('twod-hidden'));
            panel.querySelector('#twod-btn-retry-render')?.addEventListener('click', () => renderPanel());
        }
    }

    // Renderizar Corpo de Cada Aba
    function renderTabBody(campaign) {
        if (!campaign.titulo) return `<div style="text-align:center; padding: 20px; color: #94a3b8;">Nenhum post selecionado</div>`;

        if (activeTab === 'fun') {
            const queueItemsHtml = SITES_QUEUE.map((s, idx) => {
                let badgeColor = s.lang === 'es' ? '#f59e0b' : '#38bdf8';
                let isCurrent = isQueueRunning && currentQueueStep === idx;
                let isDone = isQueueRunning && currentQueueStep > idx;
                let statusText = isCurrent ? '⏳ Processando...' : (isDone ? '✅ Pronto' : s.lang.toUpperCase());
                let borderStyle = isCurrent ? 'border: 1px solid #10b981; background: rgba(16, 185, 129, 0.15);' : 'border: 1px solid rgba(255,255,255,0.05);';
                const siteTitle = (campaign.seo && campaign.seo[s.seoIndex]) || campaign.titulo || '';
                return `
                    <div style="padding: 5px 8px; border-radius: 6px; margin-bottom: 4px; font-size: 11px; ${borderStyle}">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                            <span style="font-weight: 700; color: #f1f5f9;">${idx + 1}. ${s.name}</span>
                            <span style="font-size: 9px; font-weight: 700; color: ${badgeColor};">${statusText}</span>
                        </div>
                        <div style="font-size: 10px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${siteTitle}">
                            📝 ${siteTitle}
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="twod-card" style="border-color: rgba(16, 185, 129, 0.3); background: rgba(16, 185, 129, 0.05);">
                    <div class="twod-card-title" style="color: #34d399;">
                        <span>🚀 Fila de 9 Sites (Títulos Individuais)</span>
                        <span style="font-size: 10px; background: rgba(16, 185, 129, 0.2); padding: 2px 6px; border-radius: 4px;">Automático</span>
                    </div>
                    <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 8px; line-height: 1.4;">
                        Preenche cada site com seu respectivo título (7 em Português e 2 em Espanhol nos sites Kiuvix e Twod 2) e clica em <strong>Adicionar à Fila</strong>.
                    </div>
                    <div style="max-height: 170px; overflow-y: auto; background: rgba(15, 23, 42, 0.5); padding: 6px; border-radius: 6px; margin-bottom: 8px;">
                        ${queueItemsHtml}
                    </div>
                    ${isQueueRunning ? `
                        <button class="twod-btn-secondary" id="twod-btn-stop-queue" style="background: #ef4444; border-color: #ef4444; color: white;">
                            ⏹ Parar Fila
                        </button>
                    ` : `
                        <button class="twod-btn-primary" id="twod-btn-run-queue" style="background: linear-gradient(135deg, #059669 0%, #2563eb 100%);">
                            🚀 Iniciar Fila de Sites (9 Sites)
                        </button>
                    `}
                </div>

                <div class="twod-card">
                    <div class="twod-card-title">
                        <span>Dados do Post Selecionado</span>
                        <span style="color:#10b981; font-weight:600;">${campaign.tipo || 'Geral'}</span>
                    </div>
                    <div style="font-weight: 700; color: #fff; margin-bottom: 4px;">${campaign.titulo}</div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px;">Autor padrão: <strong>Alexandre / Thiago</strong></div>
                    <div style="font-size: 11px; color: #94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${campaign.tag || ''}">
                        Tags: ${campaign.tag || 'Nenhuma tag'}
                    </div>
                </div>

                <button class="twod-btn-secondary" id="twod-btn-fun-all" style="border-color: #3b82f6; color: #60a5fa;">
                    ⚡ Preencher Apenas Este Site Atual (Sem Fila)
                </button>

                <div style="margin: 8px 0; font-size: 11px; color: #94a3b8; text-align: center; text-transform: uppercase; letter-spacing: 0.05em;">
                    Ou execute passo a passo:
                </div>

                <button class="twod-btn-secondary" id="twod-btn-fun-step1">
                    1️⃣ Categoria, Autor, Título, Apps & Sugerir IA
                </button>

                <button class="twod-btn-secondary" id="twod-btn-fun-step2">
                    2️⃣ Preencher Tags & Apps nos 3 Secundários
                </button>
            `;
        }

        if (activeTab === 'meta') {
            const campSlug = campaign?.campanha || (campaign?.titulo ? campaign.titulo.replace(/\s+/g, '') : 'Campanha');
            const savedLinks = getSavedCampaignLinks(currentDay, campSlug);

            // Determinar o site ativo (ou auto-detectado na tela, ou selecionado manualmente)
            const screenCampName = getCurrentCampaignNameFromScreen();
            const autoDetectedKey = detectSiteKeyFromScreen(screenCampName);
            const activeKey = selectedMetaSiteKey || autoDetectedKey || 'app';
            const currentSiteObj = SITES_META.find(s => s.key === activeKey) || SITES_META[1];
            const activeUrl = savedLinks[activeKey] || '';
            const activePostId = extractPostIdFromUrl(activeUrl);
            const filledCount = SITES_META.filter(s => !!savedLinks[s.key]).length;
            const currentBlockObj = COUNTRY_BLOCKS.find(b => b.id === selectedCountryBlockId) || COUNTRY_BLOCKS[0];

            return `
                <!-- Card de Links dos Sites (PostID + Destino) -->
                <div class="twod-card" style="border-color: rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08);">
                    <div class="twod-card-title" style="color: #34d399; display: flex; justify-content: space-between; align-items: center;">
                        <span>🔗 Link do Post (PostID + URL Destino)</span>
                        <button type="button" id="twod-btn-toggle-links" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 11px; padding: 0;">
                            ${isLinksManagerOpen ? '▲ Fechar' : `▼ Gerenciar 9 Sites (${filledCount}/9)`}
                        </button>
                    </div>

                    <!-- Seletor do Site e URL Ativa -->
                    <div style="margin-top: 6px; font-size: 11px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <span style="color: #cbd5e1;">Site da Conta:</span>
                            <select id="twod-select-meta-site" style="background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: #38bdf8; font-size: 11px; font-weight: 600; padding: 2px 6px;">
                                ${SITES_META.map(s => `
                                    <option value="${s.key}" ${s.key === activeKey ? 'selected' : ''}>
                                        ${s.name} ${s.lang === 'es' ? '🇪🇸' : '🇧🇷'} ${savedLinks[s.key] ? '✓' : ''}
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <div style="display: flex; gap: 6px; align-items: center;">
                            <input type="text" id="twod-input-current-url" value="${activeUrl}"
                                   placeholder="Cole a URL da FUN (ex: https://${currentSiteObj.domain}/2859/...)"
                                   style="flex: 1; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 5px 8px; color: #f8fafc; font-size: 11px; outline: none;" />
                            <span id="twod-badge-postid" style="font-size: 10px; font-weight: 700; background: ${activePostId ? 'rgba(16, 185, 129, 0.25)' : 'rgba(148, 163, 184, 0.15)'}; color: ${activePostId ? '#34d399' : '#94a3b8'}; padding: 4px 6px; border-radius: 4px; white-space: nowrap;">
                                ${activePostId ? `ID: ${activePostId}` : 'Sem ID'}
                            </span>
                        </div>
                    </div>

                    <!-- Gerenciador Expansível dos 9 Sites -->
                    <div id="twod-links-manager-box" class="${isLinksManagerOpen ? '' : 'twod-hidden'}" style="margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 8px;">
                        <div style="font-size: 10px; color: #94a3b8; margin-bottom: 4px;">
                            Cole a lista de links da FUN (pode colar todos os nichos do dia juntos):
                        </div>
                        <textarea id="twod-bulk-links-input" placeholder="Cole aqui os links da FUN (um por linha)..."
                                  style="width: 100%; height: 70px; background: #0f172a; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 6px; color: #cbd5e1; font-size: 10px; resize: vertical; margin-bottom: 6px; outline: none;"></textarea>
                        <button type="button" class="twod-btn-secondary" id="twod-btn-distribute-links" style="font-size: 10px; padding: 5px 10px; width: 100%; justify-content: center; margin-bottom: 8px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border-color: rgba(56, 189, 248, 0.3);">
                            ⚡ Distribuir Links (Auto-Detecta Nichos e Sites)
                        </button>

                        <div style="display: flex; flex-direction: column; gap: 4px; max-height: 150px; overflow-y: auto; padding-right: 2px;">
                            ${SITES_META.map(s => `
                                <div class="twod-site-link-row">
                                    <span class="twod-site-link-name" title="${s.domain}">
                                        ${s.name} <span class="${s.lang === 'es' ? 'twod-site-badge-es' : 'twod-site-badge-pt'}">${s.lang.toUpperCase()}</span>
                                    </span>
                                    <input type="text" class="twod-site-link-input" data-site-key="${s.key}" value="${savedLinks[s.key] || ''}" placeholder="https://${s.domain}/..." />
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="twod-card" style="border-color: rgba(59, 130, 246, 0.4); background: rgba(59, 130, 246, 0.08);">
                    <div class="twod-card-title" style="color: #60a5fa;">
                        <span>🚀 Automação da Campanha (3 Idiomas)</span>
                        <span style="font-size: 10px; background: rgba(59, 130, 246, 0.2); padding: 2px 6px; border-radius: 4px;">1-Clique</span>
                    </div>
                    <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 8px; line-height: 1.4;">
                        Com a campanha duplicada aberta, renomeia (troca <strong>MODELO</strong> por <strong>${activePostId ? `${activePostId},` : ''}${campaign.campanha || 'Campanha'}</strong>), preenche os 7 textos e insere as URLs (<strong>/pt/</strong>, <strong>/es/</strong> e <strong>/en/</strong>) nos 3 anúncios.
                    </div>
                    ${isMetaRunning ? `
                        <button class="twod-btn-secondary" id="twod-btn-stop-meta" style="background: #ef4444; border-color: #ef4444; color: white;">
                            ⏹ Parar Automação Meta
                        </button>
                    ` : `
                        <button class="twod-btn-primary" id="twod-btn-run-meta-full" style="background: linear-gradient(135deg, #2563eb 0%, #10b981 100%);">
                            🚀 Preencher Campanha Completa (3 Idiomas)
                        </button>
                    `}
                </div>

                <!-- Card de Duplicação em Massa (Por Bloco de Países) -->
                <div class="twod-card" style="border-color: rgba(168, 85, 247, 0.4); background: rgba(168, 85, 247, 0.08);">
                    <div class="twod-card-title" style="color: #c084fc; display: flex; justify-content: space-between; align-items: center;">
                        <span>🌍 Duplicação em Massa (Por Países)</span>
                        <span style="font-size: 10px; background: rgba(168, 85, 247, 0.25); color: #e9d5ff; padding: 2px 6px; border-radius: 4px;">Escala</span>
                    </div>
                    <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 8px; line-height: 1.4;">
                        Duplica o conjunto base (<strong>${currentBlockObj.baseSetName}</strong>), desmarca recomendações, ativa o conjunto, renomeia para o país, define orçamento diário em <strong>$ ${countryDuplicationBudget}</strong> e altera localização selecionando <strong>País</strong>.
                    </div>

                    <!-- Seletor de Bloco -->
                    <div style="margin-bottom: 8px;">
                        <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 3px; font-weight: 600;">Selecione o Bloco:</label>
                        <select id="twod-select-country-block" style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 5px 8px; color: #e9d5ff; font-size: 11px; font-weight: 600;">
                            ${COUNTRY_BLOCKS.map(b => `<option value="${b.id}" ${b.id === selectedCountryBlockId ? 'selected' : ''}>${b.name}</option>`).join('')}
                        </select>
                    </div>

                    <!-- Orçamento Diário Inicial & Base Exigida -->
                    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px;">
                        <div style="flex: 1;">
                            <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 3px; font-weight: 600;">Orçamento Diário ($):</label>
                            <input type="text" id="twod-input-country-budget" value="${countryDuplicationBudget}" placeholder="1,00"
                                   style="width: 100%; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 5px 8px; color: #f8fafc; font-size: 11px; font-weight: 600;" />
                        </div>
                        <div style="flex: 1.2;">
                            <label style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 3px; font-weight: 600;">Conjunto Base Exigido:</label>
                            <div style="font-size: 10px; color: #38bdf8; background: rgba(56, 189, 248, 0.15); padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(56, 189, 248, 0.3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${currentBlockObj.baseSetName}">
                                📌 ${currentBlockObj.baseSetName}
                            </div>
                        </div>
                    </div>

                    <!-- Opção de Pular Países já existentes -->
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                        <input type="checkbox" id="twod-check-skip-existing-countries" ${countryDuplicationSkipExisting ? 'checked' : ''} style="cursor: pointer;" />
                        <label for="twod-check-skip-existing-countries" style="font-size: 10px; color: #94a3b8; cursor: pointer; user-select: none;">
                            Pular países que já existem nesta campanha
                        </label>
                    </div>

                    <!-- Lista Preview dos Países do Bloco -->
                    <div style="max-height: 85px; overflow-y: auto; background: rgba(15, 23, 42, 0.6); padding: 6px 8px; border-radius: 6px; margin-bottom: 10px; border: 1px solid rgba(255,255,255,0.06); font-size: 10px; color: #cbd5e1; line-height: 1.6;">
                        ${currentBlockObj.countries.map((c, i) => `
                            <span class="twod-country-chip ${countryDuplicationCurrentCountry === c.name ? 'twod-chip-active' : ''}">
                                ${i + 1}. ${c.name}
                            </span>
                        `).join('')}
                    </div>

                    ${isCountryDuplicationRunning ? `
                        <div style="font-size: 11px; color: #f59e0b; margin-bottom: 8px; font-weight: 600; text-align: center;">
                            ⏳ Duplicando: ${countryDuplicationCurrentCountry} (${countryDuplicationProgress.current}/${countryDuplicationProgress.total})
                        </div>
                        <button class="twod-btn-secondary" id="twod-btn-stop-country-duplication" style="background: #ef4444; border-color: #ef4444; color: white;">
                            ⏹ Parar Duplicação de Países
                        </button>
                    ` : `
                        <button class="twod-btn-primary" id="twod-btn-run-country-duplication" style="background: linear-gradient(135deg, #9333ea 0%, #2563eb 100%);">
                            🚀 Duplicar ${currentBlockObj.countries.length} Países (${currentBlockObj.id.toUpperCase()})
                        </button>
                    `}
                </div>

                <div class="twod-card">
                    <div class="twod-card-title">Preenchimento Individual (Avulso)</div>
                    <div style="font-size: 11px; color: #94a3b8; margin-bottom: 8px;">
                        Ações individuais ou avulsas:
                    </div>

                    <button class="twod-btn-secondary" id="twod-btn-rename-campaign" style="margin-bottom: 6px; border-color: rgba(96, 165, 250, 0.4); color: #93c5fd; background: rgba(59, 130, 246, 0.1);">
                        📝 Renomear Campanha (${activePostId ? `${activePostId},` : ''}${campaign.campanha || 'Nome'})
                    </button>
                    <button class="twod-btn-secondary" id="twod-btn-fill-only-url" style="margin-bottom: 6px; border-color: rgba(52, 211, 153, 0.4); color: #34d399; background: rgba(16, 185, 129, 0.1);">
                        🔗 Inserir Apenas URL do Site no Anúncio Aberto
                    </button>
                    <button class="twod-btn-secondary twod-meta-btn-pt" id="twod-btn-meta-pt" style="margin-bottom: 6px; color: white;">
                        🇧🇷 Preencher Apenas Brasil (PT + URL)
                    </button>
                    <button class="twod-btn-secondary twod-meta-btn-es" id="twod-btn-meta-es" style="margin-bottom: 6px; color: white;">
                        🇪🇸 Preencher Apenas EUA (ES + URL)
                    </button>
                    <button class="twod-btn-secondary twod-meta-btn-en" id="twod-btn-meta-en" style="color: white;">
                        🇺🇸 Preencher Apenas EUA (EN + URL)
                    </button>
                </div>

                <div class="twod-card">
                    <div class="twod-card-title">Mapeamento dos 7 Campos</div>
                    <div style="font-size: 11px; color: #94a3b8; line-height: 1.4;">
                        • <strong>2 Textos Principais</strong> (Headline + Descrição)<br>
                        • <strong>3 Títulos</strong> (Ex: BINGO AO VIVO, JOGADORES, APLICATIVO GRÁTIS)<br>
                        • <strong>2 Descrições</strong> (⭐⭐⭐⭐⭐ e BAIXE AGORA)<br>
                        • <strong>1 Destino</strong> (URL do site com /pt/, /es/ e /en/)
                    </div>
                </div>
            `;
        }

        if (activeTab === 'wp') {
            const allWpRows = getWordPressPostRows();
            const totalOnPage = allWpRows.length;
            const targetCount = Math.min(wpTargetCount || 8, Math.max(totalOnPage, 1));
            const nichesForDay = data[currentDay] || [];
            const allNiches = Object.values(data).flat();

            if (totalOnPage === 0) {
                return `
                    <div class="twod-card" style="border-color: rgba(168, 85, 247, 0.4); background: rgba(168, 85, 247, 0.08);">
                        <div class="twod-card-title" style="color: #c084fc;">
                            <span>📝 Automação WordPress (Tags & Comentários)</span>
                        </div>
                        <div style="font-size: 11px; color: #cbd5e1; line-height: 1.5; margin-bottom: 12px;">
                            Abra a tela <strong>Todos os Posts</strong> (<code style="color: #38bdf8;">wp-admin/edit.php</code>) em qualquer um dos seus sites para que a automação identifique os posts recentes e preencha as etiquetas automaticamente.
                        </div>
                        <button class="twod-btn-secondary" id="twod-btn-refresh-wp" style="border-color: #a855f7; color: #c084fc; justify-content: center;">
                            🔄 Verificar Página Novamente
                        </button>
                    </div>
                `;
            }

            const targetRows = allWpRows.slice(0, targetCount);
            const items = targetRows.map((row, idx) => {
                const postId = (row.id || '').replace('post-', '');
                const postTitle = getPostTitleFromRow(row);
                let assignedNiche = null;
                if (wpCustomNicheAssignments[postId]) {
                    assignedNiche = allNiches.find(n => (n.campanha || n.titulo) === wpCustomNicheAssignments[postId]);
                }
                if (!assignedNiche) {
                    assignedNiche = detectNicheForPost(postTitle, nichesForDay, allNiches);
                }
                return { row, postId, postTitle, matchedNiche: assignedNiche };
            });

            const itemsHtml = items.map((item, idx) => {
                const isCurrent = isWordPressRunning && currentWpStep === idx;
                const isDone = isWordPressRunning && currentWpStep > idx;
                const borderStyle = isCurrent 
                    ? 'border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.15);' 
                    : (isDone ? 'border: 1px solid rgba(16, 185, 129, 0.4); background: rgba(16, 185, 129, 0.08);' : 'border: 1px solid rgba(255,255,255,0.06); background: rgba(15, 23, 42, 0.5);');
                const statusBadge = isCurrent 
                    ? '<span style="color:#f59e0b; font-weight:700;">⏳ Processando...</span>' 
                    : (isDone ? '<span style="color:#10b981; font-weight:700;">✅ Pronto</span>' : '');

                return `
                    <div style="padding: 6px 8px; border-radius: 6px; margin-bottom: 4px; font-size: 11px; ${borderStyle}">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <span style="font-weight: 700; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px;" title="${item.postTitle}">
                                ${idx + 1}. ${item.postTitle || `Post #${item.postId}`}
                            </span>
                            ${statusBadge ? `<span style="font-size: 10px; margin-left: 6px; flex-shrink: 0;">${statusBadge}</span>` : ''}
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px;">
                            <span style="font-size: 10px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="Tags: ${item.matchedNiche?.tag || ''}">
                                🏷️ Tags: <strong style="color: #cbd5e1;">${item.matchedNiche?.titulo || 'Nenhum'}</strong>
                            </span>
                            <select class="twod-wp-select twod-wp-niche-select" data-post-id="${item.postId}" style="font-size: 10px; padding: 1px 4px;">
                                ${nichesForDay.map(n => `<option value="${n.campanha || n.titulo}" ${item.matchedNiche?.titulo === n.titulo ? 'selected' : ''}>${n.titulo}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                `;
            }).join('');

            return `
                <div class="twod-card" style="border-color: rgba(168, 85, 247, 0.4); background: rgba(168, 85, 247, 0.08);">
                    <div class="twod-card-title" style="color: #c084fc; display: flex; justify-content: space-between; align-items: center;">
                        <span>📝 Ajustar Tags & Desmarcar Comentários</span>
                        <span style="font-size: 10px; background: rgba(168, 85, 247, 0.2); color: #c084fc; padding: 2px 6px; border-radius: 4px;">Automático</span>
                    </div>
                    <div style="font-size: 11px; color: #cbd5e1; margin-bottom: 8px; line-height: 1.4;">
                        Executa a <strong>Edição Rápida</strong> nos posts recentes: preenche as <strong>Etiquetas</strong> do nicho correspondente e desmarca <strong>Comentários</strong> e <strong>Pings</strong>.
                    </div>

                    <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(15, 23, 42, 0.6); padding: 6px 10px; border-radius: 6px; margin-bottom: 8px; font-size: 11px;">
                        <span style="color: #94a3b8;">Textos a processar:</span>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="number" id="twod-wp-count-input" value="${targetCount}" min="1" max="${totalOnPage}" style="width: 50px; background: #0f172a; border: 1px solid rgba(255,255,255,0.2); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; text-align: center;" />
                            <span style="color: #64748b; font-size: 10px;">(de ${totalOnPage})</span>
                            <button type="button" id="twod-btn-refresh-wp" class="twod-icon-btn" title="Recarregar posts" style="font-size: 12px; padding: 2px;">🔄</button>
                        </div>
                    </div>

                    <div style="max-height: 180px; overflow-y: auto; background: rgba(15, 23, 42, 0.5); padding: 6px; border-radius: 6px; margin-bottom: 8px;">
                        ${itemsHtml}
                    </div>

                    <div style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); padding: 6px 8px; border-radius: 6px; font-size: 10px; color: #34d399; margin-bottom: 8px; line-height: 1.4;">
                        🛡️ <strong>Modo Ultra-Seguro:</strong> Nenhum texto é excluído (botões de lixeira ignorados) e nenhum post antigo além dos ${targetCount} recentes é tocado.
                    </div>

                    ${isWordPressRunning ? `
                        <div style="margin-bottom: 8px; font-size: 11px; color: #fbbf24; text-align: center;">
                            ${currentWpStatus || 'Processando textos...'}
                        </div>
                        <button class="twod-btn-secondary" id="twod-btn-stop-wp" style="background: #ef4444; border-color: #ef4444; color: white;">
                            ⏹ Parar Processamento
                        </button>
                    ` : `
                        <button class="twod-btn-primary" id="twod-btn-run-wp" style="background: linear-gradient(135deg, #7c3aed 0%, #2563eb 100%);">
                            🚀 Preencher Tags & Tirar Comentários (${targetCount} Textos)
                        </button>
                    `}
                </div>
            `;
        }

        return '';
    }

    // Vincular Eventos de Automação
    function attachActionEvents(campaign) {

        // Automação FUN Digital
        const btnRunQueue = panel.querySelector('#twod-btn-run-queue');
        const btnStopQueue = panel.querySelector('#twod-btn-stop-queue');
        const btnFunAll = panel.querySelector('#twod-btn-fun-all');
        const btnFunStep1 = panel.querySelector('#twod-btn-fun-step1');
        const btnFunStep2 = panel.querySelector('#twod-btn-fun-step2');

        if (btnRunQueue) {
            btnRunQueue.addEventListener('click', async () => {
                await runSitesQueue(campaign);
            });
        }

        if (btnStopQueue) {
            btnStopQueue.addEventListener('click', () => {
                isQueueRunning = false;
                currentQueueStep = -1;
                renderPanel();
                showToast('Fila interrompida!');
            });
        }

        if (btnFunStep1) {
            btnFunStep1.addEventListener('click', async () => {
                await executeFunDigitalStep1(campaign);
            });
        }

        if (btnFunStep2) {
            btnFunStep2.addEventListener('click', async () => {
                await executeFunDigitalStep2(campaign);
            });
        }

        if (btnFunAll) {
            btnFunAll.addEventListener('click', async () => {
                const s1Success = await executeFunDigitalStep1(campaign);
                if (s1Success) {
                    showToast('Passo 1 concluído! Aguardando IA gerar os 3 títulos secundários...');

                    // Espera dinâmica: aguarda até a IA terminar de gerar os 3 secundários (indicado por 3/3 na tela)
                    let ready = false;
                    for (let w = 0; w < 24; w++) { // até 12 segundos
                        await sleep(500);
                        const bodyTxt = document.body.innerText || '';
                        if (bodyTxt.includes('Textos Secundários 3/3') || bodyTxt.includes('3/3')) {
                            ready = true;
                            break;
                        }
                    }

                    await sleep(600); // estabilizar a tela
                    await executeFunDigitalStep2(campaign);
                }
            });
        }

        // Automação Meta Ads
        const btnRunMetaFull = panel.querySelector('#twod-btn-run-meta-full');
        const btnStopMeta = panel.querySelector('#twod-btn-stop-meta');
        const btnMetaPt = panel.querySelector('#twod-btn-meta-pt');
        const btnMetaEs = panel.querySelector('#twod-btn-meta-es');
        const btnMetaEn = panel.querySelector('#twod-btn-meta-en');
        const btnRenameCampaign = panel.querySelector('#twod-btn-rename-campaign');
        const btnFillOnlyUrl = panel.querySelector('#twod-btn-fill-only-url');

        // Controles de Links dos Sites
        const btnToggleLinks = panel.querySelector('#twod-btn-toggle-links');
        const selectMetaSite = panel.querySelector('#twod-select-meta-site');
        const inputCurrentUrl = panel.querySelector('#twod-input-current-url');
        const btnDistribute = panel.querySelector('#twod-btn-distribute-links');
        const bulkTextarea = panel.querySelector('#twod-bulk-links-input');
        const campSlug = campaign?.campanha || (campaign?.titulo ? campaign.titulo.replace(/\s+/g, '') : 'Campanha');

        if (btnToggleLinks) {
            btnToggleLinks.addEventListener('click', () => {
                isLinksManagerOpen = !isLinksManagerOpen;
                renderPanel();
            });
        }

        if (selectMetaSite) {
            selectMetaSite.addEventListener('change', (e) => {
                selectedMetaSiteKey = e.target.value;
                renderPanel();
            });
        }

        if (inputCurrentUrl) {
            inputCurrentUrl.addEventListener('input', (e) => {
                const url = e.target.value.trim();
                const activeKey = selectMetaSite ? selectMetaSite.value : (selectedMetaSiteKey || 'app');
                const links = getSavedCampaignLinks(currentDay, campSlug);
                links[activeKey] = url;
                saveCampaignLinks(currentDay, campSlug, links);

                const badge = panel.querySelector('#twod-badge-postid');
                const pid = extractPostIdFromUrl(url);
                if (badge) {
                    badge.innerText = pid ? `ID: ${pid}` : 'Sem ID';
                    badge.style.color = pid ? '#34d399' : '#94a3b8';
                    badge.style.background = pid ? 'rgba(16, 185, 129, 0.25)' : 'rgba(148, 163, 184, 0.15)';
                }
            });
        }

        if (btnDistribute && bulkTextarea) {
            btnDistribute.addEventListener('click', () => {
                const text = bulkTextarea.value.trim();
                if (!text) {
                    showToast('Cole os links no campo acima primeiro.', true);
                    return;
                }
                const postsForDay = data[currentDay] || [campaign];
                const { results, totalCount } = distributeSmartBulkUrls(text, postsForDay, campaign);

                if (totalCount === 0) {
                    showToast('Nenhum link reconhecido dos 9 sites da TwoD.', true);
                    return;
                }

                // Salvar os links em cada campanha/nicho detectado
                const summary = [];
                for (const slug of Object.keys(results)) {
                    const links = getSavedCampaignLinks(currentDay, slug);
                    Object.assign(links, results[slug]);
                    saveCampaignLinks(currentDay, slug, links);

                    const pObj = postsForDay.find(p => (p.campanha || p.titulo?.replace(/\s+/g, '')) === slug);
                    const name = pObj ? pObj.titulo : slug;
                    summary.push(`${name} (${Object.keys(results[slug]).length})`);
                }

                showToast(`✅ ${totalCount} links distribuídos! [${summary.join(' • ')}]`);
                renderPanel();
            });
        }

        // Inputs individuais dos 9 sites na lista
        panel.querySelectorAll('.twod-site-link-input').forEach(inp => {
            inp.addEventListener('change', (e) => {
                const k = e.target.getAttribute('data-site-key');
                const val = e.target.value.trim();
                const links = getSavedCampaignLinks(currentDay, campSlug);
                links[k] = val;
                saveCampaignLinks(currentDay, campSlug, links);
                if (k === (selectMetaSite?.value || selectedMetaSiteKey)) {
                    if (inputCurrentUrl) inputCurrentUrl.value = val;
                }
            });
        });

        if (btnRunMetaFull) {
            btnRunMetaFull.addEventListener('click', async () => {
                await runMetaFullCampaign(campaign);
            });
        }

        if (btnStopMeta) {
            btnStopMeta.addEventListener('click', () => {
                isMetaRunning = false;
                renderPanel();
                showToast('Automação Meta interrompida!');
            });
        }

        // Controles de Duplicação por Bloco de Países
        const selectCountryBlock = panel.querySelector('#twod-select-country-block');
        const inputCountryBudget = panel.querySelector('#twod-input-country-budget');
        const checkSkipExisting = panel.querySelector('#twod-check-skip-existing-countries');
        const btnRunCountryDup = panel.querySelector('#twod-btn-run-country-duplication');
        const btnStopCountryDup = panel.querySelector('#twod-btn-stop-country-duplication');

        if (selectCountryBlock) {
            selectCountryBlock.addEventListener('change', (e) => {
                selectedCountryBlockId = e.target.value;
                localStorage.setItem('twod_country_block', selectedCountryBlockId);
                renderPanel();
            });
        }

        if (inputCountryBudget) {
            inputCountryBudget.addEventListener('input', (e) => {
                countryDuplicationBudget = e.target.value.trim() || '1,00';
                localStorage.setItem('twod_country_budget', countryDuplicationBudget);
            });
        }

        if (checkSkipExisting) {
            checkSkipExisting.addEventListener('change', (e) => {
                countryDuplicationSkipExisting = e.target.checked;
                localStorage.setItem('twod_country_skip_existing', countryDuplicationSkipExisting ? 'true' : 'false');
            });
        }

        if (btnRunCountryDup) {
            btnRunCountryDup.addEventListener('click', async () => {
                const budgetVal = inputCountryBudget ? inputCountryBudget.value.trim() : countryDuplicationBudget;
                await runCountryDuplication(selectedCountryBlockId, budgetVal || '1,00');
            });
        }

        if (btnStopCountryDup) {
            btnStopCountryDup.addEventListener('click', () => {
                isCountryDuplicationRunning = false;
                countryDuplicationCurrentCountry = '';
                renderPanel();
                showToast('⏹ Duplicação de países interrompida!');
            });
        }

        if (btnRenameCampaign) {
            btnRenameCampaign.addEventListener('click', async () => {
                const links = getSavedCampaignLinks(currentDay, campSlug);
                const screenCampName = getCurrentCampaignNameFromScreen();
                const autoKey = detectSiteKey(screenCampName);
                const activeKey = selectedMetaSiteKey || autoKey || 'app';
                const baseSiteUrl = (inputCurrentUrl ? inputCurrentUrl.value.trim() : '') || links[activeKey] || '';
                const pid = extractPostIdFromUrl(baseSiteUrl);
                await updateMetaCampaignName(campaign, pid);
            });
        }

        if (btnFillOnlyUrl) {
            btnFillOnlyUrl.addEventListener('click', async () => {
                await fillOnlyUrlOnActiveAd(campaign);
            });
        }

        if (btnMetaPt) btnMetaPt.addEventListener('click', () => executeMetaAdsFill(campaign, 'pt'));
        if (btnMetaEs) btnMetaEs.addEventListener('click', () => executeMetaAdsFill(campaign, 'es'));
        if (btnMetaEn) btnMetaEn.addEventListener('click', () => executeMetaAdsFill(campaign, 'en'));

        // Automação WordPress
        const btnRunWp = panel.querySelector('#twod-btn-run-wp');
        const btnStopWp = panel.querySelector('#twod-btn-stop-wp');
        const btnRefreshWp = panel.querySelector('#twod-btn-refresh-wp');
        const inputWpCount = panel.querySelector('#twod-wp-count-input');

        if (inputWpCount) {
            inputWpCount.addEventListener('change', (e) => {
                wpTargetCount = Math.max(1, parseInt(e.target.value, 10) || 8);
                localStorage.setItem('twod_wp_count', wpTargetCount.toString());
                renderPanel();
            });
        }

        if (btnRefreshWp) {
            btnRefreshWp.addEventListener('click', () => {
                renderPanel();
                showToast('Lista de posts do WordPress atualizada!');
            });
        }

        panel.querySelectorAll('.twod-wp-niche-select').forEach(sel => {
            sel.addEventListener('change', (e) => {
                const postId = e.target.getAttribute('data-post-id');
                if (postId) {
                    wpCustomNicheAssignments[postId] = e.target.value;
                }
            });
        });

        if (btnRunWp) {
            btnRunWp.addEventListener('click', async () => {
                await executeWordPressBulkQuickEdit(wpTargetCount);
            });
        }

        if (btnStopWp) {
            btnStopWp.addEventListener('click', () => {
                wpStopRequested = true;
                showToast('Interrupção solicitada...');
            });
        }
    }

    // ==========================================
    // FUNÇÕES DE BUSCA E DROP DOWNS NA FUN DIGITAL
    // ==========================================

    // Encontrar os botões dos sites na barra de Destino
    function getDestinoSiteButtons() {
        const allElements = Array.from(document.querySelectorAll('*'));
        const destinoHeading = allElements.find(el => {
            const t = (el.innerText || '').trim();
            return (t === 'Destino' || t.startsWith('Destino')) && el.children.length <= 2 && !el.closest('#twod-floating-root');
        });
        if (!destinoHeading) return [];

        let container = destinoHeading.parentElement;
        for (let i = 0; i < 4; i++) {
            if (!container) break;
            const siteSpans = Array.from(container.querySelectorAll('span, p, div')).filter(el => {
                const txt = (el.innerText || '').trim().toLowerCase();
                return ['ai', 'app', 'blingalax', 'twodcompa', 'f4rol', 'hub', 'kiocom', 'kiuvix', 'thehatsune'].some(s => txt.startsWith(s)) && el.children.length === 0;
            });
            if (siteSpans.length >= 8) {
                return siteSpans.map(s => s.closest('button, [role="button"], [class*="cursor-pointer" i]') || s.parentElement);
            }
            container = container.parentElement;
        }
        return [];
    }

    // Selecionar site pelo índice (0 = Ai, 1 = App, 3 = Twod 1, 4 = F4rol, etc.)
    async function selectSiteByIndex(idx) {
        const buttons = getDestinoSiteButtons();
        if (buttons.length > idx && buttons[idx]) {
            buttons[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            buttons[idx].click();
            return true;
        }
        return false;
    }

    // Clicar no botão verde "Adicionar à Fila"
    async function clickAdicionarAFila() {
        const buttons = Array.from(document.querySelectorAll('button'));
        const filaBtn = buttons.find(b => {
            const t = (b.innerText || '').trim().toLowerCase();
            return t.includes('adicionar à fila') || t.includes('adicionar a fila');
        });
        if (filaBtn) {
            filaBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            filaBtn.disabled = false;
            filaBtn.removeAttribute('disabled');
            filaBtn.click();
            return true;
        }
        return false;
    }

    // Clicar no botão "+ Criar outro bloco" após confirmação
    async function clickCriarOutroBloco() {
        for (let i = 0; i < 20; i++) {
            await sleep(350);
            const allButtons = Array.from(document.querySelectorAll('button'));

            // 1. Procura o botão principal verde do modal "+ Criar outro bloco"
            const btn = allButtons.find(b => {
                const t = (b.innerText || '').trim().toLowerCase();
                return t.includes('criar outro bloco') || t.includes('outro bloco');
            });
            if (btn) {
                btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                btn.click();
                await sleep(1000); // aguarda a tela do formulário recarregar
                return true;
            }

            // 2. Fallback: botão "+ Criar" no cabeçalho
            const topCriar = allButtons.find(b => (b.innerText || '').trim() === '+ Criar');
            if (topCriar && (document.body.innerText || '').includes('Bloco adicionado')) {
                topCriar.click();
                await sleep(1000);
                return true;
            }
        }
        return false;
    }

    // Executar a fila completa dos 9 sites para o mesmo nicho
    async function runSitesQueue(campaign) {
        if (isQueueRunning) return;
        isQueueRunning = true;

        for (let s = 0; s < SITES_QUEUE.length; s++) {
            if (!isQueueRunning) {
                showToast('Fila cancelada pelo usuário.', true);
                break;
            }

            const site = SITES_QUEUE[s];
            currentQueueStep = s;
            renderPanel();
            showToast(`[${s + 1}/${SITES_QUEUE.length}] Selecionando site: ${site.name}...`);

            // 1. Clica no ícone do site
            const okSelect = await selectSiteByIndex(site.index);
            if (!okSelect) {
                showToast(`Aviso: Botão do site ${site.name} não encontrado. Tentando prosseguir...`, true);
            }
            await sleep(1000); // aguarda tela carregar configurações do site

            // 2. Idioma: Espanhol para Kiuvix e Twod 2; Português para os demais
            const idiomaAlvo = site.lang === 'es' ? ['Espanhol', 'Español', 'ES'] : ['Português (BR)', 'Português', 'PT'];
            await selectDropdownOption('IDIOMA', idiomaAlvo);
            await sleep(350);

            // 3. Executa Passo 1 com o título específico deste site (7 em PT e 2 em ES)
            const siteTitle = (campaign.seo && campaign.seo[site.seoIndex]) || campaign.titulo;
            console.log(`[TwoD AutoFill] [${site.name}] Título dedicado (seo[${site.seoIndex}]): "${siteTitle}"`);
            showToast(`[${site.name}] Título: "${siteTitle}"`);
            const s1Ok = await executeFunDigitalStep1(campaign, siteTitle);
            if (!s1Ok) {
                showToast(`Falha no passo 1 do site ${site.name}. Pulando...`, true);
                continue;
            }

            // 4. Aguarda IA gerar os 3 secundários (indicado por "Textos Secundários 3/3")
            showToast(`[${site.name}] Aguardando IA gerar secundários...`);
            let ready = false;
            for (let w = 0; w < 24; w++) {
                if (!isQueueRunning) break;
                await sleep(500);
                const bodyTxt = document.body.innerText || '';
                if (bodyTxt.includes('Textos Secundários 3/3') || bodyTxt.includes('3/3')) {
                    ready = true;
                    break;
                }
            }
            if (!isQueueRunning) break;
            await sleep(700);

            // 5. Executa Passo 2 (Tags e Apps nos 3 Secundários)
            await executeFunDigitalStep2(campaign);
            await sleep(600);

            // 6. Clica em "Adicionar à Fila"
            showToast(`[${site.name}] Adicionando à fila...`);
            const okFila = await clickAdicionarAFila();
            if (okFila) {
                showToast(`✅ [${site.name}] Adicionado à fila!`);
            } else {
                showToast(`⚠️ [${site.name}] Botão "Adicionar à Fila" não encontrado.`, true);
            }

            // 7. Clica em "+ Criar outro bloco" para resetar e voltar ao formulário para o próximo site
            showToast(`[${site.name}] Clicando em "+ Criar outro bloco"...`);
            await clickCriarOutroBloco();
            await sleep(1500); // aguarda o formulário carregar totalmente para o próximo site
        }

        isQueueRunning = false;
        currentQueueStep = -1;
        renderPanel();
        showToast('🎉 Todos os 9 sites do nicho foram processados e adicionados à fila!');
    }

    // Helper para selecionar Categoria e Autor WP
    async function selectDropdownOption(labelText, preferredValues) {
        const allElements = Array.from(document.querySelectorAll('label, div, span, p'));
        const labelEl = allElements.find(el => {
            const t = (el.innerText || '').trim().toUpperCase();
            return (t === labelText.toUpperCase() || t === labelText.toUpperCase() + ' *') && el.children.length <= 1;
        });
        if (!labelEl) return false;

        let container = labelEl.parentElement;
        for (let i = 0; i < 2; i++) {
            if (!container) break;

            // Opção A: <select> nativo
            const select = container.querySelector('select');
            if (select) {
                const options = Array.from(select.options);
                for (const val of preferredValues) {
                    const match = options.find(o => o.text.toLowerCase().includes(val.toLowerCase()));
                    if (match) {
                        select.value = match.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        select.dispatchEvent(new Event('input', { bubbles: true }));
                        return true;
                    }
                }
                return false;
            }

            // Opção B: Input ou Botão Dropdown customizado
            const clickable = container.querySelector('button, [role="combobox"], [tabindex="0"], div[class*="select" i]')
                || container.querySelector('input');

            if (clickable) {
                if (clickable.tagName === 'INPUT' && !clickable.readOnly && !clickable.classList.contains('cursor-pointer')) {
                    setReactValue(clickable, preferredValues[0]);
                    return true;
                }

                clickable.click();
                await sleep(250);

                const items = Array.from(document.querySelectorAll('[role="option"], li, div[class*="option" i], div[class*="item" i], div[class*="menu" i] span'));
                for (const val of preferredValues) {
                    const found = items.find(it => {
                        const itTxt = (it.innerText || '').trim().toLowerCase();
                        return itTxt === val.toLowerCase() || (itTxt.includes(val.toLowerCase()) && itTxt.length < 35);
                    });
                    if (found) {
                        found.click();
                        await sleep(150);
                        return true;
                    }
                }

                // Clica de novo para fechar se não encontrou
                clickable.click();
                return false;
            }

            container = container.parentElement;
        }
        return false;
    }

    // Encontrar o input do Título Principal
    function findMainTitleInput() {
        const byPh = document.querySelector('input[placeholder*="Japão" i], input[placeholder*="empréstimo no" i], input[placeholder*="Como funciona" i]');
        if (byPh) return byPh;

        const allElements = Array.from(document.querySelectorAll('label, div, span, p, h2, h3, h4'));
        const titleLabels = allElements.filter(el => {
            const t = (el.innerText || '').trim();
            return (t === 'TÍTULO *' || t === 'TÍTULO') && el.children.length <= 1;
        });

        for (const lbl of titleLabels) {
            const isSecondary = lbl.closest('#textos-secundarios')
                || (lbl.closest('div') && lbl.closest('div').innerText.includes('Título do secundário'))
                || lbl.closest('[class*="secundar" i]');

            if (!isSecondary) {
                let container = lbl.parentElement;
                for (let i = 0; i < 3; i++) {
                    if (!container) break;
                    const inp = container.querySelector('input');
                    if (inp && !inp.placeholder.includes('secundário')) return inp;
                    container = container.parentElement;
                }
            }
        }

        const linksSection = Array.from(document.querySelectorAll('*')).find(el => (el.innerText || '').includes('Links e Apps do Texto Principal'));
        if (linksSection) {
            const allInputsBefore = Array.from(document.querySelectorAll('input')).filter(i => {
                return (i.compareDocumentPosition(linksSection) & Node.DOCUMENT_POSITION_FOLLOWING);
            });
            const cand = allInputsBefore.find(i => {
                const ph = (i.placeholder || '').toLowerCase();
                return !ph.includes('palavras') && !ph.includes('crédito') && !ph.includes('japão, crédito');
            });
            if (cand) return cand;
        }

        return null;
    }

    // Encontrar o input de Palavras-Chave Principal
    function findMainKeywordsInput() {
        const byPh = document.querySelector('input[placeholder*="japão, crédito" i], input[placeholder*="crédito" i]');
        if (byPh) return byPh;

        const allElements = Array.from(document.querySelectorAll('label, div, span, p'));
        const kwLabels = allElements.filter(el => {
            const t = (el.innerText || '').trim();
            return t.startsWith('PALAVRAS-CHAVE') && el.children.length <= 1;
        });

        for (const lbl of kwLabels) {
            const isSecondary = lbl.closest('[class*="secundar" i]')
                || (lbl.closest('div') && lbl.closest('div').innerText.includes('keywords específicas'));
            if (!isSecondary) {
                let container = lbl.parentElement;
                for (let i = 0; i < 3; i++) {
                    if (!container) break;
                    const inp = container.querySelector('input');
                    if (inp && !inp.placeholder.includes('específicas')) return inp;
                    container = container.parentElement;
                }
            }
        }

        return null;
    }

    // Preencher a aba "Apps" (ao lado de Editorial) e clicar em Adicionar
    async function fillAppsForContainer(container, campaign) {
        if (!campaign.apps || (!campaign.apps[0] && !campaign.apps[1])) return false;

        // Procura a aba "Apps" (ao lado de "Editorial") dentro ou perto do container
        const allButtons = Array.from(container.querySelectorAll('button, [role="tab"], div, span'));
        const appsTab = allButtons.find(b => {
            const t = (b.innerText || '').trim();
            const isApps = (t === 'Apps' || t === '📱 Apps') && b.children.length <= 2;
            if (!isApps) return false;
            // Deve estar perto do botão "Editorial"
            const parent = b.parentElement;
            return parent && (parent.innerText || '').includes('Editorial');
        });

        if (appsTab) {
            appsTab.click();
            await sleep(300);
        }

        // Procura os inputs de Google Play URL e App Store URL
        const playInput = container.querySelector('input[placeholder*="Google Play" i]')
            || document.querySelector('input[placeholder*="Google Play" i]');
        const appInput = container.querySelector('input[placeholder*="App Store" i]')
            || document.querySelector('input[placeholder*="App Store" i]');

        let added = false;
        if (playInput && campaign.apps[0]) {
            setReactValue(playInput, campaign.apps[0]);
            added = true;
        }

        if (appInput && campaign.apps[1]) {
            setReactValue(appInput, campaign.apps[1]);
            added = true;
        }

        // Clica no botão "+ Adicionar" daquela seção de Apps especificamente
        await sleep(350);
        let addBtn = null;
        if (appInput) {
            let parent = appInput.parentElement;
            for (let k = 0; k < 3; k++) {
                if (!parent) break;
                const btns = Array.from(parent.querySelectorAll('button'));
                const found = btns.find(b => {
                    const t = (b.innerText || '').trim();
                    return t === '+ Adicionar' || t === 'Adicionar' || t.includes('Adicionar');
                });
                if (found) { addBtn = found; break; }
                parent = parent.parentElement;
            }
        }

        if (addBtn) {
            addBtn.disabled = false;
            addBtn.removeAttribute('disabled');
            addBtn.click();
            await sleep(650);
        }

        // Mantém na aba Apps (não volta para Editorial para não resetar os apps adicionados)
        return added;
    }

    // ==========================================
    // LÓGICA FUN DIGITAL
    // ==========================================
    async function executeFunDigitalStep1(campaign, customTitle) {
        // 1. Categoria: tenta o tipo do nicho, senão "Aplicativos", senão deixa como está
        const categoriasPreferidas = [campaign.tipo, 'Aplicativos', 'Apps'].filter(Boolean);
        await selectDropdownOption('CATEGORIA', categoriasPreferidas);
        await sleep(200);

        // 2. Autor WP: tenta "Alexandre", senão "Thiago", senão deixa padrão
        await selectDropdownOption('AUTOR WP', ['Alexandre', 'Thiago']);
        await sleep(200);

        // 3. Título Principal (Usa o título individual do site ou o título geral)
        const mainTitleInput = findMainTitleInput();
        if (!mainTitleInput) {
            showToast('Erro: Campo "Título Principal" não encontrado!', true);
            return false;
        }

        const titleToUse = customTitle || (campaign.seo && campaign.seo[0]) || campaign.titulo;
        setReactValue(mainTitleInput, titleToUse);
        if (!mainTitleInput.value) {
            mainTitleInput.value = titleToUse;
        }

        // 4. Tags / Palavras-chave do Texto Principal
        const keywordsInput = findMainKeywordsInput();
        if (keywordsInput && campaign.tag) {
            setReactValue(keywordsInput, campaign.tag);
        }

        // 5. Links e Apps do Texto Principal (Clica em "Apps" do lado de "Editorial", preenche e clica em Adicionar)
        const mainCard = mainTitleInput.closest('.card')
            || mainTitleInput.closest('[class*="card" i]')
            || mainTitleInput.parentElement?.parentElement?.parentElement?.parentElement
            || document;

        await fillAppsForContainer(mainCard, campaign);

        // 6. Aguardar 350ms e Clicar em "Sugerir Títulos com IA"
        await sleep(400);
        const allButtons = Array.from(document.querySelectorAll('button'));
        const suggestBtn = allButtons.find(b => b.innerText.includes('Sugerir Títulos com IA'));
        if (suggestBtn) {
            suggestBtn.click();
            showToast(`Passo 1: Título "${titleToUse}", Apps e IA acionados!`);
            return true;
        } else {
            showToast(`Passo 1: Título "${titleToUse}" preenchido!`);
            return true;
        }
    }

    // Encontrar os 3 cards secundários independente dos títulos já gerados
    function findSecondaryItemCards() {
        const allElements = Array.from(document.querySelectorAll('*'));
        const numberBadges = allElements.filter(el => {
            const t = (el.innerText || '').trim();
            return (t === '1' || t === '2' || t === '3') && el.children.length === 0 && !el.closest('#twod-floating-root');
        });

        const cards = [];
        for (const badge of numberBadges) {
            let curr = badge.parentElement;
            while (curr && curr.parentElement && curr.parentElement !== document.body) {
                const parent = curr.parentElement;
                const siblingsWithBadges = Array.from(parent.children).filter(child => {
                    return numberBadges.some(nb => child.contains(nb));
                });
                if (siblingsWithBadges.length >= 2) {
                    if (!cards.includes(curr)) cards.push(curr);
                    break;
                }
                curr = parent;
            }
        }

        if (cards.length >= 1) return cards.slice(0, 3);

        // Fallback: Procura containers sob Textos Secundários
        const secHeading = allElements.find(el => (el.innerText || '').includes('Textos Secundários'));
        if (secHeading) {
            let container = secHeading.parentElement;
            for (let i = 0; i < 3; i++) {
                if (!container) break;
                const items = Array.from(container.children).filter(c => !c.contains(secHeading) && c.innerText.length > 5);
                if (items.length >= 3) return items.slice(0, 3);
                container = container.parentElement;
            }
        }

        return [];
    }

    // Preenche um post secundário individualmente com pausa deliberada
    async function fillSecondaryPost(card, campaign) {
        // 1. Abre o card se estiver fechado
        let kwInput = card.querySelector('input[placeholder*="keywords específicas" i], input[placeholder*="keywords" i]');
        if (!kwInput) {
            const clickTarget = card.querySelector('button, [class*="cursor-pointer" i]') || card.firstElementChild || card;
            clickTarget.click();
            await sleep(400);
            kwInput = card.querySelector('input[placeholder*="keywords específicas" i], input[placeholder*="keywords" i]');
        }

        // 2. Preenche Palavras-Chave (TAGs)
        if (kwInput && campaign.tag) {
            setReactValue(kwInput, campaign.tag);
            await sleep(250);
        }

        // 3. Localiza os campos de Google Play URL e App Store URL dentro deste card secundário
        const playInput = card.querySelector('input[placeholder*="Google Play" i]');
        const appInput = card.querySelector('input[placeholder*="App Store" i]');

        if (playInput && campaign.apps && campaign.apps[0]) {
            setReactValue(playInput, campaign.apps[0]);
            await sleep(200);
        }

        if (appInput && campaign.apps && campaign.apps[1]) {
            setReactValue(appInput, campaign.apps[1]);
            await sleep(200);
        }

        // 4. Tempinho para o React validar as URLs e habilitar o botão
        await sleep(350);

        // 5. Localiza especificamente o botão "+ Adicionar" da linha de APPS (NÃO o de links!)
        let addBtn = null;
        if (appInput) {
            let parent = appInput.parentElement;
            for (let k = 0; k < 3; k++) {
                if (!parent) break;
                const btns = Array.from(parent.querySelectorAll('button'));
                const found = btns.find(b => {
                    const t = (b.innerText || '').trim();
                    return t === '+ Adicionar' || t === 'Adicionar' || t.includes('Adicionar');
                });
                if (found) {
                    addBtn = found;
                    break;
                }
                parent = parent.parentElement;
            }
        }

        // Fallback: se não achou pelo parent do appInput, busca todos os botões do card e pega o último (APPS fica depois de LINKS)
        if (!addBtn) {
            const allAddButtons = Array.from(card.querySelectorAll('button')).filter(b => {
                const t = (b.innerText || '').trim();
                return t === '+ Adicionar' || t === 'Adicionar' || t.includes('Adicionar');
            });
            if (allAddButtons.length >= 2) {
                addBtn = allAddButtons[allAddButtons.length - 1];
            } else if (allAddButtons.length === 1) {
                addBtn = allAddButtons[0];
            }
        }

        // 6. Clica em Adicionar e aguarda o badge verde aparecer antes de ir para o próximo
        if (addBtn) {
            addBtn.disabled = false;
            addBtn.removeAttribute('disabled');
            addBtn.click();
            await sleep(650); // Tempinho crucial após clicar em Adicionar
            return true;
        }

        return false;
    }

    async function executeFunDigitalStep2(campaign) {
        const secCards = findSecondaryItemCards();
        if (secCards.length === 0) {
            showToast('Nenhum texto secundário encontrado na tela.', true);
            return;
        }

        let filledCount = 0;
        for (let i = 0; i < secCards.length; i++) {
            showToast(`Preenchendo auxiliar ${i + 1} de ${secCards.length}...`);
            const ok = await fillSecondaryPost(secCards[i], campaign);
            if (ok) filledCount++;
            await sleep(400); // Tempinho antes de passar para o próximo card
        }

        showToast(`Passo 2 concluído! Tags e Apps adicionados nos ${filledCount} secundários.`);
    }

    // ==========================================
    // LÓGICA META ADS (MOTOR ULTRA-SEGURO)
    // ==========================================

    // Identifica campos protegidos que a extensão JAMAIS deve alterar ou apagar (Ex: Parâmetros de URL / UTM e Nome do anúncio)
    function isProtectedMetaField(target) {
        if (!target) return false;
        const inp = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ? target : target.querySelector?.('input, textarea');
        const el = inp || target;

        // 1. Parâmetros de URL (Rastreamento / UTM / Meta Tags) - NUNCA APAGAR OU MODIFICAR!
        const val = (el.value || el.getAttribute('value') || '').trim();
        if (val.includes('utm_') || val.includes('{{') || val.includes('site_source_name') || val.includes('placement') || val.includes('campaign.name')) {
            return true;
        }

        const ph = (el.getAttribute('placeholder') || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();
        const id = (el.getAttribute('id') || '').toLowerCase();

        if (/par[aâ]metro|parameter|utm|rastreamento|tracking|seguimiento/i.test(ph + ' ' + aria + ' ' + name + ' ' + id)) {
            return true;
        }

        // 2. Nome do anúncio pelo próprio campo
        if (/nome do an[uú]ncio|ad name|nombre del anuncio/i.test(ph + ' ' + aria + ' ' + name + ' ' + id)) {
            return true;
        }

        // 3. Link de exibição (Destino -> Link de exibição)
        if (/link de exibi[çc][ãa]o|display link|enlace de visualizaci[óo]n/i.test(ph + ' ' + aria + ' ' + name + ' ' + id)) {
            return true;
        }

        // 4. Barra de pesquisa / filtro
        if (/pesquisar|buscar|search/i.test(ph + ' ' + aria)) {
            return true;
        }

        // 5. Checar APENAS o rótulo/label imediato com texto curto (< 120 caracteres para NUNCA pegar o painel inteiro)
        let p = el.parentElement;
        for (let lvl = 0; lvl < 2 && p; lvl++) {
            const pTxt = (p.innerText || '').toLowerCase();
            if (pTxt.length < 120) {
                if (pTxt.includes('parâmetros de url') || pTxt.includes('parametros de url') || pTxt.includes('url parameters') || pTxt.includes('criar um parâmetro')) {
                    return true;
                }
                if (pTxt.includes('nome do anúncio') || pTxt.includes('ad name') || pTxt.includes('nombre del anuncio')) {
                    return true;
                }
            }
            p = p.parentElement;
        }

        return false;
    }

    // Identifica com 100% de certeza se um elemento é o input de "URL do site"
    function isMetaWebsiteUrlElement(target) {
        if (!target) return false;
        if (isProtectedMetaField(target)) return false; // Parâmetros de URL NUNCA é URL do site!

        const inp = target.tagName === 'INPUT' ? target : target.querySelector?.('input');
        if (!inp) return false;

        const type = (inp.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'checkbox', 'radio', 'button', 'submit'].includes(type)) return false;

        const ph = (inp.placeholder || '').toLowerCase();
        const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
        const name = (inp.getAttribute('name') || '').toLowerCase();
        const id = (inp.getAttribute('id') || '').toLowerCase();

        // 1. Placeholder oficial da Meta Ads em PT, EN ou ES ("Insira o URL que as pessoas visitam...")
        if (ph.includes('visitam') || ph.includes('visit') || ph.includes('pessoas visitam') || ph.includes('people visit') || ph.includes('personas visitan')) return true;
        if (ph.includes('insira o url') || ph.includes('enter the url') || ph.includes('ingresa el url') || ph.includes('inserisci l\'url')) return true;
        if (ph === 'https://' || ph.startsWith('http://') || ph.startsWith('https://')) return true;

        // 2. Aria-label / Name / ID explícitos (rejeitando parâmetros e exibição)
        if (/url do site|website url|url del sitio|destination url|target url/i.test(aria) || /website_url|destination_url/i.test(name + ' ' + id)) {
            if (!aria.includes('exibi') && !aria.includes('display') && !aria.includes('parâmetro') && !aria.includes('parameter')) {
                return true;
            }
        }

        // 3. Container pai imediato com texto curto sob Destino
        let p = inp.parentElement;
        for (let lvl = 0; lvl < 3 && p; lvl++) {
            const txt = (p.innerText || '').toLowerCase();
            if (txt.length < 120) {
                if ((txt.includes('url do site') || txt.includes('website url') || txt.includes('url del sitio')) &&
                    !txt.includes('link de exibição') && !txt.includes('display link') && !txt.includes('parâmetro')) {
                    return true;
                }
            }
            p = p.parentElement;
        }

        return false;
    }


    // Localiza com precisão o cabeçalho de uma seção específica no editor central
    function findSectionHeader(sectionType) {
        const leftThreshold = 240;
        const rightLimit = window.innerWidth * 0.85;

        const patterns = {
            primary: /^(texto principal|primary text)(\s*\(.*?\))?(\s*\d+\s*de\s*\d+)?$/i,
            headline: /^(t[íi]tulo|headline|encabezado)(\s*\(.*?\))?(\s*\d+\s*de\s*\d+)?$/i,
            desc: /^(descri[çc][ãa]o|description)(\s*\(.*?\))?(\s*\d+\s*de\s*\d+)?$/i,
            destino: /^(destino|destination)$/i,
            rastreamento: /^(rastreamento|tracking|seguimiento)$/i
        };

        const candidates = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span, label')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            if (el.closest('[aria-label*="prévia"], [aria-label*="preview"], [data-testid*="preview"]')) return false;
            if (el.closest('[role="alert"], [class*="error"], [class*="banner"], [class*="alert"]')) return false;

            const r = el.getBoundingClientRect();
            if (r.left < leftThreshold || r.left > rightLimit || r.width < 10) return false;

            const txt = (el.innerText || '').trim();
            if (txt.length === 0 || txt.length > 50) return false;
            if (/n[ãa]o pode|em branco|inv[áa]lido|insira um|obrigat[óo]rio|analise \d+ erro/i.test(txt)) return false;

            return true;
        });

        const pat = patterns[sectionType];
        for (const el of candidates) {
            const firstLine = (el.innerText || '').split('\n')[0].trim();
            if (pat && pat.test(firstLine)) return el;
        }

        const fallbackWord = {
            primary: 'texto principal',
            headline: 'título',
            desc: 'descrição',
            destino: 'destino',
            rastreamento: 'rastreamento'
        }[sectionType];

        if (fallbackWord) {
            const matched = candidates.filter(el => {
                const firstLine = (el.innerText || '').split('\n')[0].trim().toLowerCase();
                return firstLine.startsWith(fallbackWord) || firstLine === fallbackWord;
            });
            if (matched.length > 0) {
                matched.sort((a, b) => a.children.length - b.children.length);
                return matched[0];
            }
        }

        return null;
    }

    // Localiza o campo "URL do site" sob o Destino no anúncio com 100% de segurança
    function findMetaWebsiteUrlInput() {
        const leftThreshold = 240;
        const rightLimit = window.innerWidth * 0.85;

        // 1. Rola o editor até a seção "Destino" se encontrada para garantir renderização no DOM
        const destHeader = findSectionHeader('destino');
        if (destHeader) {
            try {
                destHeader.scrollIntoView({ behavior: 'instant', block: 'center' });
            } catch (e) { }
        }

        const allInputs = Array.from(document.querySelectorAll('input')).filter(inp => {
            if (inp.closest('#twod-floating-root')) return false;
            if (inp.closest('[aria-label*="prévia"], [aria-label*="preview"]')) return false;
            if (isProtectedMetaField(inp)) return false; // NUNCA aceita Parâmetros de URL!

            const r = inp.getBoundingClientRect();
            if (r.left < leftThreshold || r.left > rightLimit || r.width < 10) return false;
            const type = (inp.getAttribute('type') || 'text').toLowerCase();
            return !['hidden', 'checkbox', 'radio', 'button', 'submit'].includes(type);
        });

        // 2. Busca estrita por características exclusivas do campo de URL do site
        const directMatch = allInputs.find(inp => isMetaWebsiteUrlElement(inp));
        if (directMatch) {
            return directMatch;
        }

        // 3. Busca após o cabeçalho Destino no DOM e ANTES de Rastreamento
        if (destHeader) {
            const rastrHeader = findSectionHeader('rastreamento');
            const afterDest = allInputs.filter(inp => {
                const pos = destHeader.compareDocumentPosition(inp);
                const isAfter = (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
                if (!isAfter) return false;

                if (rastrHeader) {
                    const posR = rastrHeader.compareDocumentPosition(inp);
                    const isBefore = (posR & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
                    if (!isBefore) return false;
                }
                return true;
            });

            const candidate = afterDest.find(inp => {
                if (isProtectedMetaField(inp)) return false;
                const ph = (inp.placeholder || '').toLowerCase();
                const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
                if (ph.includes('pesquisar') || aria.includes('pesquisar')) return false;
                const parentTxt = (inp.closest('div, label')?.innerText || '').toLowerCase();
                if (parentTxt.includes('link de exibição') || parentTxt.includes('display link')) return false;
                return true;
            });

            if (candidate) return candidate;
        }

        console.warn('[TwoD AutoFill] Campo URL do site não foi localizado com segurança.');
        return null;
    }

    // Identifica semanticamente os campos do anúncio no editor com isolamento total entre seções
    function getMetaAdFields() {
        const leftThreshold = 240;
        const rightLimit = window.innerWidth * 0.85;

        const hPrimary = findSectionHeader('primary');
        const hHeadline = findSectionHeader('headline');
        const hDesc = findSectionHeader('desc');
        const hDestino = findSectionHeader('destino');

        console.log('[TwoD AutoFill] Seções detectadas no editor:', {
            'Texto principal': !!hPrimary,
            'Título': !!hHeadline,
            'Descrição': !!hDesc,
            'Destino': !!hDestino
        });

        // Todos os elementos editáveis no painel central do editor (filtrando qualquer campo protegido e o campo de URL)
        const allInputs = Array.from(document.querySelectorAll(
            'textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]'
        )).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            if (el.closest('[aria-label*="prévia"], [aria-label*="preview"], [data-testid*="preview"]')) return false;

            // BLOQUEIO TOTAL: NUNCA incluir campo de Parâmetros de URL ou Nome do anúncio!
            if (isProtectedMetaField(el)) return false;

            // NUNCA incluir o campo de URL do site na lista de textos ou descrições!
            if (isMetaWebsiteUrlElement(el)) return false;

            const r = el.getBoundingClientRect();
            if (r.left < leftThreshold || r.left > rightLimit || r.width < 30 || r.height < 12) return false;

            const ph = (el.getAttribute('placeholder') || '').toLowerCase();
            if (ph.includes('pesquisar') || ph.includes('buscar')) return false;
            return true;
        }).filter(el => {
            // Se o elemento contiver outro elemento editável filho, mantém apenas o filho
            if (el.querySelector?.('[contenteditable="true"], textarea, input')) return false;
            return true;
        });

        let primary = [];
        let headline = [];
        let desc = [];

        allInputs.forEach(inp => {
            const posPrimary = hPrimary ? hPrimary.compareDocumentPosition(inp) : null;
            const posHeadline = hHeadline ? hHeadline.compareDocumentPosition(inp) : null;
            const posDesc = hDesc ? hDesc.compareDocumentPosition(inp) : null;
            const posDestino = hDestino ? hDestino.compareDocumentPosition(inp) : null;

            const isAfterPrimary = posPrimary && (posPrimary & Node.DOCUMENT_POSITION_FOLLOWING);
            const isBeforeHeadline = posHeadline && (posHeadline & Node.DOCUMENT_POSITION_PRECEDING);

            const isAfterHeadline = posHeadline && (posHeadline & Node.DOCUMENT_POSITION_FOLLOWING);
            const isBeforeDesc = posDesc && (posDesc & Node.DOCUMENT_POSITION_PRECEDING);

            const isAfterDesc = posDesc && (posDesc & Node.DOCUMENT_POSITION_FOLLOWING);
            const isBeforeDestino = posDestino && (posDestino & Node.DOCUMENT_POSITION_PRECEDING);

            // 1. Texto Principal: entre Texto principal e Título
            if (isAfterPrimary && (isBeforeHeadline || !hHeadline)) {
                primary.push(inp);
                return;
            }

            // 2. Título: entre Título e Descrição
            if (isAfterHeadline && (isBeforeDesc || !hDesc)) {
                headline.push(inp);
                return;
            }

            // 3. Descrição: entre Descrição e Destino (JAMAIS após Destino!)
            if (isAfterDesc && (isBeforeDestino || !hDestino)) {
                desc.push(inp);
                return;
            }
        });

        // Fallback apenas se alguma seção faltou por rolagem, mantendo os campos protegidos e o URL isolados
        if (primary.length === 0 || headline.length === 0 || desc.length === 0) {
            console.log('[TwoD AutoFill] Usando fallback ordenado por seções...');
            const safeInputs = allInputs.filter(inp => !isProtectedMetaField(inp) && !isMetaWebsiteUrlElement(inp));
            if (safeInputs.length >= 7) {
                if (primary.length === 0) primary = [safeInputs[0], safeInputs[1]];
                if (headline.length === 0) headline = [safeInputs[2], safeInputs[3], safeInputs[4]];
                if (desc.length === 0) desc = [safeInputs[5], safeInputs[6]];
            } else if (safeInputs.length >= 5) {
                if (primary.length === 0) primary = safeInputs.slice(0, 2);
                if (headline.length === 0) headline = safeInputs.slice(2, Math.min(5, safeInputs.length));
                if (desc.length === 0) desc = safeInputs.slice(5);
            } else if (safeInputs.length >= 2) {
                if (primary.length === 0) primary = safeInputs.slice(0, Math.min(2, safeInputs.length));
                if (headline.length === 0 && safeInputs.length > 2) headline = safeInputs.slice(2);
            }
        }

        console.log('[TwoD AutoFill] Campos mapeados com segurança:', {
            primary: primary.length,
            headline: headline.length,
            desc: desc.length
        });

        return { primary, headline, desc };
    }

    // Preenchimento nativo blindado contra vazamento e com proteção absoluta aos campos existentes
    async function fillInputNative(target, value) {
        if (!target) return false;

        // BLOQUEIO ABSOLUTO 1: CAMPO PROTEGIDO NUNCA PODE SER MODIFICADO OU APAGADO! (Parâmetros de URL, etc.)
        if (isProtectedMetaField(target)) {
            console.error('[TwoD AutoFill BLOCKED] BLOQUEIO CRÍTICO: Campo protegido (Parâmetros de URL / Nome do anúncio) NUNCA pode ser alterado!', target);
            return false;
        }

        const valTrimmed = (value || '').trim();
        const isUrl = /^https?:\/\//i.test(valTrimmed);
        const isWebsiteInput = isMetaWebsiteUrlElement(target);

        // BLOQUEIO CRÍTICO DE SEGURANÇA 2: NUNCA permitir que uma URL seja inserida em um campo de texto/descrição!
        if (isUrl && !isWebsiteInput) {
            console.error('[TwoD AutoFill BLOCKED] BLOQUEIO DE SEGURANÇA: Tentativa de inserir URL em campo de anúncio!', { target, value });
            showToast('🚨 Bloqueado: link não pode entrar na descrição ou texto!', true);
            return false;
        }

        // BLOQUEIO CRÍTICO DE SEGURANÇA 3: NUNCA permitir que texto comum (sem URL) seja inserido no campo de URL do site!
        if (!isUrl && isWebsiteInput) {
            console.error('[TwoD AutoFill BLOCKED] BLOQUEIO DE SEGURANÇA: Tentativa de inserir texto comum no campo de URL!', { target, value });
            return false;
        }

        try {
            const inner = target.querySelector?.('textarea, input, [contenteditable="true"]');
            const el = inner || target;

            // Desfoca explicitamente qualquer elemento que estivesse ativo para que o cursor não vaze
            if (document.activeElement && document.activeElement !== el) {
                try {
                    document.activeElement.blur();
                } catch (e) { }
            }
            window.getSelection()?.removeAllRanges();

            el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            el.click();
            el.focus();
            await sleep(80);

            // 1. INPUT OU TEXTAREA NATIVO (Inclui "URL do site", Títulos e Descrições)
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.value = '';

                const tracker = el._valueTracker;
                if (tracker) tracker.setValue('_prev_' + Math.random());

                const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) {
                    setter.call(el, value);
                } else {
                    el.value = value;
                }

                el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
                el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
                el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));

                if (el.value !== value) {
                    try {
                        const dt = new DataTransfer();
                        dt.setData('text/plain', value);
                        el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
                    } catch (pe) { }
                }

                // Desfoca e limpa seleção
                el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
                el.blur();
                window.getSelection()?.removeAllRanges();
                return true;
            }

            // 2. CONTENTEDITABLE (Lexical / Draft.js do Meta para Texto Principal)
            try {
                const range = document.createRange();
                range.selectNodeContents(el);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                range.deleteContents();

                let inserted = false;
                if (document.activeElement === el || el.contains(document.activeElement)) {
                    try {
                        inserted = document.execCommand('insertText', false, value);
                    } catch (e) { }
                }

                if (!inserted || (el.innerText || '').trim() !== value.trim()) {
                    el.innerText = value;
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
                    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                }
            } catch (err) {
                el.innerText = value;
                el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: value, inputType: 'insertText' }));
                el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            }

            el.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
            el.blur();
            window.getSelection()?.removeAllRanges();
            return true;
        } catch (e) {
            console.error('[TwoD AutoFill] Erro ao preencher campo:', e);
            return false;
        }
    }

    // Rola o editor central para forçar a renderização no React de todas as seções virtuais do anúncio
    async function scrollAdEditorToMountAll() {
        const leftThreshold = 240;
        const rightLimit = window.innerWidth * 0.85;

        const scrollContainers = Array.from(document.querySelectorAll('div, form, main, section')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            if (r.left < leftThreshold || r.left > rightLimit || r.width < 100) return false;
            return el.scrollHeight > el.clientHeight + 80;
        });

        // Rola até a área de Criativo (Texto principal / Títulos)
        for (const sc of scrollContainers) {
            try { sc.scrollTop = Math.min(sc.scrollHeight * 0.35, 550); } catch (e) { }
        }
        await sleep(250);
    }

    // Preenche com segurança total os campos do anúncio atualmente selecionado no editor
    async function fillCurrentAdFields(campaign, lang, targetUrl = '') {
        const metaList = campaign.meta || [];
        if (metaList.length === 0) {
            showToast('Nenhum dado Meta Ads encontrado para este post.', true);
            return 0;
        }

        // Sanitização preventiva: nenhum texto pode conter URL
        const stripUrl = (txt) => (txt || '').replace(/https?:\/\/[^\s]+/gi, '').trim();

        const primaryText1 = stripUrl(metaList[0]?.[lang]);
        const primaryText2 = stripUrl(metaList[1]?.[lang]);
        const headline1 = stripUrl(metaList[2]?.[lang]);
        const headline2 = stripUrl(metaList[3]?.[lang]);
        const headline3 = stripUrl(metaList[4]?.[lang]);
        const desc1 = stripUrl(metaList[5]?.[lang]);
        const desc2 = stripUrl(metaList[6]?.[lang]);

        // Garante que todas as seções virtuais do editor foram montadas no DOM
        await scrollAdEditorToMountAll();

        const fields = getMetaAdFields();
        let filledSuccess = 0;

        // 1. Preenche Texto Principal (2 campos)
        if (fields.primary[0] && primaryText1) {
            fields.primary[0].scrollIntoView?.({ behavior: 'instant', block: 'center' });
            await sleep(100);
            const ok = await fillInputNative(fields.primary[0], primaryText1);
            if (ok) filledSuccess++;
            await sleep(200);
        }
        if (fields.primary[1] && primaryText2) {
            fields.primary[1].scrollIntoView?.({ behavior: 'instant', block: 'center' });
            await sleep(100);
            const ok = await fillInputNative(fields.primary[1], primaryText2);
            if (ok) filledSuccess++;
            await sleep(200);
        }

        // 2. Preenche Título (3 campos)
        if (fields.headline[0] && headline1) {
            fields.headline[0].scrollIntoView?.({ behavior: 'instant', block: 'center' });
            await sleep(100);
            const ok = await fillInputNative(fields.headline[0], headline1);
            if (ok) filledSuccess++;
            await sleep(200);
        }
        if (fields.headline[1] && headline2) {
            fields.headline[1].scrollIntoView?.({ behavior: 'instant', block: 'center' });
            await sleep(100);
            const ok = await fillInputNative(fields.headline[1], headline2);
            if (ok) filledSuccess++;
            await sleep(200);
        }
        if (fields.headline[2] && headline3) {
            fields.headline[2].scrollIntoView?.({ behavior: 'instant', block: 'center' });
            await sleep(100);
            const ok = await fillInputNative(fields.headline[2], headline3);
            if (ok) filledSuccess++;
            await sleep(200);
        }

        // 3. Preenche Descrição (2 campos)
        if (fields.desc[0] && desc1) {
            fields.desc[0].scrollIntoView?.({ behavior: 'instant', block: 'center' });
            await sleep(100);
            const ok = await fillInputNative(fields.desc[0], desc1);
            if (ok) filledSuccess++;
            await sleep(200);
        }
        if (fields.desc[1] && desc2) {
            fields.desc[1].scrollIntoView?.({ behavior: 'instant', block: 'center' });
            await sleep(100);
            const ok = await fillInputNative(fields.desc[1], desc2);
            if (ok) filledSuccess++;
            await sleep(200);
        }

        // 4. Preenche URL do site no Destino (se fornecida)
        if (targetUrl) {
            await sleep(250);
            const websiteInput = findMetaWebsiteUrlInput();
            if (websiteInput) {
                websiteInput.scrollIntoView?.({ behavior: 'instant', block: 'center' });
                await sleep(100);
                console.log(`[TwoD AutoFill] Preenchendo URL do site (${lang.toUpperCase()}):`, targetUrl);
                const ok = await fillInputNative(websiteInput, targetUrl);
                if (ok) filledSuccess++;
                await sleep(300);
            } else {
                console.warn('[TwoD AutoFill] Campo URL do site não encontrado no editor.');
                showToast('⚠️ Campo "URL do site" não encontrado.', true);
            }
        }


        // 5. AUDITORIA E AUTO-CORREÇÃO DE SEGURANÇA (Garante que nenhuma descrição ficou contaminada)
        await sleep(200);
        fields.desc.forEach((dInput, idx) => {
            const val = (dInput.value || dInput.innerText || '').trim();
            if (/https?:\/\/|www\./i.test(val)) {
                console.warn(`[TwoD AutoFill] ALERTA: Detectada contaminação de link na Descrição ${idx + 1}! Corrigindo imediatamente...`);
                const cleanVal = idx === 0 ? desc1 : desc2;
                fillInputNative(dInput, cleanVal);
            }
        });

        return filledSuccess;
    }

    // Localiza os 3 anúncios na árvore lateral associando cada anúncio ao seu conjunto correto (independente da ordem)
    function getMetaCampaignAds() {
        const leftLimit = Math.min(360, window.innerWidth * 0.35);
        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            return r.left < leftLimit && r.top > 60 && r.width > 20 && r.height > 10;
        });

        // 1. Identifica os 3 Conjuntos pelos seus nomes na barra lateral
        const setPt = candidates.find(el => {
            const txt = (el.innerText || '').trim();
            return (txt === 'Brasil' || (txt.includes('Brasil') && !txt.includes('Novo') && !txt.includes('Estados'))) && txt.length < 35 && el.children.length <= 3;
        }) || candidates.find(el => {
            const txt = (el.innerText || '').trim();
            return txt.includes('Brasil') && !txt.includes('Novo') && txt.length < 35;
        });

        const setEs = candidates.find(el => {
            const txt = (el.innerText || '').trim().toLowerCase();
            return (txt.includes('espanhol') || txt.includes('spanish')) && !txt.includes('novo') && txt.length < 40 && el.children.length <= 3;
        }) || candidates.find(el => {
            const txt = (el.innerText || '').trim().toLowerCase();
            return (txt.includes('espanhol') || txt.includes('spanish')) && !txt.includes('novo') && txt.length < 40;
        });

        const setEn = candidates.find(el => {
            const txt = (el.innerText || '').trim().toLowerCase();
            return (txt.includes('inglês') || txt.includes('ingles') || txt.includes('english')) && !txt.includes('novo') && txt.length < 40 && el.children.length <= 3;
        }) || candidates.find(el => {
            const txt = (el.innerText || '').trim().toLowerCase();
            return (txt.includes('inglês') || txt.includes('ingles') || txt.includes('english')) && !txt.includes('novo') && txt.length < 40;
        });

        // 2. Localiza todos os nós de anúncios na árvore lateral
        const adTextNodes = candidates.filter(el => {
            const txt = (el.innerText || '').trim().toLowerCase();
            return (txt.includes('novo anúncio') || txt.includes('novo anuncio') || txt.includes('anúncio de vendas') || txt.includes('anuncio de vendas')) && txt.length < 50;
        });

        const leafAds = adTextNodes.filter(el => !adTextNodes.some(other => other !== el && el.contains(other)));
        leafAds.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);

        if (!setPt || !setEs || !setEn) {
            console.warn('[TwoD AutoFill] Não foi possível encontrar os 3 conjuntos na lateral:', {
                Brasil: !!setPt,
                Espanhol: !!setEs,
                Inglês: !!setEn
            });
            if (leafAds.length >= 3) {
                return { pt: leafAds[0], es: leafAds[1], en: leafAds[2] };
            }
            return null;
        }

        // 3. Montar a lista dos 3 conjuntos com suas posições verticais reais na tela
        const setsOnScreen = [
            { lang: 'pt', name: 'Brasil', el: setPt, top: setPt.getBoundingClientRect().top },
            { lang: 'es', name: 'Estados Unidos (Espanhol)', el: setEs, top: setEs.getBoundingClientRect().top },
            { lang: 'en', name: 'Estados Unidos (Inglês)', el: setEn, top: setEn.getBoundingClientRect().top }
        ];

        // Ordena os conjuntos de cima para baixo
        setsOnScreen.sort((a, b) => a.top - b.top);
        console.log('[TwoD AutoFill] Ordem real dos conjuntos na tela:', setsOnScreen.map(s => `${s.name} [${s.lang.toUpperCase()}] (Y=${Math.round(s.top)})`));

        const adsMap = {};

        // Para cada conjunto, seu anúncio é aquele localizado abaixo dele e antes do próximo conjunto
        for (let i = 0; i < setsOnScreen.length; i++) {
            const current = setsOnScreen[i];
            const next = setsOnScreen[i + 1] || null;

            const matchingAd = leafAds.find(ad => {
                const adTop = ad.getBoundingClientRect().top;
                if (next) {
                    return adTop > current.top && adTop < next.top;
                } else {
                    return adTop > current.top;
                }
            });

            adsMap[current.lang] = matchingAd || current.el;
            console.log(`[TwoD AutoFill] Mapeado: ${current.name} [${current.lang.toUpperCase()}] ->`, adsMap[current.lang]);
        }

        return adsMap;
    }

    // Clica no anúncio na árvore lateral simulando interação humana completa
    async function selectAdInTree(targetEl) {
        if (!targetEl) return false;

        targetEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        await sleep(150);

        const r = targetEl.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;

        // Identifica o elemento real sob o cursor no ponto exato
        const hit = document.elementFromPoint(cx, cy) || targetEl;

        const eventInit = {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
            clientX: cx,
            clientY: cy,
            buttons: 1
        };

        // Dispara sequência completa de clique com buttons: 1 (essencial para React 18)
        hit.dispatchEvent(new PointerEvent('pointerdown', eventInit));
        hit.dispatchEvent(new MouseEvent('mousedown', eventInit));
        hit.focus?.();
        hit.dispatchEvent(new PointerEvent('pointerup', eventInit));
        hit.dispatchEvent(new MouseEvent('mouseup', eventInit));
        hit.click?.();

        if (targetEl !== hit) {
            targetEl.dispatchEvent(new PointerEvent('pointerdown', eventInit));
            targetEl.dispatchEvent(new MouseEvent('mousedown', eventInit));
            targetEl.dispatchEvent(new PointerEvent('pointerup', eventInit));
            targetEl.dispatchEvent(new MouseEvent('mouseup', eventInit));
            targetEl.click?.();
        }

        // Também dispara no container pai
        if (targetEl.parentElement) {
            targetEl.parentElement.click?.();
        }

        return true;
    }

    // Aguarda o painel de edição do anúncio estar pronto na tela
    async function waitForAdEditorReady(timeoutMs = 6000) {
        const start = Date.now();
        const leftThreshold = 240;
        const rightLimit = window.innerWidth * 0.85;

        while (Date.now() - start < timeoutMs) {
            const editorInputs = Array.from(document.querySelectorAll(
                'textarea, input[type="text"], input:not([type]), [contenteditable="true"], [role="textbox"]'
            )).filter(el => {
                if (el.closest('#twod-floating-root')) return false;
                if (el.closest('[aria-label*="prévia"], [aria-label*="preview"]')) return false;
                const r = el.getBoundingClientRect();
                return r.left >= leftThreshold && r.left <= rightLimit && r.width > 20;
            });

            if (editorInputs.length >= 2) {
                return true;
            }
            await sleep(300);
        }
        return true;
    }

    // Detecta a chave do site a partir do nome da campanha ou texto da tela
    function detectSiteKey(campaignText) {
        if (!campaignText) return null;
        const s = campaignText.toLowerCase();

        // 1. blog.twodcompany é o 1º Twodcompany (Português)
        if (s.includes('blog.twodcompany') || s.includes('blog-twodcompany') || s.includes('blog_twodcompany') ||
            s.includes('blogtwod') || s.includes('blog-twod') || s.includes('mon-blogtwod')) {
            return 'twod_pt';
        }
        // 2. twodcompany (sem blog) é o Último Twodcompany (Espanhol)
        if (s.includes('twodcompany') || s.includes('twod') || s.includes('mon-twodcompany') || s.includes('mon-twod')) {
            return 'twod_es';
        }
        if (s.includes('kiuvix') || s.includes('mon-kiuvix')) return 'kiuvix';
        if (s.includes('kiocom') || s.includes('mon-kiocom')) return 'kiocom';
        if (s.includes('thehatsune') || s.includes('hatsune') || s.includes('mon-thehatsune') || s.includes('mon-hatsune')) return 'thehatsune';
        if (s.includes('f4rol') || s.includes('mon-f4rol')) return 'f4rol';
        if (s.includes('hub') || s.includes('mon-hub')) return 'hub';
        if (s.includes('app.simplificandocomcafe') || s.includes('amg-app') || s.includes('-app-') || s.includes('-app.') || s.includes('mon-app') || /\bapp\b/i.test(s)) return 'app';
        if (s.includes('ai.simplificandocomcafe') || s.includes('amg-ai') || s.includes('-ai-') || s.includes('-ai.') || s.includes('mon-ai') || /\bai\b/i.test(s)) return 'ai';

        return null;
    }

    // Detecta o site a partir de qualquer informação visível na tela (input, árvore, cabeçalho da conta, título)
    function detectSiteKeyFromScreen(explicitCampText = '') {
        if (explicitCampText) {
            const k = detectSiteKey(explicitCampText);
            if (k) return k;
        }

        const inp = findMetaCampaignNameInput();
        if (inp) {
            const v = inp.value || inp.getAttribute('value') || '';
            const k = detectSiteKey(v);
            if (k) return k;
        }

        const treeNode = getMetaCampaignTreeNode();
        if (treeNode) {
            const k = detectSiteKey(treeNode.innerText || '');
            if (k) return k;
        }

        if (document.title) {
            const k = detectSiteKey(document.title);
            if (k) return k;
        }

        // Procura no topo da página por identificadores de conta (ex: MON-TWODCOMPANY, etc)
        const topText = (document.body?.innerText || '').substring(0, 3000);
        const k = detectSiteKey(topText);
        if (k) return k;

        return null;
    }

    // Lê o nome atual da campanha visível na tela
    function getCurrentCampaignNameFromScreen() {
        const inp = findMetaCampaignNameInput();
        if (inp && (inp.value || inp.getAttribute('value'))) {
            return (inp.value || inp.getAttribute('value')).trim();
        }
        const treeNode = getMetaCampaignTreeNode();
        if (treeNode && treeNode.innerText) {
            return treeNode.innerText.trim();
        }
        return '';
    }

    // Carrega os links salvos para o post atual
    function getSavedCampaignLinks(day, slug) {
        try {
            const key = `twod_links_${day}_${slug}`;
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    }

    // Salva os links para o post atual
    function saveCampaignLinks(day, slug, linksObj) {
        try {
            const key = `twod_links_${day}_${slug}`;
            localStorage.setItem(key, JSON.stringify(linksObj));
        } catch (e) { }
    }

    // Extrai o PostID de qualquer formato de URL
    function extractPostIdFromUrl(rawUrl) {
        if (!rawUrl) return '';
        try {
            const u = new URL(rawUrl.trim());
            const segments = u.pathname.split('/').filter(Boolean);
            if (['pt', 'es', 'en'].includes(segments[0]?.toLowerCase())) {
                return segments[1] || '';
            }
            return segments[0] || '';
        } catch (e) {
            const m = rawUrl.match(/\/(\d+)\//);
            return m ? m[1] : '';
        }
    }

    // Formata a URL localizada inserindo /pt/, /es/ ou /en/ antes do PostID
    function formatLocalizedUrl(rawUrl, lang) {
        if (!rawUrl) return { url: '', postId: '' };
        try {
            const u = new URL(rawUrl.trim());
            let segments = u.pathname.split('/').filter(Boolean);
            if (['pt', 'es', 'en'].includes(segments[0]?.toLowerCase())) {
                segments.shift();
            }
            const postId = segments[0] || '';
            const rest = segments.slice(1).join('/');
            const trailing = u.pathname.endsWith('/') ? '/' : '';
            const formatted = `${u.origin}/${lang}/${postId}${rest ? '/' + rest : ''}${trailing}`;
            return { url: formatted, postId };
        } catch (e) {
            const match = rawUrl.match(/\/(\d+)\//);
            const postId = match ? match[1] : '';
            return { url: rawUrl, postId };
        }
    }

    // Normaliza texto para comparação sem acentos ou caracteres especiais
    function normalizeSlugText(str) {
        return (str || '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, ' ')
            .trim();
    }

    // Identifica o site da TwoD correspondente a partir de uma URL
    function detectSiteKeyFromUrl(uStr) {
        try {
            const host = new URL(uStr).hostname.toLowerCase();
            if (host.includes('blog.twodcompany')) return 'twod_pt';
            if (host.includes('twodcompany')) return 'twod_es';
            if (host.includes('kiuvix')) return 'kiuvix';
            if (host.includes('kiocom')) return 'kiocom';
            if (host.includes('thehatsune') || host.includes('hatsune')) return 'thehatsune';
            if (host.includes('f4rol')) return 'f4rol';
            if (host.includes('hub')) return 'hub';
            if (host.includes('app.simplificandocomcafe')) return 'app';
            if (host.includes('ai.simplificandocomcafe')) return 'ai';
        } catch (e) { }
        return null;
    }

    // Associa inteligentemente a URL a um dos posts/nichos da lista comparando slug, títulos e tags
    function matchPostForUrl(uStr, postsList, defaultPost = null) {
        if (!postsList || postsList.length === 0) return defaultPost;
        if (postsList.length === 1) return postsList[0];

        try {
            const u = new URL(uStr);
            const pathNorm = normalizeSlugText(u.pathname);
            const words = pathNorm.split(/\s+/).filter(w => w.length > 2 && isNaN(w));

            let bestPost = null;
            let bestScore = -1;

            postsList.forEach(p => {
                let score = 0;
                const fullPostText = normalizeSlugText([
                    p.titulo || '',
                    p.campanha || '',
                    p.tag || '',
                    ...(p.seo || [])
                ].join(' '));

                words.forEach(w => {
                    if (fullPostText.includes(w)) score += 3;
                });

                // Bônus para correspondência exata nos títulos SEO
                (p.seo || []).forEach(s => {
                    const sNorm = normalizeSlugText(s);
                    words.forEach(w => {
                        if (sNorm.includes(w)) score += 2;
                    });
                });

                // Bônus se o slug da campanha ou título principal coincidir
                const titleNorm = normalizeSlugText(p.titulo || '');
                const campNorm = normalizeSlugText(p.campanha || '');
                words.forEach(w => {
                    if (titleNorm.includes(w) || campNorm.includes(w)) score += 5;
                });

                if (score > bestScore) {
                    bestScore = score;
                    bestPost = p;
                }
            });

            return (bestScore > 0 && bestPost) ? bestPost : defaultPost;
        } catch (e) {
            return defaultPost;
        }
    }

    // Distribui uma colagem de links em massa (de 1 nicho ou de todos os nichos do dia juntos)
    function distributeSmartBulkUrls(text, postsList, defaultPost = null) {
        const lines = text.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
        const results = {}; // { [campSlug]: { [siteKey]: url } }
        let totalCount = 0;

        for (const line of lines) {
            const m = line.match(/https?:\/\/[^\s]+/i);
            if (!m) continue;
            const uStr = m[0];
            const siteKey = detectSiteKeyFromUrl(uStr);
            if (!siteKey) continue;

            const matchedPost = matchPostForUrl(uStr, postsList, defaultPost);
            if (!matchedPost) continue;

            const slug = matchedPost.campanha || (matchedPost.titulo ? matchedPost.titulo.replace(/\s+/g, '') : 'Campanha');
            if (!results[slug]) results[slug] = {};
            results[slug][siteKey] = uStr;
            totalCount++;
        }

        return { results, totalCount };
    }

    // Formata o nome da campanha substituindo MODELO ou qualquer nome antigo pelo slug do nicho atual, inserindo PostID antes da vírgula e removendo sufixos de cópia
    function formatCampaignName(currentName, campaignSlug, postId = '') {
        if (!currentName) return postId ? `${postId},${campaignSlug}` : campaignSlug;
        if (!campaignSlug) return currentName;

        let updated = currentName.trim();

        // 1. Apaga sufixos de cópia (ex: " — Cópia", " - Cópia", "- Cópia", " — Copia", " (Cópia)", " - Copy")
        updated = updated.replace(/\s*[-—–]\s*C[oó]pia(\s*\d+)?/gi, '');
        updated = updated.replace(/\s*[-—–]\s*Copy(\s*\d+)?/gi, '');
        updated = updated.replace(/\s*\(C[oó]pia(\s*\d+)?\)/gi, '');
        updated = updated.replace(/\s*\(Copy(\s*\d+)?\)/gi, '');
        updated = updated.replace(/\s+C[oó]pia(\s*\d+)?$/gi, '');
        updated = updated.trim();

        // 2. Análise por vírgulas para sobrescrever independente do que estiver escrito no nome antigo
        const parts = updated.split(',');

        if (parts.length >= 2) {
            // Caso A: Começa com vírgula (ex: ",MODELO,MON-TWODCOMPANY..." ou ",NomeAntigo,MON-TWODCOMPANY...")
            if (parts[0] === '') {
                parts[0] = postId ? String(postId) : '';
                parts[1] = campaignSlug;
                return parts.join(',');
            }

            // Caso B: Começa com dígitos (ex: "4146,VerQuemUsaWifi,MON-TWODCOMPANY..." ou "2859,RadioAoVivo...")
            if (/^\d+$/.test(parts[0].trim())) {
                parts[0] = postId ? String(postId) : parts[0].trim();
                parts[1] = campaignSlug;
                return parts.join(',');
            }

            // Caso C: Primeiro termo é texto (ex: "MODELO,MON-TWODCOMPANY..." ou "RadioAoVivo,MON-TWODCOMPANY...")
            if (postId) {
                parts[0] = campaignSlug;
                return `${postId},${parts.join(',')}`;
            } else {
                parts[0] = campaignSlug;
                return parts.join(',');
            }
        } else {
            // Sem vírgula
            return postId ? `${postId},${campaignSlug}` : campaignSlug;
        }
    }

    // Localiza o campo de input "Nome da campanha" no editor do Meta Ads
    function findMetaCampaignNameInput() {
        const allInputs = Array.from(document.querySelectorAll('input')).filter(inp => {
            if (inp.closest('#twod-floating-root')) return false;
            const type = (inp.getAttribute('type') || 'text').toLowerCase();
            if (['hidden', 'checkbox', 'radio', 'button', 'submit'].includes(type)) return false;

            const ph = (inp.placeholder || '').toLowerCase();
            const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
            if (ph.includes('pesquisar') || ph.includes('search') || ph.includes('buscar') ||
                aria.includes('pesquisar') || aria.includes('search') || aria.includes('buscar')) {
                return false;
            }
            return true;
        });

        // 1. Prioridade: Por aria-label ou placeholder com "nome da campanha"
        const byAttr = allInputs.find(i => {
            const label = (i.getAttribute('aria-label') || '').toLowerCase();
            const ph = (i.placeholder || '').toLowerCase();
            const name = (i.getAttribute('name') || '').toLowerCase();
            return /nome da campanha|campaign name|nombre de la campa/i.test(label) ||
                /nome da campanha|campaign name|nombre de la campa/i.test(ph) ||
                /campaign.*name|campaign_name/i.test(name);
        });
        if (byAttr) return byAttr;

        // 2. Próximo ao cabeçalho ou label "Nome da campanha"
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span, label')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const txt = (el.innerText || '').trim().toLowerCase();
            return (/^nome da campanha$/i.test(txt) || /^campaign name$/i.test(txt) || /^nombre de la campa/i.test(txt)) &&
                el.children.length <= 2;
        });
        for (const h of allHeadings) {
            let p = h.parentElement;
            for (let lvl = 0; lvl < 4; lvl++) {
                if (!p) break;
                const found = p.querySelector('input[type="text"], input:not([type])');
                if (found && !found.closest('#twod-floating-root')) return found;
                p = p.parentElement;
            }
        }

        // 3. Input cujo valor atual tem estrutura de campanha (vírgulas, MON-, MODELO, Cópia, ou slug existente)
        const allCampaignSlugs = Object.values(data).flat().map(p => p.campanha || p.titulo?.replace(/\s+/g, '')).filter(Boolean);
        const byValue = allInputs.find(i => {
            const v = (i.value || i.getAttribute('value') || '').trim();
            if (!v) return false;
            if (/MODELO/i.test(v)) return true;
            if (/C[oó]pia|Copy/i.test(v) && v.includes(',')) return true;
            if (v.includes(',') && (
                /MON-/i.test(v) ||
                /TWOD|BLOGTWOD|KIUVIX|KIOCOM|HATSUNE|F4ROL|HUB/i.test(v) ||
                /^\d+,/.test(v) ||
                /^,/.test(v) ||
                allCampaignSlugs.some(slug => v.toLowerCase().includes(slug.toLowerCase()))
            )) return true;
            return false;
        });
        if (byValue) return byValue;

        // 4. Próximo ao botão "Criar modelo" / "Create template"
        const btnModelo = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
            const txt = (b.innerText || '').trim().toLowerCase();
            return /criar modelo|create template|crear plantilla/i.test(txt);
        });
        if (btnModelo) {
            let p = btnModelo.parentElement;
            for (let lvl = 0; lvl < 4; lvl++) {
                if (!p) break;
                const found = p.querySelector('input[type="text"], input:not([type])');
                if (found && !found.closest('#twod-floating-root')) return found;
                p = p.parentElement;
            }
        }

        return null;
    }

    // Detecta com segurança o idioma do anúncio atualmente selecionado no editor
    function detectActiveAdLangFromScreen() {
        // 1. Procurar na barra superior de breadcrumbs (ex: "Brasil > Novo anúncio de Vendas")
        const breadcrumbs = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            return r.top > 20 && r.top < 130 && r.left > 240 && r.left < window.innerWidth * 0.85 && r.height < 60;
        });

        for (const el of breadcrumbs) {
            const txt = (el.innerText || '').toLowerCase();
            if (txt.includes('espanhol') || txt.includes('spanish')) return 'es';
            if (txt.includes('inglês') || txt.includes('ingles') || txt.includes('english')) return 'en';
            if (txt.includes('brasil') || txt.includes('brazil')) return 'pt';
        }

        // 2. Procurar na árvore lateral pelo nó selecionado
        const leftLimit = Math.min(360, window.innerWidth * 0.35);
        const selectedTreeItem = Array.from(document.querySelectorAll('[aria-selected="true"], [data-selected="true"], [class*="selected"], [class*="active"]')).find(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            return r.left < leftLimit && r.top > 60 && r.height > 10;
        });

        if (selectedTreeItem) {
            const ads = getMetaCampaignAds();
            if (ads) {
                for (const [l, adNode] of Object.entries(ads)) {
                    if (adNode === selectedTreeItem || adNode.contains(selectedTreeItem) || selectedTreeItem.contains(adNode)) {
                        return l;
                    }
                }
            }
        }

        return 'pt'; // padrão seguro
    }

    // Localiza o nó da Campanha na árvore lateral (topo da hierarquia)
    function getMetaCampaignTreeNode() {
        const leftLimit = Math.min(380, window.innerWidth * 0.35);
        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            return r.left < leftLimit && r.top > 60 && r.width > 20 && r.height > 10;
        });

        // 1. Elemento que contenha MODELO, Cópia ou vírgula com identificador de campanha
        const allCampaignSlugs = Object.values(data).flat().map(p => p.campanha || p.titulo?.replace(/\s+/g, '')).filter(Boolean);
        const byText = candidates.find(el => {
            const txt = (el.innerText || '').trim();
            if (txt.includes('Criar modelo') || txt.includes('Conjuntos') || txt.includes('Anúncios') || el.children.length > 3) return false;
            if (/MODELO/i.test(txt) || /C[oó]pia/i.test(txt)) return true;
            if (txt.includes(',') && (
                /MON-/i.test(txt) ||
                /TWOD|BLOGTWOD|KIUVIX|KIOCOM|HATSUNE|F4ROL|HUB/i.test(txt) ||
                /^\d+,/.test(txt) ||
                /^,/.test(txt) ||
                allCampaignSlugs.some(s => txt.toLowerCase().includes(s.toLowerCase()))
            )) return true;
            return false;
        });
        if (byText) return byText;

        // 2. Primeiro item na barra lateral acima dos conjuntos de anúncios
        const setNodes = candidates.filter(el => {
            const txt = (el.innerText || '').trim().toLowerCase();
            return (txt.includes('brasil') || txt.includes('espanhol') || txt.includes('inglês')) && el.children.length <= 3;
        });

        if (setNodes.length > 0) {
            setNodes.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
            const topSetY = setNodes[0].getBoundingClientRect().top;

            const above = candidates.filter(el => {
                const r = el.getBoundingClientRect();
                return r.top > 60 && r.top < topSetY - 8 && r.height >= 20 && el.children.length <= 3;
            });
            if (above.length > 0) {
                above.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
                return above[0];
            }
        }

        return null;
    }

    // Atualiza o nome da campanha no Meta Ads Manager
    async function updateMetaCampaignName(campaign, postId = '') {
        const campaignSlug = campaign.campanha || campaign.titulo.replace(/\s+/g, '');
        if (!campaignSlug) {
            console.warn('[TwoD AutoFill] Nenhum identificador de campanha disponível.');
            return false;
        }

        // 1. Tentar localizar o input na tela atual
        let nameInput = findMetaCampaignNameInput();

        // 2. Se não estiver no editor da campanha, clica no nível da campanha na árvore lateral
        if (!nameInput) {
            const campTreeNode = getMetaCampaignTreeNode();
            if (campTreeNode) {
                console.log('[TwoD AutoFill] Selecionando o nível da campanha na barra lateral...');
                await selectAdInTree(campTreeNode);
                await sleep(1000);
                nameInput = findMetaCampaignNameInput();
            }
        }

        if (!nameInput) {
            console.warn('[TwoD AutoFill] Campo "Nome da campanha" não encontrado.');
            showToast('⚠️ Campo de nome da campanha não encontrado na tela.', true);
            return false;
        }

        const currentVal = nameInput.value || nameInput.getAttribute('value') || '';
        console.log('[TwoD AutoFill] Nome atual encontrado:', currentVal);

        const newName = formatCampaignName(currentVal, campaignSlug, postId);
        console.log('[TwoD AutoFill] Novo nome gerado:', newName);

        if (currentVal === newName) {
            showToast(`Campanha já renomeada: ${newName}`);
            return true;
        }

        await fillInputNative(nameInput, newName);
        await sleep(350);

        // Dispara blur para salvar no Facebook
        nameInput.blur();
        nameInput.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        await sleep(300);

        showToast(`✅ Nome da campanha atualizado: ${newName}`);
        return true;
    }

    // Inserir apenas a URL do site no anúncio atualmente aberto
    async function fillOnlyUrlOnActiveAd(campaign) {
        const campSlug = campaign?.campanha || (campaign?.titulo ? campaign.titulo.replace(/\s+/g, '') : 'Campanha');
        const screenCampName = getCurrentCampaignNameFromScreen();
        const autoKey = detectSiteKeyFromScreen(screenCampName);
        const selectMetaSite = panel.querySelector('#twod-select-meta-site');
        const activeKey = selectedMetaSiteKey || (selectMetaSite ? selectMetaSite.value : null) || autoKey || 'app';
        selectedMetaSiteKey = activeKey;

        const savedLinks = getSavedCampaignLinks(currentDay, campSlug);
        const inputCurrentUrl = panel.querySelector('#twod-input-current-url');
        const baseSiteUrl = (inputCurrentUrl ? inputCurrentUrl.value.trim() : '') || savedLinks[activeKey] || '';

        if (!baseSiteUrl) {
            showToast('Nenhuma URL informada para este site.', true);
            return false;
        }

        // Detectar o idioma do anúncio aberto na tela via breadcrumbs/árvore lateral
        const lang = detectActiveAdLangFromScreen();

        const localized = formatLocalizedUrl(baseSiteUrl, lang).url;
        showToast(`Inserindo URL no anúncio (${lang.toUpperCase()}): ${localized}`);

        const websiteInput = findMetaWebsiteUrlInput();
        if (websiteInput) {
            await fillInputNative(websiteInput, localized);
            showToast(`✅ URL inserida com sucesso (${lang.toUpperCase()})!`);
            return true;
        } else {
            showToast('Campo URL do site não encontrado no anúncio aberto.', true);
            return false;
        }
    }

    // Executa a automação completa da campanha Meta Ads pelos 3 conjuntos/anúncios
    async function runMetaFullCampaign(campaign) {
        if (isMetaRunning) return;
        isMetaRunning = true;
        renderPanel();

        showToast('🚀 Iniciando automação da campanha...', false);
        await sleep(400);

        // Obter link do site correspondente
        const campSlug = campaign?.campanha || (campaign?.titulo ? campaign.titulo.replace(/\s+/g, '') : 'Campanha');
        const screenCampName = getCurrentCampaignNameFromScreen();
        const autoKey = detectSiteKeyFromScreen(screenCampName);
        const selectMetaSite = panel.querySelector('#twod-select-meta-site');
        const activeKey = selectedMetaSiteKey || (selectMetaSite ? selectMetaSite.value : null) || autoKey || 'app';
        selectedMetaSiteKey = activeKey; // Trava o site ativo para a execução completa

        const savedLinks = getSavedCampaignLinks(currentDay, campSlug);
        const inputCurrentUrl = panel.querySelector('#twod-input-current-url');
        const baseSiteUrl = savedLinks[activeKey] || (inputCurrentUrl ? inputCurrentUrl.value.trim() : '');
        const postId = extractPostIdFromUrl(baseSiteUrl);

        console.log('[TwoD AutoFill] Site ativo para automação:', activeKey, 'URL:', baseSiteUrl, 'PostID:', postId);

        try {
            // 0. Atualizar o Nome da Campanha (trocar MODELO pelo slug, colocar PostID antes da vírgula e apagar - Cópia)
            try {
                showToast(`📝 Verificando nome da campanha ${postId ? `(PostID: ${postId})` : ''}...`);
                await updateMetaCampaignName(campaign, postId);
                await sleep(700);
            } catch (nameErr) {
                console.error('[TwoD AutoFill] Erro ao atualizar nome da campanha:', nameErr);
            }

            // Gerar URLs localizadas para os 3 anúncios
            const urlPt = baseSiteUrl ? formatLocalizedUrl(baseSiteUrl, 'pt').url : '';
            const urlEs = baseSiteUrl ? formatLocalizedUrl(baseSiteUrl, 'es').url : '';
            const urlEn = baseSiteUrl ? formatLocalizedUrl(baseSiteUrl, 'en').url : '';

            const steps = [
                { lang: 'pt', name: 'Brasil (Português)', flag: '🇧🇷', url: urlPt },
                { lang: 'es', name: 'EUA (Espanhol)', flag: '🇪🇸', url: urlEs },
                { lang: 'en', name: 'EUA (Inglês)', flag: '🇺🇸', url: urlEn }
            ];

            for (let i = 0; i < steps.length; i++) {
                if (!isMetaRunning) {
                    showToast('Automação cancelada pelo usuário.', true);
                    break;
                }

                const step = steps[i];
                showToast(`${step.flag} Localizando anúncio de ${step.name}...`);

                // 1. Localizar anúncios na árvore lateral mapeados diretamente por conjunto
                let ads = getMetaCampaignAds();
                if (!ads) {
                    await sleep(600);
                    ads = getMetaCampaignAds();
                }

                if (!ads || !ads[step.lang]) {
                    showToast(`Não foi possível localizar o anúncio para ${step.name}.`, true);
                    continue;
                }

                const targetAdEl = ads[step.lang];

                // 2. Clicar no anúncio na barra lateral
                showToast(`${step.flag} Acessando anúncio de ${step.name}...`);
                await selectAdInTree(targetAdEl);

                // 3. Aguardar o editor da direita carregar
                let isReady = await waitForAdEditorReady(6000);
                if (!isReady) {
                    await selectAdInTree(targetAdEl);
                    isReady = await waitForAdEditorReady(4000);
                }

                if (!isReady) {
                    showToast(`Tempo limite ao abrir o anúncio de ${step.name}.`, true);
                    continue;
                }

                // Pausa para estabilização do editor React
                await sleep(900);

                // 4. Preencher todos os campos no idioma EXATO do conjunto e a URL correspondente
                console.log(`[TwoD AutoFill] Preenchendo ${step.name} estritamente no idioma: ${step.lang.toUpperCase()}`, step.url ? `URL: ${step.url}` : '(sem URL)');
                showToast(`${step.flag} Preenchendo textos e URL em ${step.name}...`);
                const filled = await fillCurrentAdFields(campaign, step.lang, step.url);

                if (filled > 0) {
                    showToast(`✅ ${step.name} preenchido com sucesso (${filled} campos)!`);
                } else {
                    showToast(`⚠️ Poucos campos preenchidos em ${step.name}.`, true);
                }

                // Pausa antes do próximo anúncio para o React salvar rascunho
                await sleep(1200);
            }

            if (isMetaRunning) {
                showToast('🎉 Campanha completa preenchida com sucesso nos 3 idiomas com URLs configuradas!');
            }
        } catch (err) {
            console.error('Erro na automação Meta Ads:', err);
            showToast(`Erro na automação Meta: ${err.message}`, true);
        } finally {
            isMetaRunning = false;
            renderPanel();
        }
    }

    // Preenchimento individual avulso
    async function executeMetaAdsFill(campaign, lang) {
        showToast(`Preenchendo anúncio atual (${lang.toUpperCase()})...`);
        const campSlug = campaign?.campanha || (campaign?.titulo ? campaign.titulo.replace(/\s+/g, '') : 'Campanha');
        const screenCampName = getCurrentCampaignNameFromScreen();
        const autoKey = detectSiteKeyFromScreen(screenCampName);
        const selectMetaSite = panel.querySelector('#twod-select-meta-site');
        const activeKey = selectedMetaSiteKey || (selectMetaSite ? selectMetaSite.value : null) || autoKey || 'app';
        selectedMetaSiteKey = activeKey;

        const savedLinks = getSavedCampaignLinks(currentDay, campSlug);
        const inputCurrentUrl = panel.querySelector('#twod-input-current-url');
        const baseSiteUrl = (inputCurrentUrl ? inputCurrentUrl.value.trim() : '') || savedLinks[activeKey] || '';
        const targetUrl = baseSiteUrl ? formatLocalizedUrl(baseSiteUrl, lang).url : '';

        const count = await fillCurrentAdFields(campaign, lang, targetUrl);
        if (count > 0) {
            showToast(`Preenchidos ${count} campos no anúncio (${lang.toUpperCase()})${targetUrl ? ' com URL!' : '!'}`);
        } else {
            showToast(`Campos não encontrados. Certifique-se de estar com o anúncio aberto no editor.`, true);
        }
    }

    // ==========================================
    // AUTOMAÇÃO DE DUPLICAÇÃO EM MASSA (POR PAÍSES)
    // ==========================================

    // Retorna o container de rolagem principal do editor central do Meta Ads
    function getEditorScrollContainer() {
        const leftThreshold = 240;
        const rightLimit = window.innerWidth * 0.85;

        const scrollContainers = Array.from(document.querySelectorAll('div, form, main, section')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            if (r.left < leftThreshold || r.left > rightLimit || r.width < 100) return false;
            return el.scrollHeight > el.clientHeight + 80;
        });

        if (scrollContainers.length > 0) {
            scrollContainers.sort((a, b) => b.scrollHeight - a.scrollHeight);
            return scrollContainers[0];
        }
        return null;
    }

    // Localiza o campo de input "Nome do conjunto de anúncios" no editor
    function findMetaAdSetNameInput() {
        const allInputs = Array.from(document.querySelectorAll('input')).filter(inp => {
            if (inp.closest('#twod-floating-root')) return false;
            const type = (inp.getAttribute('type') || 'text').toLowerCase();
            if (['hidden', 'checkbox', 'radio', 'button', 'submit'].includes(type)) return false;

            const ph = (inp.placeholder || '').toLowerCase();
            const aria = (inp.getAttribute('aria-label') || '').toLowerCase();
            if (ph.includes('pesquisar') || ph.includes('search') || ph.includes('buscar') ||
                aria.includes('pesquisar') || aria.includes('search') || aria.includes('buscar')) {
                return false;
            }
            const r = inp.getBoundingClientRect();
            return r.left > 200 && r.left < window.innerWidth * 0.85 && r.top > 60 && r.top < 420;
        });

        // 1. Por aria-label ou placeholder com "nome do conjunto"
        const byAttr = allInputs.find(i => {
            const label = (i.getAttribute('aria-label') || '').toLowerCase();
            const ph = (i.placeholder || '').toLowerCase();
            return /nome do conjunto|ad set name|conjunto de an/i.test(label) ||
                /nome do conjunto|ad set name|conjunto de an/i.test(ph);
        });
        if (byAttr) return byAttr;

        // 2. Próximo ao texto "Nome do conjunto de anúncios"
        const allHeadings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span, label')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const txt = (el.innerText || '').trim().toLowerCase();
            return (/nome do conjunto/i.test(txt) || /ad set name/i.test(txt)) && el.children.length <= 2;
        });
        for (const h of allHeadings) {
            let p = h.parentElement;
            for (let lvl = 0; lvl < 4; lvl++) {
                if (!p) break;
                const found = p.querySelector('input[type="text"], input:not([type])');
                if (found && !found.closest('#twod-floating-root')) return found;
                p = p.parentElement;
            }
        }

        return allInputs[0] || null;
    }

    // ==========================================
    // DETECÇÃO GEOMÉTRICA DINÂMICA DA BARRA LATERAL
    // ==========================================
    function getSidebarGeometry() {
        // Encontra a barra lateral de navegação (árvore de conjuntos e anúncios)
        // 1. Procura pelo campo de busca "Pesquisar" no topo da árvore lateral
        const searchInput = Array.from(document.querySelectorAll('input[type="text"], input:not([type])')).find(inp => {
            if (inp.closest('#twod-floating-root')) return false;
            const r = inp.getBoundingClientRect();
            const ph = (inp.getAttribute('placeholder') || inp.getAttribute('aria-label') || '').toLowerCase();
            return (ph.includes('pesquisar') || ph.includes('search')) && r.left < window.innerWidth * 0.38 && r.top < 220;
        });

        if (searchInput) {
            const sRect = searchInput.getBoundingClientRect();
            return {
                left: Math.max(30, sRect.left - 40),
                right: sRect.right + 25,
                top: 50,
                bottom: window.innerHeight - 50
            };
        }

        // 2. Procura pelo container nav/aside na esquerda
        const navContainers = Array.from(document.querySelectorAll('nav, aside, div[role="navigation"], [aria-label*="campanhas" i], [aria-label*="navegação" i]')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            return r.left >= 0 && r.left < 100 && r.width >= 200 && r.width <= 500 && r.height > 400;
        });

        if (navContainers.length > 0) {
            const r = navContainers[0].getBoundingClientRect();
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }

        // 3. Fallback responsivo baseado na resolução da tela
        return {
            left: 35,
            right: Math.min(420, Math.max(290, window.innerWidth * 0.28)),
            top: 50,
            bottom: window.innerHeight - 50
        };
    }

    // Localiza a linha completa do conjunto base na árvore lateral
    function findBaseAdSetNode(lang) {
        const sidebar = getSidebarGeometry();
        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            return r.left >= sidebar.left && r.left <= sidebar.right && r.top > sidebar.top && r.width > 20 && r.height > 10;
        });

        const isMatch = (txt) => {
            const t = (txt || '').toLowerCase();
            if (t.includes('novo') || t.includes('anúncio') || t.includes('anuncio') || t.includes('modelo') || t.includes('campanha') || t.includes('pesquisar')) return false;
            if (lang === 'es') {
                return t.includes('espanhol') || t.includes('spanish') || t.includes('estados unidos (espanhol)') || t.includes('estados unidos - espanhol');
            }
            if (lang === 'en') {
                return t.includes('inglês') || t.includes('ingles') || t.includes('english') || t.includes('estados unidos (inglês)') || t.includes('estados unidos - inglês');
            }
            return false;
        };

        // 1. Busca nó específico com Espanhol ou Inglês
        let match = candidates.find(el => isMatch(el.innerText) && el.children.length <= 3) ||
            candidates.find(el => isMatch(el.innerText));

        // 2. Se o usuário já tiver renomeado o conjunto base de Espanhol para Espanha, ainda consegue encontrá-lo
        if (!match && lang === 'es') {
            match = candidates.find(el => {
                const txt = (el.innerText || '').trim().toLowerCase();
                return (txt === 'espanha' || txt.startsWith('espanha')) && !txt.includes('novo') && !txt.includes('anúncio') && el.children.length <= 3;
            });
        }

        return match || null;
    }

    // Obtém o elemento que representa a linha inteira (row) do conjunto na árvore lateral
    function getAdSetRowContainer(adSetNode) {
        if (!adSetNode) return null;
        let curr = adSetNode;
        const sidebar = getSidebarGeometry();
        const minRowWidth = (sidebar.right - sidebar.left) * 0.65;

        for (let lvl = 0; lvl < 8; lvl++) {
            if (!curr || curr === document.body) break;
            const r = curr.getBoundingClientRect();
            if (r.width >= minRowWidth && r.height >= 22 && r.height <= 65) {
                return curr;
            }
            curr = curr.parentElement;
        }
        return adSetNode.parentElement || adSetNode;
    }

    // Verifica se a campanha já possui um conjunto com o nome do país na árvore lateral
    function hasAdSetWithCountryInTree(countryName) {
        if (!countryName) return false;
        const target = countryName.trim().toLowerCase();
        const sidebar = getSidebarGeometry();
        const nodes = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            if (r.left < sidebar.left || r.left > sidebar.right || r.width < 15 || r.height < 10) return false;
            const txt = (el.innerText || '').trim().toLowerCase();
            return (txt === target || txt.startsWith(target + ' ') || txt.startsWith(target + '—') || txt.startsWith(target + '-')) &&
                !txt.includes('novo anúncio') && !txt.includes('pesquisar') && el.children.length <= 2;
        });
        return nodes.length > 0;
    }

    // Encontra o botão de 3 pontinhos ("Menu de ações") para o item da árvore
    function findThreeDotsForAdSet(adSetNode) {
        if (!adSetNode) return null;
        const row = getAdSetRowContainer(adSetNode);
        const rRow = row.getBoundingClientRect();
        const nodeY = rRow.top + rRow.height / 2;
        const sidebar = getSidebarGeometry();

        // 1. Busca botões diretamente dentro do container da linha (row)
        const rowButtons = Array.from(row.querySelectorAll('button, [role="button"], [aria-haspopup="menu"], [data-tooltip-content*="ações" i], [aria-label*="ações" i], [aria-label*="action" i]'));

        // Prioriza botão com aria-label ou tooltip de "ações" ou "menu"
        const actionBtn = rowButtons.find(b => {
            const label = (b.getAttribute('aria-label') || b.getAttribute('title') || b.getAttribute('data-tooltip-content') || '').toLowerCase();
            return label.includes('ações') || label.includes('acoes') || label.includes('action') || label.includes('menu');
        });
        if (actionBtn) return actionBtn;

        // Se houver botões dentro da linha, o botão de 3 pontinhos fica sempre na metade direita da linha
        const rightButtons = rowButtons.filter(b => {
            const br = b.getBoundingClientRect();
            return br.left > rRow.left + rRow.width * 0.45 && br.width >= 10 && br.height >= 10;
        });
        if (rightButtons.length > 0) {
            return rightButtons[rightButtons.length - 1];
        }

        // 2. Busca na mesma faixa vertical Y da linha, encostado na borda direita da barra lateral
        const rightEdgeX = sidebar.right;
        const lateralCandidates = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            // Perto da borda direita da barra lateral
            if (r.left < rightEdgeX - 65 || r.left > rightEdgeX + 15) return false;
            // Na mesma altura vertical da linha (±16px)
            if (Math.abs((r.top + r.height / 2) - nodeY) > 16) return false;
            return r.width >= 10 && r.width <= 50 && r.height >= 10 && r.height <= 50;
        });

        if (lateralCandidates.length > 0) {
            const btn = lateralCandidates.find(el => el.getAttribute('role') === 'button' || el.tagName === 'BUTTON' || el.hasAttribute('aria-haspopup')) ||
                lateralCandidates[lateralCandidates.length - 1];
            return btn;
        }

        // 3. Procura usando elementFromPoint na margem direita da barra lateral
        for (const offset of [18, 28, 38, 12, 48]) {
            const probeX = sidebar.right - offset;
            const hit = document.elementFromPoint(probeX, nodeY);
            if (hit && !hit.closest('#twod-floating-root')) {
                const btn = hit.closest('[role="button"], button, [aria-haspopup="menu"], div[tabindex]') || hit;
                if (btn && btn !== document.body && btn !== row) return btn;
            }
        }

        return null;
    }

    // Localiza o botão de 3 pontinhos ("Mais ações") no cabeçalho superior do editor (ao lado do switch Desativado)
    function findEditorHeaderActionsButton() {
        const topElements = Array.from(document.querySelectorAll('*')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const r = el.getBoundingClientRect();
            return r.top > 30 && r.top < 150 && r.left > window.innerWidth * 0.75 && r.width >= 16 && r.width <= 60 && r.height >= 16 && r.height <= 60;
        });

        const btn = topElements.find(el => {
            const aria = (el.getAttribute('aria-label') || el.getAttribute('title') || '').toLowerCase();
            return (aria.includes('ações') || aria.includes('acoes') || aria.includes('action') || aria.includes('mais') || aria.includes('more')) &&
                (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON' || el.hasAttribute('aria-haspopup'));
        }) || topElements.find(el => (el.getAttribute('role') === 'button' || el.tagName === 'BUTTON') && el.querySelector('svg'));

        return btn || null;
    }

    // Verifica se o modal "Duplique seu conjunto de anúncios" já está visível
    function isDuplicationModalOpen() {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], div')).filter(el => {
            if (el.closest('#twod-floating-root')) return false;
            const txt = (el.innerText || '');
            return (txt.includes('Duplique seu conjunto de anúncios') || txt.includes('Aplicar recomendações') || txt.includes('Duplicate your ad set')) &&
                el.getBoundingClientRect().width > 280 && el.getBoundingClientRect().height > 120;
        });
        return dialogs.length > 0;
    }

    // Simula clique real completo (pointerdown, mousedown, pointerup, mouseup, click)
    async function simulateRealClick(targetEl) {
        if (!targetEl) return;
        targetEl.scrollIntoView({ block: 'nearest' });
        await sleep(60);
        const r = targetEl.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const init = { bubbles: true, cancelable: true, view: window, buttons: 1, clientX: cx, clientY: cy };
        targetEl.dispatchEvent(new PointerEvent('pointerdown', init));
        targetEl.dispatchEvent(new MouseEvent('mousedown', init));
        targetEl.dispatchEvent(new PointerEvent('pointerup', init));
        targetEl.dispatchEvent(new MouseEvent('mouseup', init));
        targetEl.click();
    }

    // Localiza e clica na opção "Duplicar rapidamente" (ou "Duplicar") dentro do menu popup
    async function clickDuplicarRapidamenteInMenu() {
        for (let wait = 0; wait < 12; wait++) {
            await sleep(200);

            // Se o modal de duplicação já abriu, encerra com sucesso
            if (isDuplicationModalOpen()) return true;

            // 1. Procura opção "Duplicar rapidamente"
            const menuCandidates = Array.from(document.querySelectorAll('*')).filter(el => {
                if (el.closest('#twod-floating-root')) return false;
                const txt = (el.innerText || '').trim();
                return (txt.includes('Duplicar rapidamente') || txt.includes('Quick duplicate')) && txt.length < 80;
            });

            if (menuCandidates.length > 0) {
                menuCandidates.sort((a, b) => a.innerText.length - b.innerText.length);
                const targetOption = menuCandidates[0];
                console.log('[TwoD AutoFill] Opção "Duplicar rapidamente" encontrada! Clicando...', targetOption.innerText.replace(/\n/g, ' '));
                await simulateRealClick(targetOption);
                await sleep(600);
                return true;
            }

            // 2. Fallback: opção "Duplicar" simples no menu
            const dupCandidates = Array.from(document.querySelectorAll('[role="menuitem"], [role="menu"] *, div, span')).filter(el => {
                if (el.closest('#twod-floating-root') || el.closest('[role="dialog"]')) return false;
                const txt = (el.innerText || '').trim();
                return (txt === 'Duplicar' || txt.startsWith('Duplicar') || txt === 'Duplicate') && txt.length < 35 && !txt.includes('recomendações');
            });

            if (dupCandidates.length > 0) {
                dupCandidates.sort((a, b) => a.innerText.length - b.innerText.length);
                const targetOption = dupCandidates[0];
                console.log('[TwoD AutoFill] Opção "Duplicar" encontrada no menu! Clicando...', targetOption.innerText.replace(/\n/g, ' '));
                await simulateRealClick(targetOption);
                await sleep(600);
                return true;
            }
        }
        return isDuplicationModalOpen();
    }

    // Dispara a ação de duplicação através de múltiplas camadas de fallback resilientes
    async function triggerQuickDuplicate(adSetNode) {
        if (!adSetNode) return false;

        // Se o modal já estiver aberto, continua imediatamente
        if (isDuplicationModalOpen()) return true;

        // Passo A: Clicar no conjunto na árvore para selecioná-lo e focar
        await selectAdInTree(adSetNode);
        await sleep(350);

        if (isDuplicationModalOpen()) return true;

        const row = getAdSetRowContainer(adSetNode);
        const rRow = row.getBoundingClientRect();
        const nodeY = rRow.top + rRow.height / 2;
        const sidebar = getSidebarGeometry();

        // Dispara hover na extremidade direita da linha para exibir o botão caso esteja com opacidade 0
        const hoverX = sidebar.right - 25;
        row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: hoverX, clientY: nodeY }));
        row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: hoverX, clientY: nodeY }));
        row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: hoverX, clientY: nodeY }));
        await sleep(150);

        // Tentativa 1: Localizar o botão de 3 pontinhos na linha lateral
        const threeDotsBtn = findThreeDotsForAdSet(adSetNode);
        if (threeDotsBtn) {
            console.log('[TwoD AutoFill] Botão de 3 pontinhos localizado na linha lateral! Clicando...', threeDotsBtn);
            await simulateRealClick(threeDotsBtn);
            await sleep(400);

            const opened = await clickDuplicarRapidamenteInMenu();
            if (opened || isDuplicationModalOpen()) return true;
        }

        // Tentativa 2: Usar o botão de 3 pontinhos no cabeçalho superior do editor
        const headerBtn = findEditorHeaderActionsButton();
        if (headerBtn) {
            console.log('[TwoD AutoFill] Tentando botão de ações no cabeçalho do editor...', headerBtn);
            await simulateRealClick(headerBtn);
            await sleep(400);

            const opened = await clickDuplicarRapidamenteInMenu();
            if (opened || isDuplicationModalOpen()) return true;
        }

        // Tentativa 3: Botão direito (contextmenu) na linha da árvore lateral
        console.log('[TwoD AutoFill] Tentando abrir menu de ações via botão direito (contextmenu)...');
        row.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 2,
            buttons: 2,
            clientX: rRow.left + 50,
            clientY: nodeY
        }));
        await sleep(450);

        const openedContext = await clickDuplicarRapidamenteInMenu();
        if (openedContext || isDuplicationModalOpen()) return true;

        // Tentativa 4: Disparar atalhos nativos de teclado (Cmd+D / Ctrl+D / Ctrl+Shift+D)
        console.log('[TwoD AutoFill] Disparando atalhos nativos de teclado (Cmd+D / Ctrl+D)...');
        adSetNode.focus?.();
        const active = document.activeElement || adSetNode;

        for (const isMac of [true, false]) {
            for (const keyDef of [{ key: 'd', code: 'KeyD', keyCode: 68 }, { key: 'D', code: 'KeyD', keyCode: 68, shiftKey: true }]) {
                const kParams = {
                    key: keyDef.key,
                    code: keyDef.code,
                    keyCode: keyDef.keyCode,
                    which: keyDef.keyCode,
                    shiftKey: !!keyDef.shiftKey,
                    ctrlKey: !isMac,
                    metaKey: isMac,
                    bubbles: true,
                    composed: true,
                    view: window
                };
                active.dispatchEvent(new KeyboardEvent('keydown', kParams));
                document.dispatchEvent(new KeyboardEvent('keydown', kParams));
                window.dispatchEvent(new KeyboardEvent('keydown', kParams));
            }
        }
        await sleep(500);
        if (isDuplicationModalOpen()) return true;

        // Tentativa 5 (Assistência Interativa): Se Meta Ads bloquear eventos sintéticos, aguarda 8 segundos pelo modal
        showToast('👉 Por favor, pressione Cmd+D (Mac) ou clique nos 3 pontinhos para duplicar...');
        for (let poll = 0; poll < 16; poll++) {
            await sleep(500);
            if (isDuplicationModalOpen()) {
                console.log('[TwoD AutoFill] Modal detectado via ação do usuário!');
                return true;
            }
        }

        return false;
    }

    // Trata o modal "Duplique seu conjunto de anúncios"
    async function handleDuplicationModal(timeoutMs = 9000) {
        const start = Date.now();
        let modal = null;

        while (Date.now() - start < timeoutMs) {
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], div')).filter(el => {
                if (el.closest('#twod-floating-root')) return false;
                const txt = (el.innerText || '');
                return (txt.includes('Duplique seu conjunto de anúncios') || txt.includes('Aplicar recomendações')) &&
                    el.getBoundingClientRect().width > 280 && el.getBoundingClientRect().height > 120;
            });

            if (dialogs.length > 0) {
                modal = dialogs[0];
                break;
            }
            await sleep(300);
        }

        if (!modal) {
            console.warn('[TwoD AutoFill] Modal "Duplique seu conjunto de anúncios" não apareceu a tempo.');
            return false;
        }

        console.log('[TwoD AutoFill] Modal de duplicação detectado com sucesso!');
        await sleep(500);

        // 1. Desmarcar "Aplicar recomendações"
        const recLabels = Array.from(modal.querySelectorAll('*')).filter(el => {
            const txt = (el.innerText || '').trim();
            return (txt === 'Aplicar recomendações' || txt.startsWith('Aplicar recomendações')) && el.children.length === 0;
        });

        for (const lbl of recLabels) {
            const container = lbl.closest('label, div[role="checkbox"], div') || lbl.parentElement;
            const cb = container.querySelector('input[type="checkbox"], [role="checkbox"]') || container;
            const isChecked = cb.checked === true || cb.getAttribute('aria-checked') === 'true' || cb.classList.contains('checked');
            if (isChecked || cb.tagName === 'INPUT') {
                console.log('[TwoD AutoFill] Desmarcando checkbox Aplicar recomendações...');
                cb.click();
                await sleep(350);
            }
        }

        // Garante que nenhum checkbox restante no modal continue marcado
        const allCheckboxes = Array.from(modal.querySelectorAll('input[type="checkbox"], [role="checkbox"]'));
        for (const cb of allCheckboxes) {
            const isChecked = cb.checked === true || cb.getAttribute('aria-checked') === 'true';
            if (isChecked) {
                cb.click();
                await sleep(150);
            }
        }

        // 2. Clicar no botão azul "Duplicar"
        const buttons = Array.from(modal.querySelectorAll('button, [role="button"]')).filter(b => {
            const txt = (b.innerText || '').trim();
            return (txt === 'Duplicar' || txt.includes('Duplicar')) && !txt.includes('Cancelar') && !txt.includes('Fechar');
        });

        if (buttons.length > 0) {
            const dupBtn = buttons[buttons.length - 1];
            console.log('[TwoD AutoFill] Clicando no botão azul "Duplicar"...', dupBtn);
            dupBtn.click();
            await sleep(2000);
            return true;
        }

        return false;
    }

    // Confirma que o novo conjunto duplicado carregou no editor (contém "Cópia" no nome ou breadcrumb)
    async function waitForDuplicatedAdSetInEditor(timeoutMs = 12000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const nameInput = findMetaAdSetNameInput();
            if (nameInput) {
                const val = (nameInput.value || nameInput.getAttribute('value') || '').toLowerCase();
                if (val.includes('cópia') || val.includes('copia') || val.includes('copy')) {
                    console.log('[TwoD AutoFill] Conjunto duplicado confirmado no editor:', val);
                    return true;
                }
            }

            // Verifica no breadcrumb central
            const breadcrumbs = Array.from(document.querySelectorAll('*')).filter(el => {
                if (el.closest('#twod-floating-root')) return false;
                const txt = (el.innerText || '').toLowerCase();
                return (txt.includes('— cópia') || txt.includes('- cópia') || txt.includes(' cópia') || txt.includes(' copy')) && el.children.length === 0;
            });

            if (breadcrumbs.length > 0) {
                console.log('[TwoD AutoFill] Conjunto duplicado detectado nos breadcrumbs!');
                return true;
            }

            await sleep(400);
        }
        return false;
    }

    // Ativa o conjunto duplicado caso esteja "Desativado" (switch no canto superior direito)
    async function ensureAdSetActivated() {
        for (let attempt = 0; attempt < 8; attempt++) {
            const topElements = Array.from(document.querySelectorAll('*')).filter(el => {
                if (el.closest('#twod-floating-root')) return false;
                const r = el.getBoundingClientRect();
                return r.top > 0 && r.top < 130 && r.left > window.innerWidth * 0.6 && r.height > 10;
            });

            const desativadoEl = topElements.find(el => {
                const txt = (el.innerText || '').trim();
                return txt === 'Desativado' && el.children.length === 0;
            });

            if (desativadoEl) {
                console.log('[TwoD AutoFill] Conjunto está Desativado. Ligando switch...');
                const parent = desativadoEl.parentElement;
                const switchEl = parent?.querySelector('[role="switch"], input[type="checkbox"], button, [data-testid*="toggle"]') ||
                    topElements.find(el => {
                        const r = el.getBoundingClientRect();
                        const rd = desativadoEl.getBoundingClientRect();
                        return Math.abs(r.top - rd.top) < 25 && Math.abs(r.left - rd.right) < 60 &&
                            (el.getAttribute('role') === 'switch' || el.tagName === 'INPUT' || el.tagName === 'BUTTON');
                    });

                const targetClick = switchEl || desativadoEl;
                targetClick.click();
                await sleep(600);
                console.log('[TwoD AutoFill] Switch de ativação clicado com sucesso!');
                return true;
            }

            const ativoEl = topElements.find(el => {
                const txt = (el.innerText || '').trim();
                return (txt === 'Em rascunho' || txt === 'Ativo') && el.children.length === 0;
            });

            if (ativoEl) {
                console.log('[TwoD AutoFill] Conjunto já está ativado (' + ativoEl.innerText + ').');
                return true;
            }

            await sleep(300);
        }
        return false;
    }

    // Duplica o conjunto de anúncios que JÁ ESTÁ ABERTO no editor central (Encadeamento Rápido)
    async function triggerDuplicateCurrentOpenAdSet() {
        if (isDuplicationModalOpen()) return true;

        // 1. Tenta pelo botão de 3 pontinhos no cabeçalho superior do editor (ao lado do switch Desativado/Ativo)
        const headerBtn = findEditorHeaderActionsButton();
        if (headerBtn) {
            console.log('[TwoD AutoFill] Duplicando conjunto atual via botão de ações no cabeçalho do editor...', headerBtn);
            await simulateRealClick(headerBtn);
            await sleep(400);

            const opened = await clickDuplicarRapidamenteInMenu();
            if (opened || isDuplicationModalOpen()) return true;
        }

        // 2. Dispara atalhos nativos de teclado (Cmd+D no Mac / Ctrl+D no Windows)
        console.log('[TwoD AutoFill] Tentando duplicar via atalho de teclado nativo (Cmd+D / Ctrl+D)...');
        const active = document.activeElement || document.body;
        for (const isMac of [true, false]) {
            for (const keyDef of [{ key: 'd', code: 'KeyD', keyCode: 68 }, { key: 'D', code: 'KeyD', keyCode: 68, shiftKey: true }]) {
                const kParams = {
                    key: keyDef.key,
                    code: keyDef.code,
                    keyCode: keyDef.keyCode,
                    which: keyDef.keyCode,
                    shiftKey: !!keyDef.shiftKey,
                    ctrlKey: !isMac,
                    metaKey: isMac,
                    bubbles: true,
                    composed: true,
                    view: window
                };
                active.dispatchEvent(new KeyboardEvent('keydown', kParams));
                document.dispatchEvent(new KeyboardEvent('keydown', kParams));
                window.dispatchEvent(new KeyboardEvent('keydown', kParams));
            }
        }
        await sleep(600);
        if (isDuplicationModalOpen()) return true;

        // 3. Assistência Interativa: se o Meta bloquear eventos sintéticos, aguarda o usuário apertar Cmd+D
        showToast('👉 Pressione Cmd+D (Mac) ou clique nos 3 pontinhos para duplicar...');
        for (let poll = 0; poll < 16; poll++) {
            await sleep(500);
            if (isDuplicationModalOpen()) {
                console.log('[TwoD AutoFill] Modal detectado via ação do usuário!');
                return true;
            }
        }

        return false;
    }

    // Renomeia o conjunto de anúncios para o nome do país
    async function renameDuplicatedAdSet(countryName) {
        const sc = getEditorScrollContainer();
        if (sc) {
            sc.scrollTop = 0;
            await sleep(600);
        }

        let nameInput = null;
        for (let attempt = 0; attempt < 8; attempt++) {
            nameInput = findMetaAdSetNameInput();
            if (nameInput) break;
            if (sc) sc.scrollTop = 0;
            await sleep(300);
        }

        if (!nameInput) {
            console.warn('[TwoD AutoFill] Campo "Nome do conjunto de anúncios" não encontrado.');
            return false;
        }

        nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(250);

        console.log(`[TwoD AutoFill] Atualizando Nome do Conjunto para: ${countryName}`);
        await fillInputNative(nameInput, countryName);
        await sleep(400);
        nameInput.blur();
        nameInput.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        await sleep(400);
        return true;
    }

    // Atualiza o orçamento diário para 1,00 (ou o valor configurado)
    async function updateAdSetDailyBudget(budgetValue = '1,00') {
        const sc = getEditorScrollContainer();
        if (sc) {
            sc.scrollTop = 350;
            await sleep(400);
        }

        let budgetInput = null;
        for (let attempt = 0; attempt < 6; attempt++) {
            const inputs = Array.from(document.querySelectorAll('input')).filter(inp => {
                if (inp.closest('#twod-floating-root')) return false;
                const r = inp.getBoundingClientRect();
                return r.left > 240 && r.left < window.innerWidth * 0.85 && r.width >= 35 && r.width <= 250;
            });

            // Input próximo a "Orçamento diário" ou "USD" ou "$"
            budgetInput = inputs.find(inp => {
                const p = inp.closest('div[class*="section"], section, div') || inp.parentElement?.parentElement;
                const txt = (p?.innerText || '').toLowerCase();
                return (txt.includes('orçamento diário') || txt.includes('orcamento diario')) &&
                    !txt.includes('pesquisar') && !txt.includes('nome do');
            }) || inputs.find(inp => {
                const val = (inp.value || '').trim();
                return /^\$?\s*\d+([.,]\d{2})?$/.test(val);
            });

            if (budgetInput) break;
            await sleep(300);
        }

        if (!budgetInput) {
            console.warn('[TwoD AutoFill] Campo de orçamento diário não encontrado.');
            return false;
        }

        budgetInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(250);

        console.log(`[TwoD AutoFill] Definindo Orçamento Diário para: ${budgetValue}`);
        budgetInput.focus();
        budgetInput.click();
        await sleep(150);
        await fillInputNative(budgetInput, budgetValue);
        await sleep(350);
        budgetInput.blur();
        budgetInput.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
        await sleep(400);
        return true;
    }

    // Localiza o input de pesquisa de localizações
    function findLocationSearchInput() {
        return Array.from(document.querySelectorAll('input')).find(inp => {
            if (inp.closest('#twod-floating-root')) return false;
            const ph = (inp.placeholder || '').toLowerCase();
            const al = (inp.getAttribute('aria-label') || '').toLowerCase();
            return ph.includes('localiza') || ph.includes('location') || al.includes('localiza');
        });
    }

    // Atualiza a localização (pesquisa o novo país, clica na opção "País", remove país anterior)
    async function updateAdSetLocation(country, oldCountryToRemove) {
        const sc = getEditorScrollContainer();

        // 1. Rola gradualmente para que o React monte a seção de Localizações
        let locInput = null;
        for (const scrollPos of [800, 1400, 2000, 2600, 3200]) {
            if (sc) {
                sc.scrollTop = scrollPos;
                await sleep(450);
            }

            locInput = findLocationSearchInput();
            if (locInput) break;

            // Se ainda não achou o input de pesquisa, procura botão "Editar"
            const editBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
                if (b.closest('#twod-floating-root')) return false;
                const txt = (b.innerText || '').trim();
                return txt === 'Editar' || txt === 'Edit';
            });

            for (const eb of editBtns) {
                const pText = (eb.closest('section, div[class*="section"], div')?.innerText || '').toLowerCase();
                if (pText.includes('localiza') || pText.includes('público') || pText.includes('controles')) {
                    console.log('[TwoD AutoFill] Expandindo seção de Localizações via botão Editar...');
                    eb.scrollIntoView({ block: 'center' });
                    await sleep(200);
                    eb.click();
                    await sleep(650);
                    locInput = findLocationSearchInput();
                    if (locInput) break;
                }
            }

            if (locInput) break;
        }

        if (!locInput) {
            console.warn('[TwoD AutoFill] Campo "Pesquisar localizações" não encontrado!');
            return false;
        }

        locInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await sleep(300);
        locInput.focus();
        locInput.click();
        await sleep(250);

        console.log(`[TwoD AutoFill] Pesquisando país: ${country.query}`);
        await fillInputNative(locInput, country.query);
        locInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: country.query, inputType: 'insertText' }));
        locInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));

        // 2. Aguardar o dropdown com opções do Facebook (tempo estendido: até 6s)
        let selectedOption = null;
        const targetQueryLower = country.query.toLowerCase();
        const targetNameLower = country.name.toLowerCase();

        for (let wait = 0; wait < 16; wait++) {
            await sleep(350);
            const options = Array.from(document.querySelectorAll('[role="option"], [role="listbox"] *, li, div')).filter(el => {
                if (el.closest('#twod-floating-root')) return false;
                const r = el.getBoundingClientRect();
                if (r.height < 18 || r.width < 80 || r.top < 60) return false;
                const txt = (el.innerText || '').toLowerCase();
                const hasName = txt.includes(targetQueryLower) || txt.includes(targetNameLower);
                const isCountryType = /\bpa[íi]s\b/i.test(txt) || /\bcountry\b/i.test(txt);
                return hasName && isCountryType;
            });

            if (options.length > 0) {
                options.sort((a, b) => a.innerText.length - b.innerText.length);
                selectedOption = options[0];
                break;
            }
        }

        if (selectedOption) {
            console.log('[TwoD AutoFill] Selecionando opção "País":', selectedOption.innerText.replace(/\n/g, ' '));
            await simulateRealClick(selectedOption);
            await sleep(1500);
        } else {
            console.warn(`[TwoD AutoFill] Opção "País" não detectada na lista para ${country.name}. Disparando Enter...`);
            locInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
            await sleep(1500);
        }

        // 3. Remover país antigo herdado (ex: Estados Unidos ou país anterior)
        await sleep(800);
        const oldNameLower = (oldCountryToRemove || '').toLowerCase();
        const allRemoveButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
            if (b.closest('#twod-floating-root')) return false;
            const al = (b.getAttribute('aria-label') || '').toLowerCase();
            const tt = (b.getAttribute('data-tooltip-content') || '').toLowerCase();
            const txt = (b.innerText || '').toLowerCase();
            return al.includes('remover') || al.includes('remove') || al.includes('excluir') ||
                tt.includes('remover') || txt === '✕' || txt === 'x';
        });

        for (const btn of allRemoveButtons) {
            const parent = btn.closest('div, li, tr') || btn.parentElement;
            const parentText = (parent?.innerText || '').toLowerCase();
            const isNewCountry = parentText.includes(targetNameLower) || parentText.includes(targetQueryLower);
            if (!isNewCountry && (oldNameLower ? parentText.includes(oldNameLower) : true)) {
                console.log('[TwoD AutoFill] Removendo localização anterior herdada:', parentText.replace(/\n/g, ' '));
                btn.click();
                await sleep(700);
            }
        }

        return true;
    }

    // Orquestrador da Duplicação em Massa por Bloco de Países (com encadeamento otimizado)
    async function runCountryDuplication(blockId, budgetVal = '1,00') {
        const block = COUNTRY_BLOCKS.find(b => b.id === blockId);
        if (!block) {
            showToast('⚠️ Bloco de países não encontrado.', true);
            return;
        }

        // 1. Validar a existência do conjunto base na barra lateral
        const initialBaseNode = findBaseAdSetNode(block.baseSetKey);
        if (!initialBaseNode) {
            const errMsg = `⚠️ ERRO CRÍTICO: Não foi encontrado o conjunto base "${block.baseSetName}" na árvore lateral! A duplicação do ${block.name} foi abortada.`;
            console.error('[TwoD AutoFill] ' + errMsg);
            showToast(errMsg, true);
            alert(`[TwoD AutoFill - Erro de Validação]\n\nNão foi encontrado o conjunto base "${block.baseSetName}" na barra lateral da campanha.\n\nPara duplicar o ${block.name}, certifique-se de que a campanha possui o conjunto base em ${block.lang === 'es' ? 'Espanhol' : 'Inglês'}.`);
            return;
        }

        isCountryDuplicationRunning = true;
        countryDuplicationProgress = { current: 0, total: block.countries.length };
        renderPanel();
        showToast(`🚀 Iniciando duplicação em cadeia do ${block.name} (${block.countries.length} países)...`);

        let isFirstInRun = true;
        let lastFinishedCountry = null;

        try {
            for (let i = 0; i < block.countries.length; i++) {
                if (!isCountryDuplicationRunning) {
                    showToast('⏹ Duplicação cancelada pelo usuário.');
                    break;
                }

                const country = block.countries[i];
                countryDuplicationCurrentCountry = country.name;
                countryDuplicationProgress.current = i + 1;
                renderPanel();

                // Verifica se deve pular país que já existe na campanha
                if (countryDuplicationSkipExisting && hasAdSetWithCountryInTree(country.name)) {
                    console.log(`[TwoD AutoFill] O país ${country.name} já existe na árvore lateral. Pulando...`);
                    showToast(`⏭️ [${i + 1}/${block.countries.length}] ${country.name} já existe na campanha. Pulando...`);
                    await sleep(600);
                    continue;
                }

                showToast(`[${i + 1}/${block.countries.length}] 🌍 Duplicando para: ${country.name}...`);

                let dupTriggered = false;

                if (isFirstInRun) {
                    // No primeiro país da execução: duplica a partir do conjunto base (Estados Unidos ou já existente)
                    const baseNode = findBaseAdSetNode(block.baseSetKey);
                    if (!baseNode) {
                        showToast(`⚠️ Conjunto base "${block.baseSetName}" não pôde ser localizado. Abortando!`, true);
                        break;
                    }
                    dupTriggered = await triggerQuickDuplicate(baseNode);
                } else {
                    // A partir do segundo país: DUPLICA O CONJUNTO ATUAL QUE JÁ ESTÁ ABERTO NO EDITOR!
                    // Ele já está Ativo e já tem orçamento $ 1,00!
                    console.log(`[TwoD AutoFill] Duplicação encadeada a partir de ${lastFinishedCountry?.name || 'conjunto anterior'}...`);
                    dupTriggered = await triggerDuplicateCurrentOpenAdSet();
                }

                if (!dupTriggered) {
                    showToast(`⚠️ Não foi possível abrir duplicação para ${country.name}. Abortado por segurança!`, true);
                    console.error('[TwoD AutoFill] Falha ao acionar duplicação.');
                    break;
                }

                // Passo 2: Tratar modal de recomendações (desmarcar e clicar "Duplicar")
                const modalHandled = await handleDuplicationModal(10000);
                if (!modalHandled) {
                    showToast(`⚠️ O modal de duplicação não apareceu para ${country.name}. Abortando para segurança!`, true);
                    break;
                }

                // Passo 3: Confirma que o novo conjunto duplicado carregou no editor
                const copyConfirmed = await waitForDuplicatedAdSetInEditor(14000);
                if (!copyConfirmed) {
                    showToast(`⚠️ O conjunto duplicado não foi detectado no editor para ${country.name}. Abortando!`, true);
                    break;
                }

                // Passo 4: ROLAR EDITOR AO TOPO ABSOLUTO (Garante montagem do Nome e cabeçalho)
                const sc = getEditorScrollContainer();
                if (sc) {
                    sc.scrollTop = 0;
                    await sleep(700);
                }

                // Passo 5: Ligar switch apenas na primeira duplicação (os próximos já herdam Ativo!)
                if (isFirstInRun) {
                    await ensureAdSetActivated();
                    await sleep(500);
                }

                // Passo 6: Renomear o conjunto para o nome do país
                const renamed = await renameDuplicatedAdSet(country.name);
                if (!renamed) {
                    console.warn(`[TwoD AutoFill] Aviso: Renomeação pode ter falhado para ${country.name}.`);
                }
                await sleep(500);

                // Passo 7: Atualizar orçamento para $ 1,00 apenas na primeira duplicação (os próximos já herdam $ 1,00!)
                if (isFirstInRun) {
                    await updateAdSetDailyBudget(budgetVal);
                    await sleep(500);
                }

                // Passo 8: Atualizar localização (pesquisar país, clicar em "País", remover país anterior)
                const oldCountryToRemove = isFirstInRun ? 'Estados Unidos' : (lastFinishedCountry ? lastFinishedCountry.name : 'Estados Unidos');
                await updateAdSetLocation(country, oldCountryToRemove);
                await sleep(1500);

                // Feedback e atualização do encadeamento
                lastFinishedCountry = country;
                isFirstInRun = false;
                showToast(`✅ ${country.name} configurado com sucesso!`);
                await sleep(2000); // Pausa confortável de segurança entre países
            }

            if (isCountryDuplicationRunning) {
                showToast(`🎉 Sucesso! Concluída a duplicação dos países do ${block.name}!`);
            }
        } catch (err) {
            console.error('[TwoD AutoFill] Erro durante a duplicação em massa:', err);
            showToast(`Erro na duplicação: ${err.message || err}`, true);
        } finally {
            isCountryDuplicationRunning = false;
            countryDuplicationCurrentCountry = '';
            renderPanel();
        }
    }

    // ==========================================
    // AUTOMAÇÃO WORDPRESS (TAGS & COMENTÁRIOS)
    // ==========================================

    function getWordPressPostRows() {
        const rows = Array.from(document.querySelectorAll('#the-list > tr'));
        return rows.filter(tr => {
            return tr.id && /^post-\d+$/.test(tr.id) && !tr.classList.contains('inline-edit-row');
        });
    }

    function getPostTitleFromRow(row) {
        if (!row) return '';
        const titleLink = row.querySelector('.row-title') || 
                          row.querySelector('a.row-title') ||
                          row.querySelector('td.title strong a') ||
                          row.querySelector('td.column-title strong a') ||
                          row.querySelector('td.title a') ||
                          row.querySelector('td.column-title a');
        if (titleLink) {
            return (titleLink.textContent || titleLink.innerText || '').trim();
        }
        return '';
    }

    function findQuickEditButton(row) {
        if (!row) return null;
        const btn = row.querySelector('.editinline') || row.querySelector('button.editinline');
        if (btn) return btn;

        const actionLinks = Array.from(row.querySelectorAll('.row-actions a, .row-actions button'));
        return actionLinks.find(el => {
            const t = (el.textContent || '').toLowerCase();
            const isTrash = el.classList.contains('submitdelete') || t.includes('lixeira') || t.includes('papelera') || t.includes('trash') || t.includes('delete');
            const isQuick = t.includes('edição rápida') || t.includes('edición rápida') || t.includes('quick edit');
            return isQuick && !isTrash;
        }) || null;
    }

    function findSaveButton(editRow) {
        if (!editRow) return null;
        const primarySave = editRow.querySelector('button.button-primary.save') ||
                            editRow.querySelector('.save.button-primary') ||
                            editRow.querySelector('button.save') ||
                            editRow.querySelector('.inline-edit-save .save');
        if (primarySave && !primarySave.classList.contains('cancel') && !primarySave.classList.contains('submitdelete')) {
            return primarySave;
        }

        const allBtns = Array.from(editRow.querySelectorAll('button, input[type="button"], input[type="submit"]'));
        return allBtns.find(b => {
            const t = (b.textContent || b.value || '').toLowerCase();
            const isCancel = b.classList.contains('cancel') || b.classList.contains('submitdelete') || t.includes('cancelar') || t.includes('cancel');
            const isUpdate = t.includes('atualizar') || t.includes('actualizar') || t.includes('update');
            return isUpdate && !isCancel;
        }) || null;
    }

    function normStr(text) {
        if (!text) return '';
        return text.normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .trim();
    }

    function wordMatch(w1, w2) {
        if (!w1 || !w2) return false;
        if (w1 === w2) return true;
        if (w1.length >= 4 && w2.length >= 4) {
            const minLen = Math.min(w1.length, w2.length);
            const prefixLen = Math.max(4, minLen - 2);
            if (w1.substring(0, prefixLen) === w2.substring(0, prefixLen)) {
                return true;
            }
        }
        return false;
    }

    function detectNicheForPost(title, dayNiches = [], allNiches = []) {
        if (!title) return null;
        const titleNorm = normStr(title);
        const titleWords = titleNorm.split(/\s+/).filter(w => w.length > 3);
        const stopWords = new Set(['apps', 'download', 'gratis', 'para', 'como', 'mais', 'sobre', 'onde', 'qual', 'este', 'esta', 'esse', 'essa', 'voce', 'sua', 'seus', 'suas', 'pelo', 'pela', 'pelos', 'pelas', 'tudo', 'todos', 'todas', 'celular', 'aplicativo', 'app', 'dicas', 'passo', 'melhor', 'melhores']);

        const scoreNiche = (niche) => {
            let score = 0;

            const seos = niche.seo || [];
            for (const s of seos) {
                const sNorm = normStr(s);
                if (sNorm && (sNorm.includes(titleNorm) || titleNorm.includes(sNorm))) {
                    score += 500;
                }
            }

            const metas = niche.meta || [];
            for (const m of metas) {
                if (m.es) {
                    const esNorm = normStr(m.es);
                    if (esNorm.length > 5 && titleNorm.includes(esNorm)) {
                        score += 150;
                    }
                }
            }

            const tWords = normStr(niche.titulo || '').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
            for (const tw of tWords) {
                for (const titleW of titleWords) {
                    if (wordMatch(tw, titleW)) {
                        score += 60;
                    }
                }
            }

            const tags = (niche.tag || '').split(',').map(t => normStr(t)).filter(Boolean);
            for (const tag of tags) {
                if (tag.length > 4 && titleNorm.includes(tag)) {
                    score += 80;
                }
                const tagWords = tag.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
                for (const tw of tagWords) {
                    for (const titleW of titleWords) {
                        if (wordMatch(tw, titleW)) {
                            score += 10;
                        }
                    }
                }
            }

            for (const s of seos) {
                const sWords = normStr(s).split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
                for (const sw of sWords) {
                    for (const titleW of titleWords) {
                        if (wordMatch(sw, titleW)) {
                            score += 5;
                        }
                    }
                }
            }

            return score;
        };

        let bestScore = -1;
        let bestNiche = null;
        for (const niche of dayNiches) {
            const sc = scoreNiche(niche);
            if (sc > bestScore) {
                bestScore = sc;
                bestNiche = niche;
            }
        }

        if (bestScore > 0 && bestNiche) {
            return bestNiche;
        }

        for (const niche of allNiches) {
            const sc = scoreNiche(niche);
            if (sc > bestScore) {
                bestScore = sc;
                bestNiche = niche;
            }
        }

        return bestNiche || dayNiches[0] || null;
    }

    async function executeWordPressBulkQuickEdit(count = 8) {
        if (isWordPressRunning) return;
        isWordPressRunning = true;
        wpStopRequested = false;

        try {
            const allRows = getWordPressPostRows();
            if (allRows.length === 0) {
                showToast('Nenhum post encontrado na tabela do WordPress.', true);
                isWordPressRunning = false;
                renderPanel();
                return;
            }

            const targetRows = allRows.slice(0, count);
            const nichesForDay = data[currentDay] || [];
            const allNiches = Object.values(data).flat();

            showToast(`Iniciando ajuste em ${targetRows.length} textos recentes...`);

            for (let i = 0; i < targetRows.length; i++) {
                if (wpStopRequested) {
                    showToast('Processamento interrompido pelo usuário.', true);
                    break;
                }

                currentWpStep = i;
                const row = targetRows[i];
                const postId = (row.id || '').replace('post-', '');
                const postTitle = getPostTitleFromRow(row);

                let matchedNiche = null;
                if (wpCustomNicheAssignments[postId]) {
                    matchedNiche = allNiches.find(n => (n.campanha || n.titulo) === wpCustomNicheAssignments[postId]);
                }
                if (!matchedNiche) {
                    matchedNiche = detectNicheForPost(postTitle, nichesForDay, allNiches);
                }

                if (!matchedNiche) {
                    console.warn(`[TwoD AutoFill] Nicho não identificado para "${postTitle}". Pulando...`);
                    continue;
                }

                currentWpStatus = `[${i + 1}/${targetRows.length}] ${postTitle.substring(0, 24)}... ➔ ${matchedNiche.titulo}`;
                renderPanel();

                // 1. Rolar até o post e simular foco
                row.scrollIntoView({ block: 'center', behavior: 'smooth' });
                await sleep(300);

                // 2. Simular hover para garantir exibição das ações
                row.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                await sleep(150);

                // 3. Localizar botão de Edição Rápida
                const quickEditBtn = findQuickEditButton(row);
                if (!quickEditBtn) {
                    console.warn(`[TwoD AutoFill] Botão de Edição Rápida não encontrado no post ID ${postId}`);
                    continue;
                }

                // Clicar em Edição Rápida
                quickEditBtn.click();

                // 4. Aguardar o formulário inline de edição rápida abrir
                let editRow = null;
                for (let w = 0; w < 35; w++) {
                    if (wpStopRequested) break;
                    await sleep(100);
                    editRow = document.getElementById(`edit-${postId}`);
                    if (editRow && editRow.querySelector('textarea.tax_input_post_tag, input[name="comment_status"]')) {
                        break;
                    }
                }

                if (!editRow || wpStopRequested) {
                    if (wpStopRequested) break;
                    console.warn(`[TwoD AutoFill] Formulário de edição rápida não abriu para o post ID ${postId}`);
                    continue;
                }

                await sleep(200);

                // 5. Preencher campo de Etiquetas / Tags com as tags do nicho
                const tagsInput = editRow.querySelector('textarea.tax_input_post_tag') || 
                                  editRow.querySelector('textarea[name="tax_input[post_tag]"]') ||
                                  editRow.querySelector('.tax_input_post_tag');
                if (tagsInput && matchedNiche.tag) {
                    tagsInput.focus();
                    tagsInput.value = matchedNiche.tag;
                    tagsInput.dispatchEvent(new Event('input', { bubbles: true }));
                    tagsInput.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // 6. Desmarcar "Permitir comentários"
                const commentCheckbox = editRow.querySelector('input[name="comment_status"]');
                if (commentCheckbox && commentCheckbox.checked) {
                    commentCheckbox.click();
                    if (commentCheckbox.checked) commentCheckbox.checked = false;
                    commentCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // 7. Desmarcar "Permitir pings"
                const pingCheckbox = editRow.querySelector('input[name="ping_status"]');
                if (pingCheckbox && pingCheckbox.checked) {
                    pingCheckbox.click();
                    if (pingCheckbox.checked) pingCheckbox.checked = false;
                    pingCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                }

                await sleep(250);

                // 8. Localizar e clicar no botão Atualizar / Actualizar
                const saveBtn = findSaveButton(editRow);
                if (!saveBtn) {
                    console.warn(`[TwoD AutoFill] Botão Atualizar não encontrado para post ID ${postId}`);
                    continue;
                }

                saveBtn.click();

                // 9. Aguardar o salvamento AJAX concluir e a linha fechar
                for (let w = 0; w < 40; w++) {
                    if (wpStopRequested) break;
                    await sleep(200);
                    const stillOpen = document.getElementById(`edit-${postId}`);
                    if (!stillOpen) {
                        break;
                    }
                }

                await sleep(400); // Pausa de segurança entre cada post
            }

            if (!wpStopRequested) {
                currentWpStep = targetRows.length;
                renderPanel();
                showToast(`🎉 Concluído! Todos os ${targetRows.length} textos foram atualizados.`);
            }
        } catch (err) {
            console.error('[TwoD AutoFill] Erro no bulk quick edit WordPress:', err);
            showToast('Erro ao processar textos no WordPress: ' + err.message, true);
        } finally {
            isWordPressRunning = false;
            currentWpStatus = '';
            renderPanel();
        }
    }

    function injectWordPressHeaderButton() {
        if (!isWordPressPosts) return;
        if (document.getElementById('twod-wp-header-btn')) return;

        const heading = document.querySelector('.wp-heading-inline') || document.querySelector('.wrap h1');
        if (!heading) return;

        const btn = document.createElement('button');
        btn.id = 'twod-wp-header-btn';
        btn.type = 'button';
        btn.className = 'page-title-action';
        btn.style.cssText = 'background: linear-gradient(135deg, #7c3aed, #2563eb); color: white; border: none; font-weight: 600; cursor: pointer; margin-left: 8px; vertical-align: middle; border-radius: 4px; padding: 4px 10px; font-size: 12px;';
        btn.innerHTML = '⚡ TwoD: Ajustar Tags (8 Textos)';
        btn.title = 'Abre o TwoD AutoFill para preencher tags e desmarcar comentários nos 8 textos recentes';

        btn.addEventListener('click', () => {
            panel.classList.remove('twod-hidden');
            activeTab = 'wp';
            renderPanel();
        });

        heading.insertAdjacentElement('afterend', btn);
    }

    // Inicializar
    renderPanel();
    if (isWordPressPosts) {
        injectWordPressHeaderButton();
    }
})();
