// State and storage keys
const STORAGE_KEY = 'beta_portal_real_registrations';
const SESSION_UNLOCK_KEY = 'dashboard_unlocked';
const CURRENT_USER_KEY = 'dashboard_current_user';
const PARTICIPATION_CHOICE_KEY = 'beta_portal_last_choice';
const API_ENDPOINT = '/api/registrations';
const CORRECT_HASH = 'c8bf231d991a832c793f8b518ae7a49d4e807ac1ab183c2a01bc659c01d0b774'; // SHA-256 of "aniimo"
const DEFAULT_ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'aniimo';

let registrations = [];
let users = [];
let auditLog = [];
let sessionState = {
    dashboardUnlocked: false,
    currentUser: '',
    lastParticipationChoice: 'yes',
    lastUpdated: new Date().toISOString()
};
let chartInstance = null;

class UserAccount {
    constructor(username, password, role = 'user') {
        this.username = username.trim();
        this.password = password;
        this.role = role;
        this.createdAt = new Date().toISOString();
    }
}

async function hashPassword(password) {
    if (!password) return '';
    try {
        return await computeSHA256(password);
    } catch (err) {
        console.error('Erro ao gerar hash da senha:', err);
        return '';
    }
}

// SHA-256 Cryptographic function using Web Crypto API
async function computeSHA256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Initialize application state
async function initApp() {
    await loadRegistrations();

    setupEventListeners();
    checkLockedState();

    window.addEventListener('focus', () => syncSharedStateFromBackend());
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            syncSharedStateFromBackend();
        }
    });
    window.setInterval(() => syncSharedStateFromBackend(), 5000);
    
    // Default tab check
    showTab('signup-tab');
}

function getStoredSessionState() {
    const storedSessionState = localStorage.getItem('beta_portal_session_state');
    if (!storedSessionState) return null;

    try {
        const parsedSessionState = JSON.parse(storedSessionState);
        return {
            dashboardUnlocked: Boolean(parsedSessionState.dashboardUnlocked),
            currentUser: typeof parsedSessionState.currentUser === 'string' ? parsedSessionState.currentUser : '',
            lastParticipationChoice: parsedSessionState.lastParticipationChoice === 'no' ? 'no' : 'yes',
            lastUpdated: typeof parsedSessionState.lastUpdated === 'string' ? parsedSessionState.lastUpdated : new Date().toISOString()
        };
    } catch (error) {
        return null;
    }
}

function applySharedDataFromBackend(data, { preserveLocalSession = true } = {}) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return;
    }

    registrations = Array.isArray(data.registrations) ? data.registrations : [];

    const savedSessionState = preserveLocalSession ? getStoredSessionState() : null;
    sessionState = savedSessionState ? {
        dashboardUnlocked: Boolean(savedSessionState.dashboardUnlocked),
        currentUser: typeof savedSessionState.currentUser === 'string' ? savedSessionState.currentUser : '',
        lastParticipationChoice: savedSessionState.lastParticipationChoice === 'no' ? 'no' : 'yes',
        lastUpdated: typeof savedSessionState.lastUpdated === 'string' ? savedSessionState.lastUpdated : new Date().toISOString()
    } : {
        dashboardUnlocked: false,
        currentUser: '',
        lastParticipationChoice: 'yes',
        lastUpdated: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(registrations));
    localStorage.setItem('beta_portal_session_state', JSON.stringify(sessionState));
    ensureDefaultAdminUser();
    applySessionStateToUi();
}

async function loadRegistrations() {
    try {
        const response = await fetch(API_ENDPOINT);
        if (response.ok) {
            const data = await response.json();
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                applySharedDataFromBackend(data, { preserveLocalSession: true });
                return;
            }

            if (Array.isArray(data)) {
                registrations = data;
                users = [];
                auditLog = [];
                sessionState = {
                    dashboardUnlocked: false,
                    currentUser: '',
                    lastParticipationChoice: 'yes',
                    lastUpdated: new Date().toISOString()
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(registrations));
                localStorage.setItem('beta_portal_users', JSON.stringify(users));
                localStorage.setItem('beta_portal_audit_log', JSON.stringify(auditLog));
                localStorage.setItem('beta_portal_session_state', JSON.stringify(sessionState));
                ensureDefaultAdminUser();
                applySessionStateToUi();
                return;
            }
        }
    } catch (error) {
        console.warn('API de registros indisponível, usando fallback local.', error);
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            registrations = JSON.parse(saved);
        } catch (error) {
            console.warn('Não foi possível ler os registros salvos, resetando.', error);
            registrations = [];
        }
    } else {
        registrations = [];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(registrations));
    }

    const storedUsers = localStorage.getItem('beta_portal_users');
    if (storedUsers) {
        try {
            users = JSON.parse(storedUsers);
        } catch (error) {
            users = [];
        }
    } else {
        users = [];
        localStorage.setItem('beta_portal_users', JSON.stringify(users));
    }

    const storedAuditLog = localStorage.getItem('beta_portal_audit_log');
    if (storedAuditLog) {
        try {
            auditLog = JSON.parse(storedAuditLog);
        } catch (error) {
            auditLog = [];
        }
    } else {
        auditLog = [];
        localStorage.setItem('beta_portal_audit_log', JSON.stringify(auditLog));
    }

    const storedSessionState = localStorage.getItem('beta_portal_session_state');
    if (storedSessionState) {
        try {
            const parsedSessionState = JSON.parse(storedSessionState);
            sessionState = {
                dashboardUnlocked: Boolean(parsedSessionState.dashboardUnlocked),
                currentUser: typeof parsedSessionState.currentUser === 'string' ? parsedSessionState.currentUser : '',
                lastParticipationChoice: parsedSessionState.lastParticipationChoice === 'no' ? 'no' : 'yes',
                lastUpdated: typeof parsedSessionState.lastUpdated === 'string' ? parsedSessionState.lastUpdated : new Date().toISOString()
            };
        } catch (error) {
            sessionState = {
                dashboardUnlocked: false,
                currentUser: '',
                lastParticipationChoice: 'yes',
                lastUpdated: new Date().toISOString()
            };
        }
    }

    ensureDefaultAdminUser();
    applySessionStateToUi();
}

function ensureDefaultAdminUser() {
    const existingAdmin = users.find(user => user.username.toLowerCase() === DEFAULT_ADMIN_USERNAME);
    if (existingAdmin) {
        existingAdmin.role = 'admin';
        if (!existingAdmin.password) {
            existingAdmin.password = DEFAULT_ADMIN_PASSWORD;
        }
        return;
    }

    users.unshift(new UserAccount(DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD, 'admin'));
    localStorage.setItem('beta_portal_users', JSON.stringify(users));
}

async function persistRegistrations() {
    sessionState.lastUpdated = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(registrations));
    localStorage.setItem('beta_portal_users', JSON.stringify(users));
    localStorage.setItem('beta_portal_audit_log', JSON.stringify(auditLog));
    localStorage.setItem('beta_portal_session_state', JSON.stringify(sessionState));

    try {
        await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ registrations })
        });
    } catch (error) {
        console.warn('Não foi possível sincronizar os registros com o arquivo JSON.', error);
    }
}

// Event Listeners setup
function setupEventListeners() {
    // Tab switching
    document.getElementById('nav-signup').addEventListener('click', () => showTab('signup-tab'));
    document.getElementById('nav-dashboard').addEventListener('click', () => showTab('dashboard-tab'));

    // Beta choices selection interaction
    const choiceCards = document.querySelectorAll('.choice-card');
    choiceCards.forEach(card => {
        card.addEventListener('click', () => {
            choiceCards.forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            const radio = card.querySelector('input[type="radio"]');
            if (radio) {
                radio.checked = true;
                updateParticipationPreference(radio.value);
            }
        });
    });

    // Form submission
    document.getElementById('beta-form').addEventListener('submit', handleFormSubmit);

    // Password unlock
    document.getElementById('lock-form').addEventListener('submit', handleUnlockAttempt);

    // Lock Dashboard Action
    document.getElementById('btn-lock-db').addEventListener('click', lockDashboard);
    document.getElementById('btn-clear-all').addEventListener('click', clearAllRegistrations);
    document.getElementById('admin-user-form').addEventListener('submit', handleAdminCreateUser);
    document.getElementById('btn-clear-audit-log').addEventListener('click', clearAuditLog);

}

// Show specific tab and perform necessary rendering
function showTab(tabId) {
    // Update active tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    if (tabId === 'signup-tab') {
        document.getElementById('nav-signup').classList.add('active');
        document.getElementById('signup-view').classList.add('active');
        document.getElementById('dashboard-view').classList.remove('active');
    } else if (tabId === 'dashboard-tab') {
        document.getElementById('nav-dashboard').classList.add('active');
        document.getElementById('dashboard-view').classList.add('active');
        document.getElementById('signup-view').classList.remove('active');
        
        // If unlocked, render dashboard components
        const isUnlocked = sessionStorage.getItem(SESSION_UNLOCK_KEY) === 'true';
        if (isUnlocked) {
            renderDashboard();
        }
    }
}

// Check locked state and show appropriate UI in Dashboard view
function applySessionStateToUi() {
    const lockScreen = document.getElementById('lock-screen');
    const dashboardContent = document.getElementById('dashboard-content');
    const navDashboardBtn = document.getElementById('nav-dashboard');

    if (sessionState.dashboardUnlocked) {
        lockScreen.style.display = 'none';
        dashboardContent.style.display = 'block';
        navDashboardBtn.classList.remove('locked-tab');
        navDashboardBtn.classList.add('unlocked-tab');
    } else {
        lockScreen.style.display = 'flex';
        dashboardContent.style.display = 'none';
        navDashboardBtn.classList.remove('unlocked-tab');
        navDashboardBtn.classList.add('locked-tab');
    }

    const selectedChoice = sessionState.lastParticipationChoice === 'no' ? 'no' : 'yes';
    const choiceYes = document.getElementById('choice-yes');
    const choiceNo = document.getElementById('choice-no');
    if (choiceYes && choiceNo) {
        choiceYes.checked = selectedChoice === 'yes';
        choiceNo.checked = selectedChoice === 'no';
        document.querySelectorAll('.choice-card').forEach(card => card.classList.remove('selected'));
        document.querySelector(`#choice-card-${selectedChoice}`)?.classList.add('selected');
    }
}

function checkLockedState() {
    applySessionStateToUi();
}

function unlockDashboard(message) {
    sessionState.dashboardUnlocked = true;
    sessionState.lastUpdated = new Date().toISOString();
    persistRegistrations();
    checkLockedState();
    renderDashboard();
    showToast(message, 'success');
}

function getCurrentUserName() {
    return sessionState.currentUser || '';
}

function setCurrentUserName(username) {
    sessionState.currentUser = username || '';
    sessionState.lastUpdated = new Date().toISOString();
}

function addAuditLog(user, action, details) {
    auditLog.unshift({
        user,
        action,
        details,
        date: new Date().toISOString()
    });
}

async function syncSharedStateFromBackend() {
    try {
        const response = await fetch(API_ENDPOINT);
        if (!response.ok) return;

        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) return;

        const remoteRegistrations = Array.isArray(data.registrations) ? data.registrations : [];
        const localSignature = JSON.stringify(registrations);
        const remoteSignature = JSON.stringify(remoteRegistrations);

        if (localSignature === remoteSignature) return;

        applySharedDataFromBackend(data, { preserveLocalSession: true });
        if (document.getElementById('dashboard-content').style.display === 'block' || sessionState.dashboardUnlocked) {
            renderDashboard();
        }
    } catch (error) {
        console.warn('Não foi possível sincronizar as inscrições compartilhadas com o backend.', error);
    }
}

function updateParticipationPreference(choice) {
    sessionState.lastParticipationChoice = choice === 'no' ? 'no' : 'yes';
    sessionState.lastUpdated = new Date().toISOString();
    localStorage.setItem('beta_portal_session_state', JSON.stringify(sessionState));
}

function renderAdminAuditPanel(currentUser) {
    const panel = document.getElementById('admin-audit-panel');
    if (!currentUser || currentUser.role !== 'admin') {
        panel.style.display = 'none';
        return;
    }

    panel.style.display = 'block';

    const usersBody = document.getElementById('admin-users-body');
    usersBody.innerHTML = '';
    users.forEach(user => {
        const row = document.createElement('tr');

        const usernameCell = document.createElement('td');
        usernameCell.textContent = user.username;

        const roleCell = document.createElement('td');
        roleCell.textContent = user.role === 'admin' ? 'Administrador' : 'Usuário';

        const lastLoginCell = document.createElement('td');
        lastLoginCell.textContent = user.lastLogin ? new Date(user.lastLogin).toLocaleString('pt-BR') : 'Nunca';

        const statusCell = document.createElement('td');
        statusCell.textContent = user.password ? 'Ativo' : 'Pendente';

        const actionsCell = document.createElement('td');
        const canRemove = user.role !== 'admin' && user.username.toLowerCase() !== currentUser.username.toLowerCase();
        if (canRemove) {
            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'table-action-btn delete';
            removeBtn.textContent = 'Remover';
            removeBtn.addEventListener('click', () => removeDashboardUser(user.username));
            actionsCell.appendChild(removeBtn);
        } else {
            actionsCell.textContent = '—';
        }

        row.appendChild(usernameCell);
        row.appendChild(roleCell);
        row.appendChild(lastLoginCell);
        row.appendChild(statusCell);
        row.appendChild(actionsCell);
        usersBody.appendChild(row);
    });

    const logBody = document.getElementById('admin-log-body');
    logBody.innerHTML = '';
    auditLog.slice(0, 20).forEach(entry => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${entry.user}</td>
            <td>${entry.action}</td>
            <td>${entry.details}</td>
            <td>${new Date(entry.date).toLocaleString('pt-BR')}</td>
        `;
        logBody.appendChild(row);
    });
}

async function handleAdminCreateUser(e) {
    e.preventDefault();
    const usernameInput = document.getElementById('admin-username');
    const username = usernameInput.value.trim();

    if (!username || username.length < 3) {
        showToast('Informe um nome de usuário válido.', 'error');
        return;
    }

    const existingUser = users.find(user => user.username.toLowerCase() === username.toLowerCase());
    if (existingUser) {
        showToast('Esse nome de usuário já está cadastrado.', 'error');
        return;
    }

    const adminUser = new UserAccount(username, '', 'user');
    users.push(adminUser);
    addAuditLog('admin', 'Pré-cadastro', `Usuário ${username} preparado para acesso`);
    await persistRegistrations();
    usernameInput.value = '';
    showToast('Usuário pré-cadastrado. Ele poderá criar sua senha na próxima tentativa de login.', 'success');
}

async function clearAuditLog() {
    const currentUserName = getCurrentUserName();
    const currentUser = users.find(user => user.username.toLowerCase() === currentUserName.toLowerCase());

    if (!currentUser || currentUser.role !== 'admin') {
        showToast('Apenas o administrador pode limpar o log.', 'error');
        return;
    }

    const confirmed = window.confirm('Deseja realmente limpar o log de acesso?');
    if (!confirmed) return;

    auditLog = [];
    await persistRegistrations();
    renderDashboard();
    showToast('Log de acesso limpo com sucesso.', 'success');
}

async function removeDashboardUser(username) {
    const currentUserName = getCurrentUserName();
    const currentUser = users.find(user => user.username.toLowerCase() === currentUserName.toLowerCase());

    if (!currentUser || currentUser.role !== 'admin') {
        showToast('Apenas o administrador pode remover usuários.', 'error');
        return;
    }

    const targetUser = users.find(user => user.username.toLowerCase() === username.toLowerCase());
    if (!targetUser) {
        showToast('Usuário não encontrado.', 'error');
        return;
    }

    if (targetUser.role === 'admin' || targetUser.username.toLowerCase() === currentUser.username.toLowerCase()) {
        showToast('Este usuário não pode ser removido.', 'error');
        return;
    }

    const confirmed = window.confirm(`Deseja remover o usuário ${targetUser.username} do painel?`);
    if (!confirmed) return;

    users = users.filter(user => user.username.toLowerCase() !== username.toLowerCase());
    addAuditLog(currentUser.username, 'Remoção de usuário', `Usuário ${targetUser.username} removido do painel`);
    await persistRegistrations();
    renderDashboard();
    showToast('Usuário removido do painel.', 'success');
}

async function handleUnlockAttempt(e) {
    e.preventDefault();
    const userInput = document.getElementById('dashboard-username');
    const passInput = document.getElementById('dashboard-password');
    const errorMsg = document.getElementById('lock-error-msg');
    const passwordLabel = document.getElementById('password-label');
    const loginHelp = document.getElementById('login-help');
    const username = userInput.value.trim();
    const password = passInput.value;
    const formEl = document.getElementById('lock-form');

    formEl.classList.remove('error-shake');

    if (!username || !password) {
        errorMsg.style.display = 'block';
        showToast('Digite usuário e senha para acessar.', 'error');
        return;
    }

    try {
        const existingUser = users.find(user => user.username.toLowerCase() === username.toLowerCase());
        const isAdmin = username.toLowerCase() === DEFAULT_ADMIN_USERNAME;

            if (isAdmin) {
            const adminUser = existingUser || users.find(user => user.username.toLowerCase() === DEFAULT_ADMIN_USERNAME);
            const hashedAttempt = await hashPassword(password);
            if (adminUser && adminUser.password === hashedAttempt) {
                adminUser.lastLogin = new Date().toISOString();
                setCurrentUserName(adminUser.username);
                addAuditLog('admin', 'Login', 'Admin acessou o painel');
                await persistRegistrations();
                userInput.value = '';
                passInput.value = '';
                errorMsg.style.display = 'none';
                passwordLabel.textContent = 'Senha';
                loginHelp.textContent = 'Apenas usuários pré-cadastrados pelo administrador podem criar ou usar senha nesta tela.';
                unlockDashboard('Acesso concedido com sucesso!');
                return;
            }

            setTimeout(() => formEl.classList.add('error-shake'), 10);
            errorMsg.style.display = 'block';
            passInput.value = '';
            showToast('Senha incorreta para o administrador.', 'error');
            return;
        }

        if (!existingUser) {
            setTimeout(() => formEl.classList.add('error-shake'), 10);
            errorMsg.style.display = 'block';
            showToast('Usuário não encontrado. Peça ao administrador para pré-cadastrá-lo.', 'error');
            return;
        }

        if (!existingUser.password) {
            existingUser.password = await hashPassword(password);
            existingUser.lastLogin = new Date().toISOString();
            setCurrentUserName(existingUser.username);
            addAuditLog(existingUser.username, 'Senha criada', 'Usuário criou a própria senha');
            await persistRegistrations();
            userInput.value = '';
            passInput.value = '';
            errorMsg.style.display = 'none';
            passwordLabel.textContent = 'Senha';
            loginHelp.textContent = 'Apenas usuários pré-cadastrados pelo administrador podem criar ou usar senha nesta tela.';
            unlockDashboard('Senha criada com sucesso!');
            return;
        }

        const hashedAttemptUser = await hashPassword(password);
        if (existingUser.password === hashedAttemptUser) {
            existingUser.lastLogin = new Date().toISOString();
            setCurrentUserName(existingUser.username);
            addAuditLog(existingUser.username, 'Login', 'Usuário acessou o painel');
            await persistRegistrations();
            userInput.value = '';
            passInput.value = '';
            errorMsg.style.display = 'none';
            passwordLabel.textContent = 'Senha';
            loginHelp.textContent = 'Apenas usuários pré-cadastrados pelo administrador podem criar ou usar senha nesta tela.';
            unlockDashboard('Acesso concedido com sucesso!');
            return;
        }

        setTimeout(() => formEl.classList.add('error-shake'), 10);
        errorMsg.style.display = 'block';
        passInput.value = '';
        showToast('Senha incorreta.', 'error');
    } catch (err) {
        console.error('Erro de autenticação:', err);
        showToast('Erro ao validar acesso.', 'error');
    }
}

// Lock dashboard manually
function lockDashboard() {
    sessionState.dashboardUnlocked = false;
    setCurrentUserName('');
    localStorage.setItem('beta_portal_session_state', JSON.stringify(sessionState));
    checkLockedState();
    showToast('Painel bloqueado com segurança.', 'success');
}

// Form Submission handling
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const nameInput = document.getElementById('user-name');
    const emailInput = document.getElementById('user-email');
    const choiceRadio = document.querySelector('input[name="beta-choice"]:checked');
    
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    
    if (!name || !email) {
        showToast('Por favor, preencha todos os campos.', 'error');
        return;
    }
    
    if (!choiceRadio) {
        showToast('Por favor, informe se deseja participar do programa.', 'error');
        return;
    }
    
    const choice = choiceRadio.value;
    updateParticipationPreference(choice);
    
    // Create registration record
    const newRecord = {
        name,
        email,
        participate: choice,
        date: new Date().toISOString()
    };
    
    registrations.push(newRecord);
    await persistRegistrations();
    
    // Feedback to user
    showToast('Inscrição realizada com sucesso!', 'success');
    
    // Reset Form
    nameInput.value = '';
    emailInput.value = '';
    
    // Reset custom selector cards to Yes by default
    document.querySelectorAll('.choice-card').forEach(card => card.classList.remove('selected'));
    const defaultCard = document.querySelector('.choice-card.yes-choice');
    defaultCard.classList.add('selected');
    document.getElementById('choice-yes').checked = true;
}

// Dashboard statistics & component rendering
function renderDashboard() {
    const totalCount = registrations.length;
    const yesCount = registrations.filter(r => r.participate === 'yes').length;
    const noCount = registrations.filter(r => r.participate === 'no').length;

    // Update text KPI values
    document.getElementById('stat-total').textContent = totalCount;
    document.getElementById('stat-yes').textContent = yesCount;
    document.getElementById('stat-no').textContent = noCount;

    // Render Data Table
    renderTable();
    const currentUserName = getCurrentUserName();
    const currentUser = users.find(user => user.username.toLowerCase() === currentUserName.toLowerCase());
    renderAdminAuditPanel(currentUser);

    // Render Chart
    renderChart(yesCount, noCount);
}

// Table rendering logic
function renderTable() {
    const tableBody = document.getElementById('data-table-body');
    tableBody.innerHTML = '';

    // Sort registrations: newest first
    const sorted = registrations
        .map((record, index) => ({ record, index }))
        .sort((a, b) => new Date(b.record.date) - new Date(a.record.date));

    if (sorted.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 3rem 1rem;">
                    <div style="font-size: 2.2rem; margin-bottom: 0.8rem; filter: opacity(0.35);">📥</div>
                    <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 0.3rem;">Área de Inscrições Capturadas</div>
                    <div style="font-size: 0.8rem; max-width: 320px; margin: 0 auto; line-height: 1.4; color: var(--text-muted);">
                        Aqui serão listados os nomes e e-mails coletados de forma segura pelo formulário. Cada registro novo atualizará esta tabela em tempo real com seu carimbo de data e hora.
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    sorted.forEach(({ record, index }) => {
        const tr = document.createElement('tr');
        
        const tdName = document.createElement('td');
        tdName.textContent = record.name;
        
        const tdEmail = document.createElement('td');
        tdEmail.textContent = record.email;
        
        const tdChoice = document.createElement('td');
        const badge = document.createElement('span');
        badge.className = `badge ${record.participate === 'yes' ? 'badge-yes' : 'badge-no'}`;
        badge.textContent = record.participate === 'yes' ? 'Quero' : 'Não Quero';
        tdChoice.appendChild(badge);
        
        const tdDate = document.createElement('td');
        const dateObj = new Date(record.date);
        tdDate.textContent = dateObj.toLocaleDateString('pt-BR') + ' ' + dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        const tdActions = document.createElement('td');
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'table-action-btn edit';
        editBtn.textContent = 'Editar';
        editBtn.addEventListener('click', () => editRegistration(index));

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'table-action-btn delete';
        deleteBtn.textContent = 'Excluir';
        deleteBtn.addEventListener('click', () => deleteRegistration(index));

        tdActions.appendChild(editBtn);
        tdActions.appendChild(deleteBtn);
        
        tr.appendChild(tdName);
        tr.appendChild(tdEmail);
        tr.appendChild(tdChoice);
        tr.appendChild(tdDate);
        tr.appendChild(tdActions);
        
        tableBody.appendChild(tr);
    });
}

async function editRegistration(index) {
    const record = registrations[index];
    if (!record) return;

    const newName = window.prompt('Editar nome:', record.name);
    if (newName === null) return;

    const newEmail = window.prompt('Editar e-mail:', record.email);
    if (newEmail === null) return;

    const newChoice = window.prompt('Editar opção (yes/no):', record.participate === 'yes' ? 'yes' : 'no');
    if (newChoice === null) return;

    const normalizedChoice = newChoice.trim().toLowerCase();
    if (!['yes', 'no'].includes(normalizedChoice)) {
        showToast('Opção inválida. Use yes ou no.', 'error');
        return;
    }

    registrations[index] = {
        ...record,
        name: newName.trim(),
        email: newEmail.trim(),
        participate: normalizedChoice,
        date: record.date
    };

    addAuditLog('admin', 'Edição', `Registro ${record.name} atualizado`);
    await persistRegistrations();
    renderDashboard();
    showToast('Registro atualizado com sucesso!', 'success');
}

async function deleteRegistration(index) {
    const record = registrations[index];
    if (!record) return;

    const confirmed = window.confirm(`Excluir o registro de ${record.name}?`);
    if (!confirmed) return;

    registrations.splice(index, 1);
    addAuditLog('admin', 'Exclusão', `Registro ${record.name} removido`);
    await persistRegistrations();
    renderDashboard();
    showToast('Registro removido com sucesso!', 'success');
}

async function clearAllRegistrations() {
    const password = window.prompt('Digite a senha mestre para limpar tudo:');
    if (!password) return;

    const hashed = await computeSHA256(password);
    if (hashed !== CORRECT_HASH) {
        showToast('Senha mestre incorreta.', 'error');
        return;
    }

    const confirmed = window.confirm('Deseja realmente apagar todos os registros e usuários?');
    if (!confirmed) return;

    registrations = [];
    users = [];
    auditLog = [];
    addAuditLog('admin', 'Limpeza', 'Todos os registros e usuários foram removidos');
    await persistRegistrations();
    renderDashboard();
    showToast('Todos os registros e usuários foram removidos.', 'success');
}

// Chart.js doughnut chart rendering
function renderChart(yesVal, noVal) {
    const canvas = document.getElementById('statsChart');
    const placeholder = document.getElementById('chart-placeholder');
    
    if (yesVal === 0 && noVal === 0) {
        canvas.style.display = 'none';
        placeholder.style.display = 'flex';
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        return;
    }
    
    canvas.style.display = 'block';
    placeholder.style.display = 'none';
    
    const ctx = canvas.getContext('2d');
    
    // Destroy previous chart to prevent render conflicts on data updates
    if (chartInstance) {
        chartInstance.destroy();
    }

    // Chart.js Configurations
    chartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Quero Participar', 'Não Quero'],
            datasets: [{
                data: [yesVal, noVal],
                backgroundColor: [
                    '#00f2fe',  // Cyan color
                    '#ff007f'   // Pink/magenta color
                ],
                borderColor: '#0f1126',
                borderWidth: 3,
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#f3f4f6',
                        font: {
                            family: 'Plus Jakarta Sans',
                            weight: '600',
                            size: 11
                        },
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.raw;
                            const total = yesVal + noVal;
                            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                            return ` ${context.label}: ${val} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

// Toast alerts creation helper
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icon = type === 'success' ? '✓' : '✗';
    toast.innerHTML = `<span style="font-weight: bold; font-size: 1.1rem;">${icon}</span> <span>${message}</span>`;
    
    container.appendChild(toast);
    
    // Animation in
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // Auto remove after 3.5 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 400);
    }, 3500);
}

// Initialize on page load
window.addEventListener('DOMContentLoaded', initApp);
