// ========================================================
// TWOD HUB — MOTOR JAVASCRIPT DA DASHBOARD
// ========================================================

const STORAGE_KEYS = {
    SITES: 'twod_fun_sites',
    CURRENT_USER: 'twod_logged_user',
    AUTH_TOKEN: 'twod_auth_token',
    MEDIA_TOKEN: 'twod_media_token',
    ACTIVE_TAB: 'twod_active_tab',
    META_TOKEN: 'twod_meta_token',
    META_ACCOUNT: 'twod_meta_default_account'
};

const CLOUD_BACKEND_URL = 'https://twod-dashboard-thiago.onrender.com';

function getDefaultBackendUrl() {
    if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        return window.location.origin;
    }
    if (typeof window !== 'undefined' && window.location.hostname.endsWith('.onrender.com')) {
        return window.location.origin;
    }
    return CLOUD_BACKEND_URL;
}

let API_BASE_URL = (localStorage.getItem('twod_backend_url') || getDefaultBackendUrl()).replace(/\/+$/, '');

// Limpa cache legado inseguro que armazenava usuários com senha no navegador
try { localStorage.removeItem('twod_users_db'); } catch (e) { }

const DEFAULT_SITES = [
    { id: 1, name: 'Ai', lang: 'pt', index: 0, hidden: false },
    { id: 2, name: 'App', lang: 'pt', index: 1, hidden: false },
    { id: 3, name: 'Twodcompany (1º)', lang: 'pt', index: 3, hidden: false },
    { id: 4, name: 'F4rol', lang: 'pt', index: 4, hidden: false },
    { id: 5, name: 'Hub', lang: 'pt', index: 5, hidden: false },
    { id: 6, name: 'Kiocom', lang: 'pt', index: 6, hidden: false },
    { id: 7, name: 'Kiuvix', lang: 'es', index: 7, hidden: false },
    { id: 8, name: 'Thehatsune', lang: 'pt', index: 8, hidden: false },
    { id: 9, name: 'Twodcompany (Último)', lang: 'es', index: 9, hidden: false }
];

let users = [];
let sites = [...DEFAULT_SITES];
try {
    const rawSites = localStorage.getItem(STORAGE_KEYS.SITES);
    if (rawSites) {
        const parsed = JSON.parse(rawSites);
        if (Array.isArray(parsed) && parsed.length > 0) sites = parsed;
    }
} catch (e) {
    sites = [...DEFAULT_SITES];
}

let currentUser = null;
try {
    const rawCur = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (rawCur) {
        const parsed = JSON.parse(rawCur);
        if (parsed && parsed.username) {
            delete parsed.password;
            currentUser = parsed;
        }
    }
} catch (e) { }

let _servicesBootstrapped = false;
let _prefetchedMetaConfig = null;
let _warmupPromise = null;
let _changelogShowAll = false;

function getAuthToken() {
    try { return localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) || ''; } catch (e) { return ''; }
}

function getMediaToken() {
    try { return localStorage.getItem(STORAGE_KEYS.MEDIA_TOKEN) || ''; } catch (e) { return ''; }
}

function setAuthSession(data) {
    if (!data) return;
    if (data.token) {
        try { localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, data.token); } catch (e) { }
    }
    if (data.media_token) {
        try { localStorage.setItem(STORAGE_KEYS.MEDIA_TOKEN, data.media_token); } catch (e) { }
    }
    if (data.meta_config && typeof data.meta_config === 'object') {
        _prefetchedMetaConfig = data.meta_config;
    }
    if (data.user) {
        const safeU = { ...data.user };
        delete safeU.password;
        currentUser = safeU;
        try { localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(safeU)); } catch (e) { }
    }
}

function clearAuthSession() {
    currentUser = null;
    _servicesBootstrapped = false;
    _prefetchedMetaConfig = null;
    try {
        localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.MEDIA_TOKEN);
        localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    } catch (e) { }
}

function withMediaAuth(url) {
    if (!url || typeof url !== 'string') return url || '';
    const mTok = getMediaToken();
    if (!mTok) return url;
    const hashIdx = url.indexOf('#');
    const basePart = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const hashPart = hashIdx >= 0 ? url.slice(hashIdx) : '';
    const isMediaPath = /\/api\/(graph\/thumb|graph\/file|audio|video)\//i.test(basePart);
    if (!isMediaPath) return url;
    const cleaned = basePart.replace(/([?&])t=[^&]*(&|$)/, (_, p1, p2) => (p1 === '?' && p2) ? '?' : (p2 ? p1 : '')).replace(/[?&]$/, '');
    const sep = cleaned.includes('?') ? '&' : '?';
    return `${cleaned}${sep}t=${encodeURIComponent(mTok)}${hashPart}`;
}

async function apiFetch(pathOrUrl, options = {}) {
    const url = (typeof pathOrUrl === 'string' && (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')))
        ? pathOrUrl
        : `${API_BASE_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

    const headers = new Headers(options.headers || {});
    const authTok = getAuthToken();
    if (authTok && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${authTok}`);
    }

    const resp = await fetch(url, { ...options, headers });
    if (resp.status === 401 || resp.status === 403) {
        try {
            const errData = await resp.clone().json();
            if (errData && errData.auth_error) {
                if (errData.code === 'PASSWORD_CHANGE_REQUIRED') {
                    showForcePasswordModal();
                } else {
                    clearAuthSession();
                    showLogin(errData.error || 'Sessão expirada. Faça login novamente.');
                }
            }
        } catch (e) { }
    }
    return resp;
}

window.apiFetch = apiFetch;
window.withMediaAuth = withMediaAuth;

function saveSites() {
    try { localStorage.setItem(STORAGE_KEYS.SITES, JSON.stringify(sites)); } catch (e) { }
}

// ========================================================
// SISTEMA DE AUTENTICAÇÃO E SESSÃO (VALIDADO NO BACKEND)
// ========================================================

function decodeTokenPayloadUnsafe(token) {
    // Uso exclusivo para roteamento visual no cliente; toda rota protege via HMAC no servidor
    if (!token || typeof token !== 'string' || !token.includes('.')) return null;
    try {
        const rawB64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
        const pad = '='.repeat((4 - (rawB64.length % 4)) % 4);
        const bin = atob(rawB64 + pad);
        const bytes = Uint8Array.from(bin, ch => ch.charCodeAt(0));
        const json = new TextDecoder().decode(bytes);
        return JSON.parse(json);
    } catch (e) {
        return null;
    }
}

function updateLoginServerPill(state, text) {
    const el = document.getElementById('login-server-status');
    if (!el) return;
    el.className = `login-server-pill${state ? ' ' + state : ''}`;
    el.innerText = text;
}

function warmupBackendServer(force = false) {
    if (_warmupPromise && !force) return _warmupPromise;
    updateLoginServerPill('', '⏳ Conectando ao servidor...');
    const wakingTimer = setTimeout(() => {
        updateLoginServerPill('waking', '🟡 Acordando servidor na nuvem...');
    }, 1800);

    _warmupPromise = fetch(`${API_BASE_URL}/api/status`, { method: 'GET', cache: 'no-store' })
        .then(resp => {
            clearTimeout(wakingTimer);
            if (resp.ok) {
                updateLoginServerPill('ready', '🟢 Servidor online e pronto');
                return true;
            }
            updateLoginServerPill('waking', '🟡 Servidor respondendo com alerta');
            return false;
        })
        .catch(() => {
            clearTimeout(wakingTimer);
            updateLoginServerPill('waking', '🟡 Servidor acordando — tente novamente se demorar');
            _warmupPromise = null;
            return false;
        });
    return _warmupPromise;
}

function syncAppUserHeader() {
    if (!currentUser) return;
    const nameEl = document.getElementById('current-user-name');
    const roleEl = document.getElementById('current-user-role');
    const avatarEl = document.getElementById('current-user-avatar');
    if (nameEl) nameEl.innerText = currentUser.name || 'Usuário';
    if (roleEl) roleEl.innerText = currentUser.role || 'Operador';
    if (avatarEl) avatarEl.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();

    const isAdmin = currentUser.role === 'Administrador';
    document.querySelectorAll('.admin-only').forEach(el => {
        if (isAdmin) {
            el.classList.remove('twod-hidden');
        } else {
            el.classList.add('twod-hidden');
        }
    });
}

async function verifySessionInBackground(authTok) {
    try {
        const prevTheme = currentUser ? currentUser.themeMode : null;
        const resp = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${authTok}` }
        });
        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data || !data.success || !data.user) {
            if (data && data.code === 'PASSWORD_CHANGE_REQUIRED') {
                showForcePasswordModal();
                return;
            }
            if (resp.status === 401 || resp.status === 403) {
                clearAuthSession();
                showLogin((data && data.error) || 'Sessão expirada. Faça login novamente.');
            }
            return;
        }
        setAuthSession(data);
        if (data.must_change_password) {
            showForcePasswordModal();
            return;
        }
        syncAppUserHeader();
        if (data.user.themeMode && data.user.themeMode !== prevTheme) {
            try { applyUserTheme(); } catch (e) { }
        }
    } catch (e) {
        console.warn('Falha ao revalidar sessão em segundo plano:', e);
    }
}

async function checkSession() {
    const authTok = getAuthToken();
    if (!authTok) {
        showLogin();
        warmupBackendServer();
        return;
    }

    const tokenPayload = decodeTokenPayloadUnsafe(authTok);
    const hasLocalValidToken = Boolean(
        tokenPayload &&
        Number(tokenPayload.exp || 0) * 1000 > Date.now() + 30000 &&
        !tokenPayload.mcp &&
        currentUser &&
        currentUser.username &&
        !currentUser.must_change_password
    );

    if (hasLocalValidToken) {
        showApp();
        initAuthenticatedApp();
        verifySessionInBackground(authTok);
        return;
    }

    warmupBackendServer();
    const loginBtn = document.getElementById('btn-login-submit');
    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.innerText = '⏳ Verificando sessão segura...';
    }

    try {
        const resp = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: { 'Authorization': `Bearer ${authTok}` }
        });
        const data = await resp.json();

        if (!resp.ok || !data.success || !data.user) {
            clearAuthSession();
            showLogin();
            return;
        }

        setAuthSession(data);
        if (data.must_change_password) {
            showForcePasswordModal();
        } else {
            showApp();
            initAuthenticatedApp();
        }
    } catch (e) {
        console.warn('Falha ao validar sessão com backend:', e);
        showLogin('Não foi possível conectar ao servidor de autenticação.');
    } finally {
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerText = 'Acessar Painel';
        }
    }
}

function showLogin(errorMsg = '') {
    clearAuthSession();

    const loginEl = document.getElementById('login-screen');
    const forceEl = document.getElementById('force-password-screen');
    const appEl = document.getElementById('app-container');
    const errBox = document.getElementById('login-error');
    const pwdInput = document.getElementById('login-password');

    if (forceEl) {
        forceEl.style.display = 'none';
        forceEl.classList.add('twod-hidden');
    }
    if (loginEl) {
        loginEl.style.display = 'flex';
        loginEl.classList.remove('twod-hidden');
    }
    if (appEl) {
        appEl.style.display = 'none';
        appEl.classList.add('twod-hidden');
    }
    if (errBox) {
        if (errorMsg) {
            errBox.innerText = errorMsg;
            errBox.classList.remove('twod-hidden');
        } else {
            errBox.classList.add('twod-hidden');
        }
    }
    if (pwdInput) pwdInput.value = '';
    warmupBackendServer();
}

function showForcePasswordModal() {
    const loginEl = document.getElementById('login-screen');
    const forceEl = document.getElementById('force-password-screen');
    const appEl = document.getElementById('app-container');
    const lbl = document.getElementById('force-pwd-user-label');
    const errBox = document.getElementById('force-pwd-error');
    const p1 = document.getElementById('force-new-pwd');
    const p2 = document.getElementById('force-confirm-pwd');

    if (loginEl) {
        loginEl.style.display = 'none';
        loginEl.classList.add('twod-hidden');
    }
    if (appEl) {
        appEl.style.display = 'none';
        appEl.classList.add('twod-hidden');
    }
    if (forceEl) {
        forceEl.style.display = 'flex';
        forceEl.classList.remove('twod-hidden');
    }
    if (lbl && currentUser) {
        lbl.innerText = `Olá ${currentUser.name || currentUser.username} (@${currentUser.username}) — defina sua senha pessoal para liberar o painel.`;
    }
    if (errBox) errBox.classList.add('twod-hidden');
    if (p1) p1.value = '';
    if (p2) p2.value = '';
    if (p1) setTimeout(() => p1.focus(), 60);
}

function showApp() {
    if (!currentUser || !currentUser.username || !getAuthToken()) {
        showLogin();
        return;
    }

    const loginEl = document.getElementById('login-screen');
    const forceEl = document.getElementById('force-password-screen');
    const appEl = document.getElementById('app-container');

    if (loginEl) {
        loginEl.style.display = 'none';
        loginEl.classList.add('twod-hidden');
    }
    if (forceEl) {
        forceEl.style.display = 'none';
        forceEl.classList.add('twod-hidden');
    }
    if (appEl) {
        appEl.style.display = 'flex';
        appEl.classList.remove('twod-hidden');
    }

    syncAppUserHeader();

    try { applyUserTheme(); } catch (e) { }
    try { renderSitesTable(); } catch (e) { }
    try { renderChangelog(); } catch (e) { }
    const isAdmin = currentUser.role === 'Administrador';
    if (isAdmin) {
        try { loadUsersFromBackend(); } catch (e) { }
    }
    try { initTabs(); } catch (e) { }
}

function initAuthenticatedApp() {
    if (_servicesBootstrapped) return;
    _servicesBootstrapped = true;
    checkSavedOneDriveHandle();
    initMetaApi();
}

async function handleLogin(e) {
    if (e && e.preventDefault) {
        e.preventDefault();
        e.stopPropagation();
    }
    const uEl = document.getElementById('login-username');
    const pEl = document.getElementById('login-password');
    const errBox = document.getElementById('login-error');
    const loginBtn = document.getElementById('btn-login-submit');
    const usernameInput = (uEl ? uEl.value : '').trim().toLowerCase();
    const passwordInput = (pEl ? pEl.value : '').trim();

    if (!usernameInput || !passwordInput) {
        alert('Por favor, digite o usuário e a senha.');
        return false;
    }

    if (errBox) errBox.classList.add('twod-hidden');
    let coldStartHintTimer = null;
    if (loginBtn) {
        loginBtn.disabled = true;
        loginBtn.innerText = '⏳ Entrando no painel...';
        coldStartHintTimer = setTimeout(() => {
            if (loginBtn && loginBtn.disabled) {
                loginBtn.innerText = '⏳ Acordando servidor na nuvem...';
            }
        }, 2200);
    }

    try {
        const resp = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });
        const data = await resp.json();

        if (!resp.ok || !data.success) {
            if (errBox) {
                errBox.innerText = data.error || 'Usuário ou senha incorretos.';
                errBox.classList.remove('twod-hidden');
            }
            return false;
        }

        setAuthSession(data);
        if (data.must_change_password) {
            showForcePasswordModal();
        } else {
            showApp();
            initAuthenticatedApp();
        }
    } catch (err) {
        console.error('Erro no handleLogin:', err);
        if (errBox) {
            errBox.innerText = 'Falha ao conectar no servidor Render. Aguarde alguns segundos e tente novamente.';
            errBox.classList.remove('twod-hidden');
        }
    } finally {
        if (coldStartHintTimer) clearTimeout(coldStartHintTimer);
        if (loginBtn) {
            loginBtn.disabled = false;
            loginBtn.innerText = 'Acessar Painel';
        }
    }
    return false;
}

async function submitForcedPasswordChange(e) {
    if (e && e.preventDefault) e.preventDefault();
    const p1 = (document.getElementById('force-new-pwd')?.value || '').trim();
    const p2 = (document.getElementById('force-confirm-pwd')?.value || '').trim();
    const errBox = document.getElementById('force-pwd-error');
    const btn = document.getElementById('btn-force-pwd-submit');

    const showErr = (msg) => {
        if (errBox) {
            errBox.innerText = msg;
            errBox.classList.remove('twod-hidden');
        } else {
            alert(msg);
        }
    };

    if (p1.length < 6) return showErr('A nova senha deve ter pelo menos 6 caracteres.');
    if (p1 === '123456') return showErr('A nova senha não pode ser 123456. Escolha uma senha pessoal.');
    if (p1 !== p2) return showErr('As duas senhas digitadas não coincidem.');

    if (errBox) errBox.classList.add('twod-hidden');
    if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Salvando senha...';
    }

    try {
        const resp = await apiFetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_password: p1 })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            return showErr(data.error || 'Não foi possível atualizar a senha.');
        }

        setAuthSession(data);
        showApp();
        initAuthenticatedApp();
    } catch (err) {
        showErr('Erro de conexão ao salvar nova senha: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '🔒 Salvar Senha e Entrar';
        }
    }
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        if (e && e.preventDefault) e.preventDefault();
        handleLogin(e);
    });
}

const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
    btnLogout.addEventListener('click', (e) => {
        if (e && e.preventDefault) e.preventDefault();
        showLogin();
    });
}

// ========================================================
// SISTEMA DE TEMAS (CLARO, ESCURO, AGENDADO)
// ========================================================

function applyUserTheme() {
    if (!currentUser) return;
    const mode = currentUser.themeMode || 'dark';

    // Atualiza botões do header
    document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.remove('active'));
    const activeHeaderBtn = document.getElementById(`theme-btn-${mode}`);
    if (activeHeaderBtn) activeHeaderBtn.classList.add('active');

    // Atualiza radio na aba de configurações
    const radio = document.querySelector(`input[name="theme-choice"][value="${mode}"]`);
    if (radio) radio.checked = true;

    // Mostra/oculta controles de horário
    const scheduleBox = document.getElementById('schedule-controls');
    if (mode === 'auto') {
        scheduleBox.classList.remove('twod-hidden');
        document.getElementById('schedule-start').value = currentUser.scheduleStart || '06:00';
        document.getElementById('schedule-end').value = currentUser.scheduleEnd || '18:00';
    } else {
        scheduleBox.classList.add('twod-hidden');
    }

    evaluateTheme();
}

function evaluateTheme() {
    if (!currentUser) return;
    const mode = currentUser.themeMode || 'dark';
    const html = document.documentElement;

    if (mode === 'light') {
        html.setAttribute('data-theme', 'light');
    } else if (mode === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else if (mode === 'auto') {
        // Lógica de agendamento por horário
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();

        const [startH, startM] = (currentUser.scheduleStart || '06:00').split(':').map(Number);
        const [endH, endM] = (currentUser.scheduleEnd || '18:00').split(':').map(Number);

        const startMins = startH * 60 + startM;
        const endMins = endH * 60 + endM;

        let isDaytime = false;
        if (startMins <= endMins) {
            isDaytime = currentMins >= startMins && currentMins < endMins;
        } else {
            // Se o período cruzar a meia-noite
            isDaytime = currentMins >= startMins || currentMins < endMins;
        }

        html.setAttribute('data-theme', isDaytime ? 'light' : 'dark');
    }
}

function setThemeMode(mode) {
    if (!currentUser) return;
    currentUser.themeMode = mode;
    saveUserPreferences();
    applyUserTheme();
}

function updateThemeSettings(mode) {
    setThemeMode(mode);
}

function saveScheduleTimes() {
    if (!currentUser) return;
    currentUser.scheduleStart = document.getElementById('schedule-start').value;
    currentUser.scheduleEnd = document.getElementById('schedule-end').value;
    saveUserPreferences();
    evaluateTheme();
}

async function saveUserPreferences() {
    if (!currentUser) return;
    try { localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser)); } catch (e) { }
    try {
        await apiFetch('/api/users/preferences', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                themeMode: currentUser.themeMode,
                scheduleStart: currentUser.scheduleStart,
                scheduleEnd: currentUser.scheduleEnd
            })
        });
    } catch (e) { }
}

// Relógio em Tempo Real e Checagem Periódica de Horário
function updateClock() {
    const now = new Date();
    const clockEl = document.getElementById('live-clock');
    if (clockEl) {
        clockEl.innerText = now.toLocaleTimeString('pt-BR');
    }
    evaluateTheme();
}
setInterval(updateClock, 1000);

// ========================================================
// NAVEGAÇÃO DE ABAS
// ========================================================

const tabTitles = {
    'visao-geral': { title: 'Visão Geral', subtitle: 'Status operacional e conexões da central' },
    'criativos': { title: 'Gerador de Criativos', subtitle: 'TWOD Studio V2 — Renderização via FFmpeg e OneDrive' },
    'gerador-campanhas': { title: 'Gerador de Campanhas', subtitle: 'Criação direta no Meta Ads sem o painel pesado' },
    'duplicador': { title: 'Duplicador Meta Ads', subtitle: 'Duplicação em massa por Blocos de Países' },
    'fun-digital': { title: 'Fila FUN Digital', subtitle: 'Controle de sites e alimentação da extensão' },
    'wordpress': { title: 'WordPress Automator', subtitle: 'Ajuste de tags e comentários em massa via WP REST API' },
    'usuarios': { title: 'Gestão de Usuários', subtitle: 'Controle de acessos e permissões da equipe' },
    'configuracoes': { title: 'Configurações & Tema', subtitle: 'Preferências pessoais, horários e segurança' }
};

// ========================================================
// LOG DE ATUALIZAÇÕES DO PAINEL (VISÃO GERAL)
// Para adicionar novas entregas, insira um item no topo abaixo.
// ========================================================
const PANEL_CHANGELOG = [
    {
        date: '25/11/2026',
        type: 'feat',
        badge: '🏢 Advertiser AU / Compliance',
        title: 'Detecção e preenchimento automático do Advertiser (Futuretech Dynamics) para Austrália (3858634)',
        summary: 'Detecta a entidade verificada na conta/BM/conjuntos existentes e aplica automaticamente em Austrália, Brasil, UE e demais países regulados.',
        highlights: [
            'Novo seletor "Anunciante / Advertiser" na Etapa 2 com auto-detecção de Futuretech Dynamics, dsa_recommendations e regional_regulation_identities.',
            'Retry inteligente na criação/atualização do conjunto para Austrália (AUSTRALIA_UNIVERSAL, VOLUNTARY_VERIFICATION, AUSTRALIA_FINSERV) salvando a combinação vencedora.'
        ]
    },
    {
        date: '25/11/2026',
        type: 'feat',
        badge: '📄 Troca Auto de Página',
        title: 'Seletor de Página + Fallback Automático no Duplicador (Erro 1885499 / 3858749)',
        summary: 'Lista as Páginas autorizadas da conta e troca automaticamente de Página quando a original estiver sem permissão de anunciante.',
        highlights: [
            'Novo seletor "Página do Anúncio (Meta)" na Etapa 2 para escolher outra Página fixa ou deixar no modo automático.',
            'Se /ads ou /adcreatives retornar 1885499/3858749, recria o AdCreative em uma Página autorizada (removendo instagram_user_id incompatível), reutiliza nos próximos países e mantém o rollback anti-conjunto vazio se nenhuma Página funcionar.'
        ]
    },
    {
        date: '25/11/2026',
        type: 'feat',
        badge: '⏰ Agendar 01h & Trava',
        title: 'Agendamento de conjuntos (Instantâneo vs Programar 01:00) + Trava Anti-Conjunto Vazio',
        summary: 'Modal próprio de disparo perguntando se deve iniciar agora ou programar (ex.: 01:00 da manhã) e rollback automático no 1º erro.',
        highlights: [
            'Opção de programar start_time na Meta API (com atalhos 01:00, 04:00, 06:00) publicando como Programado sem gastar antes do horário.',
            'Substitui diálogos nativos bloqueáveis pelo navegador e, se o anúncio falhar (ex.: 1885499), exclui o conjunto vazio na hora e para o lote.'
        ]
    },
    {
        date: '16/11/2026',
        type: 'feat',
        badge: '🎨 Fábrica de Criativos IA',
        title: 'Criativos automáticos Bloco A & B (Cloudflare Workers AI + Canvas)',
        summary: 'Gera cenários base grátis (Flux/Phoenix), aplica headlines/CTA em Feed (1:1) e Reels (9:16) para PT/ES/EN e envia pro OneDrive.',
        highlights: [
            'Lê os PDFs opcionais de Bloco A/B (ou deriva do Pacote da Semana), compõe 1..6.png com letras grandes para público 50+ e permite 🔄 Regerar IA por estilo.',
            'Menu expansível multi-nichos no Studio (puxa os nichos do PDF da semana para criar pastas/áudios/imagens em lote), pular blocos prontos no OneDrive e terminal ao vivo.'
        ]
    },
    {
        date: '16/11/2026',
        type: 'feat',
        badge: '📊 Progresso Ao Vivo',
        title: 'Barrinha de progresso individual por áudio (Studio + Semana)',
        summary: 'Acompanhamento em tempo real de cada idioma/arquivo (.mp3) sendo gerado e salvo no OneDrive.',
        highlights: [
            'Barra de progresso no Studio TTS + fila ao vivo (🕒 na fila, ⏳ gerando, ✅ player pronto).',
            'Mini barra de progresso em cada card da semana + contador global áudio por áudio (ex.: 14/30).'
        ]
    },
    {
        date: '16/11/2026',
        type: 'fix',
        badge: '🌐 Tradução & TTS',
        title: 'Tradução nativa via Gemini API nos áudios ES / EN / Europa',
        summary: 'Corrigido bug em que áudios estrangeiros saíam em Português por bloqueio de IP no Render.',
        highlights: [
            'Roteiros agora são traduzidos via Gemini (gemini-2.5-flash-lite) + fallback do navegador antes de sintetizar a voz.',
            'Trava anti-português impede salvar áudio em PT dentro de arquivos _es.mp3 / _en.mp3 e exibe o texto traduzido no player.'
        ]
    },
    {
        date: '16/11/2026',
        type: 'feat',
        badge: '📄 Importador PDF',
        title: 'Importador Temporário de Pacote da Semana (PDF) + Áudios em Lote',
        summary: 'Suba o PDF da semana (Seg–Sex) para extrair os 10 nichos, criar as pastas e gerar todos os áudios por idioma direto no OneDrive.',
        highlights: [
            'Leitura em 2 colunas (Seg–Sex) com slugs, roteiros ~18s, links, tags, títulos SEO e políticas.',
            'Corrigida exibição dos players de áudio no Studio, buildCommand do Render (imageio-ffmpeg) e fallback generateContent no Gemini TTS.'
        ]
    },
    {
        date: '16/11/2026',
        type: 'feat',
        badge: '🎙️ Áudios IA',
        title: 'Locuções MP3 com Gemini TTS direto no OneDrive',
        summary: 'Tradução automática e síntese de voz (PT, ES, EN, FR, IT, DE) com Google AI Studio salvando MP3 direto em Arquivos de Áudio.',
        highlights: [
            'Extração de ZIP multi-nicho criando pastas pareadas de Vídeo e Áudio automaticamente.',
            'Configuração segura da GEMINI_API_KEY em Configurações ou inline no Studio V2.'
        ]
    },
    {
        date: '15/11/2026',
        type: 'feat',
        badge: '🎬 Studio V2',
        title: 'TWOD Criativos Studio V2 no OneDrive (Upload + Renderizador FFmpeg)',
        summary: 'Criação de pacotes <Nicho> <Data>, envio padronizado de áudios/imagens/ZIP para o OneDrive e renderização 1.mp4–6.mp4 em nuvem.',
        highlights: [
            'Padronização automática: 1–3 Feed (1:1), 4–6 Reels (9:16), Bloco A/B, 1. Imagens preservada e áudios *_pt/_es/_en.mp3.',
            'Auditoria pré-voo e renderização H.264 + AAC (math.ceil + apad) salvando MP4s direto no OneDrive.'
        ]
    },
    {
        date: '15/11/2026',
        type: 'sec',
        badge: '🛡️ Proteção & Status',
        title: 'Status do App Meta (Verde/Amarelo/Vermelho) & Circuit Breaker Anti-Rajada',
        summary: 'Monitoramento em tempo real da saúde do App Meta + trava automática contra rajadas para evitar bloqueios e acompanhar DUC/Alertas.',
        highlights: [
            'Semáforo ao vivo no cabeçalho e na Visão Geral (Token, Permissões, Uso de Cota Meta, Conta/BM, DUC e App Reserva).',
            'Throttle e Circuit Breaker no servidor pausam lotes automaticamente antes que a API atinja limite ou receba flag antifraude.'
        ]
    },
    {
        date: '14/11/2026',
        type: 'perf',
        badge: '⚡ Velocidade',
        title: 'Otimização de velocidade, Tela inicial & Log de novidades',
        summary: 'Login muito mais rápido e painel sempre abrindo na Visão Geral com histórico resumido de entregas.',
        highlights: [
            'Corrigido erro 401 ao baixar usuários no OneDrive + removida trava síncrona e DNS reverso no login.',
            'Pré-aquecimento automático do Render na tela de login + entrada instantânea com sessão de 7 dias.',
            'Painel passa a abrir sempre na Visão Geral com este Log de Atualizações.'
        ]
    },
    {
        date: '14/11/2026',
        type: 'feat',
        badge: '🚀 Recurso',
        title: 'Suporte a Flexible Ads (1 criativo por anúncio) no Duplicador',
        summary: 'Anúncios flexíveis da Meta agora expandem automaticamente em até 6 anúncios individuais ao duplicar.',
        highlights: [
            'Leitura de asset_feed_spec e creative_asset_groups_spec com hidratação direta de criativos.',
            'Bloqueio preventivo caso falhe a leitura de criativos para não criar conjuntos vazios.'
        ]
    },
    {
        date: '14/11/2026',
        type: 'sec',
        badge: '🔒 Segurança',
        title: 'Autenticação no Servidor & Proxy da Meta Graph API',
        summary: 'Credenciais e token permanente da Meta agora ficam protegidos no backend em nuvem.',
        highlights: [
            'Sessões assinadas por HMAC-SHA256 e senhas em hash PBKDF2 sincronizadas no OneDrive.',
            'Troca obrigatória de senha inicial no primeiro acesso.'
        ]
    },
    {
        date: '14/11/2026',
        type: 'feat',
        badge: '🚀 Recurso',
        title: 'Miniaturas Meta, Pacotes OneDrive & Tradução em Lote',
        summary: 'Duplicador conectado aos criativos na nuvem com pré-visualização, Bloco A/B e tradução automática.',
        highlights: [
            'Vínculo campanha ↔ pacote OneDrive, indicadores de criativos OK e zoom nas miniaturas.',
            'Fallback de tradução direto no navegador quando o datacenter sofre limite.'
        ]
    },
    {
        date: '14/11/2026',
        type: 'fix',
        badge: '🔧 Correção',
        title: 'Busca por PostID & Trava contra Duplicação Cruzada',
        summary: 'Pesquisa instantânea de campanhas e proteção contra envio para campanha errada.',
        highlights: [
            'Filtro rápido por PostID ou nome no Duplicador e Gerador de Campanhas.',
            'campaign_id forçado no /copies com confirmação exibindo a campanha de destino.'
        ]
    }
];

function renderChangelog() {
    const listEl = document.getElementById('changelog-list');
    const toggleBtn = document.getElementById('btn-changelog-toggle');
    if (!listEl) return;

    const DEFAULT_VISIBLE = 3;
    const items = _changelogShowAll ? PANEL_CHANGELOG : PANEL_CHANGELOG.slice(0, DEFAULT_VISIBLE);
    listEl.innerHTML = items.map(entry => {
        const bullets = Array.isArray(entry.highlights) && entry.highlights.length
            ? `<ul class="changelog-bullets">${entry.highlights.map(h => `<li>${escHtml(h)}</li>`).join('')}</ul>`
            : '';
        return `
            <div class="changelog-item">
                <div class="changelog-item-top">
                    <span class="changelog-date">${escHtml(entry.date)}</span>
                    <span class="changelog-badge ${escHtml(entry.type || 'feat')}">${escHtml(entry.badge || 'Atualização')}</span>
                    <span class="changelog-title">${escHtml(entry.title)}</span>
                </div>
                <p class="changelog-summary">${escHtml(entry.summary)}</p>
                ${bullets}
            </div>
        `;
    }).join('');

    if (toggleBtn) {
        if (PANEL_CHANGELOG.length <= DEFAULT_VISIBLE) {
            toggleBtn.style.display = 'none';
        } else {
            toggleBtn.style.display = '';
            toggleBtn.innerText = _changelogShowAll
                ? 'Mostrar recentes'
                : `Ver tudo (${PANEL_CHANGELOG.length})`;
        }
    }
}

function toggleChangelogHistory() {
    _changelogShowAll = !_changelogShowAll;
    renderChangelog();
}

function initTabs() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        if (!btn.dataset.tabBound && !btn.getAttribute('onclick')) {
            btn.dataset.tabBound = '1';
            btn.addEventListener('click', (e) => {
                if (e && e.preventDefault) e.preventDefault();
                const tabId = btn.getAttribute('data-tab');
                switchTab(tabId);
            });
        }
    });

    // Sempre inicia o painel na tela inicial (Visão Geral)
    switchTab('visao-geral');
}

function switchTab(tabId) {
    if (!tabId) return;

    // Permissão: se tentar abrir usuário sem ser admin, volta para visão geral
    const isAdmin = currentUser && currentUser.role === 'Administrador';
    if (tabId === 'usuarios' && !isAdmin) {
        tabId = 'visao-geral';
    }

    if (!document.getElementById(`tab-${tabId}`)) {
        tabId = 'visao-geral';
    }

    try { localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tabId); } catch (e) { }

    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    const targetNav = document.querySelector(`.nav-item[data-tab="${tabId}"]`);
    const targetPane = document.getElementById(`tab-${tabId}`);

    if (targetNav) targetNav.classList.add('active');
    if (targetPane) targetPane.classList.add('active');

    // Atualiza títulos do cabeçalho
    const meta = tabTitles[tabId] || { title: 'TwoD Hub', subtitle: '' };
    const titleEl = document.getElementById('page-title');
    const subEl = document.getElementById('page-subtitle');
    if (titleEl) titleEl.innerText = meta.title;
    if (subEl) subEl.innerText = meta.subtitle;

    if (tabId === 'duplicador') {
        onDuplicatorTabOpened();
    } else if (tabId === 'criativos') {
        if (typeof window.onStudioTabOpened === 'function') {
            window.onStudioTabOpened();
        }
    } else if (tabId === 'gerador-campanhas') {
        if (typeof window.onCampaignBuilderTabOpened === 'function') {
            window.onCampaignBuilderTabOpened();
        }
    } else if (tabId === 'configuracoes') {
        onSettingsTabOpened();
    }
}

// ========================================================
// GESTÃO DA FILA FUN DIGITAL (9 SITES + ADICIONAR/OCULTAR)
// ========================================================

function renderSitesTable() {
    const tbody = document.getElementById('sites-table-body');
    const showHidden = document.getElementById('toggle-show-hidden').checked;
    tbody.innerHTML = '';

    const visibleSites = sites.filter(s => showHidden ? true : !s.hidden);

    visibleSites.forEach((site, index) => {
        const tr = document.createElement('tr');
        const langBadgeClass = `lang-${site.lang}`;
        const langLabel = site.lang === 'es' ? 'Espanhol (ES)' : (site.lang === 'en' ? 'Inglês (EN)' : 'Português (PT)');

        tr.innerHTML = `
            <td><strong>#${index + 1}</strong></td>
            <td><strong>${site.name}</strong></td>
            <td><span class="table-badge-lang ${langBadgeClass}">${langLabel}</span></td>
            <td>Index: ${site.index}</td>
            <td>
                <span class="${site.hidden ? 'status-badge-hidden' : 'status-badge-visible'}">
                    ${site.hidden ? '🔒 Oculto (Beta)' : '👁️ Visível na Fila'}
                </span>
            </td>
            <td>
                <button class="btn-icon-action" onclick="toggleSiteVisibility(${site.id})" title="${site.hidden ? 'Exibir na fila' : 'Ocultar da fila (Beta)'}">
                    ${site.hidden ? '👁️' : '🙈'}
                </button>
                <button class="btn-icon-action" onclick="deleteSite(${site.id})" title="Remover site">
                    🗑️
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Atualiza contadores na aba FUN Digital e no card da Visão Geral
    const totalVisiveis = sites.filter(s => !s.hidden).length;
    const totalOcultos = sites.length - totalVisiveis;
    document.getElementById('badge-total-sites').innerText = totalVisiveis;
    document.getElementById('sites-counter-text').innerText = `${totalVisiveis} sites ativos na fila (${totalOcultos} ocultos em teste)`;

    const funHeading = document.getElementById('fun-card-heading');
    const funSub = document.getElementById('fun-card-subinfo');
    if (funHeading) funHeading.innerText = `FUN Digital (${totalVisiveis} Sites)`;
    if (funSub) funSub.innerText = `${totalVisiveis} ativos na fila (${totalOcultos} ocultos)`;
}

function toggleSiteVisibility(id) {
    const site = sites.find(s => s.id === id);
    if (site) {
        site.hidden = !site.hidden;
        saveSites();
        renderSitesTable();
    }
}

function deleteSite(id) {
    if (confirm('Deseja realmente remover este site da fila?')) {
        sites = sites.filter(s => s.id !== id);
        saveSites();
        renderSitesTable();
    }
}

function openAddSiteModal() {
    document.getElementById('modal-site').classList.remove('twod-hidden');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('twod-hidden');
}

function saveNewSite(e) {
    e.preventDefault();
    const name = document.getElementById('site-name-input').value.trim();
    const lang = document.getElementById('site-lang-input').value;
    const index = parseInt(document.getElementById('site-index-input').value, 10);

    if (name) {
        const newSite = {
            id: Date.now(),
            name,
            lang,
            index,
            hidden: false
        };
        sites.push(newSite);
        saveSites();
        renderSitesTable();
        closeModal('modal-site');
        document.getElementById('form-add-site').reset();
    }
}

// ========================================================
// GESTÃO DE USUÁRIOS (ADMIN ONLY — VALIDADA NO BACKEND)
// ========================================================

async function loadUsersFromBackend() {
    try {
        const resp = await apiFetch('/api/users');
        const data = await resp.json();
        if (resp.ok && data.success && Array.isArray(data.users)) {
            users = data.users;
            renderUsersTable();
        }
    } catch (e) {
        console.warn('Falha ao carregar usuários do servidor:', e);
    }
}

function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        const isSelf = currentUser && u.username === currentUser.username;

        tr.innerHTML = `
            <td>
                <strong>${escHtml(u.name)}</strong> 
                <span style="font-size: 11px; color: var(--text-muted);">(@${escHtml(u.username)})</span>
                ${isSelf ? '<span class="badge-status status-active" style="margin-left: 6px;">Você</span>' : ''}
                ${u.must_change_password ? '<span class="badge-status status-pending" style="margin-left: 6px;">⏳ Troca no 1º acesso</span>' : ''}
            </td>
            <td><span class="badge-tag">${escHtml(u.role)}</span></td>
            <td>${u.themeMode === 'auto' ? '⏰ Automático' : (u.themeMode === 'light' ? '☀️ Claro' : '🌙 Escuro')}</td>
            <td><span style="color: var(--text-muted); font-size: 12px;">${escHtml(u.lastLogin || 'Nunca')}</span></td>
            <td>
                ${!isSelf ? `
                    <button class="btn-icon-action" onclick="resetUserPassword('${escHtml(u.username)}')" title="Resetar Senha">🔑</button>
                    <button class="btn-icon-action" onclick="deleteUser('${escHtml(u.username)}')" title="Excluir Usuário">🗑️</button>
                ` : `<span style="font-size: 11px; color: var(--text-muted);">Conta ativa</span>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openAddUserModal() {
    document.getElementById('modal-user').classList.remove('twod-hidden');
}

async function saveNewUser(e) {
    e.preventDefault();
    const name = document.getElementById('new-user-name').value.trim();
    const pwd = document.getElementById('new-user-pwd').value.trim();
    const role = document.getElementById('new-user-role').value;

    const username = name.toLowerCase().replace(/\s+/g, '');
    if (!username || pwd.length < 6) {
        alert('Informe nome e senha provisória com pelo menos 6 caracteres.');
        return;
    }

    try {
        const resp = await apiFetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, username, password: pwd, role })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            alert(data.error || 'Erro ao criar usuário.');
            return;
        }
        users.push(data.user);
        renderUsersTable();
        closeModal('modal-user');
        document.getElementById('form-add-user').reset();
        alert(`Usuário @${username} criado com sucesso! Ele deverá trocar a senha no primeiro login.`);
    } catch (err) {
        alert('Erro de conexão ao criar usuário: ' + err.message);
    }
}

async function resetUserPassword(username) {
    const target = users.find(u => u.username === username);
    if (!target) return;
    const nova = prompt(`Digite a nova senha provisória para ${target.name} (será trocada no próximo acesso):`, '123456');
    if (nova && nova.trim().length >= 6) {
        try {
            const resp = await apiFetch('/api/users/reset-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, new_password: nova.trim() })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                alert(data.error || 'Erro ao resetar senha.');
                return;
            }
            const idx = users.findIndex(u => u.username === username);
            if (idx !== -1 && data.user) users[idx] = data.user;
            renderUsersTable();
            alert('Senha provisória atualizada! O usuário será obrigado a definir uma nova no próximo login.');
        } catch (err) {
            alert('Erro ao resetar senha: ' + err.message);
        }
    } else if (nova !== null) {
        alert('A senha provisória deve ter pelo menos 6 caracteres.');
    }
}

async function deleteUser(username) {
    if (confirm(`Deseja realmente remover o usuário @${username}?`)) {
        try {
            const resp = await apiFetch('/api/users/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });
            const data = await resp.json();
            if (!resp.ok || !data.success) {
                alert(data.error || 'Erro ao remover usuário.');
                return;
            }
            users = users.filter(u => u.username !== username);
            renderUsersTable();
        } catch (err) {
            alert('Erro ao remover usuário: ' + err.message);
        }
    }
}

// ========================================================
// INTEGRAÇÃO ONEDRIVE & LEITOR DE ARQUIVOS NATIVO
// ========================================================

async function saveBackendUrlFromUI() {
    const input = document.getElementById('backend-url-input');
    const url = (input ? input.value : '').trim().replace(/\/+$/, '');
    if (url) {
        localStorage.setItem('twod_backend_url', url);
        API_BASE_URL = url;
    } else {
        localStorage.removeItem('twod_backend_url');
        API_BASE_URL = getDefaultBackendUrl();
    }
    const ok = await checkBackendAPI();
    if (ok) {
        alert(`Conectado com sucesso à API: ${API_BASE_URL}`);
    } else {
        alert(`URL salva (${API_BASE_URL}), mas o servidor não respondeu no momento.`);
    }
}

let oneDriveHandle = null;
let oneDriveData = {
    isApiMode: false,
    niches: [], // array de objetos de cada nicho
    audioFilesMap: new Map(), // chave: `${nicheName}_${lang}` -> File/Handle
    videoFilesMap: new Map()  // chave: `${nicheName}_${num}` -> File/Handle
};
let oneDriveOverviewMeta = {
    state: 'connecting',
    mode: 'graph_cloud',
    hydrating: false,
    folderName: ''
};

function updateOneDriveOverviewCard(opts = {}) {
    oneDriveOverviewMeta = { ...oneDriveOverviewMeta, ...opts };
    const badge = document.getElementById('badge-onedrive-status');
    const heading = document.getElementById('onedrive-card-heading');
    const desc = document.getElementById('onedrive-card-desc');
    const subinfo = document.getElementById('onedrive-card-subinfo');
    if (!badge || !heading || !desc || !subinfo) return;

    const {
        state,
        mode,
        hydrating,
        folderName,
        nichesCount = oneDriveData.niches.length,
        audiosCount = 0,
        videosCount = 0
    } = oneDriveOverviewMeta;

    let apiHost = API_BASE_URL;
    try { apiHost = new URL(API_BASE_URL).host; } catch (e) { }

    if (state === 'connecting') {
        badge.className = 'badge-status status-pending';
        badge.innerText = '⏳ Conectando...';
        heading.innerText = 'Microsoft OneDrive';
        desc.innerText = `Consultando API (${apiHost}) e cache de mídia...`;
        subinfo.innerText = 'Verificando status...';
        return;
    }

    if (state === 'auth_pending') {
        badge.className = 'badge-status status-pending';
        badge.innerText = '🟡 Autorizar Nuvem';
        heading.innerText = 'Microsoft OneDrive (OAuth Pendente)';
        desc.innerText = `Servidor online em ${apiHost}, mas falta autorizar a conta Microsoft em Criativos.`;
        subinfo.innerText = 'Clique em Abrir Criativos para autorizar';
        return;
    }

    if (state === 'connected') {
        const isCloud = mode === 'graph_cloud';
        badge.className = 'badge-status status-active';
        badge.innerText = hydrating
            ? `⏳ Sincronizando (${nichesCount} nichos)`
            : (isCloud ? '☁️ Conectado 24/7' : '🟢 Conectado');

        heading.innerText = isCloud
            ? 'Microsoft OneDrive (Nuvem 24/7)'
            : (folderName ? `Microsoft OneDrive (${folderName})` : 'Microsoft OneDrive (Local)');

        if (nichesCount > 0) {
            desc.innerText = hydrating
                ? `Graph API ativa • ${nichesCount} nichos (${audiosCount} áudios, ${videosCount} vídeos) indexando em segundo plano...`
                : `Conectado via ${isCloud ? 'Microsoft Graph API' : 'leitura local'} • ${nichesCount} nichos, ${audiosCount} áudios e ${videosCount} vídeos.`;
        } else {
            desc.innerText = isCloud
                ? 'Conectado à conta Microsoft. Carregando índice de pastas...'
                : 'Conectado à pasta local. Carregando arquivos...';
        }

        subinfo.innerText = isCloud
            ? `API Nuvem: ${apiHost}`
            : (oneDriveData.isApiMode ? `API Local: ${apiHost}` : 'Leitura direta via navegador');
        return;
    }

    badge.className = 'badge-status status-pending';
    badge.innerText = '🔴 Desconectado';
    heading.innerText = 'Microsoft OneDrive';
    desc.innerText = `Servidor (${apiHost}) indisponível no momento e nenhuma pasta local conectada.`;
    subinfo.innerText = 'Conecte pela nuvem ou pasta local em Criativos';
}

async function connectOneDriveCloudAPI() {
    try {
        const res = await apiFetch('/api/onedrive/auth?mode=json');
        const data = await res.json();
        if (data.success && data.auth_url) {
            window.location.href = data.auth_url;
        } else {
            alert('Erro ao iniciar autorização Microsoft: ' + (data.error || 'Verifique o backend/.env'));
        }
    } catch (e) {
        alert('O servidor backend precisa estar ativo em http://localhost:8000 (ou na nuvem) para iniciar o login Microsoft.');
    }
}

// 1. Conexão Automática via API Backend
async function checkBackendAPI() {
    updateOneDriveOverviewCard({ state: 'connecting' });
    try {
        const res = await apiFetch('/api/status');
        if (!res.ok) return false;
        const data = await res.json();

        const cloudBtn = document.getElementById('btn-auth-onedrive-cloud');
        if (cloudBtn) {
            if (data.graph_connected) {
                cloudBtn.className = 'btn btn-outline';
                cloudBtn.innerText = '✅ Nuvem OneDrive Autorizada';
            } else if (data.graph_configured) {
                cloudBtn.className = 'btn btn-primary';
                cloudBtn.innerText = '☁️ Autorizar OneDrive Nuvem';
            }
        }

        if (data.status === 'online' && data.onedrive_accessible) {
            console.log('✅ Backend API detectado:', data);
            updateOneDriveOverviewCard({
                state: 'connected',
                mode: data.mode,
                hydrating: Boolean(data.hydrating),
                nichesCount: data.graph_count || oneDriveData.niches.length
            });
            await loadNichesFromAPI(false, data);
            return true;
        }

        if (data.status === 'online' && data.graph_configured && !data.graph_connected) {
            updateOneDriveOverviewCard({ state: 'auth_pending', mode: data.mode });
            return false;
        }
    } catch (e) {
        console.log('Backend API não detectado no momento.');
    }
    if (!oneDriveHandle) {
        updateOneDriveOverviewCard({ state: 'disconnected' });
    }
    return false;
}

async function loadNichesFromAPI(forceReload = false, statusData = null) {
    const badge = document.getElementById('onedrive-connection-badge');
    const folderTitle = document.getElementById('onedrive-folder-title');
    const folderDesc = document.getElementById('onedrive-folder-desc');
    const rescanBtn = document.getElementById('btn-rescan-onedrive');

    const isGraph = statusData && statusData.mode === 'graph_cloud';

    if (badge) {
        badge.className = 'badge-tag';
        badge.style.color = '#10b981';
        badge.textContent = isGraph ? `☁️ OneDrive Graph API (24/7)` : `🟢 Backend API Conectado`;
    }
    if (folderTitle) folderTitle.textContent = isGraph ? `OneDrive Microsoft Graph API` : `OneDrive (via Backend API)`;
    if (folderDesc) folderDesc.textContent = `Carregando nichos via API...`;
    if (rescanBtn) {
        rescanBtn.style.display = 'inline-flex';
        rescanBtn.onclick = () => loadNichesFromAPI(true, statusData);
    }

    try {
        const params = new URLSearchParams();
        if (forceReload) params.set('reload', 'true');
        if (statusData?.graph_cloud) params.set('source', 'graph');
        const qStr = params.toString();
        const url = `/api/onedrive/niches${qStr ? `?${qStr}` : ''}`;
        const res = await apiFetch(url);
        const json = await res.json();
        if (json.success && json.niches) {
            oneDriveData.niches = json.niches;
            oneDriveData.isApiMode = true;
            oneDriveOverviewMeta.state = 'connected';
            oneDriveOverviewMeta.mode = json.source === 'graph' ? 'graph_cloud' : 'local_folder';
            oneDriveOverviewMeta.hydrating = Boolean(json.hydrating);
            renderOneDriveStatsAndTable();
            const readyVideosCount = json.niches.filter(n => (n.videos?.feed?.length || 0) + (n.videos?.reels?.length || 0) > 0).length;
            if (badge && json.source === 'graph') {
                badge.textContent = json.hydrating
                    ? `⏳ Sincronizando Nuvem (${readyVideosCount} c/ vídeo)...`
                    : `☁️ OneDrive Nuvem (${json.count} nichos • ${readyVideosCount} c/ vídeo)`;
            }
            if (folderDesc) {
                folderDesc.textContent = json.hydrating
                    ? `Sincronização em segundo plano na nuvem... ${json.count} pastas (${readyVideosCount} com vídeos carregados).`
                    : `Sincronizado via API (${json.source === 'graph' ? 'Microsoft OneDrive Nuvem' : 'Pasta Local'})! ${json.count} nichos (${readyVideosCount} com vídeos).`;
            }
            if (json.hydrating) {
                setTimeout(() => loadNichesFromAPI(false, statusData), 4000);
            }
        }
    } catch (e) {
        console.error('Erro ao carregar nichos da API:', e);
        if (folderDesc) folderDesc.textContent = `Erro ao carregar dados da API.`;
    }
}


// IndexedDB para persistir acesso à pasta
const DB_NAME = 'twod_hub_db';
const STORE_NAME = 'handles';

function getDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveHandleToDB(key, handle) {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, key);
        return new Promise(res => tx.oncomplete = res);
    } catch (e) {
        console.warn('Não foi possível salvar handle no IndexedDB:', e);
    }
}

async function getHandleFromDB(key) {
    try {
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        return new Promise(res => req.onsuccess = () => res(req.result));
    } catch (e) {
        return null;
    }
}

// Conectar via File System Access API (Chrome / Edge)
async function connectOneDriveFolder() {
    if (!window.showDirectoryPicker) {
        // Fallback para navegadores sem showDirectoryPicker
        document.getElementById('onedrive-fallback-input').click();
        return;
    }

    try {
        const handle = await window.showDirectoryPicker({
            mode: 'read',
            startIn: 'documents'
        });
        oneDriveHandle = handle;
        await saveHandleToDB('onedrive_folder', handle);
        await scanOneDriveFiles();
    } catch (err) {
        if (err.name !== 'AbortError') {
            console.error('Erro ao conectar pasta do OneDrive:', err);
            alert('Não foi possível abrir a pasta selecionada: ' + err.message);
        }
    }
}

// Fallback para navegadores sem showDirectoryPicker (Firefox / Safari)
function handleFallbackDirectoryUpload(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;

    processFilesList(files);
}

// Escanear arquivos a partir do handle
async function scanOneDriveFiles() {
    if (!oneDriveHandle) return;

    const badge = document.getElementById('onedrive-connection-badge');
    const folderTitle = document.getElementById('onedrive-folder-title');
    const folderDesc = document.getElementById('onedrive-folder-desc');
    const rescanBtn = document.getElementById('btn-rescan-onedrive');

    badge.className = 'badge-tag';
    badge.style.color = '#10b981';
    badge.textContent = `🟢 Conectado: ${oneDriveHandle.name}`;
    folderTitle.textContent = `OneDrive: ${oneDriveHandle.name}`;
    folderDesc.textContent = `Varredura em andamento em ${oneDriveHandle.name}...`;
    rescanBtn.style.display = 'inline-flex';

    oneDriveData = {
        niches: [],
        audioFilesMap: new Map(),
        videoFilesMap: new Map()
    };

    const nichesMap = new Map();

    function getOrCreateNiche(name) {
        if (!nichesMap.has(name)) {
            nichesMap.set(name, {
                name: name,
                audios: [],
                videos: { feed: [], reels: [] },
                status: 'pending'
            });
        }
        return nichesMap.get(name);
    }

    try {
        let audiosHandle = null;
        let videosHandle = null;

        // Verifica se a pasta selecionada já é 'Arquivos de Áudio' ou 'Vídeos' ou a raiz 'Trabalho'
        const lowerName = oneDriveHandle.name.toLowerCase();
        if (lowerName.includes('áudio') || lowerName.includes('audio')) {
            audiosHandle = oneDriveHandle;
        } else if (lowerName.includes('vídeo') || lowerName.includes('video')) {
            videosHandle = oneDriveHandle;
        } else {
            // Procura subpastas dentro da raiz
            for await (const [name, entry] of oneDriveHandle.entries()) {
                if (entry.kind === 'directory') {
                    const n = name.toLowerCase();
                    if (n.includes('áudio') || n.includes('audio')) audiosHandle = entry;
                    if (n.includes('vídeo') || n.includes('video')) videosHandle = entry;
                }
            }
        }

        // 1. Escaneia Áudios
        if (audiosHandle) {
            for await (const [nicheFolder, nicheEntry] of audiosHandle.entries()) {
                if (nicheEntry.kind === 'directory') {
                    const niche = getOrCreateNiche(nicheFolder);
                    for await (const [fileName, fileEntry] of nicheEntry.entries()) {
                        if (fileEntry.kind === 'file' && fileName.match(/\.(mp3|wav|m4a|aac)$/i)) {
                            // Extrai idioma do arquivo (ex: 5G_pt.mp3 -> PT)
                            let lang = 'PT';
                            const match = fileName.match(/_([a-zA-Z]{2})\./);
                            if (match) lang = match[1].toUpperCase();

                            niche.audios.push({
                                name: fileName,
                                lang: lang,
                                handle: fileEntry
                            });
                            oneDriveData.audioFilesMap.set(`${nicheFolder}_${lang}`, fileEntry);
                        }
                    }
                }
            }
        }

        // 2. Escaneia Vídeos
        if (videosHandle) {
            for await (const [nicheFolder, nicheEntry] of videosHandle.entries()) {
                if (nicheEntry.kind === 'directory') {
                    const niche = getOrCreateNiche(nicheFolder);

                    // Varre subpastas de idiomas (Português, Espanhol, Inglês, etc.)
                    for await (const [langFolder, langEntry] of nicheEntry.entries()) {
                        if (langEntry.kind === 'directory') {
                            for await (const [videoName, videoEntry] of langEntry.entries()) {
                                if (videoEntry.kind === 'file' && videoName.match(/\.mp4$/i)) {
                                    const numMatch = videoName.match(/^([1-6])\./);
                                    const num = numMatch ? parseInt(numMatch[1]) : 0;
                                    const isFeed = num >= 1 && num <= 3;
                                    const isReels = num >= 4 && num <= 6;

                                    const videoItem = {
                                        name: videoName,
                                        num: num,
                                        type: isFeed ? 'feed' : (isReels ? 'reels' : 'other'),
                                        lang: langFolder,
                                        handle: videoEntry
                                    };

                                    if (isFeed) niche.videos.feed.push(videoItem);
                                    else if (isReels) niche.videos.reels.push(videoItem);

                                    oneDriveData.videoFilesMap.set(`${nicheFolder}_${langFolder}_${videoName}`, videoEntry);
                                }
                            }
                        }
                    }
                }
            }
        }

        // Calcula status de cada nicho
        oneDriveData.niches = Array.from(nichesMap.values()).map(n => {
            const feedCount = n.videos.feed.length;
            const reelsCount = n.videos.reels.length;
            const totalVideos = feedCount + reelsCount;

            if (totalVideos >= 6) n.status = 'completed';
            else if (totalVideos > 0) n.status = 'partial';
            else n.status = 'pending';

            return n;
        });

        // Ordena por nome
        oneDriveData.niches.sort((a, b) => a.name.localeCompare(b.name));

        renderOneDriveStatsAndTable();
        folderDesc.textContent = `Sincronizado! ${oneDriveData.niches.length} nichos carregados com sucesso.`;

    } catch (err) {
        console.error('Erro na varredura de pastas:', err);
        alert('Erro ao escanear pastas: ' + err.message);
    }
}

// Processa lista de arquivos via Fallback File Input
function processFilesList(files) {
    const nichesMap = new Map();

    function getOrCreateNiche(name) {
        if (!nichesMap.has(name)) {
            nichesMap.set(name, {
                name: name,
                audios: [],
                videos: { feed: [], reels: [] },
                status: 'pending'
            });
        }
        return nichesMap.get(name);
    }

    files.forEach(file => {
        const pathParts = file.webkitRelativePath ? file.webkitRelativePath.split('/') : [file.name];
        // Exemplo: Trabalho/Arquivos de Áudio/5G 05.08.26/5G_pt.mp3
        // ou: Arquivos de Áudio/5G 05.08.26/5G_pt.mp3
        const isAudio = pathParts.some(p => p.toLowerCase().includes('áudio') || p.toLowerCase().includes('audio'));
        const isVideo = pathParts.some(p => p.toLowerCase().includes('vídeo') || p.toLowerCase().includes('video'));

        if (isAudio && file.name.match(/\.(mp3|wav|m4a|aac)$/i)) {
            const nicheIdx = pathParts.findIndex(p => p.toLowerCase().includes('áudio') || p.toLowerCase().includes('audio')) + 1;
            const nicheName = pathParts[nicheIdx] || 'Nicho Geral';
            const niche = getOrCreateNiche(nicheName);

            let lang = 'PT';
            const match = file.name.match(/_([a-zA-Z]{2})\./);
            if (match) lang = match[1].toUpperCase();

            niche.audios.push({ name: file.name, lang: lang, file: file });
            oneDriveData.audioFilesMap.set(`${nicheName}_${lang}`, file);
        } else if (isVideo && file.name.match(/\.mp4$/i)) {
            const videoIdx = pathParts.findIndex(p => p.toLowerCase().includes('vídeo') || p.toLowerCase().includes('video')) + 1;
            const nicheName = pathParts[videoIdx] || 'Nicho Geral';
            const niche = getOrCreateNiche(nicheName);

            const numMatch = file.name.match(/^([1-6])\./);
            const num = numMatch ? parseInt(numMatch[1]) : 0;
            const isFeed = num >= 1 && num <= 3;
            const isReels = num >= 4 && num <= 6;

            const videoItem = {
                name: file.name,
                num: num,
                type: isFeed ? 'feed' : 'reels',
                file: file
            };

            if (isFeed) niche.videos.feed.push(videoItem);
            else if (isReels) niche.videos.reels.push(videoItem);

            oneDriveData.videoFilesMap.set(`${nicheName}_${file.name}`, file);
        }
    });

    oneDriveData.niches = Array.from(nichesMap.values()).map(n => {
        const total = n.videos.feed.length + n.videos.reels.length;
        if (total >= 6) n.status = 'completed';
        else if (total > 0) n.status = 'partial';
        else n.status = 'pending';
        return n;
    });

    oneDriveData.niches.sort((a, b) => a.name.localeCompare(b.name));

    const badge = document.getElementById('onedrive-connection-badge');
    badge.className = 'badge-tag';
    badge.style.color = '#10b981';
    badge.textContent = `🟢 Conectado via Navegador`;

    renderOneDriveStatsAndTable();
}

// Renderiza Stats Cards e Tabela
function renderOneDriveStatsAndTable() {
    const statsContainer = document.getElementById('onedrive-stats');
    const filterBar = document.getElementById('onedrive-filter-bar');
    const tableContainer = document.getElementById('onedrive-table-container');
    const emptyState = document.getElementById('onedrive-empty-state');

    statsContainer.style.display = 'grid';
    filterBar.style.display = 'flex';
    tableContainer.style.display = 'block';
    emptyState.style.display = 'none';

    // Contadores
    const totalNiches = oneDriveData.niches.length;
    let totalAudios = 0;
    let totalVideos = 0;

    oneDriveData.niches.forEach(n => {
        totalAudios += n.audios.length;
        totalVideos += (n.videos.feed.length + n.videos.reels.length);
    });

    document.getElementById('stat-niches-count').textContent = totalNiches;
    document.getElementById('stat-audios-count').textContent = totalAudios;
    document.getElementById('stat-videos-count').textContent = totalVideos;

    updateOneDriveOverviewCard({
        state: 'connected',
        mode: oneDriveData.isApiMode ? oneDriveOverviewMeta.mode : 'browser_folder',
        folderName: oneDriveHandle ? oneDriveHandle.name : '',
        nichesCount: totalNiches,
        audiosCount: totalAudios,
        videosCount: totalVideos
    });

    filterNichesTable();
    if (typeof window.onCampaignBuilderNichesReady === 'function') {
        window.onCampaignBuilderNichesReady();
    }
}

// Filtro e Renderização da Tabela
function filterNichesTable() {
    const query = (document.getElementById('niche-search-input').value || '').toLowerCase().trim();
    const statusFilter = document.getElementById('filter-status-select').value;
    const tbody = document.getElementById('niches-table-body');

    const filtered = oneDriveData.niches.filter(n => {
        const matchesQuery = !query || n.name.toLowerCase().includes(query);
        const matchesStatus = statusFilter === 'all' || n.status === statusFilter;
        return matchesQuery && matchesStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted); padding: 30px;">Nenhum nicho encontrado com os filtros selecionados.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(n => {
        // Áudios com botões clicáveis de play
        const audiosHtml = n.audios.length > 0
            ? n.audios.map(a => `<button type="button" class="audio-chip-btn" onclick="playAudio('${encodeURIComponent(n.name)}', '${a.lang}')">▶️ ${a.lang}</button>`).join('')
            : `<span class="text-muted" style="font-size: 11px;">Sem áudios</span>`;

        // Vídeos Feed (1 a 3)
        const feedNums = [1, 2, 3];
        const feedHtml = `<div class="video-badge-group">` + feedNums.map(num => {
            const exists = n.videos.feed.some(v => v.num === num);
            return `<span class="video-chip ${exists ? 'ready' : 'missing'}">${num}.mp4 ${exists ? '✓' : '—'}</span>`;
        }).join('') + `</div>`;

        // Vídeos Reels (4 a 6)
        const reelsNums = [4, 5, 6];
        const reelsHtml = `<div class="video-badge-group">` + reelsNums.map(num => {
            const exists = n.videos.reels.some(v => v.num === num);
            return `<span class="video-chip ${exists ? 'ready' : 'missing'}">${num}.mp4 ${exists ? '✓' : '—'}</span>`;
        }).join('') + `</div>`;

        // Status badge
        let statusBadge = '';
        if (n.status === 'completed') {
            statusBadge = `<span class="badge-status-completed">6/6 Concluídos ✅</span>`;
        } else if (n.status === 'partial') {
            const total = n.videos.feed.length + n.videos.reels.length;
            statusBadge = `<span class="badge-status-partial">${total}/6 Renderizados ⚠️</span>`;
        } else {
            statusBadge = `<span class="badge-status-pending">Apenas Áudio ⏳</span>`;
        }

        return `
            <tr>
                <td><strong>📁 ${n.name}</strong></td>
                <td>${audiosHtml}</td>
                <td>${feedHtml}</td>
                <td>${reelsHtml}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join('');
}

// Reproduzir Áudio Selecionado
async function playAudio(nicheNameEncoded, lang) {
    const nicheName = decodeURIComponent(nicheNameEncoded);

    // Se estiver em modo API (Backend Server)
    if (oneDriveData.isApiMode) {
        const niche = oneDriveData.niches.find(n => n.name === nicheName);
        if (!niche) return;
        const audio = niche.audios.find(a => a.lang === lang);
        if (!audio || !audio.url) return;

        const playerBar = document.getElementById('inline-audio-player-bar');
        const audioElement = document.getElementById('global-audio-element');
        const titleEl = document.getElementById('now-playing-title');
        const metaEl = document.getElementById('now-playing-meta');

        titleEl.textContent = `Áudio ${lang} — ${nicheName}`;
        metaEl.textContent = `${audio.name} (${(audio.size / 1024).toFixed(1)} KB) — Via API`;
        audioElement.src = withMediaAuth(`${API_BASE_URL}${audio.url}`);
        playerBar.style.display = 'flex';
        audioElement.play();
        return;
    }

    // Modo nativo de arquivo local (Fallback)
    const key = `${nicheName}_${lang}`;
    const fileItem = oneDriveData.audioFilesMap.get(key);

    if (!fileItem) {
        alert(`Arquivo de áudio não encontrado para o nicho ${nicheName} (${lang})`);
        return;
    }

    try {
        let file = null;
        if (fileItem instanceof File) {
            file = fileItem;
        } else if (fileItem.getFile) {
            file = await fileItem.getFile();
        }

        if (!file) return;

        const audioUrl = URL.createObjectURL(file);
        const playerBar = document.getElementById('inline-audio-player-bar');
        const audioElement = document.getElementById('global-audio-element');
        const titleEl = document.getElementById('now-playing-title');
        const metaEl = document.getElementById('now-playing-meta');

        titleEl.textContent = `Áudio ${lang} — ${nicheName}`;
        metaEl.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        audioElement.src = audioUrl;
        playerBar.style.display = 'flex';
        audioElement.play();
    } catch (err) {
        console.error('Erro ao tocar áudio:', err);
        alert('Não foi possível reproduzir o áudio: ' + err.message);
    }
}

function closeAudioPlayer() {
    const playerBar = document.getElementById('inline-audio-player-bar');
    const audioElement = document.getElementById('global-audio-element');
    audioElement.pause();
    audioElement.src = '';
    playerBar.style.display = 'none';
}

// Tenta restaurar acesso salvo do OneDrive ao iniciar
async function checkSavedOneDriveHandle() {
    // 1. Tenta conectar via Backend API primeiro
    const apiSuccess = await checkBackendAPI();
    if (apiSuccess) return;

    // 2. Se a API não estiver rodando, tenta restaurar handle do IndexedDB
    try {
        const saved = await getHandleFromDB('onedrive_folder');
        if (saved && saved.queryPermission) {
            const perm = await saved.queryPermission({ mode: 'read' });
            if (perm === 'granted') {
                oneDriveHandle = saved;
                scanOneDriveFiles();
                return;
            }
        }
    } catch (e) {
        console.log('Nenhum handle pré-salvo do OneDrive.');
    }

    if (oneDriveOverviewMeta.state === 'connecting') {
        updateOneDriveOverviewCard({ state: 'disconnected' });
    }
}

async function changeMyPassword() {
    const curInput = document.getElementById('change-current-pwd-input');
    const newInput = document.getElementById('change-pwd-input');
    const atual = (curInput ? curInput.value : '').trim();
    const nova = (newInput ? newInput.value : '').trim();
    if (!atual) {
        alert('Por favor, digite sua senha atual.');
        return;
    }
    if (nova.length < 6) {
        alert('A nova senha deve ter pelo menos 6 caracteres.');
        return;
    }
    if (nova === '123456') {
        alert('Escolha uma senha pessoal diferente da senha padrão inicial.');
        return;
    }
    try {
        const resp = await apiFetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password: atual, new_password: nova })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            alert(data.error || 'Erro ao atualizar a senha.');
            return;
        }
        setAuthSession(data);
        if (curInput) curInput.value = '';
        if (newInput) newInput.value = '';
        alert('Sua senha foi alterada com sucesso e salva na nuvem!');
    } catch (e) {
        alert('Erro de conexão ao alterar senha: ' + e.message);
    }
}

// ========================================================
// META MARKETING API & DUPLICADOR POR BLOCOS DE PAÍSES
// ========================================================

const META_DEFAULT_TOKEN = '';
const META_DEFAULT_ACCOUNT_ID = 'act_522793227047438';
const META_GRAPH_VERSION = 'v21.0';

const META_COUNTRY_BLOCKS = {
    "BLOCO-01": {
        id: "BLOCO-01",
        title: "BLOCO 01 - Espanhol (es)",
        langCode: "es",
        langName: "ESPANHOL",
        countries: [
            { adSetName: "Espanha", code: "ES", searchEN: "Spain", langName: "ESPANHOL", langCode: "es", priority: true },
            { adSetName: "Chile", code: "CL", searchEN: "Chile", langName: "ESPANHOL", langCode: "es", priority: true },
            { adSetName: "Argentina", code: "AR", searchEN: "Argentina", langName: "ESPANHOL", langCode: "es", priority: true },
            { adSetName: "Colômbia", code: "CO", searchEN: "Colombia", langName: "ESPANHOL", langCode: "es", priority: true },
            { adSetName: "Venezuela", code: "VE", searchEN: "Venezuela", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "Peru", code: "PE", searchEN: "Peru", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "Porto Rico", code: "PR", searchEN: "Puerto Rico", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "Costa Rica", code: "CR", searchEN: "Costa Rica", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "Equador", code: "EC", searchEN: "Ecuador", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "Honduras", code: "HN", searchEN: "Honduras", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "Panamá", code: "PA", searchEN: "Panama", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "Nicarágua", code: "NI", searchEN: "Nicaragua", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "El Salvador", code: "SV", searchEN: "El Salvador", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "Guatemala", code: "GT", searchEN: "Guatemala", langName: "ESPANHOL", langCode: "es" },
            { adSetName: "República Dominicana", code: "DO", searchEN: "Dominican Republic", langName: "ESPANHOL", langCode: "es" }
        ]
    },
    "BLOCO-02": {
        id: "BLOCO-02",
        title: "BLOCO 02 - Multi-Idiomas (Europa / Ásia)",
        langCode: "multi",
        langName: "MULTI-IDIOMAS",
        countries: [
            { adSetName: "Sérvia", code: "RS", searchEN: "Serbia", langName: "SÉRVIO", langCode: "sr" },
            { adSetName: "Itália", code: "IT", searchEN: "Italy", langName: "ITALIANO", langCode: "it" },
            { adSetName: "Alemanha", code: "DE", searchEN: "Germany", langName: "ALEMÃO", langCode: "de", priority: true },
            { adSetName: "Suíça", code: "CH", searchEN: "Switzerland", langName: "ALEMÃO", langCode: "de", priority: true },
            { adSetName: "Luxemburgo", code: "LU", searchEN: "Luxembourg", langName: "ALEMÃO", langCode: "de", priority: true },
            { adSetName: "Holanda", code: "NL", searchEN: "Netherlands", langName: "HOLANDÊS", langCode: "nl", priority: true },
            { adSetName: "Bélgica", code: "BE", searchEN: "Belgium", langName: "HOLANDÊS", langCode: "nl", priority: true },
            { adSetName: "Romênia", code: "RO", searchEN: "Romania", langName: "ROMENO", langCode: "ro" },
            { adSetName: "Hungria", code: "HU", searchEN: "Hungary", langName: "HÚNGARO", langCode: "hu" },
            { adSetName: "República Tcheca", code: "CZ", searchEN: "Czech Republic", langName: "TCHECO", langCode: "cs" },
            { adSetName: "Eslováquia", code: "SK", searchEN: "Slovakia", langName: "ESLOVACO", langCode: "sk" },
            { adSetName: "Índia", code: "IN", searchEN: "India", langName: "HINDI", langCode: "hi" },
            { adSetName: "Indonésia", code: "ID", searchEN: "Indonesia", langName: "INDONÉSIO", langCode: "id" },
            { adSetName: "Paquistão", code: "PK", searchEN: "Pakistan", langName: "URDU", langCode: "ur" },
            { adSetName: "Polônia", code: "PL", searchEN: "Poland", langName: "POLONÊS", langCode: "pl" },
            { adSetName: "Ucrânia", code: "UA", searchEN: "Ukraine", langName: "UCRANIANO", langCode: "uk", priority: true },
            { adSetName: "Filipinas", code: "PH", searchEN: "Philippines", langName: "FILIPINO", langCode: "tl" }
        ]
    },
    "BLOCO-03": {
        id: "BLOCO-03",
        title: "BLOCO 03 - Francês (fr)",
        langCode: "fr",
        langName: "FRANCÊS",
        countries: [
            { adSetName: "França", code: "FR", searchEN: "France", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Benin", code: "BJ", searchEN: "Benin", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Burkina Faso", code: "BF", searchEN: "Burkina Faso", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "República do Congo", code: "CG", searchEN: "Republic of the Congo", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "República Democrática do Congo", code: "CD", searchEN: "Democratic Republic of the Congo", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Costa do Marfim", code: "CI", searchEN: "Ivory Coast", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Gabão", code: "GA", searchEN: "Gabon", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Guiné", code: "GN", searchEN: "Guinea", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Mali", code: "ML", searchEN: "Mali", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Senegal", code: "SN", searchEN: "Senegal", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Togo", code: "TG", searchEN: "Togo", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Burundi", code: "BI", searchEN: "Burundi", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Camarões", code: "CM", searchEN: "Cameroon", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Canadá", code: "CA", searchEN: "Canada", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Haiti", code: "HT", searchEN: "Haiti", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Madagascar", code: "MG", searchEN: "Madagascar", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Suíça", code: "CH", searchEN: "Switzerland", langName: "FRANCÊS", langCode: "fr", note: "⚠️ SUBIR SOMENTE APÓS DESATIVAR SUÍÇA ALEMÃO" },
            { adSetName: "Argélia", code: "DZ", searchEN: "Algeria", langName: "FRANCÊS", langCode: "fr" },
            { adSetName: "Mauritânia", code: "MR", searchEN: "Mauritania", langName: "FRANCÊS", langCode: "fr" }
        ]
    },
    "BLOCO-04": {
        id: "BLOCO-04",
        title: "BLOCO 04 - Russo (ru)",
        langCode: "ru",
        langName: "RUSSO",
        countries: [
            { adSetName: "Cazaquistão", code: "KZ", searchEN: "Kazakhstan", langName: "RUSSO", langCode: "ru" },
            { adSetName: "Uzbequistão", code: "UZ", searchEN: "Uzbekistan", langName: "RUSSO", langCode: "ru" },
            { adSetName: "Belarus", code: "BY", searchEN: "Belarus", langName: "RUSSO", langCode: "ru" },
            { adSetName: "Azerbaijão", code: "AZ", searchEN: "Azerbaijan", langName: "RUSSO", langCode: "ru" },
            { adSetName: "Tadjiquistão", code: "TJ", searchEN: "Tajikistan", langName: "RUSSO", langCode: "ru" },
            { adSetName: "Quirguistão", code: "KG", searchEN: "Kyrgyzstan", langName: "RUSSO", langCode: "ru" },
            { adSetName: "Armênia", code: "AM", searchEN: "Armenia", langName: "RUSSO", langCode: "ru" },
            { adSetName: "Geórgia", code: "GE", searchEN: "Georgia", langName: "RUSSO", langCode: "ru" },
            { adSetName: "Lituânia", code: "LT", searchEN: "Lithuania", langName: "RUSSO", langCode: "ru" }
        ]
    },
    "BLOCO-05": {
        id: "BLOCO-05",
        title: "BLOCO 05 - Árabe (ar)",
        langCode: "ar",
        langName: "ÁRABE",
        countries: [
            { adSetName: "Egito", code: "EG", searchEN: "Egypt", langName: "ÁRABE", langCode: "ar" },
            { adSetName: "Marrocos", code: "MA", searchEN: "Morocco", langName: "ÁRABE", langCode: "ar" },
            { adSetName: "Líbia", code: "LY", searchEN: "Libya", langName: "ÁRABE", langCode: "ar" },
            { adSetName: "Iraque", code: "IQ", searchEN: "Iraq", langName: "ÁRABE", langCode: "ar" },
            { adSetName: "Tunísia", code: "TN", searchEN: "Tunisia", langName: "ÁRABE", langCode: "ar" },
            { adSetName: "Palestina", code: "PS", searchEN: "Palestine", langName: "ÁRABE", langCode: "ar" },
            { adSetName: "Iêmen", code: "YE", searchEN: "Yemen", langName: "ÁRABE", langCode: "ar" },
            { adSetName: "Jordânia", code: "JO", searchEN: "Jordan", langName: "ÁRABE", langCode: "ar" }
        ]
    },
    "BLOCO-06": {
        id: "BLOCO-06",
        title: "BLOCO 06 - Inglês (en)",
        langCode: "en",
        langName: "INGLÊS",
        countries: [
            { adSetName: "Irlanda", code: "IE", searchEN: "Ireland", langName: "INGLÊS", langCode: "en" },
            { adSetName: "África do Sul", code: "ZA", searchEN: "South Africa", langName: "INGLÊS", langCode: "en" },
            { adSetName: "Reino Unido", code: "GB", searchEN: "United Kingdom", langName: "INGLÊS", langCode: "en" },
            { adSetName: "Emirados Árabes Unidos", code: "AE", searchEN: "United Arab Emirates", langName: "INGLÊS", langCode: "en" },
            { adSetName: "Nova Zelândia", code: "NZ", searchEN: "New Zealand", langName: "INGLÊS", langCode: "en" },
            { adSetName: "Austrália", code: "AU", searchEN: "Australia", langName: "INGLÊS", langCode: "en" },
            { adSetName: "Nigéria", code: "NG", searchEN: "Nigeria", langName: "INGLÊS", langCode: "en" },
            { adSetName: "Jamaica", code: "JM", searchEN: "Jamaica", langName: "INGLÊS", langCode: "en" },
            { adSetName: "Singapura", code: "SG", searchEN: "Singapore", langName: "INGLÊS", langCode: "en" }
        ]
    },
    "BLOCO-OBS": {
        id: "BLOCO-OBS",
        title: "OBSERVAÇÕES - Rotação",
        langCode: "multi",
        langName: "ROTAÇÃO",
        countries: [
            { adSetName: "Marrocos Francês", code: "MA", searchEN: "Morocco", langName: "FRANCÊS", langCode: "fr", note: "⚠️ SOMENTE SUBIR APÓS DESATIVAR MARROCOS ÁRABE" },
            { adSetName: "Tunísia Francês", code: "TN", searchEN: "Tunisia", langName: "FRANCÊS", langCode: "fr", note: "⚠️ SOMENTE SUBIR APÓS DESATIVAR TUNÍSIA ÁRABE" },
            { adSetName: "Bélgica Francês", code: "BE", searchEN: "Belgium", langName: "FRANCÊS", langCode: "fr", note: "⚠️ SOMENTE SUBIR APÓS DESATIVAR BÉLGICA HOLANDÊS" },
            { adSetName: "Argélia Árabe", code: "DZ", searchEN: "Algeria", langName: "ÁRABE", langCode: "ar", note: "⚠️ SOMENTE SUBIR APÓS DESATIVAR ARGÉLIA FRANCÊS" },
            { adSetName: "Suíça Francês", code: "CH", searchEN: "Switzerland", langName: "FRANCÊS", langCode: "fr", note: "⚠️ SUBIR SOMENTE APÓS DESATIVAR SUÍÇA ALEMÃO" }
        ]
    }
};

let metaState = {
    token: localStorage.getItem(STORAGE_KEYS.META_TOKEN) || META_DEFAULT_TOKEN,
    hasServerToken: false,
    isCloud: false,
    defaultAccountId: localStorage.getItem(STORAGE_KEYS.META_ACCOUNT) || META_DEFAULT_ACCOUNT_ID,
    user: null,
    accounts: [],
    selectedAccountId: '',
    selectedAccount: null,
    campaigns: [],
    selectedCampaignId: '',
    adsets: [],
    selectedAdSetId: '',
    selectedAdSet: null,
    promotePages: [],
    promotePagesAccountId: '',
    advertiserCtx: null,
    advertiserAccountId: '',
    activeBlockId: 'BLOCO-01',
    checkedCountries: {},
    isDuplicating: false,
    initialized: false
};

function getMetaToken() {
    return metaState.token || '';
}

function hasActiveMetaAuth() {
    return Boolean((metaState.token && metaState.token.trim()) || metaState.hasServerToken);
}

let _lastCircuitHealthSyncAt = 0;

async function metaGraphRequest(method, pathOrUrl, params = null, manualTokenOverride = null) {
    const manualToken = manualTokenOverride !== null ? manualTokenOverride : (metaState.token || '');
    const resp = await apiFetch('/api/meta/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            method: method || 'GET',
            path: pathOrUrl,
            params: params || undefined,
            manual_token: manualToken
        })
    });
    const json = await resp.json();
    if (json?.error?.is_circuit_breaker || resp.status === 429) {
        const now = Date.now();
        if (now - _lastCircuitHealthSyncAt > 10000) {
            _lastCircuitHealthSyncAt = now;
            setTimeout(() => {
                if (typeof refreshMetaAppHealth === 'function') refreshMetaAppHealth(false);
            }, 250);
        }
    }
    return json;
}

function metaGraphGet(pathOrUrl, manualTokenOverride = null) {
    return metaGraphRequest('GET', pathOrUrl, null, manualTokenOverride);
}

function metaGraphPost(pathOrUrl, paramsObj = {}, manualTokenOverride = null) {
    return metaGraphRequest('POST', pathOrUrl, paramsObj, manualTokenOverride);
}

window.hasActiveMetaAuth = hasActiveMetaAuth;
window.metaGraphRequest = metaGraphRequest;
window.metaGraphGet = metaGraphGet;
window.metaGraphPost = metaGraphPost;

function refreshServerTokenBanner() {
    const banner = document.getElementById('meta-server-token-banner');
    if (!banner) return;
    if (metaState.hasServerToken) {
        banner.classList.remove('twod-hidden');
        banner.innerHTML = metaState.token
            ? `⚠️ <strong>Usando Token Manual temporário apenas nesta sessão.</strong> O servidor já possui o token definitivo permanente ativo — limpe o campo e clique em Salvar para voltar ao padrão do servidor.`
            : `🔒 <strong>Token definitivo permanente ativo com segurança no Servidor (${metaState.isCloud ? 'Render' : '.env Local'}).</strong> Padrão automático para toda a equipe sem expor a chave no navegador ou no GitHub.`;
    } else {
        banner.classList.add('twod-hidden');
    }
}

function refreshGeminiServerBanner() {
    const banner = document.getElementById('gemini-server-key-banner');
    if (banner) {
        if (metaState.hasGeminiKey) {
            banner.classList.remove('twod-hidden');
            banner.innerHTML = `🟢 <strong>Gemini API Key ativa com segurança no Servidor (${metaState.isCloud ? 'Render' : '.env Local'}).</strong> Toda a equipe pode gerar áudios direto para o OneDrive sem precisar colar a chave novamente.`;
        } else {
            banner.classList.add('twod-hidden');
        }
    }
    if (typeof window.syncStudioGeminiBanner === 'function') {
        window.syncStudioGeminiBanner();
    }
}

function refreshCloudflareServerBanner() {
    const banner = document.getElementById('cloudflare-server-banner');
    if (banner) {
        if (metaState.hasCloudflare) {
            banner.classList.remove('twod-hidden');
            banner.innerHTML = `🟢 <strong>Cloudflare Workers AI ativa com segurança no Servidor (${metaState.isCloud ? 'Render' : '.env Local'}).</strong> Toda a equipe pode gerar criativos automáticos direto para o OneDrive.`;
        } else {
            banner.classList.add('twod-hidden');
        }
    }
    if (typeof window.syncStudioCloudflareBanner === 'function') {
        window.syncStudioCloudflareBanner();
    }
}

// Inicializa a API do Meta
async function initMetaApi() {
    try {
        let data = _prefetchedMetaConfig;
        _prefetchedMetaConfig = null;
        if (!data) {
            const resp = await apiFetch('/api/meta/config');
            if (resp.ok) {
                data = await resp.json();
            }
        }
        if (data) {
            metaState.hasServerToken = Boolean(data.has_server_token);
            metaState.hasGeminiKey = Boolean(data.has_gemini_key);
            metaState.hasCloudflare = Boolean(data.has_cloudflare);
            metaState.isCloud = Boolean(data.is_cloud);
            if (metaState.hasServerToken) {
                // Garante por padrão que todos usem o token permanente seguro do servidor (limpa tokens antigos do navegador)
                metaState.token = '';
                try { localStorage.removeItem(STORAGE_KEYS.META_TOKEN); } catch (e) {}
                ['meta-token-input', 'duplicador-token-input', 'cb-token-input'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
            }
            if (data.default_account_id) {
                metaState.defaultAccountId = data.default_account_id;
                localStorage.setItem(STORAGE_KEYS.META_ACCOUNT, data.default_account_id);
            }
        }
    } catch (e) {
        console.warn('Falha ao consultar /api/meta/config:', e);
    }

    refreshServerTokenBanner();
    refreshGeminiServerBanner();
    refreshCloudflareServerBanner();

    // Renderiza abas de blocos de países
    renderBlockNav();
    selectCountryBlock('BLOCO-01');
    loadCampaignCreativeLinks();

    // Valida conexão e carrega contas
    await testAndReloadMetaApi(false);
}

// Abre/fecha o painel rápido de conexão de Token dentro do Duplicador
function toggleDuplicatorTokenBox(forceState) {
    const box = document.getElementById('duplicador-token-box');
    const dupInput = document.getElementById('duplicador-token-input');
    if (!box) return;

    const shouldShow = (typeof forceState === 'boolean')
        ? forceState
        : box.classList.contains('twod-hidden');

    if (shouldShow) {
        box.classList.remove('twod-hidden');
        if (dupInput) dupInput.value = metaState.token || '';
    } else {
        box.classList.add('twod-hidden');
    }
}

// Quando a aba de duplicador for aberta
function onDuplicatorTabOpened() {
    if (!hasActiveMetaAuth()) {
        toggleDuplicatorTokenBox(true);
    }
    if (!metaState.initialized) {
        testAndReloadMetaApi(false);
    }
}

// Quando a aba de configurações for aberta
function onSettingsTabOpened() {
    const tokenInput = document.getElementById('meta-token-input');
    const accountInput = document.getElementById('meta-default-account-input');
    const backendInput = document.getElementById('backend-url-input');
    if (tokenInput) tokenInput.value = metaState.token || '';
    if (accountInput) accountInput.value = metaState.defaultAccountId || '';
    if (backendInput) backendInput.value = localStorage.getItem('twod_backend_url') || '';
    refreshServerTokenBanner();
}

// Testa e recarrega contas da Meta (via proxy seguro no servidor)
async function testAndReloadMetaApi(forceReload = false) {
    if (!hasActiveMetaAuth()) {
        updateMetaStatusUI(false, 'Nenhum token configurado.');
        const selectAcc = document.getElementById('select-meta-account');
        const countLabel = document.getElementById('label-account-count');
        if (selectAcc) selectAcc.innerHTML = '<option value="">Configure META_ACCESS_TOKEN no servidor ou cole um Token manual...</option>';
        if (countLabel) countLabel.innerText = '(Sem token)';
        return;
    }

    try {
        const data = await metaGraphGet(`/${META_GRAPH_VERSION}/me?fields=id,name,permissions`);

        if (data.error) {
            console.error('Erro na Meta API:', data.error);
            updateMetaStatusUI(false, data.error.message);
            const selectAcc = document.getElementById('select-meta-account');
            const countLabel = document.getElementById('label-account-count');
            if (selectAcc) selectAcc.innerHTML = '<option value="">Token inválido ou expirado</option>';
            if (countLabel) countLabel.innerText = '(Erro)';
            return;
        }

        metaState.user = data;
        metaState.initialized = true;
        updateMetaStatusUI(true, null, data);

        await loadMetaAccounts(forceReload);
        refreshMetaAppHealth(false);

    } catch (err) {
        console.error('Falha de rede ao conectar à Meta API:', err);
        updateMetaStatusUI(false, err.message);
        refreshMetaAppHealth(false);
    }
}

// Atualiza elementos de status na interface
function updateMetaStatusUI(isSuccess, errorMessage = null, userData = null) {
    const badgeOverview = document.getElementById('badge-meta-status');
    const userHeading = document.getElementById('meta-user-heading');
    const statusDesc = document.getElementById('meta-status-desc');
    const cardSubinfo = document.getElementById('meta-card-subinfo');

    const dupName = document.getElementById('duplicador-user-name');
    const dupBadge = document.getElementById('duplicador-api-badge');
    const dupSub = document.getElementById('duplicador-user-sub');

    const tokenSrcNote = metaState.hasServerToken && !metaState.token
        ? 'Token definitivo protegido no Servidor.'
        : 'Token manual ativo neste navegador.';

    if (isSuccess && userData) {
        if (badgeOverview) {
            badgeOverview.className = 'badge-status status-active';
            badgeOverview.innerText = '🟢 Conectado';
        }
        if (userHeading) userHeading.innerText = `Meta Marketing API (${userData.name})`;
        if (statusDesc) statusDesc.innerText = `Conexão ativa com Graph API ${META_GRAPH_VERSION}. ${tokenSrcNote}`;
        if (cardSubinfo) cardSubinfo.innerText = `${userData.name} (ID: ${userData.id})`;

        if (dupName) dupName.innerText = userData.name;
        if (dupBadge) {
            dupBadge.className = 'badge-status status-active';
            dupBadge.innerText = metaState.hasServerToken && !metaState.token
                ? `🔒 Meta API ${META_GRAPH_VERSION} (Servidor)`
                : `🟢 Meta API ${META_GRAPH_VERSION} Online`;
        }
        if (dupSub) dupSub.innerText = `ID: ${userData.id} • ${tokenSrcNote}`;
        toggleDuplicatorTokenBox(false);
    } else {
        if (badgeOverview) {
            badgeOverview.className = 'badge-status status-pending';
            badgeOverview.innerText = '🔴 Desconectado';
        }
        if (userHeading) userHeading.innerText = 'Meta Marketing API (Desconectado)';
        if (statusDesc) statusDesc.innerText = errorMessage ? `Status: ${errorMessage}` : 'Configure META_ACCESS_TOKEN no servidor ou informe um token em Configurações.';
        if (cardSubinfo) cardSubinfo.innerText = 'Nenhum token ativo configurado';

        if (dupName) dupName.innerText = 'Duplicador Meta Ads';
        if (dupBadge) {
            dupBadge.className = 'badge-status status-pending';
            dupBadge.innerText = '🔴 Sem Token Ativo';
        }
        if (dupSub) {
            dupSub.innerHTML = `⚠️ ${escHtml(errorMessage || 'Nenhum token configurado.')} <a href="javascript:void(0)" onclick="toggleDuplicatorTokenBox(true)" style="color: var(--accent-primary); text-decoration: underline; font-weight: 600; margin-left: 6px;">Conectar Token temporário →</a>`;
        }
    }
    if (typeof window.onCampaignBuilderMetaStatus === 'function') {
        window.onCampaignBuilderMetaStatus(isSuccess, errorMessage, userData);
    }
}

let _lastMetaHealthReport = null;

function openMetaAppHealthPanel() {
    switchTab('visao-geral');
    const panel = document.getElementById('meta-app-health-panel');
    if (panel) {
        setTimeout(() => {
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 60);
    }
    refreshMetaAppHealth(true);
}

async function refreshMetaAppHealth(manual = false) {
    const btn = document.getElementById('btn-meta-health-refresh');
    if (manual && btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Verificando...';
    }
    try {
        const accId = metaState.selectedAccountId || metaState.defaultAccountId || '';
        const q = accId ? `?account_id=${encodeURIComponent(accId)}` : '';
        const hdrs = {};
        if (metaState.token) hdrs['X-Meta-Token'] = metaState.token;
        const resp = await apiFetch(`/api/meta/app-health${q}`, { headers: hdrs });
        const data = await resp.json();
        if (data && data.success) {
            _lastMetaHealthReport = data;
            renderMetaAppHealthUI(data);
        }
    } catch (e) {
        console.warn('Falha ao consultar /api/meta/app-health:', e);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '🔄 Verificar Agora';
        }
    }
}

async function ackMetaAppHealth(action) {
    try {
        const payload = {
            action,
            account_id: metaState.selectedAccountId || metaState.defaultAccountId || ''
        };
        if (action === 'toggle_backup') {
            payload.ready = !Boolean(_lastMetaHealthReport?.audit?.backup_app_ready);
        }
        const hdrs = { 'Content-Type': 'application/json' };
        if (metaState.token) hdrs['X-Meta-Token'] = metaState.token;
        const resp = await apiFetch('/api/meta/app-health/ack', {
            method: 'POST',
            headers: hdrs,
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (data && data.success) {
            _lastMetaHealthReport = data;
            renderMetaAppHealthUI(data);
        }
    } catch (e) {
        console.warn('Erro ao atualizar check DUC/Backup:', e);
    }
}

function renderMetaAppHealthUI(report) {
    if (!report) return;
    const overall = report.overall || 'yellow';
    const overallMeta = {
        green: { cls: 'health-green', pill: 'App Meta: Saudável', badge: '🟢 Verde — Operacional' },
        yellow: { cls: 'health-yellow', pill: 'App Meta: Atenção', badge: '🟡 Amarelo — Requer Atenção' },
        red: { cls: 'health-red', pill: 'App Meta: Crítico', badge: '🔴 Vermelho — Ação Urgente' }
    }[overall] || { cls: 'health-pending', pill: 'App Meta: Verificando', badge: '⏳ Verificando' };

    const pillEl = document.getElementById('header-meta-app-pill');
    const pillTxt = document.getElementById('header-meta-app-pill-text');
    if (pillEl) pillEl.className = `app-health-pill ${overallMeta.cls}`;
    if (pillTxt) pillTxt.innerText = overallMeta.pill;

    const badgeEl = document.getElementById('meta-app-health-badge');
    if (badgeEl) {
        badgeEl.className = `app-health-badge ${overallMeta.cls}`;
        badgeEl.innerText = overallMeta.badge;
    }

    const updatedEl = document.getElementById('meta-app-health-updated');
    if (updatedEl) updatedEl.innerText = `Última verificação: ${report.checked_at || 'agora'}`;

    const gridEl = document.getElementById('meta-app-health-grid');
    if (gridEl) {
        const appObj = report.app || {};
        const tokObj = report.token || {};
        const usageObj = report.usage || {};
        const guardObj = report.guard || {};
        const accObj = report.account || null;
        const auditObj = report.audit || {};

        const appLabel = appObj.name || (appObj.id ? `App ID ${appObj.id}` : 'App não identificado');
        const tokTypeLabel = tokObj.source === 'server' ? 'Servidor (Permanente)' : (tokObj.source === 'manual' ? 'Manual (Navegador)' : 'Não configurado');
        const expLabel = tokObj.expires_at === 0 ? 'Sem expiração' : (tokObj.days_until_expiry != null ? `Expira em ${tokObj.days_until_expiry} dia(s)` : tokTypeLabel);

        const maxPct = Number(usageObj.max_pct || 0);
        const circuitText = guardObj.circuit_open
            ? `Pausado (${guardObj.circuit_seconds_left}s)`
            : (guardObj.throttle_delay_ms > 0 ? `Espaçamento (${guardObj.throttle_delay_ms}ms)` : 'Fechado / Normal');

        const accStatusLabel = accObj
            ? (accObj.account_status === 1 ? 'Ativa (OK)' : (accObj.account_status === 3 ? 'Pagto Pendente' : `Restrita (${accObj.account_status})`))
            : 'Nenhuma conta selecionada';
        const bmLabel = accObj && accObj.business_verification_status
            ? `BM: ${accObj.business_verification_status === 'verified' ? 'Verificada ✅' : accObj.business_verification_status}`
            : `Permissões: ${(tokObj.granted_scopes || []).length}/5`;

        const ducText = auditObj.last_duc_check_at
            ? `Conferido (${auditObj.duc_age_days}d)`
            : 'Nunca confirmado';
        const backupText = auditObj.backup_app_ready ? 'App Reserva: Pronto ✅' : 'App Reserva: Pendente ⚠️';

        gridEl.innerHTML = `
            <div class="meta-health-metric">
                <div class="meta-health-metric-label">App & Token</div>
                <div class="meta-health-metric-value">${escHtml(appLabel)}</div>
                <div class="meta-health-metric-sub">${escHtml(tokTypeLabel)} • ${escHtml(expLabel)}</div>
            </div>
            <div class="meta-health-metric">
                <div class="meta-health-metric-label">Cota Meta & Anti-Rajada</div>
                <div class="meta-health-metric-value">${maxPct}% de uso • ${escHtml(circuitText)}</div>
                <div class="meta-health-metric-sub">Call ${Number(usageObj.call_count || 0)}% • CPU ${Number(usageObj.total_cputime || 0)}% • Conta ${Number(usageObj.acc_util_pct || 0)}%</div>
            </div>
            <div class="meta-health-metric">
                <div class="meta-health-metric-label">Conta de Anúncios & BM</div>
                <div class="meta-health-metric-value">${escHtml(accStatusLabel)}</div>
                <div class="meta-health-metric-sub">${escHtml(bmLabel)}</div>
            </div>
            <div class="meta-health-metric">
                <div class="meta-health-metric-label">DUC, Alertas & Contingência</div>
                <div class="meta-health-metric-value">${escHtml(ducText)}</div>
                <div class="meta-health-metric-sub">${escHtml(backupText)}</div>
            </div>
        `;
    }

    const checksEl = document.getElementById('meta-app-health-checks');
    if (checksEl) {
        const checks = Array.isArray(report.checks) ? report.checks : [];
        const icons = { green: '🟢', yellow: '🟡', red: '🔴' };
        checksEl.innerHTML = checks.map(chk => `
            <div class="meta-health-check-item lvl-${escHtml(chk.level || 'yellow')}">
                <span style="font-size:14px; line-height:1.2;">${icons[chk.level] || 'ℹ️'}</span>
                <div>
                    <div class="meta-health-check-title">${escHtml(chk.title || '')}</div>
                    <div class="meta-health-check-detail">${escHtml(chk.detail || '')}</div>
                </div>
            </div>
        `).join('');
    }

    const backupBtn = document.getElementById('btn-toggle-backup-app');
    if (backupBtn) {
        const ready = Boolean(report.audit?.backup_app_ready);
        backupBtn.innerText = ready ? '🛟 App Reserva: Pronto ✅' : '🛟 Marcar App Reserva Pronto';
    }

    const resetBtn = document.getElementById('btn-reset-circuit-breaker');
    if (resetBtn) {
        if (report.guard?.circuit_open) resetBtn.classList.remove('twod-hidden');
        else resetBtn.classList.add('twod-hidden');
    }

    const linksEl = document.getElementById('meta-app-health-links');
    if (linksEl && report.links) {
        linksEl.innerHTML = `
            <a class="btn btn-outline btn-sm" href="${escHtml(report.links.alerts_inbox)}" target="_blank" rel="noopener">📬 Alerts Inbox & DUC</a>
            <a class="btn btn-outline btn-sm" href="${escHtml(report.links.app_settings)}" target="_blank" rel="noopener">⚙️ Config. App Meta</a>
            <a class="btn btn-outline btn-sm" href="${escHtml(report.links.account_quality)}" target="_blank" rel="noopener">🛡️ Qualidade da Conta</a>
            <a class="btn btn-outline btn-sm" href="${escHtml(report.links.bm_security)}" target="_blank" rel="noopener">🏢 Segurança da BM</a>
        `;
    }
}

window.openMetaAppHealthPanel = openMetaAppHealthPanel;
window.refreshMetaAppHealth = refreshMetaAppHealth;
window.ackMetaAppHealth = ackMetaAppHealth;

// Busca a lista de contas de anúncio do usuário
async function loadMetaAccounts(forceReload = false) {
    const select = document.getElementById('select-meta-account');
    const countLabel = document.getElementById('label-account-count');

    if (!select) return;

    if (metaState.accounts.length > 0 && !forceReload) {
        populateAccountsSelect(metaState.accounts);
        return;
    }

    if (countLabel) countLabel.innerText = '(Buscando contas...)';

    try {
        const data = await metaGraphGet(`/${META_GRAPH_VERSION}/me/adaccounts?fields=id,name,account_id,account_status,currency,amount_spent,business{id,name}&limit=150`);

        if (data.data && Array.isArray(data.data)) {
            // Ordena ativas primeiro
            const sorted = data.data.sort((a, b) => {
                if (a.account_status === 1 && b.account_status !== 1) return -1;
                if (a.account_status !== 1 && b.account_status === 1) return 1;
                return (a.name || '').localeCompare(b.name || '');
            });

            metaState.accounts = sorted;
            populateAccountsSelect(sorted);
            if (typeof window.onCampaignBuilderAccountsReady === 'function') {
                window.onCampaignBuilderAccountsReady();
            }

            if (countLabel) countLabel.innerText = `(${sorted.length} contas encontradas)`;
            const metaDescEl = document.getElementById('meta-status-desc');
            if (metaDescEl) {
                metaDescEl.innerText = `Conexão ativa com Graph API ${META_GRAPH_VERSION}. ${sorted.length} contas de anúncio carregadas.`;
            }
        } else {
            select.innerHTML = '<option value="">Nenhuma conta encontrada</option>';
            if (countLabel) countLabel.innerText = '(0 contas)';
        }
    } catch (e) {
        console.error('Erro ao buscar contas:', e);
        select.innerHTML = '<option value="">Erro ao carregar contas</option>';
        if (countLabel) countLabel.innerText = '(Erro)';
    }
}

function populateAccountsSelect(accounts) {
    const select = document.getElementById('select-meta-account');
    if (!select) return;

    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.innerText = 'Selecione uma conta de anúncios...';
    select.appendChild(placeholder);

    let exactDefault = '';
    let fallbackActive = '';

    accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id; // Ex: act_522793227047438
        const statusLabel = acc.account_status === 1 ? '🟢' : '⏸️';
        opt.innerText = `${statusLabel} ${acc.name || 'Sem nome'} (${acc.id}) [${acc.currency || 'USD'}]`;
        select.appendChild(opt);

        if (!exactDefault && acc.id === metaState.defaultAccountId) {
            exactDefault = acc.id;
        } else if (!fallbackActive && acc.account_status === 1) {
            fallbackActive = acc.id;
        }
    });

    const defaultToSelect = exactDefault || fallbackActive;
    if (defaultToSelect) {
        select.value = defaultToSelect;
        onMetaAccountSelected();
    }
}

function renderDupPromotePagesSelect(pages = []) {
    const sel = document.getElementById('select-dup-page-override');
    const helpEl = document.getElementById('dup-pages-help-text');
    if (!sel) return;

    const prevVal = sel.value || 'auto';
    sel.innerHTML = '<option value="auto">🔁 Página Original (Trocar automático se bloquear)</option>';

    const list = Array.isArray(pages) ? pages : [];
    list.forEach(p => {
        if (!p || !p.id) return;
        const opt = document.createElement('option');
        opt.value = String(p.id);
        const tag = (p.fromMeAccounts || p.canAdvertise) ? ' ✓' : '';
        opt.textContent = `📄 ${p.name || 'Página ' + p.id} (ID: ${p.id})${tag}`;
        sel.appendChild(opt);
    });

    if (prevVal && prevVal !== 'auto' && list.some(p => String(p.id) === String(prevVal))) {
        sel.value = prevVal;
    } else {
        sel.value = 'auto';
    }

    if (helpEl) {
        helpEl.textContent = list.length > 0
            ? `✓ ${list.length} página(s) disponível(is) na conta — troca automática ativa em caso de bloqueio 1885499`
            : 'Se a Página original bloquear (1885499), troca para outra autorizada';
    }
}

async function fetchMetaGraphWithFieldFallback(pathCandidates = []) {
    for (let i = 0; i < pathCandidates.length; i++) {
        try {
            const res = await metaGraphGet(pathCandidates[i]);
            if (res && !res.error) return res;
            const errMsg = res?.error?.message || '';
            const isFieldErr = /nonexisting field|\(#100\)|tasks|business/i.test(errMsg) || res?.error?.code === 100;
            if (!isFieldErr) return res;
        } catch (e) {
            if (i === pathCandidates.length - 1) throw e;
        }
    }
    return null;
}

async function loadDupPromotePages(accountIdOverride = null, forceRefresh = false) {
    const accountId = accountIdOverride !== null
        ? String(accountIdOverride || '')
        : String(document.getElementById('select-meta-account')?.value || metaState.selectedAccountId || '');

    if (!accountId || !hasActiveMetaAuth()) {
        metaState.promotePages = [];
        metaState.promotePagesAccountId = '';
        renderDupPromotePagesSelect([]);
        return [];
    }

    if (!forceRefresh && metaState.promotePagesAccountId === accountId && Array.isArray(metaState.promotePages) && metaState.promotePages.length > 0) {
        renderDupPromotePagesSelect(metaState.promotePages);
        return metaState.promotePages;
    }

    const helpEl = document.getElementById('dup-pages-help-text');
    if (helpEl) helpEl.textContent = '⏳ Buscando páginas autorizadas da conta...';

    const [promoteRes, meAccRes] = await Promise.allSettled([
        fetchMetaGraphWithFieldFallback([
            `/${META_GRAPH_VERSION}/${accountId}/promote_pages?fields=id,name,tasks,business{id,name}&limit=100`,
            `/${META_GRAPH_VERSION}/${accountId}/promote_pages?fields=id,name&limit=100`
        ]),
        fetchMetaGraphWithFieldFallback([
            `/${META_GRAPH_VERSION}/me/accounts?fields=id,name,tasks&limit=100`,
            `/${META_GRAPH_VERSION}/me/accounts?fields=id,name&limit=100`
        ])
    ]);

    const byId = new Map();
    const upsertPage = (raw, fromMeAccounts = false) => {
        if (!raw || !raw.id) return;
        const id = String(raw.id);
        const existing = byId.get(id) || {
            id,
            name: '',
            tasks: [],
            fromMeAccounts: false,
            canAdvertise: false,
            businessName: ''
        };
        if (raw.name && !existing.name) existing.name = String(raw.name);
        if (raw.business?.name && !existing.businessName) existing.businessName = String(raw.business.name);
        if (Array.isArray(raw.tasks)) {
            const merged = new Set([...existing.tasks, ...raw.tasks.map(t => String(t).toUpperCase())]);
            existing.tasks = Array.from(merged);
        }
        if (fromMeAccounts) existing.fromMeAccounts = true;
        const hasAdvTask = existing.tasks.includes('ADVERTISE') || existing.tasks.includes('MANAGE') || existing.tasks.includes('CREATE_CONTENT');
        existing.canAdvertise = Boolean(hasAdvTask || (existing.fromMeAccounts && existing.tasks.length === 0));
        byId.set(id, existing);
    };

    if (promoteRes.status === 'fulfilled' && Array.isArray(promoteRes.value?.data)) {
        promoteRes.value.data.forEach(p => upsertPage(p, false));
    }
    if (meAccRes.status === 'fulfilled' && Array.isArray(meAccRes.value?.data)) {
        meAccRes.value.data.forEach(p => upsertPage(p, true));
    }
    if (Array.isArray(metaState.pages)) {
        metaState.pages.forEach(p => upsertPage(p, false));
    }

    const pages = Array.from(byId.values()).sort((a, b) => {
        const score = (p) => (p.canAdvertise ? 4 : 0) + (p.fromMeAccounts ? 2 : 0);
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        return (a.name || a.id).localeCompare(b.name || b.id);
    });

    metaState.promotePages = pages;
    metaState.promotePagesAccountId = accountId;
    renderDupPromotePagesSelect(pages);
    return pages;
}

function getAuthorizedCandidatePageIds(accountId, blockedSet = new Set(), preferPageId = '') {
    const pages = (metaState.promotePagesAccountId === String(accountId) && Array.isArray(metaState.promotePages))
        ? metaState.promotePages
        : [];
    const seen = new Set();
    const out = [];
    const addCandidate = (id, name = '') => {
        const sId = String(id || '').trim();
        if (!sId || seen.has(sId) || blockedSet.has(sId)) return;
        seen.add(sId);
        out.push({ id: sId, name: name || pages.find(p => String(p.id) === sId)?.name || sId });
    };
    if (preferPageId && preferPageId !== 'auto') {
        addCandidate(preferPageId);
    }
    pages.forEach(p => addCandidate(p.id, p.name));
    return out;
}

const EU_DSA_COUNTRY_CODES = new Set([
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
    'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
    'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
]);

const REGIONAL_COUNTRY_CATEGORIES = {
    AU: [['AUSTRALIA_UNIVERSAL'], ['VOLUNTARY_VERIFICATION'], ['AUSTRALIA_UNIVERSAL', 'VOLUNTARY_VERIFICATION'], ['AUSTRALIA_FINSERV']],
    BR: [['BRAZIL_REGULATION', 'VOLUNTARY_VERIFICATION'], ['BRAZIL_REGULATION'], ['VOLUNTARY_VERIFICATION']],
    ES: [['SPAIN_FINSERV', 'VOLUNTARY_VERIFICATION'], ['VOLUNTARY_VERIFICATION']],
    SG: [['SINGAPORE_UNIVERSAL', 'VOLUNTARY_VERIFICATION'], ['SINGAPORE_UNIVERSAL'], ['VOLUNTARY_VERIFICATION']],
    TW: [['TAIWAN_UNIVERSAL', 'VOLUNTARY_VERIFICATION'], ['TAIWAN_UNIVERSAL'], ['VOLUNTARY_VERIFICATION']],
    TH: [['THAILAND_UNIVERSAL', 'VOLUNTARY_VERIFICATION'], ['THAILAND_UNIVERSAL'], ['VOLUNTARY_VERIFICATION']],
    MY: [['MALAYSIA_UNIVERSAL', 'VOLUNTARY_VERIFICATION'], ['MALAYSIA_UNIVERSAL'], ['VOLUNTARY_VERIFICATION']]
};

function isMetaMissingAdvertiserError(err) {
    const raw = err?.rawMetaError || err || {};
    const sub = Number(raw?.error_subcode || err?.error_subcode || 0);
    const code = Number(raw?.code || err?.code || 0);
    const msg = (typeof err === 'string' ? err : (raw?.message || err?.message || '')).toLowerCase();
    return sub === 3858634 || code === 3858634
        || sub === 3858548 || sub === 3858495 || sub === 3858152
        || /advertiser is missing|provide a verified advertiser|compliance_section|universal_beneficiary|universal_payer|australia_finserv|regional_regulated_categories|regional_regulation_identities/i.test(msg);
}

function getStoredRegionalComplianceConfig(accountId, countryCode) {
    if (!accountId || !countryCode) return null;
    try {
        const raw = localStorage.getItem(`twod_reg_cfg_${accountId}_${countryCode}`);
        return raw ? JSON.parse(raw) : null;
    } catch (_) {
        return null;
    }
}

function saveStoredRegionalComplianceConfig(accountId, countryCode, cfg) {
    if (!accountId || !countryCode || !cfg) return;
    try {
        localStorage.setItem(`twod_reg_cfg_${accountId}_${countryCode}`, JSON.stringify(cfg));
    } catch (_) { /* ignore storage quota */ }
}

function getStoredManualEntityId(accountId) {
    if (!accountId) return '';
    try {
        return String(localStorage.getItem(`twod_reg_entity_${accountId}`) || '').trim();
    } catch (_) {
        return '';
    }
}

function setStoredManualEntityId(accountId, entityId) {
    if (!accountId) return;
    try {
        if (entityId) localStorage.setItem(`twod_reg_entity_${accountId}`, String(entityId).trim());
        else localStorage.removeItem(`twod_reg_entity_${accountId}`);
    } catch (_) { /* ignore */ }
}

function extractEntityIdFromRegObj(regObj) {
    if (!regObj || typeof regObj !== 'object') return '';
    return String(
        regObj.universal_beneficiary
        || regObj.australia_finserv_beneficiary
        || regObj.universal_payer
        || regObj.australia_finserv_payer
        || Object.values(regObj).find(v => v && typeof v === 'string')
        || ''
    ).trim();
}

function onDupAdvertiserEntityChanged() {
    const sel = document.getElementById('select-dup-advertiser-entity');
    const idInput = document.getElementById('input-dup-reg-entity-id');
    const accountId = document.getElementById('select-meta-account')?.value || metaState.selectedAccountId || '';
    if (!sel || !idInput) return;

    if (sel.value === 'auto') {
        const ctx = metaState.advertiserCtx;
        idInput.value = ctx?.candidates?.[0]?.id || '';
        setStoredManualEntityId(accountId, '');
    } else {
        idInput.value = sel.value;
        setStoredManualEntityId(accountId, sel.value);
    }
}

function renderDupAdvertiserSelect(ctx = null) {
    const sel = document.getElementById('select-dup-advertiser-entity');
    const dsaInput = document.getElementById('input-dup-dsa-name');
    const idInput = document.getElementById('input-dup-reg-entity-id');
    const helpEl = document.getElementById('dup-advertiser-help-text');
    if (!sel) return;

    const accountId = document.getElementById('select-meta-account')?.value || metaState.selectedAccountId || '';
    const storedManualId = getStoredManualEntityId(accountId);
    const prevSel = sel.value || 'auto';

    sel.innerHTML = '<option value="auto">🤖 Auto-detectar Futuretech / Conta</option>';

    const cands = Array.isArray(ctx?.candidates) ? ctx.candidates : [];
    cands.forEach(c => {
        if (!c || !c.id) return;
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = c.label || `${c.name || 'Entidade'} (${c.id})`;
        sel.appendChild(opt);
    });

    if (storedManualId && cands.some(c => String(c.id) === storedManualId)) {
        sel.value = storedManualId;
    } else if (prevSel && prevSel !== 'auto' && cands.some(c => String(c.id) === String(prevSel))) {
        sel.value = prevSel;
    } else {
        sel.value = 'auto';
    }

    if (idInput) {
        if (storedManualId) {
            idInput.value = storedManualId;
        } else if (sel.value !== 'auto') {
            idInput.value = sel.value;
        } else {
            idInput.value = cands[0]?.id || '';
        }
    }

    if (dsaInput && (!dsaInput.value.trim() || dsaInput.dataset.autoPopulated === 'true') && ctx?.dsaNames?.[0]) {
        dsaInput.value = ctx.dsaNames[0];
        dsaInput.dataset.autoPopulated = 'true';
    }

    if (helpEl) {
        if (cands.length > 0) {
            helpEl.textContent = `✓ ${cands.length} entidade(s) encontrada(s) — principal: ${cands[0].label}`;
        } else {
            helpEl.textContent = 'Se Austrália pedir Advertiser (3858634), clique 🔄 ou cole o ID verificado ao lado';
        }
    }
}

async function loadDupAdvertiserEntities(accountIdOverride = null, forceRefresh = false) {
    const accountId = accountIdOverride !== null
        ? String(accountIdOverride || '')
        : String(document.getElementById('select-meta-account')?.value || metaState.selectedAccountId || '');

    if (!accountId || !hasActiveMetaAuth()) {
        metaState.advertiserCtx = null;
        metaState.advertiserAccountId = '';
        renderDupAdvertiserSelect(null);
        return null;
    }

    if (!forceRefresh && metaState.advertiserAccountId === accountId && metaState.advertiserCtx) {
        renderDupAdvertiserSelect(metaState.advertiserCtx);
        return metaState.advertiserCtx;
    }

    const helpEl = document.getElementById('dup-advertiser-help-text');
    if (helpEl) helpEl.textContent = '⏳ Buscando Futuretech Dynamics / entidades verificadas na conta...';

    const [accRes, bizRes, dsaRecRes, accAdsetsRes] = await Promise.allSettled([
        fetchMetaGraphWithFieldFallback([
            `/${META_GRAPH_VERSION}/${accountId}?fields=business{id,name},default_dsa_beneficiary,default_dsa_payor`,
            `/${META_GRAPH_VERSION}/${accountId}?fields=business{id,name}`
        ]),
        fetchMetaGraphWithFieldFallback([
            `/${META_GRAPH_VERSION}/me/businesses?fields=id,name,verification_status&limit=50`,
            `/${META_GRAPH_VERSION}/me/businesses?fields=id,name&limit=50`
        ]),
        metaGraphGet(`/${META_GRAPH_VERSION}/${accountId}/dsa_recommendations`).catch(() => null),
        fetchMetaGraphWithFieldFallback([
            `/${META_GRAPH_VERSION}/${accountId}/adsets?fields=id,name,targeting,dsa_beneficiary,dsa_payor,regional_regulated_categories,regional_regulation_identities&limit=100`,
            `/${META_GRAPH_VERSION}/${accountId}/adsets?fields=id,name,targeting,dsa_beneficiary,dsa_payor&limit=100`
        ])
    ]);

    const candidateMap = new Map();
    const upsertCandidate = ({ id, name = '', label = '', source = '', priority = 10, categoriesHint = null, identitiesHint = null }) => {
        const sId = String(id || '').trim();
        if (!sId) return;
        const existing = candidateMap.get(sId);
        if (!existing || priority > existing.priority) {
            candidateMap.set(sId, {
                id: sId,
                name: name || existing?.name || sId,
                label: label || existing?.label || `${name || 'Entidade'} (${sId})`,
                source: source || existing?.source || '',
                priority,
                categoriesHint: categoriesHint || existing?.categoriesHint || null,
                identitiesHint: identitiesHint || existing?.identitiesHint || null
            });
        }
    };

    const dsaNameSet = new Set();
    const addDsaName = (val) => {
        const s = String(val || '').trim();
        if (s) dsaNameSet.add(s);
    };

    const accObj = accRes.status === 'fulfilled' && accRes.value && !accRes.value.error ? accRes.value : null;
    if (accObj?.default_dsa_beneficiary) addDsaName(accObj.default_dsa_beneficiary);
    if (accObj?.default_dsa_payor) addDsaName(accObj.default_dsa_payor);

    let auSample = null;
    const allAdSets = [
        ...(Array.isArray(metaState.adsets) ? metaState.adsets : []),
        ...(accAdsetsRes.status === 'fulfilled' && Array.isArray(accAdsetsRes.value?.data) ? accAdsetsRes.value.data : [])
    ];

    allAdSets.forEach(as => {
        if (!as) return;
        if (as.dsa_beneficiary) addDsaName(as.dsa_beneficiary);
        if (as.dsa_payor) addDsaName(as.dsa_payor);
        const geoCountries = Array.isArray(as.targeting?.geo_locations?.countries) ? as.targeting.geo_locations.countries : [];
        const targetsAu = geoCountries.includes('AU') || /austr[aá]lia/i.test(as.name || '');
        const entId = extractEntityIdFromRegObj(as.regional_regulation_identities);
        if (entId) {
            upsertCandidate({
                id: entId,
                name: as.dsa_beneficiary || (targetsAu ? 'Verificado AU' : as.name),
                label: `${targetsAu ? '✨ Conjunto AU' : `✨ Conjunto ${as.name || as.id}`}: ${entId}`,
                source: targetsAu ? 'au_adset' : 'adset',
                priority: targetsAu ? 100 : 80,
                categoriesHint: Array.isArray(as.regional_regulated_categories) && as.regional_regulated_categories.length > 0 ? as.regional_regulated_categories : null,
                identitiesHint: as.regional_regulation_identities
            });
            if (targetsAu && !auSample) {
                auSample = {
                    categories: Array.isArray(as.regional_regulated_categories) && as.regional_regulated_categories.length > 0
                        ? as.regional_regulated_categories
                        : ['AUSTRALIA_UNIVERSAL'],
                    identities: as.regional_regulation_identities,
                    dsaBeneficiary: as.dsa_beneficiary || '',
                    dsaPayor: as.dsa_payor || ''
                };
            }
        }
    });

    if (dsaRecRes.status === 'fulfilled' && Array.isArray(dsaRecRes.value?.data)) {
        const recs = dsaRecRes.value.data;
        recs.filter(r => /futuretech/i.test(String(r?.name || r?.beneficiary || r || ''))).forEach(r => {
            addDsaName(r?.name || r?.beneficiary || r?.text || (typeof r === 'string' ? r : ''));
        });
        recs.forEach(r => {
            addDsaName(r?.name || r?.beneficiary || r?.text || (typeof r === 'string' ? r : ''));
        });
    }

    const bizList = bizRes.status === 'fulfilled' && Array.isArray(bizRes.value?.data) ? bizRes.value.data : [];
    bizList.forEach(b => {
        if (!b?.id) return;
        const isFuturetech = /futuretech/i.test(b.name || '');
        const isVerified = String(b.verification_status || '').toLowerCase() === 'verified';
        if (isFuturetech) addDsaName(b.name);
        upsertCandidate({
            id: b.id,
            name: b.name || b.id,
            label: `🏢 ${b.name || 'BM'} (${b.id})${isVerified ? ' ✓' : ''}`,
            source: isFuturetech ? 'futuretech_bm' : 'me_business',
            priority: isFuturetech ? 75 : (isVerified ? 48 : 35)
        });
    });

    const accBiz = accObj?.business || metaState.selectedAccount?.business || null;
    if (accBiz?.id) {
        const isFuturetech = /futuretech/i.test(accBiz.name || '');
        upsertCandidate({
            id: accBiz.id,
            name: accBiz.name || accBiz.id,
            label: `🏢 BM da Conta: ${accBiz.name || accBiz.id} (${accBiz.id})`,
            source: 'account_business',
            priority: isFuturetech ? 78 : 55
        });
    }

    if (Array.isArray(metaState.promotePages)) {
        metaState.promotePages.forEach(p => {
            if (p?.business?.id) {
                const isFuturetech = /futuretech/i.test(p.business.name || '');
                upsertCandidate({
                    id: p.business.id,
                    name: p.business.name || p.business.id,
                    label: `🏢 BM Página: ${p.business.name || p.business.id} (${p.business.id})`,
                    source: 'page_business',
                    priority: isFuturetech ? 70 : 25
                });
            }
        });
    }

    addDsaName('Futuretech Dynamics LLC');
    addDsaName('Futuretech Dynamics');

    const candidates = Array.from(candidateMap.values()).sort((a, b) => b.priority - a.priority);
    const ctx = {
        accountId,
        candidates,
        dsaNames: Array.from(dsaNameSet),
        auSample
    };

    metaState.advertiserCtx = ctx;
    metaState.advertiserAccountId = accountId;
    renderDupAdvertiserSelect(ctx);
    return ctx;
}

function buildRegionalComplianceAttempts({
    countryCode = '',
    baseAdset = null,
    siblingAdsets = [],
    regCtx = null,
    accountId = '',
    manualEntityId = '',
    manualDsaName = '',
    workingComplianceByCountry = {}
}) {
    const code = String(countryCode || '').toUpperCase();
    const isEu = EU_DSA_COUNTRY_CODES.has(code);

    const dsaNames = Array.from(new Set([
        manualDsaName,
        baseAdset?.dsa_beneficiary,
        ...(Array.isArray(siblingAdsets) ? siblingAdsets.map(a => a?.dsa_beneficiary) : []),
        ...(regCtx?.dsaNames || []),
        'Futuretech Dynamics LLC',
        'Futuretech Dynamics'
    ].map(v => String(v || '').trim()).filter(Boolean)));

    const primaryDsa = dsaNames[0] || 'Futuretech Dynamics LLC';

    const attempts = [];
    const seenKeys = new Set();
    const pushAttempt = ({ label, categories = null, identities = null, dsaBeneficiary = '', dsaPayor = '' }) => {
        const key = JSON.stringify({
            c: categories || null,
            i: identities || null,
            db: dsaBeneficiary || '',
            dp: dsaPayor || ''
        });
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        attempts.push({ key, label, categories, identities, dsaBeneficiary, dsaPayor });
    };

    const cachedBatch = workingComplianceByCountry?.[code];
    if (cachedBatch) pushAttempt(cachedBatch);

    const storedCfg = getStoredRegionalComplianceConfig(accountId, code);
    if (storedCfg) pushAttempt({ ...storedCfg, label: `${storedCfg.label || code} (salvo)` });

    if (code === 'AU' && regCtx?.auSample) {
        pushAttempt({
            label: `Conjunto AU da conta (${extractEntityIdFromRegObj(regCtx.auSample.identities)})`,
            categories: regCtx.auSample.categories,
            identities: regCtx.auSample.identities,
            dsaBeneficiary: regCtx.auSample.dsaBeneficiary || primaryDsa,
            dsaPayor: regCtx.auSample.dsaPayor || primaryDsa
        });
        pushAttempt({
            label: `Conjunto AU da conta sem DSA (${extractEntityIdFromRegObj(regCtx.auSample.identities)})`,
            categories: regCtx.auSample.categories,
            identities: regCtx.auSample.identities
        });
    }

    const entityIds = [];
    const seenEnt = new Set();
    const addEnt = (id, label = '') => {
        const sId = String(id || '').trim();
        if (!sId || seenEnt.has(sId)) return;
        seenEnt.add(sId);
        entityIds.push({ id: sId, label: label || sId });
    };

    if (manualEntityId) addEnt(manualEntityId, `ID informado (${manualEntityId})`);
    const baseEntId = extractEntityIdFromRegObj(baseAdset?.regional_regulation_identities);
    if (baseEntId) addEnt(baseEntId, `Conjunto base (${baseEntId})`);
    (siblingAdsets || []).forEach(a => {
        const sId = extractEntityIdFromRegObj(a?.regional_regulation_identities);
        if (sId) addEnt(sId, `Conjunto irmão (${sId})`);
    });
    (regCtx?.candidates || []).forEach(c => addEnt(c.id, c.label || c.id));

    if (isEu && code !== 'ES') {
        pushAttempt({
            label: `DSA UE (${primaryDsa})`,
            dsaBeneficiary: primaryDsa,
            dsaPayor: baseAdset?.dsa_payor || primaryDsa
        });
    }

    const catMatrix = REGIONAL_COUNTRY_CATEGORIES[code] || [['VOLUNTARY_VERIFICATION']];
    const shouldProactive = code === 'AU' || isEu || Boolean(REGIONAL_COUNTRY_CATEGORIES[code]) || Boolean(cachedBatch || storedCfg);

    entityIds.forEach(ent => {
        catMatrix.forEach(cats => {
            const isFinServAu = cats.includes('AUSTRALIA_FINSERV');
            const idObj = isFinServAu
                ? { australia_finserv_beneficiary: ent.id, australia_finserv_payer: ent.id }
                : { universal_beneficiary: ent.id, universal_payer: ent.id };

            if (isEu || code === 'AU' || !REGIONAL_COUNTRY_CATEGORIES[code]) {
                pushAttempt({
                    label: `${cats.join('+')} + ${ent.label} + DSA`,
                    categories: cats,
                    identities: idObj,
                    dsaBeneficiary: primaryDsa,
                    dsaPayor: primaryDsa
                });
            }
            pushAttempt({
                label: `${cats.join('+')} + ${ent.label}`,
                categories: cats,
                identities: idObj
            });
        });
    });

    dsaNames.slice(0, 2).forEach(dn => {
        pushAttempt({
            label: `DSA '${dn}'`,
            dsaBeneficiary: dn,
            dsaPayor: dn
        });
    });

    attempts.shouldProactive = shouldProactive;
    return attempts;
}

function applyComplianceAttemptToAdSetPayload(payloadObj, attempt) {
    delete payloadObj.regional_regulated_categories;
    delete payloadObj.regional_regulation_identities;
    delete payloadObj.dsa_beneficiary;
    delete payloadObj.dsa_payor;
    if (!attempt) return payloadObj;
    if (Array.isArray(attempt.categories) && attempt.categories.length > 0) {
        payloadObj.regional_regulated_categories = attempt.categories;
    }
    if (attempt.identities && typeof attempt.identities === 'object') {
        payloadObj.regional_regulation_identities = attempt.identities;
    }
    if (attempt.dsaBeneficiary) payloadObj.dsa_beneficiary = attempt.dsaBeneficiary;
    if (attempt.dsaPayor) payloadObj.dsa_payor = attempt.dsaPayor;
    return payloadObj;
}

function buildMetaAdvertiserHelpHint(countryName = 'Austrália', countryCode = 'AU', regCtx = null) {
    const foundCount = regCtx?.candidates?.length || 0;
    return (
        `📌 COMO RESOLVER VERIFICAÇÃO DO ANUNCIANTE EM ${countryName.toUpperCase()} (${countryCode}) - subcode 3858634:\n` +
        `A Meta exige uma Entidade Verificada ('Futuretech Dynamics') para entregar anúncios nesse país (entidades detectadas na conta: ${foundCount}).\n` +
        `1. No Gerenciador de Anúncios da Meta, duplique ou edite 1 conjunto para '${countryName}', selecione "Futuretech Dynamics" no campo Advertiser / Anunciante e publique (pode deixar pausado).\n` +
        `2. Volte aqui na Etapa 2 do Duplicador e clique no botão 🔄 ao lado de "Anunciante / Advertiser" — o painel copiará automaticamente o ID verificado desse conjunto!\n` +
        `3. Se já tiver o ID numérico da entidade verificada no Business Manager (Configurações do Negócio > Entidades Verificadas / Identities), cole no campo "ID Entidade Verificada" na Etapa 2.`
    );
}

// Disparado ao trocar de conta de anúncios
async function onMetaAccountSelected() {
    const selectAcc = document.getElementById('select-meta-account');
    const selectCamp = document.getElementById('select-meta-campaign');
    const selectAdSet = document.getElementById('select-meta-adset');
    const labelCamp = document.getElementById('label-campaign-count');
    const currencyPrefix = document.getElementById('currency-prefix');

    if (!selectAcc || !selectCamp) return;

    const accountId = selectAcc.value;
    metaState.selectedAccountId = accountId;

    selectCamp.innerHTML = '<option value="">Carregando campanhas...</option>';
    selectCamp.disabled = true;
    const searchCamp = document.getElementById('search-meta-campaign');
    if (searchCamp) {
        searchCamp.value = '';
        searchCamp.disabled = true;
    }
    metaState.campaigns = [];
    if (selectAdSet) {
        selectAdSet.innerHTML = '<option value="">Selecione uma campanha primeiro...</option>';
        selectAdSet.disabled = true;
    }
    hideBaseAdSetPreview();

    if (!accountId) {
        selectCamp.innerHTML = '<option value="">Selecione uma conta primeiro...</option>';
        loadDupPromotePages('').catch(() => {});
        loadDupAdvertiserEntities('').catch(() => {});
        return;
    }

    // Sempre operamos em Dólar ($ USD)
    const accObj = metaState.accounts.find(a => a.id === accountId);
    if (accObj) {
        metaState.selectedAccount = accObj;
    }
    if (currencyPrefix) {
        currencyPrefix.innerText = '$';
    }

    // Busca em paralelo Páginas autorizadas (1885499) e Entidades Verificadas / Futuretech Dynamics (3858634)
    loadDupPromotePages(accountId).catch(() => {});
    loadDupAdvertiserEntities(accountId).catch(() => {});

    if (labelCamp) labelCamp.innerText = '(Buscando...)';

    try {
        let allCamps = [];
        let nextUrl = `/${META_GRAPH_VERSION}/${accountId}/campaigns?fields=id,name,status,objective&limit=250`;
        for (let page = 0; page < 2 && nextUrl; page++) {
            const data = await metaGraphGet(nextUrl);
            if (Array.isArray(data.data) && data.data.length > 0) {
                allCamps = allCamps.concat(data.data);
            }
            nextUrl = data.paging?.next || null;
        }

        if (allCamps.length > 0) {
            metaState.campaigns = allCamps;
            if (searchCamp) searchCamp.disabled = false;
            renderMetaCampaignOptions(allCamps, true);
        } else {
            selectCamp.innerHTML = '<option value="">Nenhuma campanha nesta conta</option>';
            if (labelCamp) labelCamp.innerText = '(0 campanhas)';
        }
    } catch (e) {
        console.error('Erro ao buscar campanhas:', e);
        selectCamp.innerHTML = '<option value="">Erro ao carregar campanhas</option>';
        if (labelCamp) labelCamp.innerText = '(Erro)';
    }
}

let _metaCampRemoteTimer = null;

function renderMetaCampaignOptions(campaignsList, autoSelectFirst = false) {
    const selectCamp = document.getElementById('select-meta-campaign');
    const labelCamp = document.getElementById('label-campaign-count');
    if (!selectCamp) return;

    const prevId = selectCamp.value;
    selectCamp.innerHTML = '';

    if (!campaignsList || campaignsList.length === 0) {
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.innerText = 'Nenhuma campanha encontrada para essa busca';
        selectCamp.appendChild(emptyOpt);
        selectCamp.disabled = false;
        if (labelCamp) labelCamp.innerText = `(0 de ${(metaState.campaigns || []).length})`;
        return;
    }

    let firstActive = '';
    campaignsList.forEach(camp => {
        const opt = document.createElement('option');
        opt.value = camp.id;
        const statusTag = camp.status === 'ACTIVE' ? '🟢' : '⏸️';
        opt.innerText = `${statusTag} ${camp.name}`;
        selectCamp.appendChild(opt);
        if (!firstActive && camp.status === 'ACTIVE') firstActive = camp.id;
    });

    selectCamp.disabled = false;
    const total = (metaState.campaigns || []).length;
    if (labelCamp) {
        labelCamp.innerText = campaignsList.length === total
            ? `(${total} campanhas)`
            : `(${campaignsList.length} de ${total})`;
    }

    const stillVisible = prevId && campaignsList.some(c => c.id === prevId);
    if (stillVisible && !autoSelectFirst) {
        selectCamp.value = prevId;
        return;
    }

    const nextSelected = firstActive || campaignsList[0].id;
    selectCamp.value = nextSelected;
    if (nextSelected !== prevId || autoSelectFirst) {
        onMetaCampaignSelected();
    }
}

let _metaFilterDebounce = null;

function filterMetaCampaigns() {
    if (_metaFilterDebounce) clearTimeout(_metaFilterDebounce);
    _metaFilterDebounce = setTimeout(() => {
        _executeFilterMetaCampaigns();
    }, 120);
}

function _executeFilterMetaCampaigns() {
    const rawQuery = (document.getElementById('search-meta-campaign')?.value || '').trim();
    const allCamps = metaState.campaigns || [];
    if (!rawQuery) {
        renderMetaCampaignOptions(allCamps, false);
        return;
    }

    const tokens = normalizeText(rawQuery).split(' ').filter(Boolean);
    const filtered = allCamps.filter(c => {
        const normName = normalizeText(c.name || '');
        const rawLower = (c.name || '').toLowerCase();
        const qLower = rawQuery.toLowerCase();
        return rawLower.includes(qLower) || tokens.every(t => normName.includes(t));
    });

    renderMetaCampaignOptions(filtered, false);

    // Se não achou nas campanhas em memória e digitou 3+ caracteres (ex: PostID antigo), pesquisa na Meta API
    if (_metaCampRemoteTimer) clearTimeout(_metaCampRemoteTimer);
    if (filtered.length === 0 && rawQuery.length >= 3 && metaState.selectedAccountId) {
        const capturedAccount = metaState.selectedAccountId;
        const capturedQuery = rawQuery;
        _metaCampRemoteTimer = setTimeout(async () => {
            const labelCamp = document.getElementById('label-campaign-count');
            if (!hasActiveMetaAuth() || metaState.selectedAccountId !== capturedAccount) return;
            if ((document.getElementById('search-meta-campaign')?.value || '').trim() !== capturedQuery) return;
            if (labelCamp) labelCamp.innerText = '(Buscando na API...)';

            try {
                const filtering = JSON.stringify([{ field: 'name', operator: 'CONTAIN', value: capturedQuery }]);
                const data = await metaGraphGet(`/${META_GRAPH_VERSION}/${capturedAccount}/campaigns?fields=id,name,status,objective&filtering=${encodeURIComponent(filtering)}&limit=50`);
                if ((document.getElementById('search-meta-campaign')?.value || '').trim() !== capturedQuery) return;

                const remoteList = Array.isArray(data.data) ? data.data : [];
                if (remoteList.length > 0) {
                    const existingIds = new Set(metaState.campaigns.map(c => c.id));
                    remoteList.forEach(rc => {
                        if (!existingIds.has(rc.id)) metaState.campaigns.push(rc);
                    });
                }
                renderMetaCampaignOptions(remoteList, false);
            } catch (e) {
                console.warn('Busca remota de campanha falhou:', e);
            }
        }, 320);
    }
}

let _metaCampaignReqSeq = 0;

// Disparado ao trocar de campanha
async function onMetaCampaignSelected() {
    const selectCamp = document.getElementById('select-meta-campaign');
    const selectAdSet = document.getElementById('select-meta-adset');
    const labelAdSet = document.getElementById('label-adset-count');

    if (!selectCamp || !selectAdSet) return;

    const campaignId = selectCamp.value;
    const currentSeq = ++_metaCampaignReqSeq;

    metaState.selectedCampaignId = campaignId;
    metaState.selectedAdSetId = '';
    metaState.selectedAdSet = null;
    metaState.adsets = [];
    metaState.checkedCountries = {};
    duplicatorManualFilesByLang = {};

    renderCampaignCreativeLinkBadge();
    updateDuplicatorLanguageNotice();

    selectAdSet.innerHTML = '<option value="">Carregando conjuntos base...</option>';
    selectAdSet.disabled = true;
    hideBaseAdSetPreview();
    renderBlockNav();
    renderCountriesGrid();

    if (!campaignId) {
        selectAdSet.innerHTML = '<option value="">Selecione uma campanha primeiro...</option>';
        return;
    }

    if (labelAdSet) labelAdSet.innerText = '(Buscando...)';

    try {
        const data = await metaGraphGet(`/${META_GRAPH_VERSION}/${campaignId}/adsets?fields=id,name,daily_budget,targeting,status,dsa_beneficiary,dsa_payor,regional_regulated_categories,regional_regulation_identities&limit=100`);

        // Se uma busca mais nova já iniciou, descarta essa resposta defasada!
        if (currentSeq !== _metaCampaignReqSeq || selectCamp.value !== campaignId) {
            return;
        }

        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            metaState.adsets = data.data;
            selectAdSet.innerHTML = '';

            data.data.forEach(adset => {
                const opt = document.createElement('option');
                opt.value = adset.id;
                const statusTag = adset.status === 'ACTIVE' ? '🟢' : '⏸️';
                opt.innerText = `${statusTag} ${adset.name}`;
                selectAdSet.appendChild(opt);
            });

            selectAdSet.disabled = false;
            if (labelAdSet) labelAdSet.innerText = `(${data.data.length} conjuntos)`;

            selectAdSet.value = data.data[0].id;
            onMetaAdSetSelected();
            renderBlockNav();
            renderCountriesGrid();
        } else {
            if (currentSeq !== _metaCampaignReqSeq) return;
            metaState.adsets = [];
            metaState.checkedCountries = {};
            metaState.selectedAdSetId = '';
            metaState.selectedAdSet = null;
            selectAdSet.innerHTML = '<option value="">Nenhum conjunto nesta campanha</option>';
            if (labelAdSet) labelAdSet.innerText = '(0 conjuntos)';
            renderBlockNav();
            renderCountriesGrid();
        }
    } catch (e) {
        if (currentSeq !== _metaCampaignReqSeq) return;
        console.error('Erro ao buscar conjuntos:', e);
        metaState.adsets = [];
        metaState.checkedCountries = {};
        metaState.selectedAdSetId = '';
        metaState.selectedAdSet = null;
        selectAdSet.innerHTML = '<option value="">Erro ao carregar conjuntos</option>';
        if (labelAdSet) labelAdSet.innerText = '(Erro)';
        renderBlockNav();
        renderCountriesGrid();
    }
}

// Disparado ao selecionar o conjunto base
function onMetaAdSetSelected() {
    const selectAdSet = document.getElementById('select-meta-adset');
    if (!selectAdSet || !selectAdSet.value) {
        hideBaseAdSetPreview();
        return;
    }

    const adsetId = selectAdSet.value;
    metaState.selectedAdSetId = adsetId;
    const adset = metaState.adsets.find(a => a.id === adsetId);
    metaState.selectedAdSet = adset;

    if (adset) {
        showBaseAdSetPreview(adset);
        loadBaseAdSetMetaThumbnails(adset.id);
        renderCampaignCreativeLinkBadge();
        renderBlockNav();
        renderCountriesGrid();
        updateDuplicatorLanguageNotice();
    } else {
        hideBaseAdSetPreview();
    }
}

function showBaseAdSetPreview(adset) {
    const box = document.getElementById('base-adset-details-box');
    const nameEl = document.getElementById('preview-adset-name');
    const metaEl = document.getElementById('preview-adset-meta');
    const tagsEl = document.getElementById('preview-adset-tags');

    if (!box) return;

    if (nameEl) nameEl.innerText = `Conjunto Origem: ${adset.name}`;

    const budgetVal = adset.daily_budget ? (parseInt(adset.daily_budget) / 100).toFixed(2) : '1.00';
    if (metaEl) metaEl.innerText = `Orçamento Base: $${budgetVal} USD | Status: ${adset.status}`;

    if (tagsEl) {
        tagsEl.innerHTML = '';
        const countries = adset.targeting && adset.targeting.geo_locations && adset.targeting.geo_locations.countries
            ? adset.targeting.geo_locations.countries
            : [];

        const tag1 = document.createElement('span');
        tag1.className = 'adset-tag';
        tag1.innerText = `📍 Países Origem: ${countries.join(', ') || 'Global'}`;
        tagsEl.appendChild(tag1);

        const tag2 = document.createElement('span');
        tag2.className = 'adset-tag';
        tag2.innerText = `🎯 Idade: ${adset.targeting ? (adset.targeting.age_min || 18) + '-' + (adset.targeting.age_max || 65) : '18-65'}`;
        tagsEl.appendChild(tag2);

        const tag3 = document.createElement('span');
        tag3.className = 'adset-tag';
        tag3.innerText = `✨ Criativos & Anúncios verificados`;
        tagsEl.appendChild(tag3);
    }

    box.classList.remove('twod-hidden');
}

function hideBaseAdSetPreview() {
    const box = document.getElementById('base-adset-details-box');
    if (box) box.classList.add('twod-hidden');
}

// ========================================================
// IDENTIFICAÇÃO DE CRIATIVOS: MINIATURAS META ADS & ONEDRIVE
// ========================================================

let metaBaseAdsCache = [];
let campaignCreativesMap = {};
let _metaThumbReqSeq = 0;
let loadedNichePacksMap = {};
let loadedPacksByNicheSlug = {};
let duplicatorManualFilesByLang = {};
let duplicatorSelectedSlots = new Set([1, 2, 3, 4, 5, 6]);

function escHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
window.escHtml = escHtml;
window.loadNichesFromAPI = loadNichesFromAPI;

function isMetaPagePermissionError(err) {
    if (!err) return false;
    const sub = Number(err.error_subcode || 0);
    const txt = (typeof err === 'string')
        ? err
        : `${err.error_user_title || ''} ${err.error_user_msg || ''} ${err.message || ''}`;
    return sub === 1885499 || sub === 3858749 || /No Advertiser Permission On Page|Missing Page permission|advertiser permission on the page/i.test(txt);
}

function buildMetaPagePermissionHint(pageId = '') {
    const pidLabel = pageId ? `Página ID ${pageId}` : 'Página do Facebook usada no anúncio';
    return (
        `📌 COMO LIBERAR A PÁGINA NO BUSINESS MANAGER (subcode 1885499 / 3858749):\n` +
        `O Token / Usuário do Sistema não possui permissão de Anunciante na ${pidLabel}.\n` +
        `1. Abra https://business.facebook.com/settings/system-users\n` +
        `2. Clique no Usuário do Sistema do token -> "Atribuir Ativos" > "Páginas".\n` +
        `3. Marque a ${pidLabel} e ative "Criar anúncios" (ou Controle total) -> Salvar.`
    );
}

async function rollbackOrphanMetaAdSet(adsetId, adsetName = '', logFn = null) {
    if (!adsetId) return false;
    const logger = typeof logFn === 'function' ? logFn : logMetaTerminal;
    try {
        let delRes = await metaGraphRequest('DELETE', `/${META_GRAPH_VERSION}/${adsetId}`);
        if (delRes && delRes.error) {
            delRes = await metaGraphPost(`/${META_GRAPH_VERSION}/${adsetId}`, { status: 'DELETED' });
        }
        if (delRes && !delRes.error) {
            logger(`🧹 Rollback automático: conjunto vazio '${adsetName || adsetId}' (ID: ${adsetId}) excluído na Meta para não deixar conjunto sem anúncios.`, 'warn');
            return true;
        }
        logger(`⚠️ Não foi possível excluir automaticamente o conjunto vazio ${adsetId}: ${formatMetaApiError(delRes?.error || delRes)}`, 'warn');
    } catch (e) {
        logger(`⚠️ Falha ao tentar excluir conjunto vazio ${adsetId}: ${e.message || e}`, 'warn');
    }
    return false;
}

function stopBatchDuplication() {
    if (!metaState.isDuplicating) return;
    metaState.stopDuplicationRequested = true;
    logMetaTerminal('⏹️ Parada solicitada! Interrompendo após concluir o país atual...', 'warn');
    const stopBtn = document.getElementById('btn-stop-duplication');
    if (stopBtn) {
        stopBtn.disabled = true;
        stopBtn.innerText = '⏳ Parando...';
    }
}

function getNextTargetTimeLocalInput(hhmm = '01:00') {
    const [hh, mm] = String(hhmm || '01:00').split(':').map(n => parseInt(n, 10) || 0);
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
    if (target.getTime() <= now.getTime() + 10 * 60 * 1000) {
        target.setDate(target.getDate() + 1);
    }
    const pad = (v) => String(v).padStart(2, '0');
    return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}T${pad(target.getHours())}:${pad(target.getMinutes())}`;
}

function formatMetaStartTimeIso(localDtInputVal) {
    const raw = String(localDtInputVal || '').trim();
    if (!raw) return '';
    const d = new Date(raw);
    if (isNaN(d.getTime())) return '';
    const pad = (v) => String(v).padStart(2, '0');
    const offMin = -d.getTimezoneOffset();
    const sign = offMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offMin);
    const offH = pad(Math.floor(absMin / 60));
    const offM = pad(absMin % 60);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${offH}${offM}`;
}

function formatPtBrDateTime(localDtInputVal) {
    const d = new Date(String(localDtInputVal || '').trim());
    if (isNaN(d.getTime())) return String(localDtInputVal || '');
    const pad = (v) => String(v).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function onDupScheduleModeChanged() {
    const sel = document.getElementById('select-dup-schedule-mode');
    const box = document.getElementById('dup-inline-schedule-box');
    const dtInput = document.getElementById('input-dup-schedule-dt');
    if (!sel || !box) return;
    if (sel.value === 'scheduled') {
        box.classList.remove('twod-hidden');
        if (dtInput && !dtInput.value) {
            dtInput.value = getNextTargetTimeLocalInput('01:00');
        }
    } else {
        box.classList.add('twod-hidden');
    }
}

function presetDupInlineTime(hhmm = '01:00') {
    const dtInput = document.getElementById('input-dup-schedule-dt');
    const sel = document.getElementById('select-dup-schedule-mode');
    if (sel) sel.value = 'scheduled';
    if (dtInput) dtInput.value = getNextTargetTimeLocalInput(hhmm);
    onDupScheduleModeChanged();
}

function showDupClickFeedback(msg, level = 'warn') {
    const box = document.getElementById('dup-click-feedback');
    if (box) {
        const styles = {
            info: { bg: 'rgba(59,130,246,0.12)', bd: 'rgba(59,130,246,0.4)', fg: '#93c5fd' },
            warn: { bg: 'rgba(245,158,11,0.14)', bd: 'rgba(245,158,11,0.45)', fg: '#fcd34d' },
            error: { bg: 'rgba(239,68,68,0.14)', bd: 'rgba(239,68,68,0.45)', fg: '#f87171' },
            success: { bg: 'rgba(16,185,129,0.14)', bd: 'rgba(16,185,129,0.45)', fg: '#34d399' }
        }[level] || { bg: 'rgba(245,158,11,0.14)', bd: 'rgba(245,158,11,0.45)', fg: '#fcd34d' };
        box.style.background = styles.bg;
        box.style.border = `1px solid ${styles.bd}`;
        box.style.color = styles.fg;
        box.innerHTML = msg;
        box.classList.remove('twod-hidden');
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    const plain = String(msg || '').replace(/<[^>]+>/g, '');
    logMetaTerminal(plain, level === 'error' ? 'error' : (level === 'info' ? 'info' : 'warn'));
}

function clearDupClickFeedback() {
    const box = document.getElementById('dup-click-feedback');
    if (box) {
        box.classList.add('twod-hidden');
        box.innerHTML = '';
    }
}

let _dupLaunchModalResolver = null;
let _dupLaunchModalMissingRequired = false;

function syncDupLaunchModalScheduleUI() {
    const rInst = document.getElementById('dup-launch-radio-instant');
    const rSched = document.getElementById('dup-launch-radio-scheduled');
    const cInst = document.getElementById('dup-card-instant');
    const cSched = document.getElementById('dup-card-scheduled');
    const panel = document.getElementById('dup-launch-schedule-panel');
    const dtEl = document.getElementById('dup-launch-schedule-dt');
    const isSched = Boolean(rSched && rSched.checked);

    if (cInst) cInst.classList.toggle('is-selected', Boolean(rInst && rInst.checked));
    if (cSched) cSched.classList.toggle('is-selected', isSched);
    if (panel) panel.classList.toggle('twod-hidden', !isSched);
    if (isSched && dtEl && !dtEl.value) {
        dtEl.value = getNextTargetTimeLocalInput('01:00');
    }
}

function applyDupModalTimePreset(hhmm = '01:00') {
    const rSched = document.getElementById('dup-launch-radio-scheduled');
    const dtEl = document.getElementById('dup-launch-schedule-dt');
    if (rSched) rSched.checked = true;
    if (dtEl) dtEl.value = getNextTargetTimeLocalInput(hhmm);
    syncDupLaunchModalScheduleUI();
}

function resolveDuplicatorLaunchModal(val) {
    const modal = document.getElementById('modal-dup-launch');
    if (modal) modal.classList.add('twod-hidden');
    if (typeof _dupLaunchModalResolver === 'function') {
        const fn = _dupLaunchModalResolver;
        _dupLaunchModalResolver = null;
        fn(val);
    }
}

function confirmDuplicatorLaunchModal() {
    const errEl = document.getElementById('dup-launch-error');
    const showErr = (m) => {
        if (errEl) {
            errEl.textContent = m;
            errEl.classList.remove('twod-hidden');
        }
    };
    if (errEl) errEl.classList.add('twod-hidden');

    if (_dupLaunchModalMissingRequired) {
        const ack = document.getElementById('dup-launch-missing-ack');
        if (!ack || !ack.checked) {
            showErr('⚠️ Marque a caixa amarela acima confirmando criar apenas estrutura onde faltar criativo, ou clique em Cancelar para vincular o pacote.');
            return;
        }
    }

    const rSched = document.getElementById('dup-launch-radio-scheduled');
    const isSched = Boolean(rSched && rSched.checked);
    if (!isSched) {
        resolveDuplicatorLaunchModal({ mode: 'instant', scheduleLocalDt: '', metaStartTimeIso: '', schedulePtBr: '', autoActive: false });
        return;
    }

    const dtVal = (document.getElementById('dup-launch-schedule-dt')?.value || '').trim();
    if (!dtVal) {
        showErr('⚠️ Selecione a data e o horário de início da programação.');
        return;
    }
    const parsed = new Date(dtVal);
    if (isNaN(parsed.getTime())) {
        showErr('⚠️ Data/hora inválida.');
        return;
    }
    if (parsed.getTime() <= Date.now() + 4 * 60 * 1000) {
        showErr('⚠️ O horário programado deve estar pelo menos 5 minutos no futuro.');
        return;
    }

    const autoActive = Boolean(document.getElementById('dup-launch-auto-active')?.checked);
    resolveDuplicatorLaunchModal({
        mode: 'scheduled',
        scheduleLocalDt: dtVal,
        metaStartTimeIso: formatMetaStartTimeIso(dtVal),
        schedulePtBr: formatPtBrDateTime(dtVal),
        autoActive
    });
}

function openDuplicatorLaunchModal(config) {
    if (window.__testDupLaunchChoice !== undefined) {
        return Promise.resolve(window.__testDupLaunchChoice);
    }
    const modal = document.getElementById('modal-dup-launch');
    if (!modal) {
        return Promise.resolve({ mode: 'instant', scheduleLocalDt: '', metaStartTimeIso: '', schedulePtBr: '', autoActive: false });
    }

    const summaryEl = document.getElementById('dup-launch-summary');
    const warnBox = document.getElementById('dup-launch-missing-warn');
    const warnTxt = document.getElementById('dup-launch-missing-text');
    const warnAck = document.getElementById('dup-launch-missing-ack');
    const errEl = document.getElementById('dup-launch-error');
    const rInst = document.getElementById('dup-launch-radio-instant');
    const rSched = document.getElementById('dup-launch-radio-scheduled');
    const dtEl = document.getElementById('dup-launch-schedule-dt');
    const instSub = document.getElementById('dup-instant-sub');

    if (errEl) errEl.classList.add('twod-hidden');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div>🎯 <strong>Campanha:</strong> ${escHtml(config.campName)} <span class="text-muted">(ID: ${escHtml(config.campId)})</span></div>
            <div>📦 <strong>Conjunto Base:</strong> ${escHtml(config.adsetName)} [${escHtml(config.baseLang.toUpperCase())}]</div>
            <div>🌍 <strong>Bloco:</strong> ${escHtml(config.blockTitle)} • <strong>${config.countriesCount} conjunto(s)</strong> • Orçamento fixo <strong>$1.00 USD/dia</strong></div>
            <div>🎬 <strong>Modo de Anúncios:</strong> ${escHtml(config.modeSummary)}</div>
        `;
    }
    if (instSub) {
        instSub.textContent = config.initialStatus === 'ACTIVE'
            ? 'Publica como ATIVO (entra em análise/rodando imediatamente).'
            : 'Publica como PAUSADO para conferência manual antes do gasto.';
    }

    _dupLaunchModalMissingRequired = Boolean(config.missingDiffLangs && config.missingDiffLangs.length > 0);
    if (warnBox && warnTxt && warnAck) {
        if (_dupLaunchModalMissingRequired) {
            warnAck.checked = false;
            warnTxt.innerHTML = `⚠️ <strong>Idioma(s) sem criativo pronto (${escHtml(config.missingDiffLangs.map(l => l.toUpperCase()).join(', '))}):</strong> serão criados sem anúncios no idioma errado.`;
            warnBox.classList.remove('twod-hidden');
        } else {
            warnBox.classList.add('twod-hidden');
        }
    }

    const inlineMode = document.getElementById('select-dup-schedule-mode')?.value || 'ask';
    const inlineDt = (document.getElementById('input-dup-schedule-dt')?.value || '').trim();
    const defaultDt = inlineDt || getNextTargetTimeLocalInput('01:00');
    if (dtEl) dtEl.value = defaultDt;

    if (inlineMode === 'scheduled') {
        if (rSched) rSched.checked = true;
    } else {
        if (rInst) rInst.checked = true;
    }
    syncDupLaunchModalScheduleUI();

    modal.classList.remove('twod-hidden');
    return new Promise((resolve) => {
        _dupLaunchModalResolver = resolve;
    });
}

function formatMetaApiError(err) {
    if (!err) return 'Erro desconhecido';
    if (typeof err === 'string') return err;
    const baseMsg = [err.error_user_title, err.error_user_msg].filter(Boolean).join(': ') || err.message || JSON.stringify(err);
    const sub = err.error_subcode ? ` (subcode ${err.error_subcode})` : '';
    if (err.error_subcode === 1885183) {
        return `${baseMsg}${sub} — Ative o Modo "Ao Vivo" (Live) do app em developers.facebook.com/apps.`;
    }
    if (isMetaPagePermissionError(err)) {
        return `${baseMsg}${sub} — Libere a Página para o Usuário do Sistema em business.facebook.com/settings/system-users (Atribuir Ativos > Páginas > Criar anúncios).`;
    }
    return `${baseMsg}${sub}`;
}

function openThumbZoomModal(imgUrl, title = 'Prévia do Criativo', subtitle = '') {
    const modal = document.getElementById('dup-thumb-zoom-modal');
    const imgEl = document.getElementById('dup-thumb-zoom-img');
    const titleEl = document.getElementById('dup-thumb-zoom-title');
    const subEl = document.getElementById('dup-thumb-zoom-sub');
    if (!modal || !imgEl) return;

    let finalUrl = imgUrl || '';
    if (finalUrl.includes('/api/graph/thumb/') && !finalUrl.includes('size=')) {
        const hashIdx = finalUrl.indexOf('#');
        const bp = hashIdx >= 0 ? finalUrl.slice(0, hashIdx) : finalUrl;
        const hp = hashIdx >= 0 ? finalUrl.slice(hashIdx) : '';
        finalUrl = `${bp}${bp.includes('?') ? '&' : '?'}size=large${hp}`;
    }
    finalUrl = withMediaAuth(finalUrl);
    imgEl.src = finalUrl;
    if (titleEl) titleEl.innerText = title || 'Prévia do Criativo';
    if (subEl) subEl.innerText = subtitle || '';
    modal.classList.remove('twod-hidden');
}

function closeThumbZoomModal() {
    const modal = document.getElementById('dup-thumb-zoom-modal');
    if (modal) modal.classList.add('twod-hidden');
}

// Detecta o idioma real de um conjunto base de origem
function detectAdSetLanguage(adsetObj) {
    if (!adsetObj) return 'pt';
    const normName = normalizeText(adsetObj.name || '');

    // 1º Prioridade: marcador explícito no nome (ex: "Estados Unidos (Espanhol)", "Suíça (Francês)")
    if (normName.includes('espanhol') || normName.includes('spanish')) return 'es';
    if (normName.includes('ingles') || normName.includes('english')) return 'en';
    if (normName.includes('frances') || normName.includes('french')) return 'fr';
    if (normName.includes('russo') || normName.includes('russian')) return 'ru';
    if (normName.includes('arabe') || normName.includes('arabic')) return 'ar';
    if (normName.includes('portugues') || normName.includes('brasil') || normName.includes('portugal')) return 'pt';
    if (normName.includes('alema') || normName.includes('german')) return 'de';
    if (normName.includes('italian')) return 'it';
    if (normName.includes('holand') || normName.includes('dutch')) return 'nl';
    if (normName.includes('polon') || normName.includes('polish')) return 'pl';
    if (normName.includes('romen') || normName.includes('romanian')) return 'ro';

    // 2º Prioridade: tabela de blocos do Duplicador
    if (typeof META_COUNTRY_BLOCKS !== 'undefined') {
        for (const blk of Object.values(META_COUNTRY_BLOCKS)) {
            for (const c of (blk.countries || [])) {
                const cNorm = normalizeText(c.adSetName);
                if (cNorm && (normName === cNorm || normName.includes(cNorm))) {
                    return (c.langCode || 'pt').toLowerCase();
                }
            }
        }
    }

    // 3º Prioridade: locales & países na segmentação
    if (adsetObj.targeting?.locales?.includes(6)) return 'es';
    const countries = adsetObj.targeting?.geo_locations?.countries || [];
    if (countries.some(c => ['ES', 'MX', 'CO', 'AR', 'CL', 'PE', 'VE', 'EC', 'GT', 'CR', 'PA', 'DO', 'HN', 'PY', 'BO', 'UY', 'SV', 'NI'].includes(c))) return 'es';
    if (countries.includes('BR') || countries.includes('PT')) return 'pt';
    if (countries.includes('FR')) return 'fr';
    if (countries.includes('US') || countries.includes('GB') || countries.includes('AU')) return 'en';
    return 'pt';
}

const DUP_EXTRA_LANG_ALIASES = {
    vi: ['VI', 'VIETNAMITA', 'VIETNAM', 'VIETNAMESE'],
    th: ['TH', 'TAILANDES', 'TAILANDIA', 'THAI'],
    no: ['NO', 'NORUEGUES', 'NORUEGA', 'NORWEGIAN'],
    fi: ['FI', 'FINLANDES', 'FINLANDIA', 'FINNISH'],
    sv: ['SV', 'SUECO', 'SUECIA', 'SWEDISH'],
    iw: ['IW', 'HE', 'HEBRAICO', 'ISRAEL', 'HEBREW'],
    ms: ['MS', 'MALAIO', 'MALASIA', 'MALAY'],
    sl: ['SL', 'ESLOVENO', 'ESLOVENIA', 'SLOVENIAN'],
    lt: ['LT', 'LITUANO', 'LITUANIA', 'LITHUANIAN'],
    ca: ['CA', 'CATALAO', 'CATALAN'],
    fa: ['FA', 'PERSA', 'IRA', 'PERSIAN'],
    et: ['ET', 'ESTONIANO', 'ESTONIA', 'ESTONIAN'],
    lv: ['LV', 'LETAO', 'LETONIA', 'LATVIAN']
};

// Encontra a pasta de idioma correspondente no pacote do OneDrive sem fallback silencioso errado
function findMatchingPackFolderLang(availableLangs = [], langCode = 'pt') {
    if (!Array.isArray(availableLangs) || availableLangs.length === 0) return null;
    const codeKey = (langCode || 'pt').toLowerCase();
    const baseAliases = (typeof ONEDRIVE_LANG_ALIASES !== 'undefined' && ONEDRIVE_LANG_ALIASES[codeKey])
        ? ONEDRIVE_LANG_ALIASES[codeKey]
        : (DUP_EXTRA_LANG_ALIASES[codeKey] || [codeKey.toUpperCase()]);

    const normPack = s => normalizeText(s || '').toUpperCase().replace(/\s+/g, '');
    const candidates = availableLangs.map(raw => ({ raw, norm: normPack(raw) }));

    // Match exato (com e sem espaço), depois substring segura para nomes de idioma
    for (const alias of baseAliases) {
        const normAlias = normPack(alias);
        if (!normAlias) continue;
        const exact = candidates.find(c => c.norm === normAlias);
        if (exact) return exact.raw;
    }
    for (const alias of baseAliases) {
        if (alias === 'CANADA') continue; // ambíguo entre EN e FR
        const normAlias = normPack(alias);
        if (normAlias.length >= 4) {
            const partial = candidates.find(c => c.norm.includes(normAlias));
            if (partial) return partial.raw;
        }
    }
    return null;
}

// Extrai os vídeos (slots 1..6) de um pacote do OneDrive para um idioma específico
function getVideosForPackLang(packObj, langCode) {
    if (!packObj) return { matchedLang: null, slots: [] };
    const byLang = packObj.by_lang || {};
    const langKeys = Object.keys(byLang);

    let matchedLang = null;
    let pool = [];

    if (langKeys.length > 0) {
        matchedLang = findMatchingPackFolderLang(langKeys, langCode);
        if (matchedLang) {
            pool = [...(byLang[matchedLang].feed || []), ...(byLang[matchedLang].reels || [])];
        }
    } else {
        const allVids = [...(packObj.feed || []), ...(packObj.reels || [])];
        const langs = Array.from(new Set(allVids.map(v => v.lang).filter(Boolean)));
        matchedLang = findMatchingPackFolderLang(langs, langCode);
        if (matchedLang) {
            pool = allVids.filter(v => v.lang === matchedLang);
        }
    }

    if (!matchedLang || pool.length === 0) {
        return { matchedLang: null, slots: [] };
    }

    const slots = [];
    for (let slot = 1; slot <= 6; slot++) {
        const video = pool.find(v => Number(v.num) === slot || (v.name && v.name.startsWith(`${slot}.`)));
        if (video) {
            slots.push({
                slot,
                adName: String(slot).padStart(2, '0'),
                formatLabel: slot <= 3 ? 'Quadrado (Feed)' : 'Vertical (Reels)',
                video
            });
        }
    }
    if (slots.length === 0) {
        pool.slice(0, 6).forEach((v, idx) => {
            const slot = idx + 1;
            slots.push({
                slot,
                adName: String(slot).padStart(2, '0'),
                formatLabel: slot <= 3 ? 'Quadrado (Feed)' : 'Vertical (Reels)',
                video: v
            });
        });
    }
    return { matchedLang, slots };
}

function getCachedLinkedPackObj(campaignId) {
    const link = campaignCreativesMap[campaignId];
    if (!link) return null;
    const key = link.pack_id || link.niche_pack;
    return loadedNichePacksMap[key] || loadedNichePacksMap[link.niche_pack] || null;
}

// Verifica se há criativos prontos (Conjunto Base, OneDrive vinculado ou MP4 Manual) para um idioma
function isCreativeReadyForLang(campaignId, adsetObj, langCode) {
    const target = (langCode || 'pt').toLowerCase();
    if (adsetObj && detectAdSetLanguage(adsetObj) === target) {
        return { ready: true, source: 'base', label: 'Conjunto Base' };
    }
    if (Array.isArray(duplicatorManualFilesByLang[target]) && duplicatorManualFilesByLang[target].length > 0) {
        return { ready: true, source: 'manual', label: `MP4 Manual (${duplicatorManualFilesByLang[target].length})` };
    }
    const packObj = getCachedLinkedPackObj(campaignId);
    const link = campaignCreativesMap[campaignId];
    const langs = packObj ? (packObj.languages || Object.keys(packObj.by_lang || {})) : (link?.languages || []);
    const matched = findMatchingPackFolderLang(langs, target);
    if (matched) {
        return { ready: true, source: 'onedrive', label: matched };
    }
    return { ready: false, source: 'none', label: '' };
}

// Constroi URL localizada mantendo o padrão TranslateX do conjunto base (/es/, /pt/...)
function buildDuplicatorLocalizedUrl(rawUrl, targetLang, baseLang = 'pt') {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) return '';
    try {
        const u = new URL(trimmed);
        const parts = u.pathname.split('/').filter(Boolean);
        const langSet = (typeof TRANSLATEX_LANGS !== 'undefined')
            ? TRANSLATEX_LANGS
            : new Set(['pt', 'es', 'en', 'fr', 'de', 'it', 'nl', 'ru', 'ar', 'ro', 'hu', 'cs', 'sk', 'hi', 'id', 'ur', 'pl', 'uk', 'tl', 'sr']);
        let hadPrefix = false;
        if (parts.length > 0) {
            const firstLower = parts[0].toLowerCase();
            for (const code of langSet) {
                if (code.toLowerCase() === firstLower) {
                    hadPrefix = true;
                    parts.shift();
                    break;
                }
            }
        }
        const cleanPath = '/' + parts.join('/') + (u.pathname.endsWith('/') && parts.length > 0 ? '/' : '');
        const target = (targetLang || 'pt').trim();
        if (!hadPrefix && target.toLowerCase() === (baseLang || '').toLowerCase()) {
            u.pathname = cleanPath;
        } else {
            u.pathname = `/${target}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
        }
        return u.toString();
    } catch (e) {
        return trimmed;
    }
}

// Hidrata o pacote completo (by_lang + thumbs) de uma campanha vinculada sob demanda
async function ensureLinkedPackHydrated(campaignId, forceRefresh = false) {
    const link = campaignCreativesMap[campaignId];
    if (!link || !link.niche_pack) return null;
    if (!forceRefresh) {
        const cached = getCachedLinkedPackObj(campaignId);
        if (cached) return cached;
    }
    const campObj = (metaState.campaigns || []).find(c => c.id === campaignId);
    const nicheSlug = link.niche_slug || extractNicheFromCampaign(campObj?.name || link.campaign_name || '');
    if (!nicheSlug) return null;

    try {
        const q = `niche=${encodeURIComponent(nicheSlug)}${forceRefresh ? '&refresh=true' : ''}`;
        const resp = await apiFetch(`/api/onedrive/niche-packs?${q}`);
        const data = await resp.json();
        if (data.success && Array.isArray(data.packs)) {
            data.packs.forEach(p => {
                loadedNichePacksMap[p.pack_id || p.name] = p;
                loadedNichePacksMap[p.name] = p;
            });
            loadedPacksByNicheSlug[normalizeText(nicheSlug)] = data.packs;

            const found = data.packs.find(p =>
                (link.pack_id && p.pack_id === link.pack_id)
                || p.name === link.niche_pack
                || (link.folder_name && p.folder_name === link.folder_name && (link.block || '') === (p.block || ''))
            );
            if (found) {
                link.pack_id = found.pack_id || found.name;
                link.folder_name = found.folder_name || found.name;
                link.block = found.block || '';
                link.languages = found.languages || link.languages || [];
                localStorage.setItem('twod_campaign_creatives_v1', JSON.stringify(campaignCreativesMap));
                return found;
            }
        }
    } catch (e) {
        console.warn('Falha ao hidratar pacote vinculado:', e);
    }
    return null;
}

// Extrai o nome/slug do nicho da campanha (ex: '24944,RastrearOnibus,MON-TWODCOMPANY-09...' -> 'RastrearOnibus')
function extractNicheFromCampaign(campName = '') {
    if (!campName) return '';
    const parts = campName.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
        if (/^\d+$/.test(parts[0])) {
            return parts[1];
        }
        return parts[0];
    }
    const clean = campName.replace(/\d{2}\.\d{2}\.\d{2,4}/g, '').replace(/act_\d+/g, '').replace(/[^\w\s-]/g, ' ');
    const tokens = clean.split(/\s+/).filter(t => t.length >= 3 && !/^\d+$/.test(t));
    return tokens[0] || campName;
}

// Carrega os vínculos salvos entre Campanhas e Pacotes do OneDrive
async function loadCampaignCreativeLinks() {
    try {
        const local = localStorage.getItem('twod_campaign_creatives_v1');
        if (local) {
            try { campaignCreativesMap = JSON.parse(local) || {}; } catch (e) {}
        }
        const resp = await apiFetch('/api/campaign-creatives');
        const data = await resp.json();
        if (data.success && data.links) {
            campaignCreativesMap = { ...campaignCreativesMap, ...data.links };
            localStorage.setItem('twod_campaign_creatives_v1', JSON.stringify(campaignCreativesMap));
        }
    } catch (e) {
        console.warn('Fallback: usando links de criativos do localStorage:', e);
    }
    renderCampaignCreativeLinkBadge();
}

// Salva o vínculo de uma campanha com um pacote de criativo
async function linkCampaignToPack(campaignId, pack) {
    if (!campaignId || !pack) return;
    const campObj = (metaState.campaigns || []).find(c => c.id === campaignId);
    const campName = campObj ? campObj.name : campaignId;
    const nicheSlug = extractNicheFromCampaign(campName);

    loadedNichePacksMap[pack.pack_id || pack.name] = pack;
    loadedNichePacksMap[pack.name] = pack;

    const payload = {
        campaign_id: campaignId,
        campaign_name: campName,
        pack_id: pack.pack_id || pack.name,
        niche_pack: pack.name,
        folder_name: pack.folder_name || pack.name,
        block: pack.block || '',
        niche_slug: nicheSlug,
        account_id: metaState.selectedAccountId,
        thumbs: pack.sample_thumbs || [],
        languages: pack.languages || []
    };

    campaignCreativesMap[campaignId] = {
        ...payload,
        linked_at: new Date().toLocaleString()
    };
    localStorage.setItem('twod_campaign_creatives_v1', JSON.stringify(campaignCreativesMap));

    try {
        await apiFetch('/api/campaign-creatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (e) {
        console.warn('Erro ao salvar vínculo no servidor (salvo em localStorage):', e);
    }

    renderCampaignCreativeLinkBadge();
    renderBlockNav();
    renderCountriesGrid();
    updateDuplicatorLanguageNotice();
}

// Remove o vínculo da campanha
async function unlinkCampaignFromPack(campaignId) {
    if (!campaignId) return;
    delete campaignCreativesMap[campaignId];
    localStorage.setItem('twod_campaign_creatives_v1', JSON.stringify(campaignCreativesMap));

    try {
        await apiFetch('/api/campaign-creatives', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campaign_id: campaignId, delete: true })
        });
    } catch (e) {
        console.warn('Erro ao deletar vínculo no servidor:', e);
    }

    renderCampaignCreativeLinkBadge();
    renderBlockNav();
    renderCountriesGrid();
    updateDuplicatorLanguageNotice();
}

// Extrai todas as mídias únicas de um AdCreative (Asset Feed, Flexible Asset Groups ou Carrossel)
function extractCreativeMediaEntries(cr = {}) {
    const entries = [];
    const seen = new Set();

    const pushVideo = (v) => {
        if (!v) return;
        const vid = String(v.video_id || v.id || '').trim();
        if (!vid || seen.has(`v:${vid}`)) return;
        seen.add(`v:${vid}`);
        entries.push({
            kind: 'video',
            videoId: vid,
            thumbnailUrl: v.thumbnail_url || '',
            thumbnailHash: v.thumbnail_hash || ''
        });
    };

    const pushImage = (im) => {
        if (!im) return;
        const hash = String(im.hash || im.image_hash || '').trim();
        const url = String(im.url || im.picture || '').trim();
        const key = hash ? `ih:${hash}` : (url ? `iu:${url}` : '');
        if (!key || seen.has(key)) return;
        seen.add(key);
        entries.push({
            kind: 'image',
            imageHash: hash,
            imageUrl: url
        });
    };

    const afs = cr.asset_feed_spec || {};
    (Array.isArray(afs.videos) ? afs.videos : []).forEach(pushVideo);
    (Array.isArray(afs.images) ? afs.images : []).forEach(pushImage);
    (Array.isArray(afs.groups) ? afs.groups : []).forEach(grp => {
        (Array.isArray(grp?.videos) ? grp.videos : []).forEach(pushVideo);
        (Array.isArray(grp?.images) ? grp.images : []).forEach(pushImage);
    });

    const cags = cr.creative_asset_groups_spec || {};
    (Array.isArray(cags.groups) ? cags.groups : []).forEach(grp => {
        (Array.isArray(grp?.videos) ? grp.videos : []).forEach(pushVideo);
        (Array.isArray(grp?.images) ? grp.images : []).forEach(pushImage);
    });

    const childAttachments = cr.object_story_spec?.link_data?.child_attachments;
    if (entries.length <= 1 && Array.isArray(childAttachments) && childAttachments.length > 1) {
        childAttachments.forEach(att => {
            if (att?.video_id) {
                pushVideo({ video_id: att.video_id, thumbnail_url: att.picture || '', thumbnail_hash: att.image_hash || '' });
            } else if (att?.image_hash || att?.picture) {
                pushImage({ hash: att.image_hash || '', url: att.picture || '' });
            }
        });
    }

    return entries;
}

function extractAnyCreativeMediaEntries(cr = {}) {
    const multi = extractCreativeMediaEntries(cr);
    if (multi.length > 0) return multi;

    const entries = [];
    const oss = cr.object_story_spec || {};
    const vd = oss.video_data || {};
    const ld = oss.link_data || {};
    const pd = oss.photo_data || {};

    const singleVideoId = vd.video_id || cr.video_id || '';
    if (singleVideoId) {
        entries.push({
            kind: 'video',
            videoId: String(singleVideoId),
            thumbnailUrl: vd.image_url || cr.image_url || cr.thumbnail_url || '',
            thumbnailHash: vd.image_hash || ''
        });
        return entries;
    }

    const childAttachments = Array.isArray(ld.child_attachments)
        ? ld.child_attachments
        : (Array.isArray(oss.template_data?.child_attachments) ? oss.template_data.child_attachments : []);
    if (childAttachments.length === 1) {
        const ch = childAttachments[0];
        if (ch?.video_id) {
            entries.push({
                kind: 'video',
                videoId: String(ch.video_id),
                thumbnailUrl: ch.picture || cr.thumbnail_url || '',
                thumbnailHash: ch.image_hash || ''
            });
            return entries;
        }
        if (ch?.image_hash || ch?.picture) {
            entries.push({
                kind: 'image',
                imageHash: ch.image_hash ? String(ch.image_hash) : '',
                imageUrl: ch.picture ? String(ch.picture) : ''
            });
            return entries;
        }
    }

    const singleImgHash = ld.image_hash || pd.image_hash || cr.image_hash || '';
    const singleImgUrl = ld.picture || pd.url || cr.image_url || '';
    if (singleImgHash || singleImgUrl) {
        entries.push({
            kind: 'image',
            imageHash: singleImgHash ? String(singleImgHash) : '',
            imageUrl: singleImgUrl ? String(singleImgUrl) : (cr.thumbnail_url ? String(cr.thumbnail_url) : '')
        });
    }

    return entries;
}

async function fetchAdCreativeFullFields(creativeId) {
    if (!creativeId) return null;
    const baseFields = 'id,name,actor_id,object_type,effective_object_story_id,object_story_id,thumbnail_url,image_url,image_hash,video_id,title,body,link_url,call_to_action_type,object_story_spec,asset_feed_spec';
    const minFields = 'id,name,actor_id,object_type,effective_object_story_id,thumbnail_url,image_url,image_hash,video_id,title,body,link_url,call_to_action_type,object_story_spec';
    const tiers = [
        `${baseFields},creative_asset_groups_spec`,
        baseFields,
        minFields,
        'id,name,actor_id,object_type,effective_object_story_id,thumbnail_url,image_url,video_id,object_story_spec'
    ];

    let lastRes = null;
    for (let i = 0; i < tiers.length; i++) {
        try {
            const res = await metaGraphGet(`/${META_GRAPH_VERSION}/${creativeId}?fields=${tiers[i]}`);
            lastRes = res;
            if (res && !res.error) return res;
            const errMsg = res?.error?.message || '';
            const isFieldErr = /creative_asset_groups_spec|asset_feed_spec|object_story_id|image_hash|call_to_action_type|link_url|title|body|nonexisting field|\(#100\)/i.test(errMsg) || res?.error?.code === 100;
            if (!isFieldErr) return res;
        } catch (e) {
            const isFieldErr = /creative_asset_groups_spec|asset_feed_spec|object_story_id|image_hash|call_to_action_type|link_url|title|body|nonexisting field|\(#100\)/i.test(e.message || '');
            if (!isFieldErr || i === tiers.length - 1) throw e;
        }
    }
    return lastRes;
}

async function hydrateAdSetAdsWithCreatives(adsetId) {
    const baseCrFields = 'id,name,actor_id,object_type,effective_object_story_id,object_story_id,thumbnail_url,image_url,image_hash,video_id,title,body,link_url,call_to_action_type,object_story_spec,asset_feed_spec';
    const minCrFields = 'id,name,actor_id,object_type,effective_object_story_id,thumbnail_url,image_url,video_id,object_story_spec';
    const fieldTiers = [
        `id,name,status,url_tags,creative{${baseCrFields},creative_asset_groups_spec}`,
        `id,name,status,url_tags,creative{${baseCrFields}}`,
        `id,name,status,url_tags,creative{${minCrFields}}`,
        `id,name,status,url_tags,creative{id}`
    ];

    let adsData = null;
    for (let i = 0; i < fieldTiers.length; i++) {
        try {
            const res = await metaGraphGet(`/${META_GRAPH_VERSION}/${adsetId}/ads?fields=${fieldTiers[i]}&limit=50`);
            adsData = res;
            if (res && !res.error) break;
            const errMsg = res?.error?.message || '';
            const isFieldErr = /creative_asset_groups_spec|asset_feed_spec|object_story_id|image_hash|call_to_action_type|link_url|title|body|nonexisting field|\(#100\)/i.test(errMsg) || res?.error?.code === 100;
            if (!isFieldErr) break;
        } catch (e) {
            const isFieldErr = /creative_asset_groups_spec|asset_feed_spec|object_story_id|image_hash|call_to_action_type|link_url|title|body|nonexisting field|\(#100\)/i.test(e.message || '');
            if (!isFieldErr || i === fieldTiers.length - 1) throw e;
        }
    }

    if (adsData?.error) {
        throw new Error(formatMetaApiError(adsData.error));
    }

    const ads = Array.isArray(adsData?.data) ? adsData.data : [];
    await Promise.all(ads.map(async ad => {
        const cr = ad.creative || {};
        if (!cr.id) return;
        const alreadyMulti = extractCreativeMediaEntries(cr).length > 1;
        if (alreadyMulti && cr.creative_asset_groups_spec) return;
        try {
            const fullCr = await fetchAdCreativeFullFields(cr.id);
            if (fullCr && fullCr.id) {
                ad.creative = { ...cr, ...fullCr };
            }
        } catch (e) {
            console.warn(`Não foi possível hidratar creative ${cr.id}:`, e);
        }
    }));

    return ads;
}

async function resolveMetaImageHashMap(accountId, hashes = [], cacheMap = null) {
    const out = {};
    const pending = [];
    Array.from(new Set(hashes.filter(Boolean))).forEach(h => {
        const ck = `img:${h}`;
        if (cacheMap && cacheMap[ck]) {
            out[h] = cacheMap[ck];
        } else {
            pending.push(h);
        }
    });
    if (!accountId || pending.length === 0) return out;
    try {
        const q = encodeURIComponent(JSON.stringify(pending.slice(0, 50)));
        const res = await metaGraphGet(`/${META_GRAPH_VERSION}/${accountId}/adimages?hashes=${q}&fields=hash,url,url_128,permalink_url`);
        (Array.isArray(res?.data) ? res.data : []).forEach(item => {
            const u = item.url || item.url_128 || item.permalink_url || '';
            if (item.hash && u) {
                out[item.hash] = u;
                if (cacheMap) cacheMap[`img:${item.hash}`] = u;
            }
        });
    } catch (e) {
        console.warn('Não foi possível resolver adimages por hash:', e);
    }
    return out;
}

// Carrega as miniaturas em alta resolução dos anúncios do Facebook para o conjunto base
function extractCreativeTemplateSpec(cr = {}, fallbackActorId = '') {
    const oss = cr.object_story_spec || {};
    const afs = cr.asset_feed_spec || {};
    const cags = cr.creative_asset_groups_spec || {};
    const cagGroups = [
        ...(Array.isArray(cags.groups) ? cags.groups : []),
        ...(Array.isArray(afs.groups) ? afs.groups : [])
    ];
    const vd = oss.video_data || {};
    const ld = oss.link_data || {};

    const firstGrpCta = cagGroups.map(g => g?.call_to_action).find(Boolean) || null;
    const firstGrpCtaType = cagGroups.flatMap(g => g?.call_to_action_types || []).find(Boolean) || '';
    const firstGrpLinkObj = cagGroups.flatMap(g => g?.link_urls || []).find(Boolean) || null;

    const afsCtaType = Array.isArray(afs.call_to_action_types) ? afs.call_to_action_types[0] : '';
    const afsLinkObj = Array.isArray(afs.link_urls) ? afs.link_urls[0] : null;
    const ctaObj = vd.call_to_action || ld.call_to_action || firstGrpCta || { type: afsCtaType || firstGrpCtaType || cr.call_to_action_type || 'DOWNLOAD', value: { link: cr.link_url || '' } };
    const rawLink = ctaObj.value?.link || ld.link || cr.link_url || afsLinkObj?.website_url || afsLinkObj?.display_url || firstGrpLinkObj?.website_url || firstGrpLinkObj?.display_url || '';

    const rawBodies = [];
    const rawTitles = [];
    const rawDescs = [];
    const pushUnique = (arr, txt) => {
        const t = String(txt || '').trim();
        if (t && !arr.includes(t)) arr.push(t);
    };

    (afs.bodies || []).forEach(b => pushUnique(rawBodies, b?.text));
    (afs.titles || []).forEach(t => pushUnique(rawTitles, t?.text));
    (afs.descriptions || []).forEach(d => pushUnique(rawDescs, d?.text));

    cagGroups.forEach(grp => {
        (grp?.bodies || []).forEach(b => pushUnique(rawBodies, b?.text));
        (grp?.titles || []).forEach(t => pushUnique(rawTitles, t?.text));
        (grp?.descriptions || []).forEach(d => pushUnique(rawDescs, d?.text));
        (grp?.texts || []).forEach(tx => {
            const kind = String(tx?.text_type || tx?.type || '').toLowerCase();
            if (kind.includes('head') || kind.includes('title')) pushUnique(rawTitles, tx?.text);
            else if (kind.includes('desc')) pushUnique(rawDescs, tx?.text);
            else pushUnique(rawBodies, tx?.text);
        });
    });

    const storyPageId = cr.effective_object_story_id ? String(cr.effective_object_story_id).split('_')[0] : '';
    const fallbackPageId = (typeof metaState !== 'undefined' && Array.isArray(metaState.pages) && metaState.pages[0]?.id) || '';

    return {
        pageId: oss.page_id || cr.actor_id || fallbackActorId || storyPageId || fallbackPageId || '',
        instagramUserId: oss.instagram_user_id || '',
        ctaType: ctaObj.type || cr.call_to_action_type || afsCtaType || firstGrpCtaType || 'DOWNLOAD',
        rawLink,
        rawBodies,
        rawTitles,
        rawDescs,
        rawVdMsg: vd.message || ld.message || cr.body || '',
        rawVdTitle: vd.title || ld.name || cr.title || '',
        rawVdDesc: vd.link_description || ld.description || '',
        hasAfs: rawBodies.length > 0 || rawTitles.length > 0 || rawDescs.length > 0,
        optimizationType: 'DEGREES_OF_FREEDOM',
        afsVideos: Array.isArray(afs.videos) ? afs.videos : [],
        afsImages: Array.isArray(afs.images) ? afs.images : [],
        mediaEntries: extractCreativeMediaEntries(cr),
        allMediaEntries: extractAnyCreativeMediaEntries(cr)
    };
}

async function resolveMetaVideoThumbUrl(videoId, initialThumb = '', cacheMap = null) {
    if (!videoId) return initialThumb || '';
    const cacheKey = `vthumb:${videoId}`;
    if (cacheMap && cacheMap[cacheKey]) return cacheMap[cacheKey];
    if (initialThumb && !initialThumb.includes('p64x64')) {
        if (cacheMap) cacheMap[cacheKey] = initialThumb;
        return initialThumb;
    }
    try {
        const stData = await metaGraphGet(`/${META_GRAPH_VERSION}/${videoId}?fields=picture,thumbnails`);
        const thumbUri = stData.thumbnails?.data?.[0]?.uri || stData.picture || initialThumb || '';
        if (thumbUri && cacheMap) cacheMap[cacheKey] = thumbUri;
        return thumbUri;
    } catch (e) {
        return initialThumb || '';
    }
}

async function createSingleMediaAdCreative({ accountId, name, spec, mediaAsset, textsObj, linkUrl, logFn = null }) {
    const postCreative = (pObj) => metaGraphPost(`/${META_GRAPH_VERSION}/${accountId}/adcreatives`, pObj);
    const cleanLink = linkUrl || spec.rawLink || '';
    const hasMultiAfs = Boolean(
        textsObj.hasAfs
        && ((textsObj.tBodies || []).length > 0 || (textsObj.tTitles || []).length > 0 || (textsObj.tDescs || []).length > 0)
    );

    const buildCtaObj = () => {
        if (!cleanLink && (!spec.ctaType || spec.ctaType === 'DOWNLOAD' || spec.ctaType === 'LEARN_MORE')) {
            return null;
        }
        const cta = { type: spec.ctaType || 'DOWNLOAD' };
        if (cleanLink) cta.value = { link: cleanLink };
        return cta;
    };

    const buildPayload = (useAfsMode) => {
        const oss = { page_id: spec.pageId };
        if (spec.instagramUserId) oss.instagram_user_id = spec.instagramUserId;

        if (mediaAsset.kind === 'video') {
            const ctaBuilt = buildCtaObj();
            const videoData = {
                video_id: mediaAsset.videoId
            };
            if (ctaBuilt) videoData.call_to_action = ctaBuilt;
            if (mediaAsset.thumbnailUrl) {
                videoData.image_url = mediaAsset.thumbnailUrl;
            } else if (mediaAsset.thumbnailHash) {
                videoData.image_hash = mediaAsset.thumbnailHash;
            }
            if (!useAfsMode) {
                const msg = (textsObj.tBodies && textsObj.tBodies[0]) || textsObj.tVdMsg || '';
                const ttl = (textsObj.tTitles && textsObj.tTitles[0]) || textsObj.tVdTitle || '';
                const dsc = (textsObj.tDescs && textsObj.tDescs[0]) || textsObj.tVdDesc || '';
                if (msg) videoData.message = msg;
                if (ttl) videoData.title = ttl;
                if (dsc) videoData.link_description = dsc;
            }
            oss.video_data = videoData;
        } else {
            const ctaBuilt = buildCtaObj();
            const linkData = {};
            if (ctaBuilt) linkData.call_to_action = ctaBuilt;
            if (cleanLink) linkData.link = cleanLink;
            if (mediaAsset.imageHash) linkData.image_hash = mediaAsset.imageHash;
            else if (mediaAsset.imageUrl) linkData.picture = mediaAsset.imageUrl;
            if (!useAfsMode) {
                const msg = (textsObj.tBodies && textsObj.tBodies[0]) || textsObj.tVdMsg || '';
                const ttl = (textsObj.tTitles && textsObj.tTitles[0]) || textsObj.tVdTitle || '';
                const dsc = (textsObj.tDescs && textsObj.tDescs[0]) || textsObj.tVdDesc || '';
                if (msg) linkData.message = msg;
                if (ttl) linkData.name = ttl;
                if (dsc) linkData.description = dsc;
            }
            oss.link_data = linkData;
        }

        const payload = {
            name,
            object_story_spec: oss
        };
        if (useAfsMode) {
            const afsOut = {
                optimization_type: 'DEGREES_OF_FREEDOM'
            };
            if ((textsObj.tBodies || []).length > 0) afsOut.bodies = textsObj.tBodies.map(text => ({ text }));
            if ((textsObj.tTitles || []).length > 0) afsOut.titles = textsObj.tTitles.map(text => ({ text }));
            if ((textsObj.tDescs || []).length > 0) afsOut.descriptions = textsObj.tDescs.map(text => ({ text }));
            payload.asset_feed_spec = afsOut;
            payload.degrees_of_freedom_spec = {
                creative_features_spec: {
                    standard_enhancements: { enroll_status: 'OPT_OUT' }
                }
            };
        }
        return payload;
    };

    const postWithFieldFallbacks = async (payload) => {
        let res = await postCreative(payload);
        if (res.error && /degrees_of_freedom_spec|standard_enhancements/i.test(res.error.message || '')) {
            delete payload.degrees_of_freedom_spec;
            res = await postCreative(payload);
        }
        if (res.error && /instagram_user_id/i.test(res.error.message || '')) {
            delete payload.object_story_spec.instagram_user_id;
            res = await postCreative(payload);
        }
        if (res.error && payload.object_story_spec?.video_data?.image_url && /image_url|thumbnail|picture|download image/i.test(res.error.message || '')) {
            delete payload.object_story_spec.video_data.image_url;
            res = await postCreative(payload);
        }
        return res;
    };

    let creativePayload = buildPayload(hasMultiAfs);
    let crRes = await postWithFieldFallbacks(creativePayload);

    if (crRes.error && hasMultiAfs && crRes.error.error_subcode !== 1885183) {
        if (typeof logFn === 'function') {
            logFn(`ℹ️ Conta não aceitou asset_feed_spec múltiplo em '${name}', aplicando texto principal único como fallback...`, 'warn');
        }
        creativePayload = buildPayload(false);
        crRes = await postWithFieldFallbacks(creativePayload);
    }

    return crRes;
}

async function createSingleMediaCreativeWithPageFallback({
    accountId,
    name,
    spec,
    mediaAsset,
    textsObj,
    linkUrl,
    candidatePages = [],
    allowFallback = true,
    blockedPageIds = new Set(),
    activeWorkingPageId = '',
    logFn = null
}) {
    const queue = [];
    const queuedIds = new Set();
    const enqueuePage = (id, label = '') => {
        const sId = String(id || '').trim();
        if (!sId || queuedIds.has(sId) || blockedPageIds.has(sId)) return;
        queuedIds.add(sId);
        queue.push({ id: sId, label: label || sId });
    };

    if (activeWorkingPageId) {
        enqueuePage(activeWorkingPageId);
    } else if (spec.pageId) {
        enqueuePage(spec.pageId);
    }

    if (allowFallback && Array.isArray(candidatePages)) {
        candidatePages.forEach(p => enqueuePage(p.id, p.name ? `${p.name} (${p.id})` : p.id));
    }

    if (queue.length === 0 && spec.pageId) {
        enqueuePage(spec.pageId);
    }

    let lastRes = { error: { message: 'Nenhuma Página autorizada disponível na conta.' } };
    for (let i = 0; i < queue.length; i++) {
        const cand = queue[i];
        const useOriginalIg = (!activeWorkingPageId && String(cand.id) === String(spec.pageId || '')) ? (spec.instagramUserId || '') : '';
        const attemptSpec = {
            ...spec,
            pageId: cand.id,
            instagramUserId: useOriginalIg
        };

        if (i > 0 && typeof logFn === 'function') {
            logFn(`🔄 Página anterior sem permissão. Testando Página autorizada ${cand.label}...`, 'warn');
        }

        const res = await createSingleMediaAdCreative({
            accountId,
            name,
            spec: attemptSpec,
            mediaAsset,
            textsObj,
            linkUrl,
            logFn
        });
        lastRes = res;

        if (res && res.id) {
            return { ...res, usedPageId: cand.id, switchedPage: String(cand.id) !== String(spec.pageId || '') };
        }
        if (res?.error?.error_subcode === 1885183) {
            return { ...res, usedPageId: cand.id };
        }
        if (isMetaPagePermissionError(res?.error)) {
            blockedPageIds.add(String(cand.id));
            if (!allowFallback) return { ...res, usedPageId: cand.id };
            continue;
        }
        return { ...res, usedPageId: cand.id };
    }
    return lastRes;
}

async function hydrateCreativeFromEffectiveStory(cr = {}, spec = {}, currentMedia = []) {
    const outSpec = { ...spec };
    const mediaList = Array.isArray(currentMedia) ? [...currentMedia] : [];
    const storyId = cr.effective_object_story_id || cr.object_story_id || '';
    if (!storyId || (mediaList.length > 0 && outSpec.rawLink && (outSpec.rawVdMsg || (outSpec.rawBodies || []).length > 0))) {
        return { spec: outSpec, mediaList };
    }

    try {
        const post = await metaGraphGet(`/${META_GRAPH_VERSION}/${storyId}?fields=message,call_to_action,attachments{type,media,target{id},url,unshimmed_url,title,description}`);
        if (post && !post.error) {
            if (!outSpec.rawVdMsg && post.message) outSpec.rawVdMsg = String(post.message);
            if (post.call_to_action?.type && (!outSpec.ctaType || outSpec.ctaType === 'DOWNLOAD')) {
                outSpec.ctaType = post.call_to_action.type;
            }
            if (!outSpec.rawLink && post.call_to_action?.value?.link) {
                outSpec.rawLink = post.call_to_action.value.link;
            }
            const att = Array.isArray(post.attachments?.data) ? post.attachments.data[0] : null;
            if (att) {
                if (!outSpec.rawLink) outSpec.rawLink = att.unshimmed_url || att.url || '';
                if (!outSpec.rawVdTitle && att.title) outSpec.rawVdTitle = String(att.title);
                if (!outSpec.rawVdDesc && att.description) outSpec.rawVdDesc = String(att.description);
                if (mediaList.length === 0) {
                    const isVideo = /video/i.test(att.type || '') || Boolean(att.target?.id && att.media?.source);
                    if (isVideo && att.target?.id) {
                        mediaList.push({
                            kind: 'video',
                            videoId: String(att.target.id),
                            thumbnailUrl: att.media?.image?.src || cr.thumbnail_url || '',
                            thumbnailHash: ''
                        });
                    } else if (att.media?.image?.src) {
                        mediaList.push({
                            kind: 'image',
                            imageHash: '',
                            imageUrl: String(att.media.image.src)
                        });
                    }
                }
            }
        }
    } catch (e) {
        console.warn(`Não foi possível consultar effective_object_story_id ${storyId}:`, e);
    }

    return { spec: outSpec, mediaList };
}

async function rescueBaseAdWithPage({
    adObj,
    targetPageId,
    accountId,
    nicheSlug = '',
    baseLang = 'es',
    token = '',
    campaignId = '',
    currentAdsetId = '',
    videoUploadCache = {},
    resolvedImgMap = {},
    logFn = null
}) {
    const cr = adObj?.creative || {};
    let spec = extractCreativeTemplateSpec(cr, cr.actor_id || '');
    let mediaList = Array.isArray(spec.allMediaEntries) ? [...spec.allMediaEntries] : extractAnyCreativeMediaEntries(cr);

    // 1. Suporte direto a Carrossel (child_attachments > 1)
    const rawCarousel = cr.object_story_spec?.link_data || cr.object_story_spec?.template_data || null;
    if (rawCarousel && Array.isArray(rawCarousel.child_attachments) && rawCarousel.child_attachments.length > 1) {
        const clonedCarousel = JSON.parse(JSON.stringify(rawCarousel));
        const res = await metaGraphPost(`/${META_GRAPH_VERSION}/${accountId}/adcreatives`, {
            name: `${adObj.name || nicheSlug || 'Carousel'} - Page ${targetPageId}`,
            object_story_spec: {
                page_id: String(targetPageId),
                link_data: clonedCarousel
            }
        });
        if (res && res.id) {
            return {
                creativeId: res.id,
                adName: adObj.name || '',
                urlTags: adObj.url_tags || '',
                pageId: String(targetPageId)
            };
        }
        return {
            error: res?.error || { message: 'Falha ao clonar carrossel na nova Página.' },
            isPagePerm: isMetaPagePermissionError(res?.error),
            isDevMode: res?.error?.error_subcode === 1885183
        };
    }

    // 2. Se Meta ocultou mídia ou URL por permissão da Página, tenta hidratar via post original
    const enriched = await hydrateCreativeFromEffectiveStory(cr, spec, mediaList);
    spec = enriched.spec;
    mediaList = enriched.mediaList;

    // 3. Se ainda faltar link de destino, consulta 1 conjunto irmão na campanha como resgate
    if (!spec.rawLink && Array.isArray(metaState.adsets)) {
        const sibling = metaState.adsets.find(a => String(a.id) !== String(currentAdsetId));
        if (sibling) {
            try {
                const sibAds = await hydrateAdSetAdsWithCreatives(sibling.id);
                for (const sAd of sibAds) {
                    const sSpec = extractCreativeTemplateSpec(sAd.creative || {}, sAd.creative?.actor_id || '');
                    if (sSpec.rawLink) {
                        spec.rawLink = sSpec.rawLink;
                        if (!spec.rawVdMsg && sSpec.rawVdMsg) spec.rawVdMsg = sSpec.rawVdMsg;
                        if (!spec.rawVdTitle && sSpec.rawVdTitle) spec.rawVdTitle = sSpec.rawVdTitle;
                        if (!spec.rawVdDesc && sSpec.rawVdDesc) spec.rawVdDesc = sSpec.rawVdDesc;
                        if ((!spec.rawBodies || spec.rawBodies.length === 0) && sSpec.rawBodies?.length) spec.rawBodies = sSpec.rawBodies;
                        if ((!spec.rawTitles || spec.rawTitles.length === 0) && sSpec.rawTitles?.length) spec.rawTitles = sSpec.rawTitles;
                        if ((!spec.rawDescs || spec.rawDescs.length === 0) && sSpec.rawDescs?.length) spec.rawDescs = sSpec.rawDescs;
                        if (sSpec.hasAfs) spec.hasAfs = true;
                        break;
                    }
                }
            } catch (_) { /* best effort */ }
        }
    }

    // 4. Se ainda não há mídia, tenta pacote OneDrive no idioma base ou thumbnail
    if (mediaList.length === 0 && campaignId && campaignCreativesMap[campaignId]) {
        try {
            let pack = getCachedLinkedPackObj(campaignId);
            if (!pack) {
                pack = await Promise.race([
                    ensureLinkedPackHydrated(campaignId, false),
                    new Promise(resolve => setTimeout(() => resolve(null), 9000))
                ]);
            }
            const packRes = pack ? getVideosForPackLang(pack, baseLang) : { slots: [] };
            if (Array.isArray(packRes.slots) && packRes.slots.length > 0) {
                const firstVideo = packRes.slots[0].video;
                if (typeof logFn === 'function') {
                    logFn(`☁️ Mídia oculta na Meta — subindo vídeo base (${baseLang.toUpperCase()} / ${firstVideo.name}) do OneDrive...`, 'info');
                }
                const upRes = await uploadOneDriveVideoToMeta(accountId, firstVideo, token, videoUploadCache);
                if (upRes?.video_id) {
                    mediaList.push({
                        kind: 'video',
                        videoId: upRes.video_id,
                        thumbnailUrl: upRes.thumbnail_url || cr.thumbnail_url || ''
                    });
                }
            }
        } catch (e) {
            console.warn('Fallback OneDrive no idioma base falhou:', e);
        }
    }

    if (mediaList.length === 0 && (cr.image_url || cr.thumbnail_url)) {
        mediaList.push({
            kind: 'image',
            imageHash: cr.image_hash || '',
            imageUrl: cr.image_url || cr.thumbnail_url || ''
        });
    }

    if (mediaList.length === 0) {
        return {
            error: { message: `Não foi possível extrair vídeo ou imagem de '${adObj?.name || 'Anúncio'}' para recriar na Página ${targetPageId}.` },
            isAssetError: true
        };
    }

    const chosenAsset = { ...mediaList[0] };
    if (chosenAsset.kind === 'video' && !chosenAsset.thumbnailUrl && !chosenAsset.thumbnailHash) {
        chosenAsset.thumbnailUrl = await resolveMetaVideoThumbUrl(chosenAsset.videoId, cr.thumbnail_url || '', videoUploadCache);
    } else if (chosenAsset.kind === 'image' && chosenAsset.imageHash && !chosenAsset.imageUrl) {
        if (!resolvedImgMap[chosenAsset.imageHash]) {
            const fetchedMap = await resolveMetaImageHashMap(accountId, [chosenAsset.imageHash], videoUploadCache);
            Object.assign(resolvedImgMap, fetchedMap);
        }
        chosenAsset.imageUrl = resolvedImgMap[chosenAsset.imageHash] || cr.thumbnail_url || '';
    }

    const textsObj = {
        hasAfs: spec.hasAfs,
        tBodies: spec.rawBodies || [],
        tTitles: spec.rawTitles || [],
        tDescs: spec.rawDescs || [],
        tVdMsg: spec.rawVdMsg || '',
        tVdTitle: spec.rawVdTitle || '',
        tVdDesc: spec.rawVdDesc || ''
    };

    const res = await createSingleMediaAdCreative({
        accountId,
        name: `${adObj?.name || nicheSlug || 'Ad'} - Page ${targetPageId}`,
        spec: {
            ...spec,
            pageId: String(targetPageId),
            instagramUserId: '' // Nunca herdar IG de Página diferente
        },
        mediaAsset: chosenAsset,
        textsObj,
        linkUrl: spec.rawLink || cr.link_url || '',
        logFn
    });

    if (res && res.id) {
        return {
            creativeId: res.id,
            adName: adObj?.name || '',
            urlTags: adObj?.url_tags || '',
            pageId: String(targetPageId)
        };
    }

    return {
        error: res?.error || { message: 'Falha ao recriar AdCreative na nova Página.' },
        isPagePerm: isMetaPagePermissionError(res?.error),
        isDevMode: res?.error?.error_subcode === 1885183
    };
}

async function loadBaseAdSetMetaThumbnails(adsetId) {
    const thumbsRow = document.getElementById('fb-ads-thumbs-row');
    const statusEl = document.getElementById('fb-ads-thumb-status');
    const countBadge = document.getElementById('badge-fb-ads-count');

    if (!thumbsRow) return;

    thumbsRow.innerHTML = '<div class="text-muted" style="font-size:12px; padding:10px;">⏳ Buscando criativos no Facebook Ads...</div>';
    if (statusEl) statusEl.innerText = 'Consultando Meta Marketing API...';
    if (countBadge) countBadge.innerText = 'Carregando...';

    const currentSeq = ++_metaThumbReqSeq;
    metaBaseAdsCache = [];

    try {
        const hydratedAds = await hydrateAdSetAdsWithCreatives(adsetId);

        if (currentSeq !== _metaThumbReqSeq) return;

        if (hydratedAds.length > 0) {
            const previewItems = [];
            let hasFlexibleExpansion = false;
            const thumbCache = {};

            // Pré-resolve hashes de imagens presentes em anúncios flexíveis
            const allImageHashes = [];
            hydratedAds.forEach(ad => {
                extractCreativeMediaEntries(ad.creative || {}).forEach(m => {
                    if (m.kind === 'image' && m.imageHash && !m.imageUrl) {
                        allImageHashes.push(m.imageHash);
                    }
                });
            });
            const resolvedImgMap = await resolveMetaImageHashMap(metaState.selectedAccountId, allImageHashes, thumbCache);
            if (currentSeq !== _metaThumbReqSeq) return;

            await Promise.all(hydratedAds.map(async ad => {
                const cr = ad.creative || {};
                const mediaEntries = extractCreativeMediaEntries(cr);
                const isActive = ad.status === 'ACTIVE';

                if (mediaEntries.length > 1) {
                    hasFlexibleExpansion = true;
                    const resolvedList = await Promise.all(mediaEntries.map(async (m, mIdx) => {
                        let thumbUrl = '';
                        if (m.kind === 'video') {
                            thumbUrl = await resolveMetaVideoThumbUrl(m.videoId, m.thumbnailUrl || '', thumbCache);
                        } else {
                            thumbUrl = m.imageUrl || (m.imageHash ? resolvedImgMap[m.imageHash] : '') || cr.thumbnail_url || '';
                        }
                        return {
                            adId: ad.id,
                            creativeId: cr.id || '-',
                            title: `${String(mIdx + 1).padStart(2, '0')} (Flexível)`,
                            thumbUrl,
                            isActive
                        };
                    }));
                    ad._resolvedThumb = resolvedList[0]?.thumbUrl || '';
                    resolvedList.forEach(item => previewItems.push(item));
                    return;
                }

                let bestThumb = cr.image_url || cr.object_story_spec?.video_data?.image_url || cr.thumbnail_url || '';
                if ((!bestThumb || bestThumb.includes('p64x64')) && cr.id) {
                    try {
                        const d320 = await metaGraphGet(`/${META_GRAPH_VERSION}/${cr.id}?fields=id,thumbnail_url&thumbnail_width=320&thumbnail_height=320`);
                        if (d320.thumbnail_url) bestThumb = d320.thumbnail_url;
                    } catch (e) {}
                }
                ad._resolvedThumb = bestThumb;
                previewItems.push({
                    adId: ad.id,
                    creativeId: cr.id || '-',
                    title: ad.name || `0${previewItems.length + 1}`,
                    thumbUrl: bestThumb,
                    isActive
                });
            }));

            if (currentSeq !== _metaThumbReqSeq) return;
            metaBaseAdsCache = hydratedAds;
            thumbsRow.innerHTML = '';

            previewItems.forEach((item) => {
                const card = document.createElement('div');
                card.className = 'creative-thumb-card';
                card.title = `Clique para ampliar • Anúncio: ${item.title} (ID: ${item.adId})`;

                if (item.thumbUrl) {
                    const img = document.createElement('img');
                    img.src = item.thumbUrl;
                    img.className = 'creative-thumb-preview zoomable';
                    img.alt = item.title;
                    img.loading = 'lazy';
                    img.addEventListener('click', () => openThumbZoomModal(item.thumbUrl, `Facebook Ads: ${item.title}`, `Creative ID: ${item.creativeId}`));
                    card.appendChild(img);
                } else {
                    const placeholder = document.createElement('div');
                    placeholder.className = 'creative-thumb-preview';
                    placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;color:#64748b;font-size:20px;';
                    placeholder.innerText = '🎬';
                    card.appendChild(placeholder);
                }

                const titleDiv = document.createElement('div');
                titleDiv.className = 'creative-thumb-title';
                titleDiv.innerText = item.title;
                card.appendChild(titleDiv);

                const statusSpan = document.createElement('span');
                statusSpan.className = 'creative-thumb-badge';
                statusSpan.style.cssText = `background:${item.isActive ? '#10b98120' : '#f59e0b20'};color:${item.isActive ? '#34d399' : '#fbbf24'};border:1px solid ${item.isActive ? '#10b98140' : '#f59e0b40'};`;
                statusSpan.innerText = item.isActive ? '🟢 Ativo' : '⏸️ Pausado';
                card.appendChild(statusSpan);

                thumbsRow.appendChild(card);
            });

            if (countBadge) {
                countBadge.innerText = hasFlexibleExpansion
                    ? `${hydratedAds.length} anúncio (${previewItems.length} criativos)`
                    : `${hydratedAds.length} anúncio(s)`;
            }
            if (statusEl) {
                statusEl.innerText = hasFlexibleExpansion
                    ? `Pronto: ${previewItems.length} criativos no anúncio flexível (serão publicados ${previewItems.length} anúncios individuais)`
                    : `Pronto: ${previewItems.length} criativo(s) em alta resolução carregados`;
            }
        } else {
            thumbsRow.innerHTML = '<div class="text-muted" style="font-size:12px; padding:8px;">Nenhum anúncio encontrado neste conjunto base.</div>';
            if (countBadge) countBadge.innerText = '0 anúncios';
            if (statusEl) statusEl.innerText = 'Conjunto sem anúncios';
        }
    } catch (e) {
        if (currentSeq !== _metaThumbReqSeq) return;
        console.warn('Erro ao buscar miniaturas do Facebook:', e);
        thumbsRow.innerHTML = `<div class="text-muted" style="font-size:12px; padding:8px;">⚠️ Não foi possível carregar miniaturas: ${escHtml(e.message)}</div>`;
        if (countBadge) countBadge.innerText = 'Erro';
        if (statusEl) statusEl.innerText = 'Falha ao consultar API';
    }
}

// Renderiza o badge e status do vínculo com o pacote do OneDrive
function renderCampaignCreativeLinkBadge() {
    const badge = document.getElementById('campaign-creative-badge');
    const summary = document.getElementById('campaign-creative-summary');
    const actionsBox = document.getElementById('campaign-link-actions');
    const candidateContainer = document.getElementById('onedrive-candidate-packs-container');

    const campaignId = metaState.selectedCampaignId;
    if (!badge) return;

    if (!campaignId) {
        badge.innerText = 'Nenhuma campanha';
        badge.style.background = 'rgba(255,255,255,0.05)';
        badge.style.color = '#94a3b8';
        badge.style.borderColor = 'rgba(255,255,255,0.1)';
        if (summary) summary.innerText = 'Selecione uma campanha acima para visualizar ou definir o vínculo de criativos.';
        if (candidateContainer) candidateContainer.classList.add('twod-hidden');
        return;
    }

    const link = campaignCreativesMap[campaignId];
    if (link && link.niche_pack) {
        badge.innerText = `✅ Vinculado: ${link.niche_pack}`;
        badge.style.background = 'rgba(16, 185, 129, 0.15)';
        badge.style.color = '#34d399';
        badge.style.borderColor = 'rgba(16, 185, 129, 0.4)';

        const langs = (link.languages || []).map(l => `<span class="lang-pill ready">🟢 ${escHtml(l)}</span>`).join(' ') || '<span class="text-muted">Idiomas detectados automaticamente</span>';
        if (summary) {
            summary.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                    <div>
                        <strong>Pacote de Mídias Vinculado:</strong> <code>${escHtml(link.niche_pack)}</code>
                        <div style="margin-top:4px; display:flex; gap:5px; flex-wrap:wrap; align-items:center;">Idiomas disponíveis no pacote: ${langs}</div>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="unlinkCampaignFromPack('${campaignId}')" style="padding:3px 8px; font-size:11px; color:#ef4444; border-color:#ef444440;">Desvincular ❌</button>
                </div>
            `;
        }

        if (actionsBox) {
            actionsBox.innerHTML = `
                <button type="button" class="btn btn-secondary btn-sm" onclick="loadNicheCandidatePacks(true, false)" style="padding:4px 10px; font-size:11px;">✏️ Trocar Pacote</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="loadNicheCandidatePacks(true, true)" style="padding:4px 10px; font-size:11px;">🔄 Sincronizar OneDrive</button>
            `;
        }
        if (candidateContainer) candidateContainer.classList.add('twod-hidden');

        // Hidrata silenciosamente em segundo plano para ter by_lang e thumbs no Passo 2
        if (!getCachedLinkedPackObj(campaignId)) {
            ensureLinkedPackHydrated(campaignId, false).then(hydrated => {
                if (hydrated && metaState.selectedCampaignId === campaignId) {
                    renderBlockNav();
                    renderCountriesGrid();
                    updateDuplicatorLanguageNotice();
                }
            });
        }
    } else {
        badge.innerText = '🟡 Não vinculado';
        badge.style.background = 'rgba(245, 158, 11, 0.15)';
        badge.style.color = '#fbbf24';
        badge.style.borderColor = 'rgba(245, 158, 11, 0.4)';

        const campObj = (metaState.campaigns || []).find(c => c.id === campaignId);
        const nicheSlug = extractNicheFromCampaign(campObj ? campObj.name : '');

        if (summary) {
            summary.innerHTML = `
                <span>Esta campanha ainda não está vinculada a um pacote de criativos do OneDrive. Nicho detectado: <strong>${escHtml(nicheSlug)}</strong>.</span>
            `;
        }

        if (actionsBox) {
            actionsBox.innerHTML = `
                <button type="button" class="btn btn-secondary btn-sm" onclick="loadNicheCandidatePacks(true, false)" style="padding:4px 10px; font-size:11px;">🔍 Localizar no OneDrive</button>
                <button type="button" class="btn btn-secondary btn-sm" onclick="loadNicheCandidatePacks(true, true)" style="padding:4px 10px; font-size:11px;">🔄 Sincronizar</button>
            `;
        }

        if (metaState.selectedAdSetId) {
            loadNicheCandidatePacks(false, false);
        }
    }
}

// Renderiza as miniaturas de um pacote em um idioma selecionado dentro do card
function renderPackCardThumbs(thumbsWrapEl, pack, selectedLang) {
    if (!thumbsWrapEl) return;
    thumbsWrapEl.innerHTML = '';

    let videos = [];
    if (pack.by_lang && selectedLang && pack.by_lang[selectedLang]) {
        videos = [...(pack.by_lang[selectedLang].feed || []), ...(pack.by_lang[selectedLang].reels || [])];
    } else {
        const all = [...(pack.feed || []), ...(pack.reels || [])];
        videos = selectedLang ? all.filter(v => v.lang === selectedLang) : all;
    }

    if (videos.length === 0) {
        thumbsWrapEl.innerHTML = '<div class="text-muted" style="font-size:11px; padding:8px;">Nenhum .mp4 encontrado neste idioma.</div>';
        return;
    }

    videos.slice(0, 9).forEach(v => {
        const slotWrap = document.createElement('div');
        slotWrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:3px;';

        const thumbPath = v.thumb_url || '';
        const vUrl = v.url || '';
        const rawVidUrl = vUrl.startsWith('http') ? vUrl : `${API_BASE_URL}${vUrl}`;
        const rawThumbUrl = thumbPath ? (thumbPath.startsWith('http') ? thumbPath : `${API_BASE_URL}${thumbPath}`) : '';
        const fullVidUrl = withMediaAuth(rawVidUrl);
        const fullThumbUrl = withMediaAuth(rawThumbUrl);

        if (fullThumbUrl) {
            const img = document.createElement('img');
            img.src = fullThumbUrl;
            img.loading = 'lazy';
            img.className = 'candidate-pack-thumb-item zoomable';
            img.alt = v.name || 'Vídeo';
            img.title = `Clique para ampliar • ${v.name || 'Vídeo'} (${v.lang || selectedLang || ''})`;
            img.addEventListener('error', () => {
                img.style.display = 'none';
            });
            img.addEventListener('click', () => openThumbZoomModal(fullThumbUrl, `${pack.name} (${v.lang || selectedLang || ''})`, v.name || ''));
            slotWrap.appendChild(img);
        } else {
            const vid = document.createElement('video');
            vid.src = `${fullVidUrl}#t=0.5`;
            vid.preload = 'metadata';
            vid.muted = true;
            vid.playsInline = true;
            vid.className = 'candidate-pack-thumb-item';
            vid.title = `${v.name || 'Vídeo'} (${v.lang || ''})`;
            slotWrap.appendChild(vid);
        }

        const labelSpan = document.createElement('span');
        labelSpan.style.cssText = 'font-size:10px; color:#94a3b8;';
        const slotNum = v.num ? String(v.num).padStart(2, '0') : (v.name || '');
        const kindTag = (v.num >= 1 && v.num <= 3) ? 'Feed' : (v.num >= 4 && v.num <= 6 ? 'Reels' : '');
        labelSpan.innerText = kindTag ? `${slotNum} (${kindTag})` : slotNum;
        slotWrap.appendChild(labelSpan);

        thumbsWrapEl.appendChild(slotWrap);
    });
}

// Busca e exibe os pacotes candidatos do nicho no OneDrive com thumbnails por idioma + Bloco A/B
async function loadNicheCandidatePacks(forceOpen = true, forceRefresh = false) {
    const container = document.getElementById('onedrive-candidate-packs-container');
    if (!container) return;

    const campaignId = metaState.selectedCampaignId;
    if (!campaignId) {
        alert('Selecione uma campanha primeiro.');
        return;
    }

    const campObj = (metaState.campaigns || []).find(c => c.id === campaignId);
    const campName = campObj ? campObj.name : '';
    const nicheSlug = extractNicheFromCampaign(campName);

    if (!nicheSlug) {
        container.innerHTML = '<div class="text-muted" style="font-size:12px;">Não foi possível identificar o nicho no nome da campanha.</div>';
        container.classList.remove('twod-hidden');
        return;
    }

    container.classList.remove('twod-hidden');
    container.innerHTML = `<div class="text-muted" style="font-size:12px; padding:8px;">${forceRefresh ? '🔄 Sincronizando pastas e novos idiomas direto do OneDrive...' : '⏳ Buscando pacotes para'} "<strong>${escHtml(nicheSlug)}</strong>"...</div>`;

    let packs = [];
    const normSlug = normalizeText(nicheSlug);
    if (!forceRefresh && Array.isArray(loadedPacksByNicheSlug[normSlug]) && loadedPacksByNicheSlug[normSlug].length > 0) {
        packs = loadedPacksByNicheSlug[normSlug];
    } else {
        try {
            const q = `niche=${encodeURIComponent(nicheSlug)}${forceRefresh ? '&refresh=true' : ''}`;
            const resp = await apiFetch(`/api/onedrive/niche-packs?${q}`);
            const data = await resp.json();
            if (data.success && Array.isArray(data.packs)) {
                packs = data.packs;
                loadedPacksByNicheSlug[normSlug] = packs;
                packs.forEach(p => {
                    loadedNichePacksMap[p.pack_id || p.name] = p;
                    loadedNichePacksMap[p.name] = p;
                });
            }
        } catch (e) {
            console.warn('Erro ao consultar /api/onedrive/niche-packs:', e);
        }
    }

    // Fallback para oneDriveData.niches caso conectado via pasta local no navegador
    if (packs.length === 0 && Array.isArray(oneDriveData.niches)) {
        const localMatches = oneDriveData.niches.filter(n => {
            const nNorm = normalizeText(n.name);
            return nNorm.includes(normSlug) || (nNorm.length >= 4 && normSlug.includes(nNorm));
        });
        localMatches.forEach(lm => {
            const allV = [...(lm.videos?.feed || []), ...(lm.videos?.reels || [])];
            const blocks = {};
            allV.forEach(v => {
                const b = (v.block || '').trim();
                if (!blocks[b]) blocks[b] = [];
                blocks[b].push(v);
            });
            Object.entries(blocks).forEach(([blockName, vList]) => {
                const byLang = {};
                vList.forEach(v => {
                    const l = v.lang || 'Sem Idioma';
                    if (!byLang[l]) byLang[l] = { feed: [], reels: [] };
                    byLang[l][v.num >= 1 && v.num <= 3 ? 'feed' : 'reels'].push(v);
                });
                const langs = Object.keys(byLang);
                const disp = blockName ? `${lm.name} — ${blockName}` : lm.name;
                const pid = blockName ? `${lm.name} :: ${blockName}` : lm.name;
                const pObj = {
                    pack_id: pid,
                    name: disp,
                    folder_name: lm.name,
                    block: blockName,
                    status: lm.status || 'completed',
                    languages: langs,
                    videos_count: vList.length,
                    by_lang: byLang,
                    feed: vList.filter(v => v.num >= 1 && v.num <= 3),
                    reels: vList.filter(v => v.num >= 4 && v.num <= 9),
                    sample_thumbs: vList.slice(0, 6).map(v => v.thumb_url || v.url || '')
                };
                packs.push(pObj);
                loadedNichePacksMap[pid] = pObj;
                loadedNichePacksMap[disp] = pObj;
            });
        });
    }

    if (packs.length === 0) {
        container.innerHTML = `
            <div style="font-size:12px; color:#cbd5e1; padding:10px; background:rgba(255,255,255,0.03); border-radius:6px;">
                🔍 Nenhuma pasta encontrada no OneDrive para o nicho "<strong>${escHtml(nicheSlug)}</strong>".<br>
                <span class="text-muted" style="font-size:11px;">Verifique se a pasta com o nome do nicho e data (ex: <code>${escHtml(nicheSlug)} 04.11.26</code>) está na pasta Vídeos do OneDrive.</span>
            </div>
        `;
        return;
    }

    const currentLink = campaignCreativesMap[campaignId];
    const baseLang = detectAdSetLanguage(metaState.selectedAdSet);

    container.innerHTML = '';
    const topBar = document.createElement('div');
    topBar.style.cssText = 'font-size:12px; margin-bottom:8px; color:#cbd5e1; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;';
    topBar.innerHTML = `
        <span><strong>${packs.length} pacote(s) encontrado(s)</strong> para "${escHtml(nicheSlug)}" (Bloco A / B separados • clique nos idiomas para comparar as miniaturas):</span>
    `;
    const refreshBtn = document.createElement('button');
    refreshBtn.type = 'button';
    refreshBtn.className = 'btn btn-secondary btn-sm';
    refreshBtn.style.cssText = 'padding:3px 10px; font-size:11px;';
    refreshBtn.innerText = '🔄 Atualizar OneDrive';
    refreshBtn.addEventListener('click', () => loadNicheCandidatePacks(true, true));
    topBar.appendChild(refreshBtn);
    container.appendChild(topBar);

    packs.forEach(pack => {
        const isCurrent = currentLink && (
            (currentLink.pack_id && pack.pack_id && currentLink.pack_id === pack.pack_id)
            || currentLink.niche_pack === pack.name
        );

        const card = document.createElement('div');
        card.className = `candidate-pack-card ${isCurrent ? 'active-pack' : ''}`;

        const head = document.createElement('div');
        head.className = 'candidate-pack-head';

        const leftInfo = document.createElement('div');
        leftInfo.innerHTML = `<strong style="font-size:13px; color:#f8fafc;">📁 ${escHtml(pack.name)}</strong> <span class="text-muted" style="font-size:11px;">(${pack.videos_count} vídeos)</span>`;

        const langsRow = document.createElement('div');
        langsRow.className = 'candidate-pack-langs';
        langsRow.style.marginTop = '6px';

        const thumbsRow = document.createElement('div');
        thumbsRow.className = 'candidate-pack-thumbs';

        const langsList = pack.languages || [];
        const matchedBaseLang = findMatchingPackFolderLang(langsList, baseLang);
        let activePreviewLang = matchedBaseLang || langsList[0] || '';

        if (langsList.length > 0) {
            langsList.forEach(l => {
                const pill = document.createElement('span');
                pill.className = `lang-pill ready clickable ${l === activePreviewLang ? 'selected' : ''}`;
                pill.innerText = l === matchedBaseLang ? `🎯 ${l}` : `🟢 ${l}`;
                pill.title = `Visualizar miniaturas em ${l}`;
                pill.addEventListener('click', () => {
                    langsRow.querySelectorAll('.lang-pill').forEach(p => p.classList.remove('selected'));
                    pill.classList.add('selected');
                    renderPackCardThumbs(thumbsRow, pack, l);
                });
                langsRow.appendChild(pill);
            });
        } else {
            langsRow.innerHTML = '<span class="text-muted" style="font-size:11px;">Sem subpastas de idioma</span>';
        }
        leftInfo.appendChild(langsRow);

        const rightAction = document.createElement('div');
        if (isCurrent) {
            rightAction.innerHTML = `<span class="badge-tag" style="background:#10b98125; color:#34d399; border:1px solid #10b98150; font-size:11px;">✅ Pacote Atual</span>`;
        } else {
            const linkBtn = document.createElement('button');
            linkBtn.type = 'button';
            linkBtn.className = 'btn btn-primary btn-sm btn-link-pack';
            linkBtn.style.cssText = 'padding:5px 12px; font-size:12px;';
            linkBtn.innerText = '📌 Vincular a esta Campanha';
            linkBtn.addEventListener('click', () => linkCampaignToPack(campaignId, pack));
            rightAction.appendChild(linkBtn);
        }

        head.appendChild(leftInfo);
        head.appendChild(rightAction);
        card.appendChild(head);
        card.appendChild(thumbsRow);
        renderPackCardThumbs(thumbsRow, pack, activePreviewLang);

        container.appendChild(card);
    });

    if (isCurrentInSync(packs, currentLink)) {
        renderBlockNav();
        renderCountriesGrid();
        updateDuplicatorLanguageNotice();
    }
}

function isCurrentInSync(packs, currentLink) {
    if (!currentLink || !Array.isArray(packs)) return false;
    return packs.some(p => (currentLink.pack_id && p.pack_id === currentLink.pack_id) || p.name === currentLink.niche_pack);
}

async function refreshLinkedPackAndNotice() {
    const campaignId = metaState.selectedCampaignId;
    if (!campaignId) return;
    const btn = document.getElementById('btn-dup-sync-notice');
    if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Verificando OneDrive...';
    }
    try {
        await ensureLinkedPackHydrated(campaignId, true);
        renderCampaignCreativeLinkBadge();
        renderBlockNav();
        renderCountriesGrid();
        updateDuplicatorLanguageNotice();
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '🔄 Verificar OneDrive Agora';
        }
    }
}

function handleManualDuplicatorVideos(langCode, fileList) {
    const code = (langCode || '').toLowerCase();
    const files = Array.from(fileList || []).filter(f => /\.(mp4|mov|m4v)$/i.test(f.name || ''));
    files.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
    if (files.length > 0) {
        duplicatorManualFilesByLang[code] = files.slice(0, 6);
    } else {
        delete duplicatorManualFilesByLang[code];
    }
    renderBlockNav();
    renderCountriesGrid();
    updateDuplicatorLanguageNotice();
}

function toggleDuplicatorSlot(slotNum, isChecked) {
    const num = Number(slotNum);
    if (isChecked) duplicatorSelectedSlots.add(num);
    else duplicatorSelectedSlots.delete(num);
}

// Alerta dinâmico de diferença de idioma, criativos prontos e upload manual no Passo 2
function updateDuplicatorLanguageNotice() {
    const noticeEl = document.getElementById('duplicator-lang-notice');
    if (!noticeEl) return;

    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    const adset = metaState.selectedAdSet;
    const campaignId = metaState.selectedCampaignId;

    if (!block || !adset || !campaignId) {
        noticeEl.classList.add('twod-hidden');
        return;
    }

    const baseLang = detectAdSetLanguage(adset);
    const checks = metaState.checkedCountries[metaState.activeBlockId] || {};
    const selectedCountries = block.countries.filter(c => checks[c.adSetName]);
    const scopeCountries = selectedCountries.length > 0 ? selectedCountries : block.countries;

    const neededLangsMap = new Map();
    scopeCountries.forEach(c => {
        const l = (c.langCode || (block.langCode && block.langCode !== 'multi' ? block.langCode : baseLang) || baseLang).toLowerCase();
        if (!neededLangsMap.has(l)) neededLangsMap.set(l, c.langName || l.toUpperCase());
    });

    const diffLangs = Array.from(neededLangsMap.keys()).filter(l => l !== baseLang);

    if (diffLangs.length === 0) {
        noticeEl.className = 'duplicator-lang-notice notice-success';
        noticeEl.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <span>✅</span>
                <strong>OK — Mesmo Idioma da Origem (${escHtml(block.title)})</strong>
            </div>
            <div style="font-size:12px; color:#d1fae5;">
                O conjunto base e os países selecionados compartilham o mesmo idioma (${baseLang.toUpperCase()}). Os anúncios, criativos e UTMs serão clonados com precisão instantânea.
            </div>
        `;
        noticeEl.classList.remove('twod-hidden');
        return;
    }

    const link = campaignCreativesMap[campaignId];
    const packObj = getCachedLinkedPackObj(campaignId);
    const readyLangs = [];
    const missingLangs = [];

    diffLangs.forEach(l => {
        const status = isCreativeReadyForLang(campaignId, adset, l);
        if (status.ready) readyLangs.push({ code: l, name: neededLangsMap.get(l), status });
        else missingLangs.push({ code: l, name: neededLangsMap.get(l) });
    });

    noticeEl.innerHTML = '';

    if (missingLangs.length === 0) {
        noticeEl.className = 'duplicator-lang-notice notice-success';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;';
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <span>✅</span>
                <strong>Criativo OK + Tradução Automática (${escHtml(block.title)})</strong>
            </div>
            <span class="lang-pill ready">🎬 OK (${readyLangs.map(r => r.code.toUpperCase()).join(', ')})</span>
        `;
        noticeEl.appendChild(header);

        const desc = document.createElement('div');
        desc.style.fontSize = '12px';
        desc.innerHTML = `
            Origem em <strong>${baseLang.toUpperCase()}</strong> ➔ Duplicando para <strong>${diffLangs.map(l => l.toUpperCase()).join(', ')}</strong>.<br>
            Ao clicar em Duplicar, o TwoD Hub subirá os vídeos do pacote <strong>"${escHtml(link?.niche_pack || 'MP4 Manual')}"</strong>, traduzirá os textos (2-3-2) e atualizará a URL TranslateX (<code>/${diffLangs[0]}/</code>).
        `;
        noticeEl.appendChild(desc);

        // Prévia clicável dos vídeos do idioma destino quando for um idioma ou pacote hidratado
        if (diffLangs.length === 1 && packObj) {
            const { slots } = getVideosForPackLang(packObj, diffLangs[0]);
            if (slots.length > 0) {
                const stripTitle = document.createElement('div');
                stripTitle.style.cssText = 'font-size:11px; color:#a7f3d0; margin-top:4px;';
                stripTitle.innerText = `🎬 Criativos encontrados na pasta "${slots[0].video.lang}" (${slots.length} vídeos — marque os slots que deseja publicar):`;
                noticeEl.appendChild(stripTitle);

                const strip = document.createElement('div');
                strip.className = 'dup-notice-thumbs-strip';
                slots.forEach(s => {
                    const chip = document.createElement('label');
                    chip.className = 'dup-notice-thumb-chip';
                    chip.style.cursor = 'pointer';

                    const rawThumb = s.video.thumb_url
                        ? (s.video.thumb_url.startsWith('http') ? s.video.thumb_url : `${API_BASE_URL}${s.video.thumb_url}`)
                        : '';
                    const fullThumb = withMediaAuth(rawThumb);
                    if (fullThumb) {
                        const img = document.createElement('img');
                        img.src = fullThumb;
                        img.alt = s.adName;
                        img.loading = 'lazy';
                        img.addEventListener('click', (ev) => {
                            ev.preventDefault();
                            openThumbZoomModal(fullThumb, `${packObj.name} — ${s.video.lang} #${s.adName}`, s.video.name);
                        });
                        chip.appendChild(img);
                    }

                    const checkRow = document.createElement('span');
                    checkRow.style.cssText = 'display:flex; align-items:center; gap:4px;';
                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.checked = duplicatorSelectedSlots.has(s.slot);
                    cb.addEventListener('change', (ev) => toggleDuplicatorSlot(s.slot, ev.target.checked));
                    checkRow.appendChild(cb);
                    const lbl = document.createElement('span');
                    lbl.innerText = `${s.adName} (${s.slot <= 3 ? 'Feed' : 'Reels'})`;
                    checkRow.appendChild(lbl);
                    chip.appendChild(checkRow);

                    strip.appendChild(chip);
                });
                noticeEl.appendChild(strip);
            }
        }
    } else {
        noticeEl.className = 'duplicator-lang-notice';
        const header = document.createElement('div');
        header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;';
        header.innerHTML = `
            <div style="display:flex; align-items:center; gap:8px;">
                <span style="font-size:16px;">⚠️</span>
                <strong>${link?.niche_pack ? `Criativo Pendente para ${missingLangs.map(m => m.code.toUpperCase()).join(', ')}` : `Mudança de Idioma (${baseLang.toUpperCase()} ➔ ${diffLangs.map(l => l.toUpperCase()).join(', ')})`}</strong>
            </div>
            ${readyLangs.length > 0 ? `<span class="lang-pill ready">🎬 OK: ${readyLangs.map(r => r.code.toUpperCase()).join(', ')}</span>` : ''}
        `;
        noticeEl.appendChild(header);

        const body = document.createElement('div');
        body.style.cssText = 'font-size:12px; line-height:1.5;';
        body.innerHTML = link?.niche_pack
            ? `O pacote vinculado <code>${escHtml(link.niche_pack)}</code> não possui subpasta em <strong>${missingLangs.map(m => `${m.name} (${m.code.toUpperCase()})`).join(', ')}</strong>. Você pode sincronizar o OneDrive após subir a pasta, anexar os <code>.mp4</code> aqui abaixo agora, ou duplicar com segurança apenas a estrutura (<code>PAUSED</code>, $1.00 USD, sem anúncios errados).`
            : `O conjunto base está em <strong>${baseLang.toUpperCase()}</strong>. Vincule um pacote do OneDrive no <strong>Passo 1</strong> acima, ou anexe os vídeos <code>.mp4</code> no idioma destino abaixo.`;
        noticeEl.appendChild(body);

        const actionsRow = document.createElement('div');
        actionsRow.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-top:4px;';

        if (link?.niche_pack) {
            const syncBtn = document.createElement('button');
            syncBtn.type = 'button';
            syncBtn.id = 'btn-dup-sync-notice';
            syncBtn.className = 'btn btn-secondary btn-sm';
            syncBtn.style.cssText = 'padding:4px 10px; font-size:11px;';
            syncBtn.innerText = '🔄 Verificar OneDrive Agora';
            syncBtn.addEventListener('click', refreshLinkedPackAndNotice);
            actionsRow.appendChild(syncBtn);
        }

        // Upload manual opcional por idioma faltante
        missingLangs.slice(0, 3).forEach(m => {
            const labelBtn = document.createElement('label');
            labelBtn.className = 'btn btn-secondary btn-sm';
            labelBtn.style.cssText = 'padding:4px 10px; font-size:11px; cursor:pointer; display:inline-flex; align-items:center; gap:4px;';
            labelBtn.innerText = `📤 Subir .mp4 (${m.code.toUpperCase()})`;
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'video/mp4,video/*';
            input.multiple = true;
            input.style.display = 'none';
            input.addEventListener('change', (ev) => handleManualDuplicatorVideos(m.code, ev.target.files));
            labelBtn.appendChild(input);
            actionsRow.appendChild(labelBtn);
        });

        noticeEl.appendChild(actionsRow);
    }

    noticeEl.classList.remove('twod-hidden');
}

// ========================================================
// RECONHECIMENTO INTELIGENTE DE PAÍSES JÁ CRIADOS NA CAMPANHA
// ========================================================

// Normaliza texto para comparação segura (sem acentos, minúsculo, sem pontuação)
function normalizeText(text) {
    if (!text) return '';
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Mapeia os conjuntos de anúncios existentes na campanha para busca rápida por país
function getCampaignExistingCountriesList() {
    if (!metaState.adsets || !Array.isArray(metaState.adsets)) return [];

    return metaState.adsets.map(adset => {
        const countryCodes = (adset.targeting && adset.targeting.geo_locations && Array.isArray(adset.targeting.geo_locations.countries))
            ? adset.targeting.geo_locations.countries.map(c => c.toUpperCase())
            : [];
        return {
            adset,
            countryCodes,
            normalizedName: normalizeText(adset.name)
        };
    });
}

// Identifica se um país do bloco já existe nesta campanha
function findExistingAdSetForCountry(country) {
    const list = getCampaignExistingCountriesList();
    if (list.length === 0) return null;

    const targetCode = (country.code || '').toUpperCase();
    const targetNameNorm = normalizeText(country.adSetName);

    // 1º Prioridade: O nome do adset contém o nome exato do país E o código ISO bate
    const exactNameAndCode = list.find(item => {
        const nameMatches = item.normalizedName.includes(targetNameNorm) || targetNameNorm.includes(item.normalizedName);
        const codeMatches = targetCode && item.countryCodes.includes(targetCode);
        return nameMatches && (codeMatches || item.countryCodes.length === 0);
    });
    if (exactNameAndCode) return exactNameAndCode.adset;

    // 2º Prioridade: O conjunto tem segmentação única para o código ISO deste país
    if (targetCode) {
        const matchSingleCountry = list.find(item =>
            item.countryCodes.length === 1 && item.countryCodes[0] === targetCode
        );
        if (matchSingleCountry) {
            const isSpecialVariation = targetNameNorm.includes('frances') || targetNameNorm.includes('arabe') || targetNameNorm.includes('alemao') || targetNameNorm.includes('ingles') || targetNameNorm.includes('holandes');
            if (!isSpecialVariation || matchSingleCountry.normalizedName.includes(targetNameNorm)) {
                return matchSingleCountry.adset;
            }
        }
    }

    // 3º Prioridade: Fallback por nome exato do país no nome do conjunto
    const matchByNameOnly = list.find(item => item.normalizedName.includes(targetNameNorm));
    if (matchByNameOnly) return matchByNameOnly.adset;

    return null;
}

// Calcula estatísticas do bloco: total, já existentes, faltantes, status de conclusão
function getBlockStats(blockId) {
    const block = META_COUNTRY_BLOCKS[blockId];
    if (!block) return { total: 0, existing: 0, missing: 0, isComplete: false };

    let existingCount = 0;
    block.countries.forEach(country => {
        if (findExistingAdSetForCountry(country)) {
            existingCount++;
        }
    });

    const total = block.countries.length;
    const missing = total - existingCount;
    return {
        total,
        existing: existingCount,
        missing,
        isComplete: total > 0 && existingCount >= total
    };
}

function getBlockCreativeSummary(blockId) {
    const block = META_COUNTRY_BLOCKS[blockId];
    if (!block || !metaState.selectedCampaignId) {
        return { readyCount: 0, total: block?.countries?.length || 0, status: 'none' };
    }
    const countries = block.countries || [];
    let readyCount = 0;
    countries.forEach(c => {
        const lang = (c.langCode || 'es').toLowerCase();
        if (isCreativeReadyForLang(metaState.selectedCampaignId, metaState.selectedAdSet, lang).ready) {
            readyCount++;
        }
    });
    const total = countries.length;
    const status = (total > 0 && readyCount >= total) ? 'ok' : (readyCount > 0 ? 'partial' : 'pending');
    return { readyCount, total, status };
}

// Renderiza a barra de navegação dos blocos com badges de progresso + status OK de criativos
function renderBlockNav() {
    const nav = document.getElementById('blocks-tab-nav');
    if (!nav) return;

    nav.innerHTML = '';
    Object.keys(META_COUNTRY_BLOCKS).forEach(blockId => {
        const block = META_COUNTRY_BLOCKS[blockId];
        const stats = getBlockStats(blockId);
        const creativeStats = getBlockCreativeSummary(blockId);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `block-tab-btn ${blockId === metaState.activeBlockId ? 'active' : ''} ${stats.isComplete ? 'is-complete' : ''}`;
        btn.setAttribute('data-block', blockId);

        let badgeHtml = '';
        if (stats.isComplete) {
            badgeHtml = `<span class="block-tab-badge badge-complete">✅ ${stats.existing}/${stats.total}</span>`;
        } else if (stats.existing > 0) {
            badgeHtml = `<span class="block-tab-badge badge-partial">📊 ${stats.existing}/${stats.total}</span>`;
        } else {
            badgeHtml = `<span class="block-tab-badge badge-empty">⏳ 0/${stats.total}</span>`;
        }

        let creativeBadgeHtml = '';
        if (metaState.selectedCampaignId && metaState.selectedAdSet) {
            if (creativeStats.status === 'ok') {
                creativeBadgeHtml = `<span class="block-tab-badge badge-creative-ok" title="Criativo disponível no idioma deste bloco">🎬 OK</span>`;
            } else if (creativeStats.status === 'partial') {
                creativeBadgeHtml = `<span class="block-tab-badge badge-creative-partial" title="${creativeStats.readyCount} de ${creativeStats.total} países têm criativo disponível">🎬 OK (${creativeStats.readyCount}/${creativeStats.total})</span>`;
            } else {
                creativeBadgeHtml = `<span class="block-tab-badge badge-creative-pending" title="Criativo pendente neste idioma">⏳ Criativo</span>`;
            }
        }

        btn.innerHTML = `<span>${block.title}</span> ${badgeHtml} ${creativeBadgeHtml}`;
        btn.onclick = () => selectCountryBlock(blockId);
        nav.appendChild(btn);
    });
}

// Seleciona um bloco de países
function selectCountryBlock(blockId) {
    if (!META_COUNTRY_BLOCKS[blockId]) return;

    metaState.activeBlockId = blockId;
    const block = META_COUNTRY_BLOCKS[blockId];

    // Atualiza botões ativos
    document.querySelectorAll('.block-tab-btn').forEach(btn => {
        if (btn.getAttribute('data-block') === blockId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    const titleEl = document.getElementById('current-block-title');
    if (titleEl) titleEl.innerText = block.title;

    // Inicializa seleção padrão inteligente:
    // Apenas países faltantes vêm marcados por padrão; países já criados ficam desmarcados!
    if (!metaState.checkedCountries[blockId]) {
        metaState.checkedCountries[blockId] = {};
        block.countries.forEach(c => {
            const alreadyExists = !!findExistingAdSetForCountry(c);
            metaState.checkedCountries[blockId][c.adSetName] = !alreadyExists;
        });
    }

    renderCountriesGrid();
    updateDuplicatorLanguageNotice();
}

// Renderiza o grid de checkboxes dos países do bloco ativo com badges visuais de presença
function renderCountriesGrid() {
    const grid = document.getElementById('countries-grid-container');
    if (!grid) return;

    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    if (!block) return;

    grid.innerHTML = '';
    if (!metaState.checkedCountries[metaState.activeBlockId]) {
        metaState.checkedCountries[metaState.activeBlockId] = {};
    }
    const currentChecks = metaState.checkedCountries[metaState.activeBlockId];

    block.countries.forEach(country => {
        const isChecked = !!currentChecks[country.adSetName];
        const existingAdSet = findExistingAdSetForCountry(country);

        const card = document.createElement('label');
        card.className = `country-card ${isChecked ? 'selected' : ''} ${existingAdSet ? 'country-already-exists' : ''}`;

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isChecked;
        chk.onchange = (e) => {
            if (!metaState.checkedCountries[metaState.activeBlockId]) {
                metaState.checkedCountries[metaState.activeBlockId] = {};
            }
            metaState.checkedCountries[metaState.activeBlockId][country.adSetName] = e.target.checked;
            if (e.target.checked) {
                card.classList.add('selected');
            } else {
                card.classList.remove('selected');
            }
            updateBlockCounter();
        };

        const info = document.createElement('div');
        info.className = 'country-info';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'country-name';
        nameDiv.innerHTML = `${country.adSetName} <span class="country-sub">(${country.code})</span>`;

        const subDiv = document.createElement('div');
        subDiv.className = 'country-sub';
        subDiv.innerText = `${country.langName}${country.note ? ' • ' + country.note : ''}`;

        const cLang = (country.langCode || 'es').toLowerCase();
        const cCreativeStatus = isCreativeReadyForLang(metaState.selectedCampaignId, metaState.selectedAdSet, cLang);
        const creativePillHtml = (metaState.selectedCampaignId && metaState.selectedAdSet)
            ? `<span class="country-creative-pill ${cCreativeStatus.ready ? 'ok' : 'missing'}" title="${cCreativeStatus.ready ? `Criativo disponível: ${escHtml(cCreativeStatus.label)}` : `Sem pasta em ${cLang.toUpperCase()} vinculada`}">${cCreativeStatus.ready ? '🎬 Criativo OK' : '⏳ Sem criativo'}</span>`
            : '';

        const statusDiv = document.createElement('div');
        if (existingAdSet) {
            const statusLabel = existingAdSet.status === 'ACTIVE' ? 'Ativo 🟢' : 'Pausado ⏸️';
            statusDiv.innerHTML = `<span class="country-status-pill pill-exists" title="Conjunto existente: ${escHtml(existingAdSet.name)} (ID: ${existingAdSet.id})">✅ Já na Campanha (${statusLabel})</span> ${creativePillHtml}`;
        } else {
            statusDiv.innerHTML = `<span class="country-status-pill pill-pending">⏳ Pendente</span> ${creativePillHtml}`;
        }

        info.appendChild(nameDiv);
        info.appendChild(subDiv);
        info.appendChild(statusDiv);

        card.appendChild(chk);
        card.appendChild(info);

        if (country.priority) {
            const star = document.createElement('span');
            star.className = 'country-badge-star';
            star.title = 'País Prioritário';
            star.innerText = '⭐';
            card.appendChild(star);
        }

        grid.appendChild(card);
    });

    updateBlockCounter();
}

function updateBlockCounter() {
    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    if (!block) return;

    const currentChecks = metaState.checkedCountries[metaState.activeBlockId] || {};
    const count = Object.values(currentChecks).filter(Boolean).length;
    const badge = document.getElementById('current-block-selected-count');
    if (badge) {
        badge.innerText = `${count} de ${block.countries.length} selecionados`;
    }

    const pillsContainer = document.getElementById('current-block-status-pills');
    if (pillsContainer) {
        const stats = getBlockStats(metaState.activeBlockId);
        if (stats.isComplete) {
            pillsContainer.innerHTML = `<span class="stat-pill stat-pill-complete">🎉 Bloco 100% Concluído (${stats.existing}/${stats.total})</span>`;
        } else if (stats.existing > 0) {
            pillsContainer.innerHTML = `
                <span class="stat-pill stat-pill-created">✅ ${stats.existing} já na campanha</span>
                <span class="stat-pill stat-pill-missing">⏳ ${stats.missing} faltam criar</span>
            `;
        } else {
            pillsContainer.innerHTML = `
                <span class="stat-pill stat-pill-missing">⏳ Nenhum país deste bloco na campanha (${stats.total} faltantes)</span>
            `;
        }
    }

    updateDuplicatorLanguageNotice();
}

function toggleAllCountriesInBlock(checked) {
    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    if (!block) return;

    if (!metaState.checkedCountries[metaState.activeBlockId]) {
        metaState.checkedCountries[metaState.activeBlockId] = {};
    }

    block.countries.forEach(c => {
        metaState.checkedCountries[metaState.activeBlockId][c.adSetName] = checked;
    });

    renderCountriesGrid();
    updateDuplicatorLanguageNotice();
}

function selectPriorityCountriesOnly() {
    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    if (!block) return;

    if (!metaState.checkedCountries[metaState.activeBlockId]) {
        metaState.checkedCountries[metaState.activeBlockId] = {};
    }

    block.countries.forEach(c => {
        metaState.checkedCountries[metaState.activeBlockId][c.adSetName] = !!c.priority;
    });

    renderCountriesGrid();
    updateDuplicatorLanguageNotice();
}

// Ação rápida: Marca apenas os países que ainda NÃO existem na campanha selecionada
function selectMissingCountriesOnly() {
    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    if (!block) return;

    if (!metaState.checkedCountries[metaState.activeBlockId]) {
        metaState.checkedCountries[metaState.activeBlockId] = {};
    }

    block.countries.forEach(c => {
        const alreadyExists = !!findExistingAdSetForCountry(c);
        metaState.checkedCountries[metaState.activeBlockId][c.adSetName] = !alreadyExists;
    });

    renderCountriesGrid();
    updateDuplicatorLanguageNotice();
}

// Registra mensagens no Terminal em tempo real
function logMetaTerminal(message, type = 'info') {
    const terminal = document.getElementById('meta-terminal-body');
    const emptyLog = terminal ? terminal.querySelector('.terminal-log-empty') : null;
    if (emptyLog) emptyLog.remove();

    if (!terminal) return;

    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    const line = document.createElement('div');
    line.className = `terminal-entry ${type}`;
    line.innerHTML = `<span class="term-time">[${timeStr}]</span> <span class="term-text">${message}</span>`;
    terminal.appendChild(line);

    terminal.scrollTop = terminal.scrollHeight;
}

function clearMetaLog() {
    const terminal = document.getElementById('meta-terminal-body');
    if (terminal) {
        terminal.innerHTML = '<div class="terminal-log-empty">Terminal limpo. Pronto para nova duplicação.</div>';
    }
    const clearBtn = document.getElementById('btn-clear-meta-log');
    if (clearBtn) clearBtn.style.display = 'none';
}

function getMetaLogPlainText() {
    const terminal = document.getElementById('meta-terminal-body');
    if (!terminal) return '';
    const entries = terminal.querySelectorAll('.terminal-entry');
    if (entries.length > 0) {
        return Array.from(entries).map(el => {
            const tm = (el.querySelector('.term-time')?.textContent || '').trim();
            const tx = (el.querySelector('.term-text')?.textContent || '').trim();
            return tm && tx ? `${tm} ${tx}` : (el.textContent || '').trim();
        }).filter(Boolean).join('\n');
    }
    return (terminal.innerText || terminal.textContent || '').trim();
}

async function copyMetaLog() {
    const btn = document.getElementById('btn-copy-meta-log');
    const txt = getMetaLogPlainText();
    if (!txt) {
        alert('O terminal ainda está vazio.');
        return;
    }

    let copied = false;
    try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(txt);
            copied = true;
        }
    } catch (e) { }

    if (!copied) {
        const ta = document.createElement('textarea');
        ta.value = txt;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
            copied = document.execCommand('copy');
        } catch (e) { }
        document.body.removeChild(ta);
    }

    if (btn) {
        const origText = btn.dataset.origLabel || btn.textContent || '📋 Copiar Terminal';
        btn.dataset.origLabel = origText;
        btn.textContent = copied ? '✅ Copiado!' : '⚠️ Selecione e copie manualmente';
        clearTimeout(btn._copyTimer);
        btn._copyTimer = setTimeout(() => {
            btn.textContent = origText;
        }, 2200);
    }
}

// ========================================================
// MOTOR DE DUPLICAÇÃO EM MASSA (META MARKETING API)
// ========================================================

async function startBatchDuplication() {
    const startBtn = document.getElementById('btn-start-duplication');
    const stopBtn = document.getElementById('btn-stop-duplication');
    if (metaState.isDuplicating) {
        if (stopBtn && stopBtn.classList.contains('twod-hidden')) {
            metaState.isDuplicating = false;
        } else {
            showDupClickFeedback('⏳ <strong>Já existe uma duplicação em andamento.</strong> Aguarde a conclusão ou clique em "Parar Após Atual".', 'info');
            return;
        }
    }

    clearDupClickFeedback();

    if (!hasActiveMetaAuth()) {
        showDupClickFeedback('🔑 <strong>Token Meta ausente:</strong> configure <code>META_ACCESS_TOKEN</code> no servidor ou informe um Token na aba Configurações.', 'error');
        return;
    }
    const token = getMetaToken();

    const selectAcc = document.getElementById('select-meta-account');
    const selectCamp = document.getElementById('select-meta-campaign');
    const selectAdSet = document.getElementById('select-meta-adset');

    const accountId = selectAcc?.value || metaState.selectedAccountId;
    const campaignId = selectCamp?.value || metaState.selectedCampaignId;
    const adsetId = selectAdSet?.value || metaState.selectedAdSetId;

    if (!accountId) {
        showDupClickFeedback('⚠️ <strong>Selecione uma Conta de Anúncios</strong> no Passo 1 antes de iniciar.', 'warn');
        return;
    }
    if (!campaignId) {
        showDupClickFeedback('⚠️ <strong>Selecione uma Campanha de destino</strong> no Passo 1 antes de iniciar.', 'warn');
        return;
    }
    if (!adsetId) {
        showDupClickFeedback('⚠️ <strong>Selecione o Conjunto Base (Origem)</strong> no Passo 1 antes de iniciar.', 'warn');
        return;
    }

    // Sincroniza estado imediatamente com os selects visíveis na tela
    metaState.selectedAccountId = accountId;
    metaState.selectedCampaignId = campaignId;
    metaState.selectedAdSetId = adsetId;

    const campObj = (metaState.campaigns || []).find(c => String(c.id) === String(campaignId));
    const adsetObj = (metaState.adsets || []).find(a => String(a.id) === String(adsetId));

    if (!campObj) {
        showDupClickFeedback('❌ <strong>Campanha não encontrada na lista carregada.</strong> Clique em recarregar contas/campanhas no Passo 1.', 'error');
        return;
    }
    if (!adsetObj) {
        showDupClickFeedback('❌ <strong>Conjunto base não encontrado nesta campanha.</strong> Selecione o conjunto base novamente no Passo 1.', 'error');
        return;
    }
    metaState.selectedAdSet = adsetObj;

    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    if (!block) {
        showDupClickFeedback('⚠️ Selecione um Bloco de países no Passo 2.', 'warn');
        return;
    }
    const checks = metaState.checkedCountries[metaState.activeBlockId] || {};
    const countriesToDuplicate = block.countries.filter(c => checks[c.adSetName]);

    if (countriesToDuplicate.length === 0) {
        showDupClickFeedback('⚠️ <strong>Nenhum país marcado neste bloco!</strong> Marque pelo menos 1 país acima (ex.: clique em "✓ Marcar Todos" ou "⚡ Marcar Apenas Faltantes").', 'warn');
        return;
    }

    const initialStatus = document.getElementById('select-initial-status')?.value || 'PAUSED';
    const nameFormat = document.getElementById('select-name-format')?.value || 'country_only';

    const baseLang = detectAdSetLanguage(adsetObj);
    const campNicheSlug = extractNicheFromCampaign(campObj.name || '');

    const uniqueDiffLangs = Array.from(new Set(
        countriesToDuplicate
            .map(c => (c.langCode || (block.langCode && block.langCode !== 'multi' ? block.langCode : baseLang) || baseLang).toLowerCase())
            .filter(l => l !== baseLang)
    ));

    // Hidrata pacote vinculado SOMENTE quando há idiomas diferentes do conjunto base (evita travar em clonagem mesmo idioma)
    const link = campaignCreativesMap[campaignId];
    let linkedPackObj = getCachedLinkedPackObj(campaignId);
    if (uniqueDiffLangs.length > 0 && link && link.niche_pack && !linkedPackObj) {
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.innerText = '⏳ Verificando criativos OneDrive...';
        }
        try {
            linkedPackObj = await Promise.race([
                ensureLinkedPackHydrated(campaignId, false),
                new Promise(resolve => setTimeout(() => resolve(null), 9000))
            ]);
        } finally {
            if (startBtn) {
                startBtn.disabled = false;
                startBtn.innerText = '🚀 Iniciar Duplicação via Meta API';
            }
        }
    }

    const langMediaSources = {};
    const readyDiffLangs = [];
    const missingDiffLangs = [];

    uniqueDiffLangs.forEach(langCode => {
        const manualFiles = duplicatorManualFilesByLang[langCode];
        if (Array.isArray(manualFiles) && manualFiles.length > 0) {
            langMediaSources[langCode] = { mode: 'manual', files: manualFiles };
            readyDiffLangs.push(langCode);
            return;
        }
        const packRes = linkedPackObj ? getVideosForPackLang(linkedPackObj, langCode) : { matchedLang: null, slots: [] };
        if (packRes.slots && packRes.slots.length > 0) {
            const filteredSlots = packRes.slots.filter(s => duplicatorSelectedSlots.has(s.slot));
            langMediaSources[langCode] = {
                mode: 'onedrive',
                matchedLang: packRes.matchedLang,
                slots: filteredSlots.length > 0 ? filteredSlots : packRes.slots
            };
            readyDiffLangs.push(langCode);
            return;
        }
        langMediaSources[langCode] = { mode: 'missing' };
        missingDiffLangs.push(langCode);
    });

    const modeSummary = uniqueDiffLangs.length === 0
        ? 'Clonagem Direta (Mesmo Idioma)'
        : (readyDiffLangs.length === uniqueDiffLangs.length
            ? `Tradução 2-3-2 + URL TranslateX + Upload Criativos (${link?.niche_pack || 'MP4 Manual'})`
            : (readyDiffLangs.length > 0
                ? `Misto: Tradução onde há criativo (${readyDiffLangs.map(l => l.toUpperCase()).join(',')}) + Apenas Estrutura onde falta (${missingDiffLangs.map(l => l.toUpperCase()).join(',')})`
                : 'Apenas Estrutura Segura (Sem Anúncios)'));

    const launchChoice = await openDuplicatorLaunchModal({
        campName: campObj.name,
        campId: campObj.id,
        adsetName: adsetObj.name,
        adsetId: adsetObj.id,
        baseLang,
        blockTitle: block.title,
        countriesCount: countriesToDuplicate.length,
        modeSummary,
        initialStatus,
        missingDiffLangs
    });

    if (!launchChoice) return;

    const isScheduled = launchChoice.mode === 'scheduled' && Boolean(launchChoice.metaStartTimeIso);
    const scheduledMetaStartTime = isScheduled ? launchChoice.metaStartTimeIso : '';
    const effectiveStatus = isScheduled
        ? (launchChoice.autoActive ? 'ACTIVE' : initialStatus)
        : initialStatus;

    metaState.isDuplicating = true;
    metaState.stopDuplicationRequested = false;
    const stopOnFirstError = document.getElementById('dup-stop-on-error-check')
        ? Boolean(document.getElementById('dup-stop-on-error-check').checked)
        : true;
    const selectedPageOverride = document.getElementById('select-dup-page-override')?.value || 'auto';
    const autoFallbackPage = document.getElementById('dup-auto-fallback-page-check')
        ? Boolean(document.getElementById('dup-auto-fallback-page-check').checked)
        : true;
    const blockedPageIds = new Set();
    let activeWorkingPageId = (selectedPageOverride && selectedPageOverride !== 'auto') ? String(selectedPageOverride) : '';
    const cachedRescuedAdsByBaseId = {};
    const resolvedImgMap = {};

    // Atualiza UI para estado de execução
    const clearBtn = document.getElementById('btn-clear-meta-log');
    const progressWrapper = document.getElementById('duplication-progress-wrapper');
    const progressFill = document.getElementById('duplication-progress-fill');
    const progressStatus = document.getElementById('progress-status-text');
    const progressPct = document.getElementById('progress-percentage-text');
    const termStatus = document.getElementById('terminal-live-status');

    if (startBtn) {
        startBtn.disabled = true;
        startBtn.innerText = '⏳ Duplicando via API...';
    }
    if (stopBtn) {
        stopBtn.disabled = false;
        stopBtn.innerText = '⏹️ Parar Após Atual';
        stopBtn.classList.remove('twod-hidden');
    }
    if (clearBtn) clearBtn.style.display = 'inline-block';
    if (progressWrapper) progressWrapper.classList.remove('twod-hidden');
    if (termStatus) termStatus.innerText = 'Em execução...';

    let accountPromotePages = [];
    if (selectedPageOverride !== 'auto' || autoFallbackPage) {
        try {
            accountPromotePages = await loadDupPromotePages(accountId);
        } catch (_) {
            accountPromotePages = Array.isArray(metaState.promotePages) ? metaState.promotePages : [];
        }
    }

    logMetaTerminal(`🚀 Iniciando processo de duplicação para ${countriesToDuplicate.length} países no bloco ${block.title}...`, 'info');
    logMetaTerminal(`🎯 Campanha de Destino: '${campObj.name}' (ID: ${campObj.id})`, 'info');
    logMetaTerminal(`📦 Conjunto base: '${adsetObj.name}' (${baseLang.toUpperCase()} | ID: ${adsetObj.id})`, 'info');
    if (activeWorkingPageId) {
        const pgName = accountPromotePages.find(p => String(p.id) === activeWorkingPageId)?.name || activeWorkingPageId;
        logMetaTerminal(`📄 Página selecionada para os anúncios: '${pgName}' (ID: ${activeWorkingPageId})`, 'info');
    }
    if (isScheduled) {
        logMetaTerminal(`🕐 Agendamento ativo: início programado para ${launchChoice.schedulePtBr} (${scheduledMetaStartTime} • status=${effectiveStatus})`, 'info');
    } else {
        logMetaTerminal(`⚡ Início Instantâneo selecionado (status=${effectiveStatus})`, 'info');
    }

    const budgetInCents = 100; // Sempre 1 dólar ($1.00 USD = 100 centavos)

    // Busca previamente todos os anúncios e criativos completos (hidratando asset_feed_spec e creative_asset_groups_spec)
    let baseAds = [];
    let baseAdsLoadError = '';
    try {
        baseAds = await hydrateAdSetAdsWithCreatives(adsetId);
        logMetaTerminal(`📋 Anúncios identificados no conjunto base: ${baseAds.length} anúncio(s)`, 'info');
        baseAds.forEach((bAd, idx) => {
            const cr = bAd.creative || {};
            const allEntries = extractAnyCreativeMediaEntries(cr);
            const crPageId = cr.object_story_spec?.page_id || cr.actor_id || (cr.effective_object_story_id ? String(cr.effective_object_story_id).split('_')[0] : '') || '';
            const afsV = Array.isArray(cr.asset_feed_spec?.videos) ? cr.asset_feed_spec.videos.length : 0;
            const afsI = Array.isArray(cr.asset_feed_spec?.images) ? cr.asset_feed_spec.images.length : 0;
            const cagsG = Array.isArray(cr.creative_asset_groups_spec?.groups) ? cr.creative_asset_groups_spec.groups.length : 0;
            logMetaTerminal(`🔎 Modelo #${idx + 1} '${bAd.name || bAd.id}': ${allEntries.length} mídia(s) detectada(s) [afs_v=${afsV}, afs_i=${afsI}, cags_g=${cagsG}]${crPageId ? ` • Página: ${crPageId}` : ''}`, 'info');
        });
    } catch (e) {
        baseAdsLoadError = e.message || String(e);
        console.warn('Não foi possível ler anúncios prévios do conjunto:', e);
        logMetaTerminal(`❌ Erro ao consultar anúncios do conjunto base: ${baseAdsLoadError}`, 'error');
    }

    // Pré-prepara vídeos + textos traduzidos + URLs TranslateX + AdCreatives por idioma destino pronto
    const preparedCreativesByLang = {};
    const creativePrepFailures = [];
    window._dupSessionVideoCache = window._dupSessionVideoCache || {};
    const videoUploadCache = window._dupSessionVideoCache;

    const finishDuplicationUi = () => {
        metaState.isDuplicating = false;
        metaState.stopDuplicationRequested = false;
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.innerText = '🚀 Iniciar Nova Duplicação';
        }
        if (stopBtn) {
            stopBtn.disabled = false;
            stopBtn.innerText = '⏹️ Parar Após Atual';
            stopBtn.classList.add('twod-hidden');
        }
    };

    const uploadLocalBrowserFileToMeta = async (accountId, fileObj) => {
        const cacheKey = `${accountId}:manual:${fileObj.name}:${fileObj.size}`;
        if (videoUploadCache[cacheKey]?.video_id) return videoUploadCache[cacheKey];

        const q = new URLSearchParams({
            account_id: accountId,
            title: fileObj.name || 'video.mp4',
            filename: fileObj.name || 'video.mp4',
            graph_version: META_GRAPH_VERSION
        });
        const hdrs = { 'Content-Type': 'application/octet-stream' };
        if (token) hdrs['X-Meta-Token'] = token;

        const upResp = await apiFetch(`/api/meta/upload-video-binary?${q.toString()}`, {
            method: 'POST',
            headers: hdrs,
            body: fileObj
        });
        const upJson = await upResp.json();
        const upRes = upJson.result || upJson;
        if (!upJson.success || !upRes.id) {
            throw new Error(`Falha ao subir ${fileObj.name}: ${formatMetaApiError(upJson.error || upRes)}`);
        }
        let thumbnailUrl = '';
        for (let attempt = 0; attempt < 20; attempt++) {
            await new Promise(r => setTimeout(r, 3000));
            const stData = await metaGraphGet(`/${META_GRAPH_VERSION}/${upRes.id}?fields=status,picture,thumbnails`);
            const thumbUri = stData.thumbnails?.data?.[0]?.uri || stData.picture || '';
            if (thumbUri) thumbnailUrl = thumbUri;
            if (stData.status?.video_status === 'ready') break;
        }
        const out = { video_id: upRes.id, thumbnail_url: thumbnailUrl };
        videoUploadCache[cacheKey] = out;
        return out;
    };

    const preparedSameLangItems = [];
    const hasSameLangTargets = countriesToDuplicate.some(c => {
        const cLang = (c.langCode || (block.langCode && block.langCode !== 'multi' ? block.langCode : baseLang) || baseLang).toLowerCase();
        return cLang === baseLang;
    });

    if (baseAds.length === 0 && (baseAdsLoadError || hasSameLangTargets || readyDiffLangs.length > 0)) {
        const noAdsReason = baseAdsLoadError
            ? `Erro na Meta API ao ler os anúncios do conjunto base:\n• ${baseAdsLoadError}`
            : `A Meta retornou 0 anúncios no conjunto base '${adsetObj.name}'.`;
        logMetaTerminal(`⚠️ Nenhum anúncio encontrado no conjunto base para servir de modelo. ${baseAdsLoadError || ''}`, 'warn');
        const proceedWithoutAds = confirm(
            `⚠️ ATENÇÃO — NENHUM ANÚNCIO ENCONTRADO NO CONJUNTO BASE:\n\n` +
            `${noAdsReason}\n\n` +
            `Se continuar agora, os ${countriesToDuplicate.length} conjunto(s) serão criados VAZIOS (sem nenhum anúncio).\n\n` +
            `• Cancelar = ABORTAR AGORA (Recomendado — evita criar conjuntos sem anúncio)\n` +
            `• OK = Continuar criando conjuntos sem anúncio`
        );
        if (!proceedWithoutAds) {
            logMetaTerminal(`🛑 Duplicação cancelada antes de criar conjuntos vazios sem anúncio.`, 'warn');
            if (termStatus) termStatus.innerText = baseAdsLoadError ? 'Erro ao ler anúncios base' : 'Cancelado';
            if (progressStatus) progressStatus.innerText = 'Cancelado antes de criar conjuntos vazios';
            finishDuplicationUi();
            return;
        }
    }

    const baseHasFlexibleMulti = baseAds.some(ad => extractCreativeMediaEntries(ad.creative || {}).length > 1);

    if (hasSameLangTargets && baseAds.length > 0 && baseHasFlexibleMulti) {
        let sameLangErr = '';
        let sameLangDevBlock = false;
        let sameLangPageBlock = false;
        let sameLangBlockedPageId = '';
        let expectedExpandedCount = 0;
        const expandedItems = [];

        try {
            if (progressStatus) progressStatus.innerText = `🎬 Expandindo criativos do anúncio flexível (${baseLang.toUpperCase()})...`;
            for (const baseAd of baseAds) {
                const spec = extractCreativeTemplateSpec(baseAd.creative || {}, baseAd.creative?.actor_id || '');
                const mediaEntries = spec.mediaEntries || [];

                if (mediaEntries.length <= 1) {
                    if (baseAd.creative?.id) {
                        expectedExpandedCount++;
                        expandedItems.push({
                            adName: baseAd.name || String(expandedItems.length + 1).padStart(2, '0'),
                            creativeId: baseAd.creative.id,
                            urlTags: baseAd.url_tags || ''
                        });
                    }
                    continue;
                }

                expectedExpandedCount += mediaEntries.length;

                if (!spec.pageId) {
                    sameLangErr = `Anúncio base '${baseAd.name}' não possui page_id em object_story_spec.`;
                    logMetaTerminal(`⚠️ ${sameLangErr}`, 'warn');
                    continue;
                }

                logMetaTerminal(`🎬 Conjunto base '${baseAd.name}' é Flexível (${mediaEntries.length} criativos) — gerando ${mediaEntries.length} anúncios individuais (1 criativo por anúncio)...`, 'info');

                const textsObj = {
                    hasAfs: spec.hasAfs,
                    tBodies: spec.rawBodies,
                    tTitles: spec.rawTitles,
                    tDescs: spec.rawDescs,
                    tVdMsg: spec.rawVdMsg,
                    tVdTitle: spec.rawVdTitle,
                    tVdDesc: spec.rawVdDesc
                };

                for (let mIdx = 0; mIdx < mediaEntries.length; mIdx++) {
                    const entry = { ...mediaEntries[mIdx] };
                    const adCode = String(mIdx + 1).padStart(2, '0');
                    if (entry.kind === 'video' && !entry.thumbnailUrl && !entry.thumbnailHash) {
                        entry.thumbnailUrl = await resolveMetaVideoThumbUrl(entry.videoId, '', videoUploadCache);
                    }

                    const crRes = await createSingleMediaCreativeWithPageFallback({
                        accountId: metaState.selectedAccountId,
                        name: `${campNicheSlug || 'Ad'} - ${baseLang.toUpperCase()} - ${adCode}`,
                        spec,
                        mediaAsset: entry,
                        textsObj,
                        linkUrl: spec.rawLink,
                        candidatePages: getAuthorizedCandidatePageIds(metaState.selectedAccountId, blockedPageIds),
                        allowFallback: autoFallbackPage,
                        blockedPageIds,
                        activeWorkingPageId,
                        logFn: logMetaTerminal
                    });

                    if (crRes.id) {
                        if (crRes.usedPageId && crRes.switchedPage) {
                            activeWorkingPageId = String(crRes.usedPageId);
                            logMetaTerminal(`✅ Página '${activeWorkingPageId}' autorizada! Expandindo os demais criativos por ela.`, 'success');
                        }
                        expandedItems.push({
                            adName: adCode,
                            creativeId: crRes.id,
                            urlTags: baseAd.url_tags || ''
                        });
                    } else {
                        sameLangErr = formatMetaApiError(crRes.error || crRes);
                        logMetaTerminal(`⚠️ Falha ao expandir criativo ${adCode} (${baseLang.toUpperCase()}): ${sameLangErr}`, 'error');
                        if (crRes.error?.error_subcode === 1885183 || isMetaPagePermissionError(crRes.error)) {
                            sameLangDevBlock = crRes.error?.error_subcode === 1885183;
                            sameLangPageBlock = isMetaPagePermissionError(crRes.error);
                            sameLangBlockedPageId = crRes.usedPageId || spec.pageId || '';
                            break;
                        }
                    }
                }
                if (sameLangDevBlock || sameLangPageBlock) break;
            }
        } catch (expErr) {
            sameLangErr = expErr.message || String(expErr);
            logMetaTerminal(`❌ Erro ao expandir criativos de ${baseLang.toUpperCase()}: ${sameLangErr}`, 'error');
        }

        if (expandedItems.length > 0 && expandedItems.length === expectedExpandedCount) {
            preparedSameLangItems.push(...expandedItems);
            logMetaTerminal(`✨ ${expandedItems.length} anúncio(s) individuais preparados para ${baseLang.toUpperCase()} (01 a ${String(expandedItems.length).padStart(2, '0')}).`, 'success');
        } else {
            if (expandedItems.length > 0) {
                preparedSameLangItems.push(...expandedItems);
                logMetaTerminal(`⚠️ Expansão parcial em ${baseLang.toUpperCase()}: ${expandedItems.length}/${expectedExpandedCount} criativo(s) preparado(s).`, 'warn');
            }
            creativePrepFailures.push({
                lang: baseLang,
                error: sameLangErr || `Expansão incompleta (${expandedItems.length}/${expectedExpandedCount} criativos do anúncio flexível).`,
                isDevMode: sameLangDevBlock,
                isPagePerm: sameLangPageBlock,
                pageId: sameLangBlockedPageId
            });
        }
    }

    if (baseAds.length > 0 && readyDiffLangs.length > 0) {
        for (const tLang of readyDiffLangs) {
            const mediaSrc = langMediaSources[tLang];
            if (!mediaSrc || mediaSrc.mode === 'missing') continue;

            const mediaItems = mediaSrc.mode === 'onedrive'
                ? mediaSrc.slots.map(s => ({ kind: 'onedrive', adName: s.adName, slot: s.slot, video: s.video }))
                : mediaSrc.files.map((f, fIdx) => ({ kind: 'manual', adName: String(fIdx + 1).padStart(2, '0'), file: f }));

            if (mediaItems.length === 0) continue;

            const usePaired = (baseAds.length > 1 && baseAds.length === mediaItems.length);
            const createdItems = [];
            const translatedTemplateCache = {};
            let lastLangError = '';
            let hitDevModeBlock = false;
            let hitPagePermBlock = false;
            let blockedPageId = '';

            try {
                if (progressStatus) progressStatus.innerText = `🎬 Preparando criativos e tradução para ${tLang.toUpperCase()}...`;
                logMetaTerminal(`🌐 Preparando pacote de vídeos e tradução (${baseLang.toUpperCase()} ➔ ${tLang.toUpperCase()})...`, 'info');

                // Sobe 1 vídeo por vez e valida logo o primeiro AdCreative para abortar rápido em caso de bloqueio da Meta (ex: 1885183)
                for (let uIdx = 0; uIdx < mediaItems.length; uIdx++) {
                    const mItem = mediaItems[uIdx];
                    let uploaded;

                    if (mItem.kind === 'onedrive') {
                        const vKey = `${metaState.selectedAccountId}:${mItem.video.id || mItem.video.url || mItem.video.name}`;
                        if (videoUploadCache[vKey]?.video_id) {
                            logMetaTerminal(`⚡ Reutilizando vídeo ${mItem.adName} (${mItem.video.name}) já enviado nesta sessão (ID: ${videoUploadCache[vKey].video_id})`, 'info');
                            uploaded = videoUploadCache[vKey];
                        } else {
                            logMetaTerminal(`☁️ Subindo criativo ${mItem.adName} (${mItem.video.lang} / ${mItem.video.name}) para Meta Ads...`, 'info');
                            uploaded = await uploadOneDriveVideoToMeta(metaState.selectedAccountId, mItem.video, token, videoUploadCache);
                            if (uploaded?.video_id) videoUploadCache[vKey] = uploaded;
                        }
                    } else {
                        logMetaTerminal(`📤 Enviando MP4 manual ${mItem.adName} (${mItem.file.name}) para Meta Ads...`, 'info');
                        uploaded = await uploadLocalBrowserFileToMeta(metaState.selectedAccountId, mItem.file);
                    }

                    const templateAd = usePaired ? baseAds[uIdx] : baseAds[0];
                    const templateKey = templateAd.id || String(usePaired ? uIdx : 0);
                    const spec = extractCreativeTemplateSpec(templateAd.creative || {}, templateAd.creative?.actor_id || '');
                    if (!spec.pageId && (activeWorkingPageId || accountPromotePages[0]?.id)) {
                        spec.pageId = String(activeWorkingPageId || accountPromotePages[0].id);
                        spec.instagramUserId = '';
                    }

                    if (!spec.pageId) {
                        lastLangError = `Anúncio base '${templateAd.name}' não possui page_id e nenhuma Página foi encontrada na conta.`;
                        logMetaTerminal(`⚠️ ${lastLangError}`, 'warn');
                        continue;
                    }

                    if (!translatedTemplateCache[templateKey]) {
                        const localizedLink = buildDuplicatorLocalizedUrl(spec.rawLink, tLang, baseLang);
                        const batchIn = [
                            ...spec.rawBodies,
                            ...spec.rawTitles,
                            ...spec.rawDescs,
                            spec.rawVdMsg,
                            spec.rawVdTitle,
                            spec.rawVdDesc
                        ];
                        const batchOut = (typeof translateTextsBatch === 'function')
                            ? await translateTextsBatch(batchIn, tLang, baseLang)
                            : batchIn;

                        let cursor = 0;
                        const tBodies = batchOut.slice(cursor, cursor + spec.rawBodies.length); cursor += spec.rawBodies.length;
                        const tTitles = batchOut.slice(cursor, cursor + spec.rawTitles.length); cursor += spec.rawTitles.length;
                        const tDescs = batchOut.slice(cursor, cursor + spec.rawDescs.length); cursor += spec.rawDescs.length;
                        const tVdMsg = batchOut[cursor++] || '';
                        const tVdTitle = batchOut[cursor++] || '';
                        const tVdDesc = batchOut[cursor++] || '';

                        translatedTemplateCache[templateKey] = {
                            spec,
                            localizedLink,
                            textsObj: {
                                hasAfs: spec.hasAfs,
                                tBodies,
                                tTitles,
                                tDescs,
                                tVdMsg,
                                tVdTitle,
                                tVdDesc
                            }
                        };
                    }

                    const trData = translatedTemplateCache[templateKey];
                    const crRes = await createSingleMediaCreativeWithPageFallback({
                        accountId: metaState.selectedAccountId,
                        name: `${campNicheSlug || 'Ad'} - ${tLang.toUpperCase()} - ${mItem.adName}`,
                        spec: trData.spec,
                        mediaAsset: {
                            kind: 'video',
                            videoId: uploaded.video_id,
                            thumbnailUrl: uploaded.thumbnail_url || ''
                        },
                        textsObj: trData.textsObj,
                        linkUrl: trData.localizedLink,
                        candidatePages: getAuthorizedCandidatePageIds(metaState.selectedAccountId, blockedPageIds),
                        allowFallback: autoFallbackPage,
                        blockedPageIds,
                        activeWorkingPageId,
                        logFn: logMetaTerminal
                    });

                    if (crRes.id) {
                        if (crRes.usedPageId && (crRes.switchedPage || (activeWorkingPageId && String(crRes.usedPageId) !== activeWorkingPageId))) {
                            activeWorkingPageId = String(crRes.usedPageId);
                            trData.spec = { ...trData.spec, pageId: activeWorkingPageId, instagramUserId: '' };
                            logMetaTerminal(`✅ Página '${activeWorkingPageId}' autorizada! Usando-a para os criativos em ${tLang.toUpperCase()}.`, 'success');
                        }
                        createdItems.push({
                            adName: usePaired ? (templateAd.name || mItem.adName) : mItem.adName,
                            creativeId: crRes.id,
                            urlTags: templateAd.url_tags || ''
                        });
                    } else {
                        lastLangError = formatMetaApiError(crRes.error || crRes);
                        logMetaTerminal(`⚠️ Falha ao criar AdCreative ${mItem.adName} (${tLang.toUpperCase()}): ${lastLangError}`, 'error');
                        const errSub = crRes.error?.error_subcode;
                        if (errSub === 1885183) {
                            hitDevModeBlock = true;
                            break;
                        }
                        if (isMetaPagePermissionError(crRes.error)) {
                            hitPagePermBlock = true;
                            blockedPageId = crRes.usedPageId || trData.spec.pageId || '';
                            break;
                        }
                    }
                }

                if (createdItems.length > 0) {
                    preparedCreativesByLang[tLang] = createdItems;
                    logMetaTerminal(`✨ ${createdItems.length} AdCreative(s) prontos para ${tLang.toUpperCase()} (URL TranslateX: /${tLang}/)`, 'success');
                } else {
                    creativePrepFailures.push({
                        lang: tLang,
                        error: lastLangError || 'Nenhum AdCreative pôde ser criado.',
                        isDevMode: hitDevModeBlock,
                        isPagePerm: hitPagePermBlock,
                        pageId: blockedPageId
                    });
                }
            } catch (prepErr) {
                console.error(`Erro preparando idioma ${tLang}:`, prepErr);
                const errMsg = prepErr.message || String(prepErr);
                logMetaTerminal(`❌ Erro ao preparar criativos em ${tLang.toUpperCase()}: ${errMsg}`, 'error');
                creativePrepFailures.push({ lang: tLang, error: errMsg, isDevMode: false, isPagePerm: false, pageId: '' });
            }
        }
    }

    // BLOQUEIO DE SEGURANÇA: nunca cria conjuntos vazios silenciosamente se a criação de AdCreative falhou
    if (creativePrepFailures.length > 0) {
        const hasDevMode = creativePrepFailures.some(f => f.isDevMode);
        const pagePermItem = creativePrepFailures.find(f => f.isPagePerm || isMetaPagePermissionError(f.error || ''));
        const failLines = creativePrepFailures.map(f => `• ${f.lang.toUpperCase()}: ${f.error}`).join('\n');
        const devHint = hasDevMode
            ? `\n\n📌 COMO RESOLVER AGORA (Modo Desenvolvimento):\n` +
              `Seu App da Meta está em Modo de Desenvolvimento (erro 1885183), por isso a Meta bloqueia a criação de novos anúncios via API.\n` +
              `1. Acesse https://developers.facebook.com/apps/ e abra seu app.\n` +
              `2. Em Configurações > Básico, preencha uma URL de Privacidade (ex: https://thiagokinho22-code.github.io/twod-dashboard-thiago/privacy.html).\n` +
              `3. No topo da tela, mude a chave de "Desenvolvimento" para "Ao Vivo / Público" (Live) — ou use um Token de Usuário do Sistema no Business Manager.`
            : '';
        const pagePermHint = pagePermItem
            ? `\n\n${buildMetaPagePermissionHint(pagePermItem.pageId || '')}`
            : '';

        const proceedEmpty = confirm(
            `❌ FALHA AO CRIAR OS ANÚNCIOS TRADUZIDOS NA META:\n\n${failLines}${devHint}${pagePermHint}\n\n` +
            `Deseja MESMO ASSIM criar os conjuntos vazios (apenas estrutura em PAUSED, sem anúncio)?\n\n` +
            `• Cancelar = ABORTAR AGORA (Recomendado — evita criar conjuntos sem anúncio)\n` +
            `• OK = Continuar criando conjuntos sem anúncio`
        );

        if (!proceedEmpty) {
            logMetaTerminal(`🛑 Operação cancelada antes de criar conjuntos vazios sem anúncio.`, 'warn');
            if (termStatus) termStatus.innerText = hasDevMode ? 'Bloqueado (App Meta em Desenvolvimento)' : (pagePermItem ? 'Bloqueado (Permissão da Página)' : 'Cancelado');
            if (progressStatus) progressStatus.innerText = 'Cancelado antes de criar conjuntos vazios';
            finishDuplicationUi();
            return;
        }
    }

    const regCtx = await loadDupAdvertiserEntities(accountId).catch(() => metaState.advertiserCtx || null);
    const manualEntitySel = document.getElementById('select-dup-advertiser-entity')?.value || 'auto';
    const manualEntityId = (document.getElementById('input-dup-reg-entity-id')?.value || '').trim()
        || (manualEntitySel !== 'auto' ? manualEntitySel : '');
    const manualDsaName = (document.getElementById('input-dup-dsa-name')?.value || '').trim();
    if (manualEntityId && manualEntityId !== regCtx?.candidates?.[0]?.id) {
        setStoredManualEntityId(accountId, manualEntityId);
    }
    const workingComplianceByCountry = {};

    const detectedBasePageId = (() => {
        for (const ad of baseAds) {
            const cr = ad?.creative || {};
            const pid = cr.object_story_spec?.page_id
                || (typeof cr.effective_object_story_id === 'string' && cr.effective_object_story_id.includes('_') ? cr.effective_object_story_id.split('_')[0] : '')
                || cr.actor_id
                || '';
            if (pid) return String(pid);
        }
        return '';
    })();

    let successCount = 0;
    let failCount = 0;
    let abortedReason = '';
    let abortedPagePerm = false;
    let abortedAdvCountry = null;
    const startTime = Date.now();

    for (let i = 0; i < countriesToDuplicate.length; i++) {
        if (metaState.stopDuplicationRequested) {
            logMetaTerminal(`⏹️ Lote interrompido manualmente pelo usuário antes do país #${i + 1}.`, 'warn');
            abortedReason = 'Interrompido manualmente pelo usuário.';
            break;
        }

        const country = countriesToDuplicate[i];
        const currentIdx = i + 1;
        const total = countriesToDuplicate.length;
        let copiedAdSetId = '';
        let finalName = country.adSetName;

        // Atualiza barra de progresso
        const pct = Math.round(((currentIdx - 1) / total) * 100);
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressPct) progressPct.innerText = `${pct}%`;
        if (progressStatus) progressStatus.innerText = `[${currentIdx}/${total}] Clonando ${country.adSetName} (${country.code})...`;

        logMetaTerminal(`[${currentIdx}/${total}] Duplicando conjunto para '${country.adSetName}' (${country.code})...`, 'info');

        try {
            // PASSO 1: Clona a estrutura do conjunto base sempre em PAUSED primeiro e FORÇA explicitamente a campanha de destino
            const copyParams = {
                status_option: 'PAUSED',
                campaign_id: campaignId
            };
            let copyAppliedStartTime = false;
            if (isScheduled && scheduledMetaStartTime) {
                copyParams.start_time = scheduledMetaStartTime;
                if (metaState.selectedAdSet?.end_time) {
                    copyParams.end_time = '0';
                }
                copyAppliedStartTime = true;
            }

            let copyData = await metaGraphPost(`/${META_GRAPH_VERSION}/${adsetId}/copies`, copyParams);
            if (copyData.error && copyAppliedStartTime && /start_time|end_time|schedule/i.test(copyData.error.message || '')) {
                copyAppliedStartTime = false;
                copyData = await metaGraphPost(`/${META_GRAPH_VERSION}/${adsetId}/copies`, {
                    status_option: 'PAUSED',
                    campaign_id: campaignId
                });
            }

            if (copyData.error) {
                const cErr = new Error(formatMetaApiError(copyData.error));
                cErr.isCircuitBreaker = Boolean(copyData.error.is_circuit_breaker);
                cErr.rawMetaError = copyData.error;
                throw cErr;
            }

            copiedAdSetId = copyData.copied_adset_id;

            // PASSO 2: Formata o novo nome
            if (nameFormat === 'country_lang') {
                finalName = `${country.adSetName} (${country.langName})`;
            } else if (nameFormat === 'block_country') {
                finalName = `${block.id.replace('BLOCO-', 'B')} - ${country.adSetName}`;
            }

            // PASSO 3: Configura segmentação preservando idade/targeting_automation do conjunto base (sem locales herdados)
            const baseT = metaState.selectedAdSet?.targeting ? JSON.parse(JSON.stringify(metaState.selectedAdSet.targeting)) : {};
            delete baseT.locales;
            if (country.code !== 'BR') delete baseT.brand_safety_content_filter_levels;
            const targeting = {
                ...baseT,
                geo_locations: {
                    countries: [country.code],
                    location_types: ['frequently_in', 'home', 'recent']
                }
            };

            // PASSO 4: Atualiza o conjunto clonado via POST /{copied_id} com suporte automático a Advertiser (AU/UE/BR/3858634)
            const updatePayload = {
                name: finalName,
                daily_budget: budgetInCents.toString(),
                status: effectiveStatus,
                targeting
            };
            if (isScheduled && scheduledMetaStartTime) {
                updatePayload.start_time = scheduledMetaStartTime;
            }

            const complianceAttempts = buildRegionalComplianceAttempts({
                countryCode: country.code,
                baseAdset: adsetObj,
                siblingAdsets: metaState.adsets || [],
                regCtx,
                accountId,
                manualEntityId,
                manualDsaName,
                workingComplianceByCountry
            });
            let complianceIdx = -1;
            if (complianceAttempts.shouldProactive && complianceAttempts.length > 0) {
                complianceIdx = 0;
                applyComplianceAttemptToAdSetPayload(updatePayload, complianceAttempts[0]);
            }

            const postAdSetUpdate = async (payloadObj) => {
                const cleanPayload = {};
                Object.entries(payloadObj || {}).forEach(([k, v]) => {
                    if (v !== undefined && v !== null) {
                        cleanPayload[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
                    }
                });
                return metaGraphPost(`/${META_GRAPH_VERSION}/${copiedAdSetId}`, cleanPayload);
            };

            let updateData = await postAdSetUpdate(updatePayload);
            const retried = new Set();
            const maxUpdateAttempts = Math.max(6, complianceAttempts.length + 3);
            for (let attempt = 0; attempt < maxUpdateAttempts && updateData.error; attempt++) {
                const errMsg = (updateData.error.message || '').toLowerCase();
                const errSub = Number(updateData.error.error_subcode || 0);
                const isMissingAdv = isMetaMissingAdvertiserError(updateData.error);
                const isRegOrDsaErr = isMissingAdv
                    || errMsg.includes('regional_regulat')
                    || errMsg.includes('voluntary_verification')
                    || errMsg.includes('brazil_regulation')
                    || errMsg.includes('spain_finserv')
                    || errMsg.includes('australia_')
                    || errMsg.includes('dsa_beneficiary')
                    || errMsg.includes('dsa_payor');

                if (!retried.has('start_time') && copyAppliedStartTime && errMsg.includes('start_time')) {
                    retried.add('start_time');
                    delete updatePayload.start_time;
                } else if (!retried.has('targeting') && (errMsg.includes('targeting') || errMsg.includes('advantage_audience'))) {
                    retried.add('targeting');
                    updatePayload.targeting = {
                        geo_locations: { countries: [country.code], location_types: ['frequently_in', 'home', 'recent'] }
                    };
                } else if (isRegOrDsaErr) {
                    const onlyDsaRejected = !isMissingAdv && (errMsg.includes('dsa_beneficiary') || errMsg.includes('dsa_payor')) && !errMsg.includes('regional_regulat');
                    let nextIdx = -1;
                    for (let k = complianceIdx + 1; k < complianceAttempts.length; k++) {
                        if (onlyDsaRejected && complianceAttempts[k].dsaBeneficiary) continue;
                        nextIdx = k;
                        break;
                    }
                    if (nextIdx !== -1) {
                        complianceIdx = nextIdx;
                        const nextComp = complianceAttempts[complianceIdx];
                        logMetaTerminal(`🏢 Ajustando Advertiser/Compliance em ${finalName} (${errSub || 'regulação'}) ➔ '${nextComp.label}'...`, 'warn');
                        applyComplianceAttemptToAdSetPayload(updatePayload, nextComp);
                    } else if (!retried.has('reg_strip') && !isMissingAdv) {
                        retried.add('reg_strip');
                        delete updatePayload.regional_regulated_categories;
                        delete updatePayload.regional_regulation_identities;
                        delete updatePayload.dsa_beneficiary;
                        delete updatePayload.dsa_payor;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
                updateData = await postAdSetUpdate(updatePayload);
            }

            if (updateData.error) {
                const uErr = new Error(formatMetaApiError(updateData.error));
                uErr.rawMetaError = updateData.error;
                throw uErr;
            }

            if (complianceIdx >= 0 && complianceAttempts[complianceIdx]) {
                const winningComp = complianceAttempts[complianceIdx];
                workingComplianceByCountry[country.code] = winningComp;
                saveStoredRegionalComplianceConfig(accountId, country.code, winningComp);
                if (complianceIdx > 0 || country.code === 'AU') {
                    logMetaTerminal(`🏢 Advertiser aplicado em ${finalName}: '${winningComp.label}'`, 'info');
                }
            }

            // PASSO 5: Publica anúncios clonados (mesmo idioma), traduzidos (idioma com criativo) ou omite se estrutura exclusiva
            const countryLang = (country.langCode || (block.langCode && block.langCode !== 'multi' ? block.langCode : baseLang) || baseLang).toLowerCase();
            let expectedAds = 0;
            let adsCreated = 0;
            const adErrors = [];
            let countryModeMsg = '';

            const createAdInCopiedSet = async (adName, creativeId, urlTags) => {
                const payload = {
                    name: adName,
                    adset_id: copiedAdSetId,
                    creative: JSON.stringify({ creative_id: creativeId }),
                    status: effectiveStatus
                };
                if (urlTags) payload.url_tags = urlTags;
                return metaGraphPost(`/${META_GRAPH_VERSION}/${metaState.selectedAccountId}/ads`, payload);
            };

            const publishDirectBaseAdWithPageFallback = async (baseAd) => {
                const adDisplayName = baseAd.name || finalName;
                const getOrCreateRescued = async (pId) => {
                    const cacheKey = `${pId}:${baseAd.id || baseAd.creative?.id}`;
                    if (cachedRescuedAdsByBaseId[cacheKey]) return cachedRescuedAdsByBaseId[cacheKey];
                    const res = await rescueBaseAdWithPage({
                        adObj: baseAd,
                        targetPageId: pId,
                        accountId: metaState.selectedAccountId,
                        nicheSlug: campNicheSlug,
                        baseLang,
                        token,
                        campaignId,
                        currentAdsetId: adsetId,
                        videoUploadCache,
                        resolvedImgMap,
                        logFn: logMetaTerminal
                    });
                    if (res && res.creativeId) cachedRescuedAdsByBaseId[cacheKey] = res;
                    return res;
                };

                let initialErr = null;
                let needPageFallback = false;

                if (activeWorkingPageId) {
                    const rescued = await getOrCreateRescued(activeWorkingPageId);
                    if (rescued && rescued.creativeId) {
                        const adRes = await createAdInCopiedSet(adDisplayName, rescued.creativeId, baseAd.url_tags);
                        if (adRes.id) return adRes;
                        initialErr = adRes.error;
                        if (isMetaPagePermissionError(adRes.error) && autoFallbackPage) {
                            blockedPageIds.add(String(activeWorkingPageId));
                            activeWorkingPageId = '';
                            needPageFallback = true;
                        }
                    } else {
                        initialErr = rescued?.error || { message: 'Falha ao recriar anúncio na Página selecionada.' };
                        if ((rescued?.isPagePerm || isMetaPagePermissionError(initialErr)) && autoFallbackPage && !rescued?.isDevMode) {
                            blockedPageIds.add(String(activeWorkingPageId));
                            activeWorkingPageId = '';
                            needPageFallback = true;
                        }
                    }
                } else {
                    const directRes = await createAdInCopiedSet(adDisplayName, baseAd.creative.id, baseAd.url_tags);
                    if (directRes.id) return directRes;
                    initialErr = directRes.error;
                    if (isMetaPagePermissionError(directRes.error) && autoFallbackPage) {
                        const origSpec = extractCreativeTemplateSpec(baseAd.creative || {}, baseAd.creative?.actor_id || '');
                        if (origSpec.pageId) blockedPageIds.add(String(origSpec.pageId));
                        needPageFallback = true;
                    }
                }

                if (!needPageFallback) {
                    return { error: initialErr };
                }

                if (accountPromotePages.length === 0) {
                    try {
                        accountPromotePages = await loadDupPromotePages(metaState.selectedAccountId);
                    } catch (_) { /* keep empty */ }
                }

                const candidates = getAuthorizedCandidatePageIds(metaState.selectedAccountId, blockedPageIds);
                if (candidates.length === 0) {
                    logMetaTerminal('⚠️ Nenhuma outra Página autorizada encontrada nesta conta para substituir a Página bloqueada.', 'warn');
                    return { error: initialErr };
                }

                logMetaTerminal(`🔄 Página atual sem permissão de anunciante (1885499/3858749). Testando ${candidates.length} Página(s) autorizada(s) da conta...`, 'warn');
                let lastErr = initialErr;

                for (const cand of candidates) {
                    if (blockedPageIds.has(String(cand.id))) continue;
                    logMetaTerminal(`🔁 Recriando anúncio '${adDisplayName}' usando Página '${cand.name}' (ID: ${cand.id})...`, 'info');
                    const rescueRes = await getOrCreateRescued(cand.id);
                    if (!rescueRes?.creativeId) {
                        lastErr = rescueRes?.error || lastErr;
                        if (rescueRes?.isDevMode || rescueRes?.isAssetError) break;
                        if (rescueRes?.isPagePerm || isMetaPagePermissionError(lastErr)) {
                            blockedPageIds.add(String(cand.id));
                            logMetaTerminal(`⚠️ Página '${cand.name}' (${cand.id}) também sem permissão no BM, tentando próxima...`, 'warn');
                            continue;
                        }
                        break;
                    }

                    const retryAdRes = await createAdInCopiedSet(adDisplayName, rescueRes.creativeId, baseAd.url_tags);
                    if (retryAdRes.id) {
                        activeWorkingPageId = String(cand.id);
                        logMetaTerminal(`✅ Página '${cand.name}' (ID: ${cand.id}) aceita! Anúncio publicado com novo AdCreative (${rescueRes.creativeId}) — aplicando esta Página nos próximos países.`, 'success');
                        return retryAdRes;
                    }
                    if (retryAdRes.error) {
                        lastErr = retryAdRes.error;
                        if (isMetaPagePermissionError(retryAdRes.error)) {
                            blockedPageIds.add(String(cand.id));
                            logMetaTerminal(`⚠️ Página '${cand.name}' (${cand.id}) também sem permissão para publicar anúncio, tentando próxima...`, 'warn');
                            continue;
                        }
                        break;
                    }
                }

                return { error: lastErr };
            };

            if (countryLang === baseLang) {
                if (preparedSameLangItems.length > 0) {
                    expectedAds = preparedSameLangItems.length;
                    for (const item of preparedSameLangItems) {
                        const adResult = await createAdInCopiedSet(item.adName, item.creativeId, item.urlTags);
                        if (adResult.id) {
                            adsCreated++;
                        } else if (adResult.error) {
                            adErrors.push(adResult.error);
                            logMetaTerminal(`❌ Anúncio '${item.adName}' em ${finalName} falhou: ${formatMetaApiError(adResult.error)}`, 'error');
                            if (stopOnFirstError) break;
                        }
                    }
                    countryModeMsg = adsCreated > 0 ? `com ${adsCreated} anúncio(s) individuais clonado(s)` : 'sem anúncios';
                } else {
                    const validBaseAds = baseAds.filter(b => b.creative && b.creative.id);
                    expectedAds = validBaseAds.length;
                    for (const baseAd of validBaseAds) {
                        const adResult = await publishDirectBaseAdWithPageFallback(baseAd);
                        if (adResult.id) {
                            adsCreated++;
                        } else if (adResult.error) {
                            adErrors.push(adResult.error);
                            logMetaTerminal(`❌ Anúncio '${baseAd.name}' em ${finalName} falhou: ${formatMetaApiError(adResult.error)}`, 'error');
                            if (stopOnFirstError) break;
                        }
                    }
                    countryModeMsg = adsCreated > 0
                        ? `com ${adsCreated} anúncio(s) ${activeWorkingPageId ? `(Página ${activeWorkingPageId})` : 'clonado(s)'}`
                        : 'sem anúncios';
                }
            } else if (Array.isArray(preparedCreativesByLang[countryLang]) && preparedCreativesByLang[countryLang].length > 0) {
                expectedAds = preparedCreativesByLang[countryLang].length;
                for (const item of preparedCreativesByLang[countryLang]) {
                    const adResult = await createAdInCopiedSet(item.adName, item.creativeId, item.urlTags);
                    if (adResult.id) {
                        adsCreated++;
                    } else if (adResult.error) {
                        adErrors.push(adResult.error);
                        logMetaTerminal(`❌ Anúncio traduzido '${item.adName}' em ${finalName} falhou: ${formatMetaApiError(adResult.error)}`, 'error');
                        if (stopOnFirstError) break;
                    }
                }
                countryModeMsg = adsCreated > 0 ? `com ${adsCreated} anúncio(s) traduzido(s) (${countryLang.toUpperCase()})` : 'sem anúncios';
            } else {
                countryModeMsg = `apenas estrutura (sem anúncios — aguardando criativos em ${countryLang.toUpperCase()})`;
            }

            // TRAVA ANTI-CONJUNTO VAZIO: se o conjunto exigia anúncios e falhou, faz rollback e lança erro para parar o lote
            if (expectedAds > 0 && (adsCreated === 0 || (stopOnFirstError && adErrors.length > 0))) {
                const firstAdErr = adErrors[0] || { message: 'Nenhum anúncio pôde ser criado neste conjunto.' };
                if (stopOnFirstError && copiedAdSetId && adsCreated === 0) {
                    await rollbackOrphanMetaAdSet(copiedAdSetId, finalName, logMetaTerminal);
                    copiedAdSetId = '';
                }
                const adErrObj = new Error(`Anúncio falhou (${adsCreated}/${expectedAds} criados): ${formatMetaApiError(firstAdErr)}`);
                adErrObj.rawMetaError = firstAdErr;
                adErrObj.isCircuitBreaker = Boolean(firstAdErr.is_circuit_breaker);
                throw adErrObj;
            }

            successCount++;
            const schedTag = isScheduled ? ` [Programado: ${launchChoice.schedulePtBr}]` : '';
            logMetaTerminal(`✅ [${currentIdx}/${total}] Conjunto '${finalName}' criado ${countryModeMsg}${schedTag}! (ID: ${copiedAdSetId})`, 'success');

            // Registra o novo conjunto no estado local e atualiza os cards/badges em tempo real
            metaState.adsets.push({
                id: copiedAdSetId,
                name: finalName,
                status: effectiveStatus,
                start_time: scheduledMetaStartTime || undefined,
                targeting: targeting
            });
            if (metaState.checkedCountries[metaState.activeBlockId]) {
                metaState.checkedCountries[metaState.activeBlockId][country.adSetName] = false;
            }
            renderBlockNav();
            renderCountriesGrid();

        } catch (err) {
            failCount++;
            console.error(`Erro ao duplicar para ${country.adSetName}:`, err);
            logMetaTerminal(`❌ [${currentIdx}/${total}] Falha em '${finalName}': ${err.message}`, 'error');

            if (stopOnFirstError && copiedAdSetId) {
                await rollbackOrphanMetaAdSet(copiedAdSetId, finalName, logMetaTerminal);
                copiedAdSetId = '';
            }

            if (err.isCircuitBreaker || /Proteção anti-rajada ativa|rate limit/i.test(err.message || '')) {
                abortedReason = 'Pausado pelo Circuit Breaker anti-rajada.';
                logMetaTerminal('🛑 Lote pausado automaticamente pelo Circuit Breaker para proteger o App Meta contra bloqueios. Veja o Status do App na Visão Geral.', 'warn');
                break;
            }

            if (stopOnFirstError) {
                const remaining = total - currentIdx;
                abortedReason = err.message;
                abortedPagePerm = isMetaPagePermissionError(err.rawMetaError || err.message);
                const isMissingAdv = !abortedPagePerm && isMetaMissingAdvertiserError(err.rawMetaError || err.message);
                if (isMissingAdv) {
                    abortedAdvCountry = { name: country.adSetName, code: country.code };
                }
                logMetaTerminal(
                    `🛑 Trava Anti-Conjunto Vazio acionada: lote interrompido em [${currentIdx}/${total}] para não criar ${remaining > 0 ? `os outros ${remaining} conjunto(s)` : 'conjuntos'} sem anúncios!`,
                    'warn'
                );
                if (abortedPagePerm) {
                    buildMetaPagePermissionHint(detectedBasePageId).split('\n').forEach(line => {
                        if (line.trim()) logMetaTerminal(line, 'warn');
                    });
                } else if (abortedAdvCountry) {
                    buildMetaAdvertiserHelpHint(abortedAdvCountry.name, abortedAdvCountry.code, regCtx).split('\n').forEach(line => {
                        if (line.trim()) logMetaTerminal(line, 'warn');
                    });
                }
                break;
            }
        }

        // Breve intervalo para respeitar taxa da Meta
        await new Promise(r => setTimeout(r, 350));
    }

    const elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(1);

    // Finalização
    if (!abortedReason) {
        if (progressFill) progressFill.style.width = '100%';
        if (progressPct) progressPct.innerText = '100%';
        if (progressStatus) progressStatus.innerText = 'Duplicação concluída!';
        if (termStatus) termStatus.innerText = 'Concluído';
    } else {
        if (progressStatus) progressStatus.innerText = `🛑 Interrompido (${successCount} criado(s), ${failCount} falha)`;
        if (termStatus) {
            termStatus.innerText = abortedPagePerm
                ? 'Bloqueado (Permissão na Página)'
                : (abortedAdvCountry ? `Bloqueado (Advertiser ${abortedAdvCountry.code})` : 'Interrompido por erro');
        }
    }

    finishDuplicationUi();

    logMetaTerminal(
        abortedReason
            ? `🛑 Operação interrompida em ${elapsedSecs}s! Sucesso: ${successCount} | Falhas: ${failCount} (conjuntos vazios evitados/revertidos).`
            : `🎉 Operação finalizada em ${elapsedSecs}s! Sucesso: ${successCount} | Falhas: ${failCount}`,
        abortedReason ? 'warning' : (successCount > 0 ? 'success' : 'warning')
    );

    if (abortedReason && failCount > 0) {
        const extraHint = abortedPagePerm
            ? `\n\n${buildMetaPagePermissionHint(detectedBasePageId)}`
            : (abortedAdvCountry ? `\n\n${buildMetaAdvertiserHelpHint(abortedAdvCountry.name, abortedAdvCountry.code, regCtx)}` : '');
        alert(
            `🛑 LOTE INTERROMPIDO NO 1º ERRO (CONJUNTOS VAZIOS EVITADOS):\n\n` +
            `• Motivo: ${abortedReason}\n` +
            `• Conjuntos completos salvos antes do erro: ${successCount}\n` +
            `• O conjunto que falhou sem anúncio foi excluído automaticamente na Meta e os países pendentes continuam marcados para você retomar após corrigir.${extraHint}`
        );
    }
    refreshMetaAppHealth(false);
}

// Helpers compartilhados de Token Meta (Configurações e Duplicador)
function toggleTokenVisibility(inputId = 'meta-token-input', btnId = 'btn-toggle-token-vis') {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (!input || !btn) return;

    if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = '🔒 Ocultar';
    } else {
        input.type = 'password';
        btn.innerText = '👁️ Ver';
    }
}

async function testMetaTokenFromUI(inputId = 'meta-token-input', resultBoxId = 'meta-token-test-result') {
    const tokenInput = document.getElementById(inputId);
    const resultBox = document.getElementById(resultBoxId);
    const manualToken = tokenInput ? tokenInput.value.trim() : '';

    if (!manualToken && !metaState.hasServerToken) {
        alert('Por favor, cole um Token de Acesso ou configure META_ACCESS_TOKEN no servidor.');
        return;
    }

    if (resultBox) {
        resultBox.className = '';
        resultBox.style.background = 'rgba(59, 130, 246, 0.15)';
        resultBox.style.color = '#3b82f6';
        resultBox.innerText = manualToken
            ? '🔍 Validando token manual junto à Graph API da Meta...'
            : '🔍 Testando token definitivo configurado no servidor...';
        resultBox.classList.remove('twod-hidden');
    }

    try {
        const data = await metaGraphGet(`/${META_GRAPH_VERSION}/me?fields=id,name,permissions`, manualToken || null);

        if (data.error) {
            if (resultBox) {
                resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
                resultBox.style.color = '#ef4444';
                resultBox.innerText = `❌ Erro no Token: ${data.error.message}`;
            }
            return;
        }

        const perms = (data.permissions && data.permissions.data)
            ? data.permissions.data.filter(p => p.status === 'granted').map(p => p.permission).join(', ')
            : 'public_profile';

        if (resultBox) {
            resultBox.style.background = 'rgba(16, 185, 129, 0.15)';
            resultBox.style.color = '#10b981';
            resultBox.innerHTML = `<strong>✅ Token Válido e Ativo!</strong><br>` +
                `Usuário: <b>${data.name}</b> (ID: ${data.id})<br>` +
                `Permissões ativas: <code>${perms}</code>`;
        }
    } catch (e) {
        if (resultBox) {
            resultBox.style.background = 'rgba(239, 68, 68, 0.15)';
            resultBox.style.color = '#ef4444';
            resultBox.innerText = `❌ Falha de rede: ${e.message}`;
        }
    }
}

async function saveMetaSettingsFromUI(source = 'configuracoes') {
    const cfgTokenInput = document.getElementById('meta-token-input');
    const dupTokenInput = document.getElementById('duplicador-token-input');
    const cbTokenInput = document.getElementById('cb-token-input');
    const accountInput = document.getElementById('meta-default-account-input');

    const primaryTokenInput = (source === 'duplicador' && dupTokenInput)
        ? dupTokenInput
        : (source === 'campaign_builder' && cbTokenInput ? cbTokenInput : cfgTokenInput);
    const token = primaryTokenInput ? primaryTokenInput.value.trim() : '';
    const accountId = (source === 'configuracoes' && accountInput)
        ? accountInput.value.trim()
        : (metaState.defaultAccountId || '');

    // Mantém todos os inputs de token sincronizados
    if (cfgTokenInput) cfgTokenInput.value = token;
    if (dupTokenInput) dupTokenInput.value = token;
    if (cbTokenInput) cbTokenInput.value = token;

    if (token) {
        metaState.token = token;
        localStorage.setItem(STORAGE_KEYS.META_TOKEN, token);
    } else {
        metaState.token = '';
        localStorage.removeItem(STORAGE_KEYS.META_TOKEN);
    }

    if (source === 'configuracoes') {
        if (accountId) {
            metaState.defaultAccountId = accountId;
            localStorage.setItem(STORAGE_KEYS.META_ACCOUNT, accountId);
        } else {
            metaState.defaultAccountId = '';
            localStorage.removeItem(STORAGE_KEYS.META_ACCOUNT);
        }
    }

    // Salva no backend autenticado apenas se for Administrador (evita expor ou apagar token do servidor)
    if (currentUser && currentUser.role === 'Administrador') {
        try {
            const cfgPayload = { default_account_id: accountId };
            if (token && !metaState.isCloud) {
                cfgPayload.meta_access_token = token;
            }
            await apiFetch('/api/meta/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cfgPayload)
            });
        } catch (e) {
            // Ignora falhas não críticas ao salvar conta padrão
        }
    }

    if (!token) {
        if (metaState.hasServerToken) {
            alert('Token manual removido do navegador. Usando o token definitivo do servidor!');
            testAndReloadMetaApi(true);
            return;
        }
        metaState.user = null;
        metaState.accounts = [];
        metaState.campaigns = [];
        metaState.adsets = [];
        metaState.initialized = false;
        updateMetaStatusUI(false, 'Token removido.');
        alert('Token removido com sucesso!');
        return;
    }

    alert('Token temporário salvo com sucesso no seu navegador!');
    testAndReloadMetaApi(true);
}

async function saveGeminiSettingsFromUI() {
    const keyInput = document.getElementById('gemini-api-key-input');
    const statusEl = document.getElementById('gemini-key-save-status');
    const keyVal = keyInput ? keyInput.value.trim() : '';

    if (statusEl) {
        statusEl.textContent = '⏳ Salvando chave Gemini...';
        statusEl.style.color = '#93c5fd';
    }

    try {
        if (!keyVal) {
            if (!confirm('O campo da Gemini API Key está vazio. Deseja remover a chave salva no servidor?')) {
                if (statusEl) statusEl.textContent = '';
                return;
            }
        }
        const resp = await apiFetch('/api/meta/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gemini_api_key: keyVal })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            throw new Error(data.error || `Erro HTTP ${resp.status}`);
        }
        metaState.hasGeminiKey = Boolean(data.has_gemini_key);
        if (keyInput) keyInput.value = '';
        refreshGeminiServerBanner();
        if (statusEl) {
            statusEl.textContent = metaState.hasGeminiKey
                ? (metaState.isCloud
                    ? '✅ Salva na sessão do Render! (Para manter após redeploy, adicione GEMINI_API_KEY nas Environment Variables do Render).'
                    : '✅ Gemini API Key salva no servidor (.env) com segurança!')
                : '🗑️ Gemini API Key removida do servidor.';
            statusEl.style.color = metaState.hasGeminiKey ? '#34d399' : '#fbbf24';
        }
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = `❌ Erro ao salvar: ${e.message}`;
            statusEl.style.color = '#f87171';
        } else {
            alert(`Erro ao salvar chave Gemini: ${e.message}`);
        }
    }
}

async function saveCloudflareSettingsFromUI() {
    const accInput = document.getElementById('cloudflare-account-id-input');
    const tokInput = document.getElementById('cloudflare-api-token-input');
    const statusEl = document.getElementById('cloudflare-save-status');
    const accVal = accInput ? accInput.value.trim() : '';
    const tokVal = tokInput ? tokInput.value.trim() : '';

    if ((accVal && !tokVal) || (!accVal && tokVal)) {
        if (statusEl) {
            statusEl.textContent = '⚠️ Informe tanto o Account ID quanto o API Token da Cloudflare.';
            statusEl.style.color = '#fbbf24';
        }
        return;
    }

    if (statusEl) {
        statusEl.textContent = '⏳ Salvando credenciais Cloudflare...';
        statusEl.style.color = '#93c5fd';
    }

    try {
        if (!accVal && !tokVal) {
            if (!confirm('Os campos da Cloudflare estão vazios. Deseja remover as credenciais salvas no servidor?')) {
                if (statusEl) statusEl.textContent = '';
                return;
            }
        }
        const resp = await apiFetch('/api/meta/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cloudflare_account_id: accVal,
                cloudflare_api_token: tokVal
            })
        });
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            throw new Error(data.error || `Erro HTTP ${resp.status}`);
        }
        metaState.hasCloudflare = Boolean(data.has_cloudflare);
        if (accInput) accInput.value = '';
        if (tokInput) tokInput.value = '';
        refreshCloudflareServerBanner();
        if (statusEl) {
            statusEl.textContent = metaState.hasCloudflare
                ? (metaState.isCloud
                    ? '✅ Salvo na sessão do Render! (Para manter após redeploy, adicione CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_API_TOKEN nas Environment Variables).'
                    : '✅ Credenciais Cloudflare salvas no servidor (.env) com segurança!')
                : '🗑️ Credenciais Cloudflare removidas do servidor.';
            statusEl.style.color = metaState.hasCloudflare ? '#34d399' : '#fbbf24';
        }
    } catch (e) {
        if (statusEl) {
            statusEl.textContent = `❌ Erro ao salvar: ${e.message}`;
            statusEl.style.color = '#f87171';
        } else {
            alert(`Erro ao salvar Cloudflare: ${e.message}`);
        }
    }
}

// Expõe funções globais para compatibilidade total com onclick
window.switchTab = switchTab;
window.setThemeMode = setThemeMode;
window.openAddSiteModal = openAddSiteModal;
window.closeModal = closeModal;
window.openAddUserModal = openAddUserModal;
window.connectOneDriveCloudAPI = connectOneDriveCloudAPI;
window.saveBackendUrlFromUI = saveBackendUrlFromUI;
window.connectOneDriveFolder = connectOneDriveFolder;
window.scanOneDriveFiles = scanOneDriveFiles;
window.playAudio = playAudio;
window.closeAudioPlayer = closeAudioPlayer;
window.changeMyPassword = changeMyPassword;
window.handleLogin = handleLogin;
window.submitForcedPasswordChange = submitForcedPasswordChange;
window.showLogin = showLogin;
window.showApp = showApp;
window.toggleChangelogHistory = toggleChangelogHistory;

// Funções Meta Ads & Duplicador
window.reloadMetaAccounts = loadMetaAccounts;
window.loadDupPromotePages = loadDupPromotePages;
window.loadDupAdvertiserEntities = loadDupAdvertiserEntities;
window.onDupAdvertiserEntityChanged = onDupAdvertiserEntityChanged;
window.buildRegionalComplianceAttempts = buildRegionalComplianceAttempts;
window.isMetaMissingAdvertiserError = isMetaMissingAdvertiserError;
window.onMetaAccountSelected = onMetaAccountSelected;
window.onMetaCampaignSelected = onMetaCampaignSelected;
window.onMetaAdSetSelected = onMetaAdSetSelected;
window.selectCountryBlock = selectCountryBlock;
window.toggleAllCountriesInBlock = toggleAllCountriesInBlock;
window.selectPriorityCountriesOnly = selectPriorityCountriesOnly;
window.selectMissingCountriesOnly = selectMissingCountriesOnly;
window.startBatchDuplication = startBatchDuplication;
window.stopBatchDuplication = stopBatchDuplication;
window.rollbackOrphanMetaAdSet = rollbackOrphanMetaAdSet;
window.isMetaPagePermissionError = isMetaPagePermissionError;
window.buildMetaPagePermissionHint = buildMetaPagePermissionHint;
window.getNextTargetTimeLocalInput = getNextTargetTimeLocalInput;
window.formatMetaStartTimeIso = formatMetaStartTimeIso;
window.onDupScheduleModeChanged = onDupScheduleModeChanged;
window.presetDupInlineTime = presetDupInlineTime;
window.syncDupLaunchModalScheduleUI = syncDupLaunchModalScheduleUI;
window.applyDupModalTimePreset = applyDupModalTimePreset;
window.confirmDuplicatorLaunchModal = confirmDuplicatorLaunchModal;
window.resolveDuplicatorLaunchModal = resolveDuplicatorLaunchModal;
window.clearMetaLog = clearMetaLog;
window.copyMetaLog = copyMetaLog;
window.toggleDuplicatorTokenBox = toggleDuplicatorTokenBox;
window.toggleTokenVisibility = toggleTokenVisibility;
window.testMetaTokenFromUI = testMetaTokenFromUI;
window.saveMetaSettingsFromUI = saveMetaSettingsFromUI;
window.loadCampaignCreativeLinks = loadCampaignCreativeLinks;
window.linkCampaignToPack = linkCampaignToPack;
window.unlinkCampaignFromPack = unlinkCampaignFromPack;
window.loadNicheCandidatePacks = loadNicheCandidatePacks;
window.updateDuplicatorLanguageNotice = updateDuplicatorLanguageNotice;
window.openThumbZoomModal = openThumbZoomModal;
window.closeThumbZoomModal = closeThumbZoomModal;
window.formatMetaApiError = formatMetaApiError;
window.refreshLinkedPackAndNotice = refreshLinkedPackAndNotice;
window.handleManualDuplicatorVideos = handleManualDuplicatorVideos;
window.saveGeminiSettingsFromUI = saveGeminiSettingsFromUI;
window.refreshGeminiServerBanner = refreshGeminiServerBanner;
window.saveCloudflareSettingsFromUI = saveCloudflareSettingsFromUI;
window.refreshCloudflareServerBanner = refreshCloudflareServerBanner;
window.metaState = metaState;

// ========================================================
// INICIALIZAÇÃO INFALÍVEL (EXECUTA IMEDIATO SE DOM JÁ CARREGADO)
// ========================================================
function startApp() {
    checkSession();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}




