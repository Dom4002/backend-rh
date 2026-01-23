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

// --- 1. TABLE DE ROUTAGE INTELLIGENTE ---
// Chaque action du site est dirigée vers son MASTER SCENARIO
const SCENARIO_MAP = {
    // === MASTER READER (Lecture seule) ===
    'read': process.env.URL_MASTER_READ,
    'read-leaves': process.env.URL_MASTER_READ,
    'read-candidates': process.env.URL_MASTER_READ,
    'read-flash': process.env.URL_MASTER_READ,
    'read-config': process.env.URL_MASTER_READ,
    'read-payroll': process.env.URL_MASTER_READ,
    'read-logs': process.env.URL_MASTER_READ,

    // === MASTER MUTATOR (Modifications simples) ===
    'write': process.env.URL_MASTER_WRITE,
    'update': process.env.URL_MASTER_WRITE,
    'emp-update': process.env.URL_MASTER_WRITE,
    'write-flash': process.env.URL_MASTER_WRITE,

    // === MASTER FLOW CONTROL (Actions complexes & Flux) ===
    'log': process.env.URL_MASTER_FLOW,
    'clock': process.env.URL_MASTER_FLOW,
    'leave': process.env.URL_MASTER_FLOW,
    'leave-action': process.env.URL_MASTER_FLOW,       // Correspond à leave_action
    'candidate-action': process.env.URL_MASTER_FLOW,   // Correspond à candidate_action

    // === MASTER FILE SYSTEM (Génération & Fichiers) ===
    'badge': process.env.URL_MASTER_FILE,
    'gatekeeper': process.env.URL_MASTER_FILE,
    'contract-gen': process.env.URL_MASTER_FILE,
    'contract-upload': process.env.URL_MASTER_FILE,

    // === LOGIN (Indépendant) ===
    'login': process.env.URL_LOGIN
};

// --- 2. PERMISSIONS (Sécurité Rôles) ---
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

// --- 3. POINT D'ENTRÉE UNIQUE ---
app.all('/api/:action', upload.any(), async (req, res) => {
    const action = req.params.action; // Ex: 'read-leaves', 'clock'
    const targetUrl = SCENARIO_MAP[action];

    // 1. Vérification si l'action existe
    if (!targetUrl) {
        console.error(`Action inconnue demandée : ${action}`);
        return res.status(404).json({ error: "Action non configurée sur le serveur" });
    }

    // 2. Vérification du Token JWT (Sauf pour login et gatekeeper public)
    if (action !== 'login' && action !== 'gatekeeper') {
        const authHeader = req.headers['authorization'];
        const token = authHeader ? authHeader.split(' ')[1] : req.query.token;

        if (!token) return res.status(401).json({ error: "Authentification requise" });

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const userRole = decoded.role; 

            // Vérification des droits
            if (!PERMISSIONS[userRole] || !PERMISSIONS[userRole].includes(action)) {
                console.warn(`Accès refusé pour ${decoded.nom} (${userRole}) sur ${action}`);
                return res.status(403).json({ error: "Privilèges insuffisants" });
            }
            req.user = decoded; // On garde l'info utilisateur
        } catch (err) {
            return res.status(401).json({ error: "Session expirée" });
        }
    }

    try {
        // 3. Préparation des données pour Make
        let dataToSend;
        let requestHeaders = {};

        // On injecte TOUJOURS le mot-clé "action" pour le Router de Make
        // Make lit les paramètres d'URL (Query String) même en POST
        const queryWithAction = { ...req.query, action: action };

        // Gestion Multipart (Fichiers) ou JSON
        if (req.files && req.files.length > 0) {
            const form = new FormData();
            // On remet le body dans le form-data
            for (const key in req.body) { form.append(key, req.body[key]); }
            // On ajoute les fichiers
            req.files.forEach(file => { 
                form.append(file.fieldname, file.buffer, file.originalname); 
            });
            // On ajoute aussi l'action dans le body pour être sûr
            form.append('action', action);
            
            dataToSend = form;
            requestHeaders = form.getHeaders();
        } else {
            // Si c'est du JSON classique
            dataToSend = { ...req.body, action: action };
        }

        // 4. Envoi vers le Master Scénario Make
        const response = await axios({
            method: req.method,
            url: targetUrl,
            params: queryWithAction, // L'action part ici dans l'URL (ex: ?action=read-leaves)
            data: dataToSend,        // Et ici dans le corps
            headers: { ...requestHeaders },
            responseType: 'arraybuffer' // Pour gérer les PDF/Images de retour
        });

        // 5. Gestion Spéciale LOGIN (Création du Token)
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
                console.error("Erreur parsing Login:", e);
            }
        }

        // 6. Relai de la réponse Make vers le Site
        if(response.headers['content-type']) {
            res.set('Content-Type', response.headers['content-type']);
        }
        res.send(response.data);

    } catch (error) {
        console.error(`Erreur Proxy [${action}] vers Make:`, error.message);
        if (error.response) {
            res.status(error.response.status).send(error.response.data);
        } else {
            res.status(500).json({ error: "Erreur de communication avec le Master Scénario" });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur Centralisé (5 Masters) actif sur le port ${PORT}`));
