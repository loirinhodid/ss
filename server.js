
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 8000;
const PUBLIC_DIR = path.resolve(__dirname);
const DATA_FILE = process.env.DATA_FILE || path.join(PUBLIC_DIR, 'data.json');
let sqliteConnection = null;
let botProtectionEnabled = true;

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

function buildPersistedPayload(data, previousPayload = null) {
    const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    const previous = previousPayload && typeof previousPayload === 'object' && !Array.isArray(previousPayload) ? previousPayload : {};

    const hasRegistrationsField = Object.prototype.hasOwnProperty.call(source, 'registrations');
    const registrations = hasRegistrationsField
        ? (Array.isArray(source.registrations) ? source.registrations : Array.isArray(data) ? data : [])
        : (Array.isArray(previous.registrations) ? previous.registrations : []);

    const hasUsersField = Object.prototype.hasOwnProperty.call(source, 'users');
    const users = hasUsersField ? (Array.isArray(source.users) ? source.users : []) : (Array.isArray(previous.users) ? previous.users : []);

    const hasAuditLogField = Object.prototype.hasOwnProperty.call(source, 'auditLog');
    const auditLog = hasAuditLogField ? (Array.isArray(source.auditLog) ? source.auditLog : []) : (Array.isArray(previous.auditLog) ? previous.auditLog : []);

    const sessionState = createDefaultSessionState();
    const payload = {
        registrations,
        users,
        auditLog,
        sessionState
    };

    payload.sessionState.lastUpdated = new Date().toISOString();
    return payload;
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

function readRegistrationsFile() {
    const persistedFromDatabase = loadPayloadFromDatabase();
    if (persistedFromDatabase) {
        return buildPersistedPayload(persistedFromDatabase, persistedFromDatabase);
    }

    try {
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(content);
        const payload = buildPersistedPayload(parsed);
        persistPayloadToDatabase(payload);
        return payload;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('Não foi possível ler data.json:', error);
        }

        const emptyPayload = {
            registrations: [],
            users: [],
            auditLog: [],
            sessionState: createDefaultSessionState()
        };

        persistPayloadToDatabase(emptyPayload);
        fs.writeFileSync(DATA_FILE, JSON.stringify(emptyPayload, null, 2), 'utf8');
        return buildPersistedPayload(emptyPayload);
    }
}

function writeRegistrationsFile(data) {
    const previousPayload = readRegistrationsFile();
    const payload = buildPersistedPayload(data, previousPayload);
    persistPayloadToDatabase(payload);
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}

function recordAuditEvent(user, action, details) {
    const previousPayload = readRegistrationsFile();
    const nextAuditLog = [{
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
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
}

function getBotProtectionStatus() {
    return botProtectionEnabled;
}

function setBotProtectionEnabled(enabled) {
    botProtectionEnabled = Boolean(enabled);
    recordAuditEvent('system', 'Proteção', botProtectionEnabled ? 'Proteção contra bots ativada.' : 'Proteção contra bots desativada.');
    return botProtectionEnabled;
}

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
        'go-http-client', 'okhttp', 'postmanruntime', 'java/', 'libwww', 'python-urllib', 'wget/', 'python-urllib3'
    ];

    if (botIndicators.some(indicator => normalizedUserAgent.includes(indicator))) {
        return false;
    }

    const browserIndicators = ['mozilla', 'chrome', 'firefox', 'safari', 'edg/', 'edge/', 'opera', 'chromium', 'webkit'];
    return browserIndicators.some(indicator => normalizedUserAgent.includes(indicator));
}

function shouldBlockAutomatedRequest(req) {
    if (!botProtectionEnabled) {
        return false;
    }

    const userAgent = (req && req.headers && (req.headers['user-agent'] || req.headers['User-Agent'] || '')) || '';
    const blocked = !looksLikeRealBrowser(userAgent);

    if (blocked) {
        recordAuditEvent('system', 'Proteção bloqueada', `Bloqueado automaticamente por user-agent: ${userAgent || 'desconhecido'}`);
    }

    return blocked;
}

const server = http.createServer((req, res) => {
    // Decodes URL components (e.g. spaces as %20)
    let decodedUrl;
    try {
        decodedUrl = decodeURIComponent(req.url);
    } catch (e) {
        decodedUrl = req.url;
    }
    
    // Strip query parameters
    const pathname = decodedUrl.split('?')[0];

    if (pathname === '/api/bot-protection') {
        if (req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ enabled: botProtectionEnabled }));
            return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
                body += chunk;
            });
            req.on('end', () => {
                try {
                    const parsed = JSON.parse(body);
                    const enabled = typeof parsed?.enabled === 'boolean' ? parsed.enabled : Boolean(parsed?.enabled);
                    setBotProtectionEnabled(enabled);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ enabled: botProtectionEnabled }));
                } catch (error) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'Payload inválido.' }));
                }
            });
            return;
        }
    }

    if (shouldBlockAutomatedRequest(req)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Access denied for automated systems.');
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
            let body = '';
            req.on('data', chunk => {
                body += chunk;
            });
            req.on('end', () => {
                let parsed = { registrations: [], users: [] };
                try {
                    parsed = JSON.parse(body);
                } catch (error) {
                    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify({ error: 'Payload inválido.' }));
                    return;
                }

                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const persistedPayload = buildPersistedPayload(parsed);
                    writeRegistrationsFile(parsed);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(persistedPayload));
                    return;
                }

                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'Esperava um objeto com registrations e users.' }));
            });
            return;
        }
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    
    // Security check to avoid accessing files outside the workspace
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
