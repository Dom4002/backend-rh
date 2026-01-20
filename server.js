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

// --- 1. MISE À JOUR DES PERMISSIONS ---
// Ajout de 'read-config' pour TOUS les rôles (nécessaire pour le GPS)
const PERMISSIONS = {
    'ADMIN': [
        'login', 'read', 'write', 'update', 'log', 'read-logs', 'gatekeeper', 
        'badge', 'emp-update', 'contract-gen', 'contract-upload', 'leave', 
        'clock', 'read-leaves', 'leave-action', 
        'read-candidates', 'candidate-action', 'read-flash', 'write-flash
        'read-config' // <--- NOUVEAU
    ],
    'RH': [
        'login', 'read', 'write', 'update', 'log', 'badge', 'emp-update', 
        'contract-gen', 'contract-upload', 'leave', 'clock', 'read-leaves', 
        'leave-action', 
        'read-candidates', 'candidate-action', 'read-flash', 'write-flash
        'read-config' // <--- NOUVEAU
    ],
    'MANAGER': [
        'login', 'read', 'log', 'badge', 'leave', 'clock', 'read-leaves', 'leave-action',
        'read-config', 'read-flash', 'write-flash // <--- NOUVEAU
    ],
    'EMPLOYEE': [
        'login', 'read', 'badge', 'leave', 'clock', 'emp-update',
        'read-config', 'read-flash', 'write-flash // <--- NOUVEAU (Indispensable pour qu'ils puissent pointer)
    ]
};

// --- 2. MISE À JOUR DES WEBHOOKS ---
// Ajout du lien vers le scénario Make de configuration
const WEBHOOKS = {
    'login': process.env.URL_LOGIN,
    'read': process.env.URL_READ,
    'write': process.env.URL_WRITE_POST,
    'update': process.env.URL_UPDATE,
    'log': process.env.URL_LOG,
    'read-logs': process.env.URL_READ_LOGS,
    'gatekeeper': process.env.URL_GATEKEEPER,
    'badge': process.env.URL_BADGE_GEN,
    'emp-update': process.env.URL_EMPLOYEE_UPDATE,
    'contract-gen': process.env.URL_CONTRACT_GENERATE,
    'contract-upload': process.env.URL_UPLOAD_SIGNED_CONTRACT,
    'leave': process.env.URL_LEAVE_REQUEST,
    'clock': process.env.URL_CLOCK_ACTION,
    'read-leaves': process.env.URL_READ_LEAVES,
    'leave-action': process.env.URL_LEAVE_ACTION,
    
    // RECRUTEMENT
    'read-candidates': process.env.URL_READ_CANDIDATES,
    'candidate-action': process.env.URL_CANDIDATE_ACTION,

    // ... vos autres webhooks ...
    'read-flash': 'process.env.URL_READ_FLASH',
    'write-flash': 'process.env.URL_WRITE_FLASH'

    // NOUVEAU : CONFIGURATION SAAS
    'read-config': process.env.URL_GET_CONFIG // <--- C'est ici qu'on lie l'action à l'URL Make
};

app.all('/api/:action', upload.any(), async (req, res) => {
    const action = req.params.action;
    const secretUrl = WEBHOOKS[action];

    if (!secretUrl) return res.status(404).json({ error: "Action inconnue ou non configurée" });

    // VERIFICATION DU TOKEN (Sauf pour le login)
    if (action !== 'login') {
        const authHeader = req.headers['authorization'];
        const token = authHeader ? authHeader.split(' ')[1] : req.query.token;

        if (!token) return res.status(401).json({ error: "Authentification requise" });

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const userRole = decoded.role; 

            // Vérification stricte des permissions
            if (!PERMISSIONS[userRole] || !PERMISSIONS[userRole].includes(action)) {
                console.warn(`Accès refusé pour ${decoded.nom} (${userRole}) sur l'action ${action}`);
                return res.status(403).json({ error: "Accès interdit : privilèges insuffisants" });
            }
            req.user = decoded;
        } catch (err) {
            console.error("Erreur Token:", err.message);
            return res.status(401).json({ error: "Session invalide ou expirée" });
        }
    }

    try {
        let dataToSend;
        let requestHeaders = {};

        // Gestion des fichiers (Multipart) vs JSON standard
        if (req.files && req.files.length > 0) {
            const form = new FormData();
            for (const key in req.body) { form.append(key, req.body[key]); }
            req.files.forEach(file => { 
                form.append(file.fieldname, file.buffer, file.originalname); 
            });
            dataToSend = form;
            requestHeaders = form.getHeaders();
        } else {
            dataToSend = req.body;
        }

        // Transmission à Make
        const response = await axios({
            method: req.method,
            url: secretUrl,
            params: req.query,
            data: dataToSend,
            headers: { ...requestHeaders },
            responseType: 'arraybuffer' 
        });

        // GENERATION DU TOKEN AU LOGIN
        if (action === 'login') {
            const responseText = Buffer.from(response.data).toString();
            try {
                const makeData = JSON.parse(responseText);
                if (makeData.status === 'success') {
                    const token = jwt.sign(
                        { 
                            id: makeData.id, 
                            role: (makeData.role || "EMPLOYEE").toUpperCase(), 
                            nom: makeData.nom 
                        },
                        JWT_SECRET,
                        { expiresIn: '24h' }
                    );
                    makeData.token = token;
                    return res.json(makeData);
                }
            } catch (e) {
                console.error("Erreur parsing réponse Login:", e);
            }
        }

        // Relai de la réponse Make vers le Frontend
        if(response.headers['content-type']) {
            res.set('Content-Type', response.headers['content-type']);
        }
        res.send(response.data);

    } catch (error) {
        console.error(`Erreur Proxy [${action}]:`, error.message);
        if (error.response) {
            res.status(error.response.status).send(error.response.data);
        } else {
            res.status(500).json({ error: "Erreur de communication avec le service RH (Make)" });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur Proxy Sécurisé Actif sur le port ${PORT}`));

