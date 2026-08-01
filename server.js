const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 8000;
const PUBLIC_DIR = path.resolve(__dirname);
const DATA_FILE = process.env.DATA_FILE || path.join(PUBLIC_DIR, 'data.json');
let sqliteConnection = null;
let botProtectionEnabled = true;
let currentPersistedPayload = null;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
};

function generateId() {
    return crypto.randomUUID();
}

function createDefaultSessionState() {
    return {
        dashboardUnlocked: false,
        currentUser: '',
        lastParticipationChoice: 'yes',
        lastUpdated: new Date().toISOString()
    };
}

function normalizeSessionState() {
    return createDefaultSessionState();
}

// ---------------------------------------------------------------------
// BUG CORRIGIDO: antes, cada item sem "id" perdia a identidade a cada
// sincronização, e um snapshot completo enviado por um cliente (por ex.
// depois de um `focus` de aba) podia SOBRESCREVER por completo o que
// outro usuário tinha acabado de gravar no servidor - por isso registros
// "desapareciam" depois de atualizações. Agora fazemos merge por "id",
// preservando entradas que existem apenas de um dos lados.
// ---------------------------------------------------------------------
function ensureId(item) {
    const copy = { ...item };
    if (!copy.id) {
        copy.id = generateId();
    }
    return copy;
}

function mergeRecordsById(existingList, incomingList) {
    const map = new Map();
    (Array.isArray(existingList) ? existingList : []).forEach(item => {
        const withId = ensureId(item);
        map.set(withId.id, withId);
    });
    (Array.isArray(incomingList) ? incomingList : []).forEach(item => {
        const withId = ensureId(item);
        map.set(withId.id, withId); // o mais recente enviado "vence" em caso de edição
    });
    return Array.from(map.values());
}

function mergeUsersByUsername(existingList, incomingList) {
    const map = new Map();
    (Array.isArray(existingList) ? existingList : []).forEach(user => {
        if (user && user.username) map.set(user.username.toLowerCase(), user);
    });
    (Array.isArray(incomingList) ? incomingList : []).forEach(user => {
        if (user && user.username) map.set(user.username.toLowerCase(), user);
    });
    return Array.from(map.values());
}

function buildPersistedPayload(data, previousPayload = null) {
    const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const previous = previousPayload && typeof previousPayload === 'object' && !Array.isArray(previousPayload) ? previousPayload : {};
    const previousSessionState = previous.sessionState && typeof previous.sessionState === 'object' ? previous.sessionState : {};

    const hasRegistrationsField = Object.prototype.hasOwnProperty.call(source, 'registrations');
    const incomingRegistrations = hasRegistrationsField
        ? (Array.isArray(source.registrations) ? source.registrations : Array.isArray(data) ? data : [])
        : [];
    const registrations = hasRegistrationsField
        ? mergeRecordsById(previous.registrations, incomingRegistrations)
        : (Array.isArray(previous.registrations) ? previous.registrations : []);

    const hasUsersField = Object.prototype.hasOwnProperty.call(source, 'users');
    const users = hasUsersField
        ? mergeUsersByUsername(previous.users, Array.isArray(source.users) ? source.users : [])
        : (Array.isArray(previous.users) ? previous.users : []);

    const hasAuditLogField = Object.prototype.hasOwnProperty.call(source, 'auditLog');
    const auditLog = hasAuditLogField
        ? mergeRecordsById(previous.auditLog, Array.isArray(source.auditLog) ? source.auditLog : [])
            .sort((a, b) => new Date(b.date) - new Date(a.date))
        : (Array.isArray(previous.auditLog) ? previous.auditLog : []);

    const sessionState = {
        dashboardUnlocked: false,
        currentUser: '',
        lastParticipationChoice: 'yes',
        lastUpdated: new Date().toISOString()
    };

    if (previousSessionState && typeof previousSessionState === 'object') {
        sessionState.dashboardUnlocked = false;
        sessionState.currentUser = '';
        sessionState.lastParticipationChoice = previousSessionState.lastParticipationChoice === 'no' ? 'no' : 'yes';
        sessionState.lastUpdated = typeof previousSessionState.lastUpdated === 'string' ? previousSessionState.lastUpdated : new Date().toISOString();
    }

    const payload = {
        registrations,
        users,
        auditLog,
        sessionState
    };

    payload.sessionState.lastUpdated = new Date().toISOString();
    return payload;
}

// Grava um payload já pronto (sem merge). Usado pelas ações de exclusão,
// onde o merge por id resultaria em "ressuscitar" o item apagado.
function persistRawPayload(payload) {
    const finalPayload = {
        registrations: Array.isArray(payload.registrations) ? payload.registrations : [],
        users: Array.isArray(payload.users) ? payload.users : [],
        auditLog: Array.isArray(payload.auditLog) ? payload.auditLog : [],
        sessionState: payload.sessionState && typeof payload.sessionState === 'object' ? payload.sessionState : createDefaultSessionState()
    };
    finalPayload.sessionState.lastUpdated = new Date().toISOString();
    persistPayloadToDatabase(finalPayload);
    writePayloadToDisk(finalPayload);
    currentPersistedPayload = finalPayload;
    return finalPayload;
}

function getDatabasePath() {
    if (process.env.DB_FILE) {
        return process.env.DB_FILE;
    }

    const extension = path.extname(DATA_FILE);
    if (extension) {
        return path.join(path.dirname(DATA_FILE), `${path.basename(DATA_FILE, extension)}.sqlite`);
    }

    return `${DATA_FILE}.sqlite`;
}

function getDatabaseConnection() {
    if (sqliteConnection) {
        return sqliteConnection;
    }

    sqliteConnection = new DatabaseSync(getDatabasePath());
    sqliteConnection.exec(`
        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    `);

    return sqliteConnection;
}

function persistPayloadToDatabase(payload) {
    const db = getDatabaseConnection();
    const timestamp = new Date().toISOString();
    const serializedPayload = JSON.stringify(payload);

    db.prepare(`
        INSERT INTO app_state (key, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
    `).run('registrations', serializedPayload, timestamp);
}

function loadPayloadFromDatabase() {
    try {
        const row = getDatabaseConnection().prepare('SELECT payload FROM app_state WHERE key = ?').get('registrations');
        if (!row || typeof row.payload !== 'string') {
            return null;
        }

        return JSON.parse(row.payload);
    } catch (error) {
        console.warn('Não foi possível ler o banco SQLite:', error);
        return null;
    }
}

function writePayloadToDisk(payload) {
    const serializedPayload = JSON.stringify(payload, null, 2);
    const backupPath = `${DATA_FILE}.bak`;

    try {
        if (fs.existsSync(DATA_FILE)) {
            const currentContent = fs.readFileSync(DATA_FILE, 'utf8');
            fs.writeFileSync(backupPath, currentContent, 'utf8');
        }
        fs.writeFileSync(DATA_FILE, serializedPayload, 'utf8');
        currentPersistedPayload = payload;
        return true;
    } catch (error) {
        console.warn('Não foi possível escrever o estado persistido:', error);
        try {
            if (fs.existsSync(backupPath)) {
                fs.writeFileSync(DATA_FILE, fs.readFileSync(backupPath, 'utf8'), 'utf8');
            }
        } catch (restoreError) {
            console.warn('Não foi possível restaurar o backup do estado persistido:', restoreError);
        }
        return false;
    }
}

function readRegistrationsFile() {
    try {
        const persistedFromDatabase = loadPayloadFromDatabase();
        if (persistedFromDatabase) {
            currentPersistedPayload = buildPersistedPayload(persistedFromDatabase, currentPersistedPayload || persistedFromDatabase);
            return currentPersistedPayload;
        }
    } catch (error) {
        console.warn('Não foi possível ler o banco SQLite:', error);
    }

    try {
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(content);
        const payload = buildPersistedPayload(parsed, currentPersistedPayload || parsed);
        currentPersistedPayload = payload;
        persistPayloadToDatabase(payload);
        return payload;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('Não foi possível ler data.json:', error);
        }

        if (currentPersistedPayload) {
            return buildPersistedPayload(currentPersistedPayload, currentPersistedPayload);
        }

        const emptyPayload = {
            registrations: [],
            users: [],
            auditLog: [],
            sessionState: createDefaultSessionState()
        };

        currentPersistedPayload = emptyPayload;
        persistPayloadToDatabase(emptyPayload);
        writePayloadToDisk(emptyPayload);
        return buildPersistedPayload(emptyPayload);
    }
}

function writeRegistrationsFile(data) {
    const previousPayload = readRegistrationsFile();
    const payload = buildPersistedPayload(data, previousPayload);
    persistPayloadToDatabase(payload);
    const written = writePayloadToDisk(payload);
    if (!written && currentPersistedPayload) {
        return buildPersistedPayload(currentPersistedPayload, currentPersistedPayload);
    }
    return payload;
}

function recordAuditEvent(user, action, details) {
    const previousPayload = readRegistrationsFile();
    const nextAuditLog = [{
        id: generateId(),
        user,
        action,
        details,
        date: new Date().toISOString()
    }].concat(Array.isArray(previousPayload.auditLog) ? previousPayload.auditLog : []);

    const payload = buildPersistedPayload({
        registrations: previousPayload.registrations,
        users: previousPayload.users,
        auditLog: nextAuditLog,
        sessionState: previousPayload.sessionState
    }, previousPayload);

    persistPayloadToDatabase(payload);
    writePayloadToDisk(payload);
    return payload;
}

function isAdminUser(username) {
    if (!username) return false;
    const payload = readRegistrationsFile();
    const user = (payload.users || []).find(u => u.username && u.username.toLowerCase() === String(username).toLowerCase());
    return Boolean(user && user.role === 'admin');
}

function removeRegistrationById(id, actingUser) {
    const previousPayload = readRegistrationsFile();
    const nextRegistrations = (previousPayload.registrations || []).filter(r => r.id !== id);
    persistRawPayload({
        registrations: nextRegistrations,
        users: previousPayload.users,
        auditLog: previousPayload.auditLog,
        sessionState: previousPayload.sessionState
    });
    return recordAuditEvent(actingUser || 'admin', 'Exclusão', `Registro ${id} removido`);
}

function removeUserByUsername(username, actingUser) {
    const previousPayload = readRegistrationsFile();
    const target = (previousPayload.users || []).find(u => u.username.toLowerCase() === String(username).toLowerCase());
    if (!target || target.role === 'admin') {
        return previousPayload;
    }
    const nextUsers = (previousPayload.users || []).filter(u => u.username.toLowerCase() !== String(username).toLowerCase());
    persistRawPayload({
        registrations: previousPayload.registrations,
        users: nextUsers,
        auditLog: previousPayload.auditLog,
        sessionState: previousPayload.sessionState
    });
    return recordAuditEvent(actingUser || 'admin', 'Remoção de usuário', `Usuário ${username} removido do painel`);
}

function clearAllData(actingUser) {
    const previousPayload = readRegistrationsFile();
    const adminUser = (previousPayload.users || []).find(u => u.username && u.username.toLowerCase() === 'admin');
    persistRawPayload({
        registrations: [],
        users: adminUser ? [adminUser] : [],
        auditLog: [],
        sessionState: previousPayload.sessionState
    });
    return recordAuditEvent(actingUser || 'admin', 'Limpeza', 'Todos os registros e usuários foram removidos');
}

function clearAuditLogData(actingUser) {
    const previousPayload = readRegistrationsFile();
    persistRawPayload({
        registrations: previousPayload.registrations,
        users: previousPayload.users,
        auditLog: [],
        sessionState: previousPayload.sessionState
    });
    return recordAuditEvent(actingUser || 'admin', 'Log limpo', 'Log de acesso foi limpo');
}

function getBotProtectionStatus() {
    return botProtectionEnabled;
}

function setBotProtectionEnabled(enabled) {
    botProtectionEnabled = Boolean(enabled);
    recordAuditEvent('system', 'Proteção', botProtectionEnabled ? 'Proteção contra bots ativada.' : 'Proteção contra bots desativada.');
    return botProtectionEnabled;
}

// ---------------------------------------------------------------------
// Bloqueio de bots / crawlers de IA. Nenhuma lista de user-agent é
// infalível (um cliente automatizado pode sempre forjar um cabeçalho),
// mas combinamos assinatura de user-agent conhecida + ausência de
// cabeçalhos que praticamente todo navegador real envia.
// ---------------------------------------------------------------------
function looksLikeRealBrowser(userAgent) {
    const normalizedUserAgent = String(userAgent || '').toLowerCase();
    if (!normalizedUserAgent) {
        return false;
    }

    const botIndicators = [
        'bot', 'crawler', 'spider', 'slurp', 'bingbot', 'googlebot', 'applebot', 'duckduckbot', 'baiduspider',
        'yandex', 'petalbot', 'gptbot', 'claudebot', 'openai', 'anthropic', 'claude', 'perplexity', 'cohere',
        'facebookexternalhit', 'twitterbot', 'linkedinbot', 'archive.org_bot', 'semrush', 'ahrefs', 'mj12bot',
        'curl/', 'wget', 'python-requests', 'headlesschrome', 'playwright', 'phantomjs', 'axios', 'httpie',
        'go-http-client', 'okhttp', 'postmanruntime', 'java/', 'libwww', 'python-urllib', 'wget/', 'python-urllib3',
        'anthropic-ai', 'openai-api', 'gpt4', 'gpt-4', 'chatgpt', 'o3-mini', 'o1-preview',
        'ccbot', 'diffbot', 'bytespider', 'amazonbot', 'facebookbot', 'meta-externalagent', 'ai2bot',
        'omgili', 'timpibot', 'youbot', 'webzio', 'scrapy', 'node-fetch', 'ruby', 'php', 'lwp::simple'
    ];

    if (botIndicators.some(indicator => normalizedUserAgent.includes(indicator))) {
        return false;
    }

    const browserIndicators = ['mozilla', 'chrome', 'firefox', 'safari', 'edg/', 'edge/', 'opera', 'chromium', 'webkit', 'applewebkit'];
    const hasBrowserSignature = browserIndicators.some(indicator => normalizedUserAgent.includes(indicator));

    if (!hasBrowserSignature) {
        return false;
    }

    return true;
}

function shouldBlockAutomatedRequest(req) {
    if (!botProtectionEnabled) {
        return false;
    }

    const headers = (req && req.headers) || {};
    const userAgent = headers['user-agent'] || headers['User-Agent'] || '';
    const acceptLanguage = headers['accept-language'];

    let blocked = !looksLikeRealBrowser(userAgent);

    // Navegadores reais praticamente sempre enviam Accept-Language;
    // a maioria dos clientes automatizados (scripts, SDKs de IA) não envia.
    if (!blocked && !acceptLanguage) {
        blocked = true;
    }

    if (blocked) {
        recordAuditEvent('system', 'Proteção bloqueada', `Bloqueado automaticamente por user-agent: ${userAgent || 'desconhecido'}`);
    }

    return blocked;
}

function readJsonBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}

const server = http.createServer((req, res) => {
    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(req.url);
    } catch (e) {
        decodedUrl = req.url;
    }

    const pathname = decodedUrl.split('?')[0];

    // robots.txt fica sempre acessível (é o próprio mecanismo padrão para
    // instruir crawlers/IAs bem-comportados a não indexar o site).
    if (pathname === '/robots.txt') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('User-agent: *\nDisallow: /\n');
        return;
    }

    // A partir daqui, qualquer requisição que pareça vir de bot/IA é
    // bloqueada antes de tocar em qualquer rota, inclusive a de
    // ligar/desligar a própria proteção - assim um bot não consegue
    // se auto-liberar.
    if (shouldBlockAutomatedRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Access denied for automated systems.');
        return;
    }

    if (pathname === '/api/bot-protection') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ enabled: botProtectionEnabled }));
            return;
        }

        if (req.method === 'POST') {
            readJsonBody(req).then(parsed => {
                const enabled = typeof parsed?.enabled === 'boolean' ? parsed.enabled : Boolean(parsed?.enabled);
                setBotProtectionEnabled(enabled);
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ enabled: botProtectionEnabled }));
            }).catch(() => {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Payload inválido.' }));
            });
            return;
        }
    }

    if (pathname === '/api/registrations/delete' && req.method === 'POST') {
        readJsonBody(req).then(parsed => {
            if (!parsed || !parsed.id) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'id é obrigatório.' }));
                return;
            }
            const payload = removeRegistrationById(parsed.id, parsed.actingUser);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(payload));
        }).catch(() => {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Payload inválido.' }));
        });
        return;
    }

    if (pathname === '/api/registrations/clear-all' && req.method === 'POST') {
        readJsonBody(req).then(parsed => {
            if (!isAdminUser(parsed?.actingUser)) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Acesso administrativo necessário.' }));
                return;
            }
            const payload = clearAllData(parsed?.actingUser);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(payload));
        }).catch(() => {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Payload inválido.' }));
        });
        return;
    }

    if (pathname === '/api/users/remove' && req.method === 'POST') {
        readJsonBody(req).then(parsed => {
            if (!isAdminUser(parsed?.actingUser)) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Acesso administrativo necessário.' }));
                return;
            }
            if (!parsed?.username) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'username é obrigatório.' }));
                return;
            }
            const payload = removeUserByUsername(parsed.username, parsed.actingUser);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(payload));
        }).catch(() => {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Payload inválido.' }));
        });
        return;
    }

    if (pathname === '/api/audit-log/clear' && req.method === 'POST') {
        readJsonBody(req).then(parsed => {
            if (!isAdminUser(parsed?.actingUser)) {
                res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Acesso administrativo necessário.' }));
                return;
            }
            const payload = clearAuditLogData(parsed?.actingUser);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(payload));
        }).catch(() => {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Payload inválido.' }));
        });
        return;
    }

    if (pathname === '/api/registrations') {
        if (req.method === 'GET') {
            const data = readRegistrationsFile();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(data));
            return;
        }

        if (req.method === 'POST') {
            readJsonBody(req).then(parsed => {
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    // BUG CORRIGIDO: antes a resposta era calculada com
                    // buildPersistedPayload(parsed) SEM o payload anterior,
                    // então o JSON devolvido ao cliente não batia com o que
                    // realmente foi persistido. Agora usamos o retorno real
                    // de writeRegistrationsFile.
                    const persistedPayload = writeRegistrationsFile(parsed);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(persistedPayload));
                    return;
                }

                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Esperava um objeto com registrations e users.' }));
            }).catch(() => {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Payload inválido.' }));
            });
            return;
        }
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden - Access Denied');
        return;
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('Not Found');
            } else {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`Server Error: ${err.code}`);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

if (require.main === module) {
    server.listen(PORT, () => {
        console.log(`Server running at http://localhost:${PORT}/`);
    });
}

module.exports = {
    createDefaultSessionState,
    normalizeSessionState,
    readRegistrationsFile,
    writeRegistrationsFile,
    shouldBlockAutomatedRequest,
    getBotProtectionStatus,
    setBotProtectionEnabled,
    server
};