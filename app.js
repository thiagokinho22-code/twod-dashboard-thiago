// ========================================================
// TWOD HUB — MOTOR JAVASCRIPT DA DASHBOARD
// ========================================================

const STORAGE_KEYS = {
    USERS: 'twod_users_db',
    CURRENT_USER: 'twod_logged_user',
    SITES: 'twod_fun_sites',
    ACTIVE_TAB: 'twod_active_tab',
    META_TOKEN: 'twod_meta_token',
    META_ACCOUNT: 'twod_meta_default_account'
};

// 1. DADOS INICIAIS (SEED) SE NÃO EXISTIREM
const DEFAULT_USERS = [
    {
        id: 'usr_thiago',
        username: 'thiago',
        name: 'Thiago',
        role: 'Administrador',
        password: '123456',
        themeMode: 'dark', // 'light', 'dark', 'auto'
        scheduleStart: '06:00',
        scheduleEnd: '18:00',
        lastLogin: 'Agora'
    },
    {
        id: 'usr_alexandre',
        username: 'alexandre',
        name: 'Alexandre',
        role: 'Operador',
        password: '123456',
        themeMode: 'dark',
        scheduleStart: '06:00',
        scheduleEnd: '18:00',
        lastLogin: 'Ontem'
    },
    {
        id: 'usr_wesley',
        username: 'wesley',
        name: 'Wesley',
        role: 'Operador',
        password: '123456',
        themeMode: 'auto',
        scheduleStart: '07:00',
        scheduleEnd: '19:00',
        lastLogin: 'Há 2 dias'
    }
];

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

// Estado da Aplicação Seguro com Tratamento de Exceção
let users = [...DEFAULT_USERS];
try {
    const rawUsers = localStorage.getItem(STORAGE_KEYS.USERS);
    if (rawUsers) {
        const parsed = JSON.parse(rawUsers);
        if (Array.isArray(parsed) && parsed.length > 0) users = parsed;
    }
} catch (e) {
    console.warn('Recuperando usuários padrão devido a erro no localStorage:', e);
    users = [...DEFAULT_USERS];
}

// Migração automática: atualiza 'auxiliar2' para 'wesley' se existir no localStorage anterior
let migrated = false;
users = users.map(u => {
    if (u && u.username === 'auxiliar2') {
        migrated = true;
        return { ...u, id: 'usr_wesley', username: 'wesley', name: 'Wesley' };
    }
    return u;
});
if (migrated) {
    try { localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users)); } catch (e) { }
}

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

// Limpa qualquer sessão prévia para SEMPRE exigir login ao abrir o painel
try {
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
} catch (e) { }

let currentUser = null;

function saveUsers() {
    try { localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users)); } catch (e) { }
}

function saveSites() {
    try { localStorage.setItem(STORAGE_KEYS.SITES, JSON.stringify(sites)); } catch (e) { }
}

// ========================================================
// SISTEMA DE AUTENTICAÇÃO E SESSÃO
// ========================================================

function checkSession() {
    // Sempre exibe a tela de login ao abrir o TwoD Hub
    showLogin();
}

function showLogin() {
    currentUser = null;
    try { localStorage.removeItem(STORAGE_KEYS.CURRENT_USER); } catch (e) { }

    const loginEl = document.getElementById('login-screen');
    const appEl = document.getElementById('app-container');
    const errBox = document.getElementById('login-error');
    const pwdInput = document.getElementById('login-password');

    if (loginEl) {
        loginEl.style.display = 'flex';
        loginEl.classList.remove('twod-hidden');
    }
    if (appEl) {
        appEl.style.display = 'none';
        appEl.classList.add('twod-hidden');
    }
    if (errBox) errBox.classList.add('twod-hidden');
    if (pwdInput) pwdInput.value = '';
}

function showApp() {
    if (!currentUser) {
        showLogin();
        return;
    }

    const loginEl = document.getElementById('login-screen');
    const appEl = document.getElementById('app-container');

    if (loginEl) {
        loginEl.style.display = 'none';
        loginEl.classList.add('twod-hidden');
    }
    if (appEl) {
        appEl.style.display = 'flex';
        appEl.classList.remove('twod-hidden');
    }

    const nameEl = document.getElementById('current-user-name');
    const roleEl = document.getElementById('current-user-role');
    const avatarEl = document.getElementById('current-user-avatar');
    if (nameEl) nameEl.innerText = currentUser.name || 'Usuário';
    if (roleEl) roleEl.innerText = currentUser.role || 'Operador';
    if (avatarEl) avatarEl.innerText = (currentUser.name || 'U').charAt(0).toUpperCase();

    // Controle de permissão: esconde abas de admin para operadores
    const isAdmin = currentUser.role === 'Administrador';
    document.querySelectorAll('.admin-only').forEach(el => {
        if (isAdmin) {
            el.classList.remove('twod-hidden');
        } else {
            el.classList.add('twod-hidden');
        }
    });

    try { applyUserTheme(); } catch (e) { }
    try { renderSitesTable(); } catch (e) { }
    if (isAdmin) {
        try { renderUsersTable(); } catch (e) { }
    }
    try { initTabs(); } catch (e) { }
}

function handleLogin(e) {
    if (e && e.preventDefault) {
        e.preventDefault();
        e.stopPropagation();
    }
    try {
        const uEl = document.getElementById('login-username');
        const pEl = document.getElementById('login-password');
        const usernameInput = (uEl ? uEl.value : '').trim().toLowerCase();
        const passwordInput = (pEl ? pEl.value : '');

        if (!usernameInput || !passwordInput) {
            alert('Por favor, digite o usuário e a senha.');
            return false;
        }

        if (!Array.isArray(users)) users = [...DEFAULT_USERS];

        let user = users.find(u => u && u.username && u.username.toLowerCase() === usernameInput && u.password === passwordInput);

        if (!user) {
            const defaultMatch = DEFAULT_USERS.find(u => u.username.toLowerCase() === usernameInput && u.password === passwordInput);
            if (defaultMatch) {
                user = { ...defaultMatch };
                users.push(user);
                saveUsers();
            }
        }

        const errBox = document.getElementById('login-error');
        if (user) {
            user.lastLogin = 'Agora';
            saveUsers();
            currentUser = user;
            if (errBox) errBox.classList.add('twod-hidden');
            showApp();
        } else {
            if (errBox) errBox.classList.remove('twod-hidden');
        }
    } catch (err) {
        console.error('Erro no handleLogin:', err);
    }
    return false;
}

const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
}

function quickLogin(username, password) {
    const uInput = document.getElementById('login-username');
    const pInput = document.getElementById('login-password');
    if (uInput) uInput.value = username;
    if (pInput) pInput.value = password;
    handleLogin();
}

const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
    btnLogout.addEventListener('click', (e) => {
        if (e && e.preventDefault) e.preventDefault();
        currentUser = null;
        try { localStorage.removeItem(STORAGE_KEYS.CURRENT_USER); } catch (e) { }
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

function saveUserPreferences() {
    const idx = users.findIndex(u => u.username === currentUser.username);
    if (idx !== -1) {
        users[idx] = currentUser;
        saveUsers();
    }
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

function initTabs() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (e && e.preventDefault) e.preventDefault();
            const tabId = btn.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    const savedTab = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) || 'visao-geral';
    switchTab(savedTab);
}

function switchTab(tabId) {
    if (!tabId) return;

    // Permissão: se tentar abrir usuário sem ser admin, volta para visão geral
    const isAdmin = currentUser && currentUser.role === 'Administrador';
    if (tabId === 'usuarios' && !isAdmin) {
        tabId = 'visao-geral';
    }

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

    // Atualiza contadores
    const totalVisiveis = sites.filter(s => !s.hidden).length;
    document.getElementById('badge-total-sites').innerText = totalVisiveis;
    document.getElementById('sites-counter-text').innerText = `${totalVisiveis} sites ativos na fila (${sites.length - totalVisiveis} ocultos em teste)`;
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
// GESTÃO DE USUÁRIOS (ADMIN ONLY)
// ========================================================

function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    users.forEach(u => {
        const tr = document.createElement('tr');
        const isSelf = u.username === currentUser.username;

        tr.innerHTML = `
            <td>
                <strong>${u.name}</strong> 
                <span style="font-size: 11px; color: var(--text-muted);">(@${u.username})</span>
                ${isSelf ? '<span class="badge-status status-active" style="margin-left: 6px;">Você</span>' : ''}
            </td>
            <td><span class="badge-tag">${u.role}</span></td>
            <td>${u.themeMode === 'auto' ? '⏰ Automático' : (u.themeMode === 'light' ? '☀️ Claro' : '🌙 Escuro')}</td>
            <td><span style="color: var(--text-muted); font-size: 12px;">${u.lastLogin || 'Nunca'}</span></td>
            <td>
                ${!isSelf ? `
                    <button class="btn-icon-action" onclick="resetUserPassword('${u.username}')" title="Resetar Senha">🔑</button>
                    <button class="btn-icon-action" onclick="deleteUser('${u.username}')" title="Excluir Usuário">🗑️</button>
                ` : `<span style="font-size: 11px; color: var(--text-muted);">Conta ativa</span>`}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function openAddUserModal() {
    document.getElementById('modal-user').classList.remove('twod-hidden');
}

function saveNewUser(e) {
    e.preventDefault();
    const name = document.getElementById('new-user-name').value.trim();
    const pwd = document.getElementById('new-user-pwd').value;
    const role = document.getElementById('new-user-role').value;

    const username = name.toLowerCase().replace(/\s+/g, '');

    if (users.find(u => u.username === username)) {
        alert('Este nome de usuário já existe!');
        return;
    }

    const newUser = {
        id: 'usr_' + Date.now(),
        username,
        name,
        role,
        password: pwd,
        themeMode: 'dark',
        scheduleStart: '06:00',
        scheduleEnd: '18:00',
        lastLogin: 'Nunca'
    };

    users.push(newUser);
    saveUsers();
    renderUsersTable();
    closeModal('modal-user');
    document.getElementById('form-add-user').reset();
    alert(`Usuário @${username} criado com sucesso!`);
}

function resetUserPassword(username) {
    const target = users.find(u => u.username === username);
    if (!target) return;
    const nova = prompt(`Digite a nova senha para ${target.name}:`, '123456');
    if (nova) {
        target.password = nova;
        saveUsers();
        renderUsersTable();
        alert('Senha alterada com sucesso!');
    }
}

function deleteUser(username) {
    if (confirm(`Deseja realmente remover o usuário @${username}?`)) {
        users = users.filter(u => u.username !== username);
        saveUsers();
        renderUsersTable();
    }
}

// ========================================================
// INTEGRAÇÃO ONEDRIVE & LEITOR DE ARQUIVOS NATIVO
// ========================================================

const API_BASE_URL = (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'))
    ? window.location.origin
    : 'http://localhost:8000';

let oneDriveHandle = null;
let oneDriveData = {
    isApiMode: false,
    niches: [], // array de objetos de cada nicho
    audioFilesMap: new Map(), // chave: `${nicheName}_${lang}` -> File/Handle
    videoFilesMap: new Map()  // chave: `${nicheName}_${num}` -> File/Handle
};

// 1. Conexão Automática via API Backend
async function checkBackendAPI() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/status`);
        if (!res.ok) return false;
        const data = await res.json();
        if (data.status === 'online' && data.onedrive_accessible) {
            console.log('✅ Backend API detectado:', data);
            await loadNichesFromAPI();
            return true;
        }
    } catch (e) {
        console.log('Backend API não detectado localmente.');
    }
    return false;
}

async function loadNichesFromAPI() {
    const badge = document.getElementById('onedrive-connection-badge');
    const folderTitle = document.getElementById('onedrive-folder-title');
    const folderDesc = document.getElementById('onedrive-folder-desc');
    const connectActions = document.querySelector('.onedrive-connect-actions');
    const rescanBtn = document.getElementById('btn-rescan-onedrive');

    if (badge) {
        badge.className = 'badge-tag';
        badge.style.color = '#10b981';
        badge.textContent = `🟢 Backend API Conectado (127.0.0.1:8000)`;
    }
    if (folderTitle) folderTitle.textContent = `OneDrive Nuvem (via Backend API)`;
    if (folderDesc) folderDesc.textContent = `Carregando nichos via API...`;
    if (rescanBtn) {
        rescanBtn.style.display = 'inline-flex';
        rescanBtn.onclick = () => loadNichesFromAPI();
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/onedrive/niches`);
        const json = await res.json();
        if (json.success && json.niches) {
            oneDriveData.niches = json.niches;
            oneDriveData.isApiMode = true;
            renderOneDriveStatsAndTable();
            if (folderDesc) folderDesc.textContent = `Sincronizado via API! ${json.count} nichos disponíveis no OneDrive.`;
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

    filterNichesTable();
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
        audioElement.src = `${API_BASE_URL}${audio.url}`;
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
            }
        }
    } catch (e) {
        console.log('Nenhum handle pré-salvo do OneDrive.');
    }
}

function changeMyPassword() {
    const input = document.getElementById('change-pwd-input');
    const nova = input.value.trim();
    if (!nova) {
        alert('Por favor, digite a nova senha.');
        return;
    }
    currentUser.password = nova;
    saveUserPreferences();
    input.value = '';
    alert('Sua senha foi alterada com sucesso!');
}

// ========================================================
// META MARKETING API & DUPLICADOR POR BLOCOS DE PAÍSES
// ========================================================

const META_DEFAULT_TOKEN = 'EAAO1VpZB2A6kBSz2fdMv3hhG5g5NZAUZC13I1NB2ZCDxt1C8Nzjd3jGJZCBa41fzxNA5SRnHWdvBFm37Azq8wajZARsiEn1bPSgHINCARZAbaM7631DTjCUdOyiGHpu7LsPN6ihXdjAyrecZC9HsFT2S3Ny3nRZBWIW5jllZBWghk5paaw5fngnqn165rlNPV1TtxRGWZAuNh4ZCjMTv1pFrJZCxNVzX4lkoCS052CVYCGE5U0eZCp7yGPiks4Gl1LS1nPa6tn6ZBsJGOa5tZAxRLSevneEH0vToifm3';
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
    activeBlockId: 'BLOCO-01',
    checkedCountries: {},
    isDuplicating: false,
    initialized: false
};

function getMetaToken() {
    return metaState.token || META_DEFAULT_TOKEN;
}

// Inicializa a API do Meta
async function initMetaApi() {
    // 1. Tenta sincronizar com o backend local caso esteja rodando
    try {
        const resp = await fetch('/api/meta/config');
        if (resp.ok) {
            const data = await resp.json();
            if (data.meta_access_token) {
                metaState.token = data.meta_access_token;
                localStorage.setItem(STORAGE_KEYS.META_TOKEN, data.meta_access_token);
            }
            if (data.default_account_id) {
                metaState.defaultAccountId = data.default_account_id;
                localStorage.setItem(STORAGE_KEYS.META_ACCOUNT, data.default_account_id);
            }
        }
    } catch (e) {
        // Backend não rodando localmente (ex: GitHub Pages), usa localStorage ou token padrão
    }

    // 2. Renderiza abas de blocos de países
    renderBlockNav();
    selectCountryBlock('BLOCO-01');

    // 3. Valida token e carrega contas
    await testAndReloadMetaApi(false);
}

// Quando a aba de duplicador for aberta
function onDuplicatorTabOpened() {
    if (!metaState.initialized) {
        testAndReloadMetaApi(false);
    }
}

// Quando a aba de configurações for aberta
function onSettingsTabOpened() {
    const tokenInput = document.getElementById('meta-token-input');
    const accountInput = document.getElementById('meta-default-account-input');
    if (tokenInput) tokenInput.value = metaState.token || '';
    if (accountInput) accountInput.value = metaState.defaultAccountId || '';
}

// Testa e recarrega contas da Meta
async function testAndReloadMetaApi(forceReload = false) {
    const token = getMetaToken();
    if (!token) return;

    try {
        const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me?access_token=${encodeURIComponent(token)}&fields=id,name,permissions`);
        const data = await res.json();

        if (data.error) {
            console.error('Erro na Meta API:', data.error);
            updateMetaStatusUI(false, data.error.message);
            return;
        }

        metaState.user = data;
        metaState.initialized = true;
        updateMetaStatusUI(true, null, data);

        // Carrega contas
        await loadMetaAccounts(forceReload);

    } catch (err) {
        console.error('Falha de rede ao conectar à Meta API:', err);
        updateMetaStatusUI(false, err.message);
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

    if (isSuccess && userData) {
        if (badgeOverview) {
            badgeOverview.className = 'badge-status status-active';
            badgeOverview.innerText = '🟢 Conectado';
        }
        if (userHeading) userHeading.innerText = `Meta Marketing API (${userData.name})`;
        if (statusDesc) statusDesc.innerText = `Conexão ativa com Graph API ${META_GRAPH_VERSION}. Token com permissão total em todas as BMs.`;
        if (cardSubinfo) cardSubinfo.innerText = `${userData.name} (ID: ${userData.id})`;

        if (dupName) dupName.innerText = userData.name;
        if (dupBadge) {
            dupBadge.className = 'badge-status status-active';
            dupBadge.innerText = `🟢 Meta API ${META_GRAPH_VERSION} Online`;
        }
        if (dupSub) dupSub.innerText = `ID: ${userData.id} • Permissões ativas: ads_management, ads_read, business_management`;
    } else {
        if (badgeOverview) {
            badgeOverview.className = 'badge-status status-pending';
            badgeOverview.innerText = '🔴 Erro de Conexão';
        }
        if (statusDesc) statusDesc.innerText = `Falha ao validar token: ${errorMessage || 'Token expirado ou inválido'}`;
        if (dupBadge) {
            dupBadge.className = 'badge-status status-pending';
            dupBadge.innerText = '🔴 Desconectado';
        }
        if (dupSub) dupSub.innerText = `Erro: ${errorMessage || 'Verifique o token nas configurações'}`;
    }
}

// Busca a lista de contas de anúncio do usuário
async function loadMetaAccounts(forceReload = false) {
    const token = getMetaToken();
    const select = document.getElementById('select-meta-account');
    const countLabel = document.getElementById('label-account-count');

    if (!select) return;

    if (metaState.accounts.length > 0 && !forceReload) {
        populateAccountsSelect(metaState.accounts);
        return;
    }

    if (countLabel) countLabel.innerText = '(Buscando contas...)';

    try {
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/adaccounts?access_token=${encodeURIComponent(token)}&fields=id,name,account_id,account_status,currency,amount_spent&limit=150`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.data && Array.isArray(data.data)) {
            // Ordena ativas primeiro
            const sorted = data.data.sort((a, b) => {
                if (a.account_status === 1 && b.account_status !== 1) return -1;
                if (a.account_status !== 1 && b.account_status === 1) return 1;
                return (a.name || '').localeCompare(b.name || '');
            });

            metaState.accounts = sorted;
            populateAccountsSelect(sorted);

            if (countLabel) countLabel.innerText = `(${sorted.length} contas encontradas)`;
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

    let defaultToSelect = '';

    accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.id; // Ex: act_522793227047438
        const statusLabel = acc.account_status === 1 ? '🟢' : '⏸️';
        opt.innerText = `${statusLabel} ${acc.name || 'Sem nome'} (${acc.id}) [${acc.currency || 'USD'}]`;
        select.appendChild(opt);

        if (!defaultToSelect) {
            if (acc.id === metaState.defaultAccountId) {
                defaultToSelect = acc.id;
            } else if (acc.account_status === 1) {
                defaultToSelect = acc.id;
            }
        }
    });

    if (defaultToSelect) {
        select.value = defaultToSelect;
        onMetaAccountSelected();
    }
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
    if (selectAdSet) {
        selectAdSet.innerHTML = '<option value="">Selecione uma campanha primeiro...</option>';
        selectAdSet.disabled = true;
    }
    hideBaseAdSetPreview();

    if (!accountId) {
        selectCamp.innerHTML = '<option value="">Selecione uma conta primeiro...</option>';
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

    if (labelCamp) labelCamp.innerText = '(Buscando...)';

    const token = getMetaToken();
    try {
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${accountId}/campaigns?access_token=${encodeURIComponent(token)}&fields=id,name,status,objective&limit=100`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.data && Array.isArray(data.data) && data.data.length > 0) {
            metaState.campaigns = data.data;
            selectCamp.innerHTML = '';

            let firstActive = '';
            data.data.forEach(camp => {
                const opt = document.createElement('option');
                opt.value = camp.id;
                const statusTag = camp.status === 'ACTIVE' ? '🟢' : '⏸️';
                opt.innerText = `${statusTag} ${camp.name}`;
                selectCamp.appendChild(opt);

                if (!firstActive && camp.status === 'ACTIVE') {
                    firstActive = camp.id;
                }
            });

            selectCamp.disabled = false;
            if (labelCamp) labelCamp.innerText = `(${data.data.length} campanhas)`;

            if (firstActive) {
                selectCamp.value = firstActive;
            } else {
                selectCamp.value = data.data[0].id;
            }

            onMetaCampaignSelected();
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

// Disparado ao trocar de campanha
async function onMetaCampaignSelected() {
    const selectCamp = document.getElementById('select-meta-campaign');
    const selectAdSet = document.getElementById('select-meta-adset');
    const labelAdSet = document.getElementById('label-adset-count');

    if (!selectCamp || !selectAdSet) return;

    const campaignId = selectCamp.value;
    metaState.selectedCampaignId = campaignId;
    metaState.adsets = [];
    metaState.checkedCountries = {};

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

    const token = getMetaToken();
    try {
        const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${campaignId}/adsets?access_token=${encodeURIComponent(token)}&fields=id,name,daily_budget,targeting,status&limit=100`;
        const resp = await fetch(url);
        const data = await resp.json();

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
            metaState.adsets = [];
            metaState.checkedCountries = {};
            selectAdSet.innerHTML = '<option value="">Nenhum conjunto nesta campanha</option>';
            if (labelAdSet) labelAdSet.innerText = '(0 conjuntos)';
            renderBlockNav();
            renderCountriesGrid();
        }
    } catch (e) {
        console.error('Erro ao buscar conjuntos:', e);
        metaState.adsets = [];
        metaState.checkedCountries = {};
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
        tag3.innerText = `✨ Criativos & Anúncios serão clonados automaticamente`;
        tagsEl.appendChild(tag3);
    }

    box.classList.remove('twod-hidden');
}

function hideBaseAdSetPreview() {
    const box = document.getElementById('base-adset-details-box');
    if (box) box.classList.add('twod-hidden');
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

// Renderiza a barra de navegação dos blocos com badges de progresso
function renderBlockNav() {
    const nav = document.getElementById('blocks-tab-nav');
    if (!nav) return;

    nav.innerHTML = '';
    Object.keys(META_COUNTRY_BLOCKS).forEach(blockId => {
        const block = META_COUNTRY_BLOCKS[blockId];
        const stats = getBlockStats(blockId);

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

        btn.innerHTML = `<span>${block.title}</span> ${badgeHtml}`;
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
}

// Renderiza o grid de checkboxes dos países do bloco ativo com badges visuais de presença
function renderCountriesGrid() {
    const grid = document.getElementById('countries-grid-container');
    if (!grid) return;

    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    if (!block) return;

    grid.innerHTML = '';
    const currentChecks = metaState.checkedCountries[metaState.activeBlockId] || {};

    block.countries.forEach(country => {
        const isChecked = !!currentChecks[country.adSetName];
        const existingAdSet = findExistingAdSetForCountry(country);

        const card = document.createElement('label');
        card.className = `country-card ${isChecked ? 'selected' : ''} ${existingAdSet ? 'country-already-exists' : ''}`;

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isChecked;
        chk.onchange = (e) => {
            currentChecks[country.adSetName] = e.target.checked;
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

        const statusDiv = document.createElement('div');
        if (existingAdSet) {
            const statusLabel = existingAdSet.status === 'ACTIVE' ? 'Ativo 🟢' : 'Pausado ⏸️';
            statusDiv.innerHTML = `<span class="country-status-pill pill-exists" title="Conjunto existente: ${existingAdSet.name} (ID: ${existingAdSet.id})">✅ Já na Campanha (${statusLabel})</span>`;
        } else {
            statusDiv.innerHTML = `<span class="country-status-pill pill-pending">⏳ Pendente</span>`;
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

// ========================================================
// MOTOR DE DUPLICAÇÃO EM MASSA (META MARKETING API)
// ========================================================

async function startBatchDuplication() {
    if (metaState.isDuplicating) return;

    if (!metaState.selectedAccountId) {
        alert('Por favor, selecione uma Conta de Anúncios.');
        return;
    }
    if (!metaState.selectedCampaignId) {
        alert('Por favor, selecione uma Campanha ativa.');
        return;
    }
    if (!metaState.selectedAdSetId) {
        alert('Por favor, selecione o Conjunto Base (Origem).');
        return;
    }

    const block = META_COUNTRY_BLOCKS[metaState.activeBlockId];
    const checks = metaState.checkedCountries[metaState.activeBlockId] || {};
    const countriesToDuplicate = block.countries.filter(c => checks[c.adSetName]);

    if (countriesToDuplicate.length === 0) {
        alert('Selecione ao menos 1 país no bloco para duplicar.');
        return;
    }

    const initialStatus = document.getElementById('select-initial-status').value || 'PAUSED';
    const nameFormat = document.getElementById('select-name-format').value || 'country_only';

    const confirmMsg = `Confirmar duplicação de ${countriesToDuplicate.length} conjuntos no Meta Ads?\n\n` +
        `• Bloco: ${block.title}\n` +
        `• Orçamento por conjunto: $1.00 USD (fixo)\n` +
        `• Status Inicial: ${initialStatus === 'PAUSED' ? 'Pausado (Seguro)' : 'Ativo (Imediato)'}\n` +
        `• Total de novos conjuntos: ${countriesToDuplicate.length}`;

    if (!confirm(confirmMsg)) return;

    metaState.isDuplicating = true;

    // Atualiza UI para estado de execução
    const startBtn = document.getElementById('btn-start-duplication');
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
    if (clearBtn) clearBtn.style.display = 'inline-block';
    if (progressWrapper) progressWrapper.classList.remove('twod-hidden');
    if (termStatus) termStatus.innerText = 'Em execução...';

    logMetaTerminal(`🚀 Iniciando processo de duplicação para ${countriesToDuplicate.length} países no bloco ${block.title}...`, 'info');
    logMetaTerminal(`📦 Conjunto base: '${metaState.selectedAdSet ? metaState.selectedAdSet.name : metaState.selectedAdSetId}' (ID: ${metaState.selectedAdSetId})`, 'info');

    const token = getMetaToken();
    const budgetInCents = 100; // Sempre 1 dólar ($1.00 USD = 100 centavos)

    // Busca previamente todos os anúncios e criativos do conjunto base
    let baseAds = [];
    try {
        const adsUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${metaState.selectedAdSetId}/ads?access_token=${encodeURIComponent(token)}&fields=id,name,status,creative&limit=50`;
        const adsResp = await fetch(adsUrl);
        const adsData = await adsResp.json();
        if (adsData.data && Array.isArray(adsData.data)) {
            baseAds = adsData.data;
        }
        logMetaTerminal(`📋 Anúncios identificados no conjunto base: ${baseAds.length} anúncio(s)`, 'info');
    } catch (e) {
        console.warn('Não foi possível ler anúncios prévios do conjunto:', e);
    }

    let successCount = 0;
    let failCount = 0;
    const startTime = Date.now();

    for (let i = 0; i < countriesToDuplicate.length; i++) {
        const country = countriesToDuplicate[i];
        const currentIdx = i + 1;
        const total = countriesToDuplicate.length;

        // Atualiza barra de progresso
        const pct = Math.round(((currentIdx - 1) / total) * 100);
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressPct) progressPct.innerText = `${pct}%`;
        if (progressStatus) progressStatus.innerText = `[${currentIdx}/${total}] Clonando ${country.adSetName} (${country.code})...`;

        logMetaTerminal(`[${currentIdx}/${total}] Duplicando conjunto para '${country.adSetName}' (${country.code})...`, 'info');

        try {
            // PASSO 1: Clona a estrutura do conjunto base via POST /{adset_id}/copies
            const copyUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${metaState.selectedAdSetId}/copies?access_token=${encodeURIComponent(token)}`;
            const copyResp = await fetch(copyUrl, { method: 'POST' });
            const copyData = await copyResp.json();

            if (copyData.error) {
                throw new Error(copyData.error.message || 'Erro ao copiar conjunto');
            }

            const copiedAdSetId = copyData.copied_adset_id;

            // PASSO 2: Formata o novo nome
            let finalName = country.adSetName;
            if (nameFormat === 'country_lang') {
                finalName = `${country.adSetName} (${country.langName})`;
            } else if (nameFormat === 'block_country') {
                finalName = `${block.id.replace('BLOCO-', 'B')} - ${country.adSetName}`;
            }

            // PASSO 3: Configura segmentação de país exclusiva
            const targeting = {
                geo_locations: {
                    countries: [country.code],
                    location_types: ['frequently_in', 'home', 'recent']
                }
            };

            // PASSO 4: Atualiza o conjunto clonado via POST /{copied_id}
            const updateUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${copiedAdSetId}`;
            const formData = new URLSearchParams();
            formData.append('access_token', token);
            formData.append('name', finalName);
            formData.append('daily_budget', budgetInCents.toString());
            formData.append('status', initialStatus);
            formData.append('targeting', JSON.stringify(targeting));

            const updateResp = await fetch(updateUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: formData.toString()
            });
            const updateData = await updateResp.json();

            if (updateData.error) {
                throw new Error(updateData.error.message || 'Erro ao configurar conjunto clonado');
            }

            // PASSO 5: Clona todos os anúncios/criativos do conjunto base para o novo conjunto
            let adsCreated = 0;
            for (const baseAd of baseAds) {
                if (baseAd.creative && baseAd.creative.id) {
                    const createAdUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${metaState.selectedAccountId}/ads`;
                    const adData = new URLSearchParams();
                    adData.append('access_token', token);
                    adData.append('name', baseAd.name || finalName);
                    adData.append('adset_id', copiedAdSetId);
                    adData.append('creative', JSON.stringify({ creative_id: baseAd.creative.id }));
                    adData.append('status', initialStatus);

                    const adResp = await fetch(createAdUrl, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                        body: adData.toString()
                    });
                    const adResult = await adResp.json();
                    if (adResult.id) adsCreated++;
                }
            }

            successCount++;
            const adsMsg = adsCreated > 0 ? `com ${adsCreated} anúncio(s)` : 'sem anúncios';
            logMetaTerminal(`✅ [${currentIdx}/${total}] Conjunto '${finalName}' criado ${adsMsg}! (ID: ${copiedAdSetId})`, 'success');

            // Registra o novo conjunto no estado local e atualiza os cards/badges em tempo real
            metaState.adsets.push({
                id: copiedAdSetId,
                name: finalName,
                status: initialStatus,
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
            logMetaTerminal(`❌ [${currentIdx}/${total}] Falha em ${country.adSetName}: ${err.message}`, 'error');
        }

        // Breve intervalo para respeitar taxa da Meta
        await new Promise(r => setTimeout(r, 250));
    }

    const elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(1);

    // Finalização
    if (progressFill) progressFill.style.width = '100%';
    if (progressPct) progressPct.innerText = '100%';
    if (progressStatus) progressStatus.innerText = 'Duplicação concluída!';
    if (termStatus) termStatus.innerText = 'Concluído';

    if (startBtn) {
        startBtn.disabled = false;
        startBtn.innerText = '🚀 Iniciar Nova Duplicação';
    }
    metaState.isDuplicating = false;

    logMetaTerminal(`🎉 Operação finalizada em ${elapsedSecs}s! Sucesso: ${successCount} | Falhas: ${failCount}`, successCount > 0 ? 'success' : 'warning');
}

// Helpers da aba Configurações
function toggleTokenVisibility() {
    const input = document.getElementById('meta-token-input');
    const btn = document.getElementById('btn-toggle-token-vis');
    if (!input || !btn) return;

    if (input.type === 'password') {
        input.type = 'text';
        btn.innerText = '🔒 Ocultar';
    } else {
        input.type = 'password';
        btn.innerText = '👁️ Ver';
    }
}

async function testMetaTokenFromUI() {
    const tokenInput = document.getElementById('meta-token-input');
    const resultBox = document.getElementById('meta-token-test-result');
    const token = tokenInput ? tokenInput.value.trim() : '';

    if (!token) {
        alert('Por favor, cole um Token de Acesso.');
        return;
    }

    if (resultBox) {
        resultBox.className = '';
        resultBox.style.background = 'rgba(59, 130, 246, 0.15)';
        resultBox.style.color = '#3b82f6';
        resultBox.innerText = '🔍 Validando token junto à Graph API da Meta...';
        resultBox.classList.remove('twod-hidden');
    }

    try {
        const res = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/me?access_token=${encodeURIComponent(token)}&fields=id,name,permissions`);
        const data = await res.json();

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

async function saveMetaSettingsFromUI() {
    const tokenInput = document.getElementById('meta-token-input');
    const accountInput = document.getElementById('meta-default-account-input');

    const token = tokenInput ? tokenInput.value.trim() : '';
    const accountId = accountInput ? accountInput.value.trim() : '';

    if (token) {
        metaState.token = token;
        localStorage.setItem(STORAGE_KEYS.META_TOKEN, token);
    }
    if (accountId) {
        metaState.defaultAccountId = accountId;
        localStorage.setItem(STORAGE_KEYS.META_ACCOUNT, accountId);
    }

    // Salva no backend local se estiver ativo
    try {
        await fetch('/api/meta/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                meta_access_token: token,
                default_account_id: accountId
            })
        });
    } catch (e) {
        // Ignora se estiver fora do localhost
    }

    alert('Configurações da Meta salvas com sucesso!');
    testAndReloadMetaApi(true);
}

// Expõe funções globais para compatibilidade total com onclick
window.switchTab = switchTab;
window.setThemeMode = setThemeMode;
window.openAddSiteModal = openAddSiteModal;
window.closeModal = closeModal;
window.openAddUserModal = openAddUserModal;
window.connectOneDriveFolder = connectOneDriveFolder;
window.scanOneDriveFiles = scanOneDriveFiles;
window.playAudio = playAudio;
window.closeAudioPlayer = closeAudioPlayer;
window.changeMyPassword = changeMyPassword;
window.handleLogin = handleLogin;
window.quickLogin = quickLogin;
window.showLogin = showLogin;
window.showApp = showApp;

// Funções Meta Ads & Duplicador
window.reloadMetaAccounts = loadMetaAccounts;
window.onMetaAccountSelected = onMetaAccountSelected;
window.onMetaCampaignSelected = onMetaCampaignSelected;
window.onMetaAdSetSelected = onMetaAdSetSelected;
window.selectCountryBlock = selectCountryBlock;
window.toggleAllCountriesInBlock = toggleAllCountriesInBlock;
window.selectPriorityCountriesOnly = selectPriorityCountriesOnly;
window.selectMissingCountriesOnly = selectMissingCountriesOnly;
window.startBatchDuplication = startBatchDuplication;
window.clearMetaLog = clearMetaLog;
window.toggleTokenVisibility = toggleTokenVisibility;
window.testMetaTokenFromUI = testMetaTokenFromUI;
window.saveMetaSettingsFromUI = saveMetaSettingsFromUI;

// ========================================================
// INICIALIZAÇÃO INFALÍVEL (EXECUTA IMEDIATO SE DOM JÁ CARREGADO)
// ========================================================
function startApp() {
    checkSession();
    checkSavedOneDriveHandle();
    initMetaApi();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}




