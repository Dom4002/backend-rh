const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');

const app = express();
const upload = multer();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = process.env.JWT_SECRET || 'cle_de_secours_indev';

// --- 1. TABLE DE ROUTAGE (Pas de changement ici) ---
const SCENARIO_MAP = {
    // MASTER READER
    'read': process.env.URL_MASTER_READ,
    'read-leaves': process.env.URL_MASTER_READ,
    'read-candidates': process.env.URL_MASTER_READ,
    'read-flash': process.env.URL_MASTER_READ,
    'read-config': process.env.URL_MASTER_READ,
    'read-payroll': process.env.URL_MASTER_READ,
    'read-logs': process.env.URL_MASTER_READ,

    // MASTER MUTATOR
    'write': process.env.URL_MASTER_WRITE,
    'update': process.env.URL_MASTER_WRITE,
    'emp-update': process.env.URL_MASTER_WRITE,
    'write-flash': process.env.URL_MASTER_WRITE,

    // MASTER FLOW CONTROL
    'log': process.env.URL_MASTER_FLOW,
    'clock': process.env.URL_MASTER_FLOW,
    'leave': process.env.URL_MASTER_FLOW,
    'leave-action': process.env.URL_MASTER_FLOW,
    'candidate-action': process.env.URL_MASTER_FLOW,

    // MASTER FILE SYSTEM
    'badge': process.env.URL_MASTER_FILE,
    'gatekeeper': process.env.URL_MASTER_FILE,
    'contract-gen': process.env.URL_MASTER_FILE,
    'contract-upload': process.env.URL_MASTER_FILE,

    // LOGIN
    'login': process.env.URL_LOGIN
};

// --- 2. PERMISSIONS (Pas de changement ici) ---
const PERMISSIONS = {
    'ADMIN': [
        'login', 'read', 'read-leaves', 'read-candidates', 'read-flash', 'read-config', 'read-payroll', 'read-logs',
        'write', 'update', 'emp-update', 'write-flash',
        'log', 'clock', 'leave', 'leave-action', 'candidate-action',
        'badge', 'gatekeeper', 'contract-gen', 'contract-upload'
    ],
    'RH': [
        'login', 'read', 'read-leaves', 'read-candidates', 'read-flash', 'read-config', 'read-payroll',
        'write', 'update', 'emp-update', 'write-flash',
        'log', 'clock', 'leave', 'leave-action', 'candidate-action',
        'badge', 'contract-gen', 'contract-upload'
    ],
    'MANAGER': [
        'login', 'read', 'read-leaves', 'read-flash', 'read-config',
        'write-flash',
        'log', 'clock', 'leave', 'leave-action',
        'badge'
    ],
    'EMPLOYEE': [
        'login', 'read', 'read-flash', 'read-config', 'read-payroll',
        'emp-update',
        'clock', 'leave',
        'badge'
    ]
};

// --- 3. POINT D'ENTRÉE ---
app.all('/api/:action', upload.any(), async (req, res) => {
    const action = req.params.action;
    const targetUrl = SCENARIO_MAP[action];

    if (!targetUrl) return res.status(404).json({ error: "Action non configurée" });

    // Vérification Token (Sauf login/gatekeeper)
    if (action !== 'login' && action !== 'gatekeeper') {
        const authHeader = req.headers['authorization'];
        const token = authHeader ? authHeader.split(' ')[1] : req.query.token;

        if (!token) return res.status(401).json({ error: "Authentification requise" });

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (!PERMISSIONS[decoded.role] || !PERMISSIONS[decoded.role].includes(action)) {
                return res.status(403).json({ error: "Privilèges insuffisants" });
            }
        } catch (err) {
            return res.status(401).json({ error: "Session expirée" });
        }
    }

    try {
        let dataToSend;
        let requestHeaders = {};

        // === CORRECTION MAJEURE ICI ===
        // On envoie le mot-clé de routage dans l'URL sous le nom 'route'
        // Comme ça, il ne touche pas au Body (JSON) qui contient tes données métiers
        const queryWithRoute = { ...req.query, route: action };

        if (req.files && req.files.length > 0) {
            const form = new FormData();
            for (const key in req.body) { form.append(key, req.body[key]); }
            req.files.forEach(file => { 
                form.append(file.fieldname, file.buffer, file.originalname); 
            });
            dataToSend = form;
            requestHeaders = form.getHeaders();
        } else {
            // On envoie le body tel quel, sans y injecter l'action en double
            dataToSend = req.body;
        }

        const response = await axios({
            method: req.method,
            url: targetUrl,
            params: queryWithRoute, // C'est ici que part la clé 'route' = 'candidate-action'
            data: dataToSend,       // Ici, ton JSON reste pur : { "action": "ACCEPTER", "id": "..." }
            headers: { ...requestHeaders },
            responseType: 'arraybuffer'
        });

        if (action === 'login') {
             // ... (Logique Login inchangée) ...
             const responseText = Buffer.from(response.data).toString();
             try {
                 const makeData = JSON.parse(responseText);
                 if (makeData.status === 'success') {
                     const token = jwt.sign({ id: makeData.id, role: (makeData.role||"EMPLOYEE").toUpperCase(), nom: makeData.nom }, JWT_SECRET, { expiresIn: '24h' });
                     makeData.token = token;
                     return res.json(makeData);
                 }
             } catch (e) {}
        }

        if(response.headers['content-type']) {
            res.set('Content-Type', response.headers['content-type']);
        }
        res.send(response.data);

    } catch (error) {
        console.error(`Erreur Proxy [${action}]:`, error.message);
        if (error.response) res.status(error.response.status).send(error.response.data);
        else res.status(500).json({ error: "Erreur serveur" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur Optimisé (Clé 'route') actif sur le port ${PORT}`));
