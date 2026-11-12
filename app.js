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

// Estado da Aplicação
let users = JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS)) || DEFAULT_USERS;

// Migração automática: atualiza 'auxiliar2' para 'wesley' se existir no localStorage anterior
let migrated = false;
users = users.map(u => {
    if (u.username === 'auxiliar2') {
        migrated = true;
        return { ...u, id: 'usr_wesley', username: 'wesley', name: 'Wesley' };
    }
    return u;
});
if (migrated) {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
}
let sites = JSON.parse(localStorage.getItem(STORAGE_KEYS.SITES)) || DEFAULT_SITES;
let currentUser = JSON.parse(localStorage.getItem(STORAGE_KEYS.CURRENT_USER)) || null;

function saveUsers() {
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
}

function saveSites() {
    localStorage.setItem(STORAGE_KEYS.SITES, JSON.stringify(sites));
}

// ========================================================
// SISTEMA DE AUTENTICAÇÃO E SESSÃO
// ========================================================

const loginScreen = document.getElementById('login-screen');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

function checkSession() {
    if (currentUser) {
        // Encontra o usuário atualizado no banco
        const updated = users.find(u => u.username === currentUser.username);
        if (updated) currentUser = updated;
        showApp();
    } else {
        showLogin();
    }
}

function showLogin() {
    loginScreen.classList.remove('twod-hidden');
    appContainer.classList.add('twod-hidden');
}

function showApp() {
    loginScreen.classList.add('twod-hidden');
    appContainer.classList.remove('twod-hidden');

    // Atualiza cabeçalho e perfil
    document.getElementById('current-user-name').innerText = currentUser.name;
    document.getElementById('current-user-role').innerText = currentUser.role;
    document.getElementById('current-user-avatar').innerText = currentUser.name.charAt(0).toUpperCase();

    // Controle de permissão: esconde abas de admin para operadores
    const isAdmin = currentUser.role === 'Administrador';
    document.querySelectorAll('.admin-only').forEach(el => {
        if (isAdmin) {
            el.classList.remove('twod-hidden');
        } else {
            el.classList.add('twod-hidden');
        }
    });

    // Aplica tema do usuário
    applyUserTheme();

    // Renderiza tabelas e abas
    renderSitesTable();
    if (isAdmin) renderUsersTable();
    initTabs();
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById('login-username').value.trim().toLowerCase();
    const passwordInput = document.getElementById('login-password').value;

    const user = users.find(u => u.username.toLowerCase() === usernameInput && u.password === passwordInput);
    if (user) {
        user.lastLogin = 'Agora';
        saveUsers();
        currentUser = user;
        localStorage.setItem(STORAGE_KEYS.CURRENT_USER, JSON.stringify(currentUser));
        loginError.classList.add('twod-hidden');
        showApp();
    } else {
        loginError.classList.remove('twod-hidden');
    }
});

function quickLogin(username, password) {
    document.getElementById('login-username').value = username;
    document.getElementById('login-password').value = password;
    loginForm.dispatchEvent(new Event('submit'));
}

document.getElementById('btn-logout').addEventListener('click', () => {
    currentUser = null;
    localStorage.removeItem(STORAGE_KEYS.CURRENT_USER);
    showLogin();
});

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
        btn.addEventListener('click', () => {
            const tabId = btn.getAttribute('data-tab');
            switchTab(tabId);
        });
    });

    const savedTab = localStorage.getItem(STORAGE_KEYS.ACTIVE_TAB) || 'visao-geral';
    switchTab(savedTab);
}

function switchTab(tabId) {
    // Permissão: se tentar abrir usuário sem ser admin, volta para visão geral
    if (tabId === 'usuarios' && currentUser.role !== 'Administrador') {
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
    document.getElementById('page-title').innerText = meta.title;
    document.getElementById('page-subtitle').innerText = meta.subtitle;

    localStorage.setItem(STORAGE_KEYS.ACTIVE_TAB, tabId);
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
// INICIALIZAÇÃO
// ========================================================
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
});

