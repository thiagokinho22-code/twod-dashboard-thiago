// ========================================================
// TWOD HUB — MOTOR JAVASCRIPT DA DASHBOARD
// ========================================================

const STORAGE_KEYS = {
    USERS: 'twod_users_db',
    CURRENT_USER: 'twod_logged_user',
    SITES: 'twod_fun_sites',
    ACTIVE_TAB: 'twod_active_tab'
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

let currentUser = null;
try {
    const rawUser = localStorage.getItem(STORAGE_KEYS.CURRENT_USER);
    if (rawUser) currentUser = JSON.parse(rawUser);
} catch (e) {
    currentUser = null;
}

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
    if (currentUser && currentUser.username) {
        // Encontra o usuário atualizado no banco
        const updated = users.find(u => u && u.username && u.username.toLowerCase() === currentUser.username.toLowerCase());
        if (updated) currentUser = updated;
        showApp();
    } else {
        showLogin();
    }
}

function showLogin() {
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

    if (!currentUser) currentUser = { ...DEFAULT_USERS[0] };

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
            try { localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser)); } catch (e) { }
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
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
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

    try { localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tabId); } catch (e) { }
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

// ========================================================
// INICIALIZAÇÃO INFALÍVEL (EXECUTA IMEDIATO SE DOM JÁ CARREGADO)
// ========================================================
function startApp() {
    checkSession();
    checkSavedOneDriveHandle();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}




