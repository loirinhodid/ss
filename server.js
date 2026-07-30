
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8000;
const PUBLIC_DIR = path.resolve(__dirname);
const DATA_FILE = process.env.DATA_FILE || path.join(PUBLIC_DIR, 'data.json');

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

function buildPersistedPayload(data) {
    const safeSessionState = normalizeSessionState();
    const registrations = data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.registrations)
        ? data.registrations
        : Array.isArray(data) ? data : [];

    const payload = {
        registrations,
        users: [],
        auditLog: [],
        sessionState: safeSessionState
    };

    payload.sessionState.lastUpdated = new Date().toISOString();
    return payload;
}

function readRegistrationsFile() {
    try {
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(content);

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return buildPersistedPayload(parsed);
        }

        return buildPersistedPayload(parsed);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('Não foi possível ler data.json:', error);
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify({ registrations: [], users: [], auditLog: [], sessionState: createDefaultSessionState() }, null, 2), 'utf8');
        return { registrations: [], users: [], auditLog: [], sessionState: createDefaultSessionState() };
    }
}

function writeRegistrationsFile(data) {
    const payload = buildPersistedPayload(data);
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
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

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
});

module.exports = {
    createDefaultSessionState,
    normalizeSessionState,
    readRegistrationsFile,
    writeRegistrationsFile
};
