
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

function normalizeSessionState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return createDefaultSessionState();
    }

    return {
        dashboardUnlocked: Boolean(value.dashboardUnlocked),
        currentUser: typeof value.currentUser === 'string' ? value.currentUser : '',
        lastParticipationChoice: value.lastParticipationChoice === 'no' ? 'no' : 'yes',
        lastUpdated: typeof value.lastUpdated === 'string' ? value.lastUpdated : new Date().toISOString()
    };
}

function readRegistrationsFile() {
    try {
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        const parsed = JSON.parse(content);

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return {
                registrations: Array.isArray(parsed.registrations) ? parsed.registrations : [],
                users: Array.isArray(parsed.users) ? parsed.users : [],
                auditLog: Array.isArray(parsed.auditLog) ? parsed.auditLog : [],
                sessionState: normalizeSessionState(parsed.sessionState)
            };
        }

        return {
            registrations: Array.isArray(parsed) ? parsed : [],
            users: [],
            auditLog: [],
            sessionState: createDefaultSessionState()
        };
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn('Não foi possível ler data.json:', error);
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify({ registrations: [], users: [], auditLog: [], sessionState: createDefaultSessionState() }, null, 2), 'utf8');
        return { registrations: [], users: [], auditLog: [], sessionState: createDefaultSessionState() };
    }
}

function writeRegistrationsFile(data) {
    const payload = data && typeof data === 'object' && !Array.isArray(data)
        ? {
            registrations: Array.isArray(data.registrations) ? data.registrations : [],
            users: Array.isArray(data.users) ? data.users : [],
            auditLog: Array.isArray(data.auditLog) ? data.auditLog : [],
            sessionState: normalizeSessionState(data.sessionState)
          }
        : { registrations: Array.isArray(data) ? data : [], users: [], auditLog: [], sessionState: createDefaultSessionState() };

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
                    writeRegistrationsFile(parsed);
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                    res.end(JSON.stringify(parsed));
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
