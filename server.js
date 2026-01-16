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

// Cette clé doit être la même que dans ton tableau de bord Render
const JWT_SECRET = process.env.JWT_SECRET || 'cle_secours_si_oublie';

// Liste des permissions : on définit qui a le droit de faire quoi
const PERMISSIONS = {
    'ADMIN': ['login', 'read', 'write', 'update', 'log', 'read-logs', 'gatekeeper', 'badge', 'emp-update', 'contract-gen', 'contract-upload', 'leave', 'clock'],
    'RH': ['login', 'read', 'write', 'update', 'log', 'badge', 'emp-update', 'contract-gen', 'contract-upload', 'leave', 'clock'],
    'MANAGER': ['login', 'read', 'log', 'badge', 'leave', 'clock'],
    'EMPLOYEE': ['login', 'read', 'badge', 'leave', 'clock', 'emp-update']
};

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
    'clock': process.env.URL_CLOCK_ACTION
};

app.all('/api/:action', upload.any(), async (req, res) => {
    const action = req.params.action;
    const secretUrl = WEBHOOKS[action];

    if (!secretUrl) return res.status(404).json({ error: "Action inconnue" });

    let userRole = 'GUEST';

    // VERIFICATION DU TOKEN (Sauf pour le login)
    if (action !== 'login') {
        const authHeader = req.headers['authorization'];
        if (!authHeader) return res.status(401).json({ error: "Non authentifié" });

        try {
            const token = authHeader.split(' ')[1];
            const decoded = jwt.verify(token, JWT_SECRET);
            userRole = decoded.role;

            // Bloquer si le rôle n'a pas la permission
            if (!PERMISSIONS[userRole] || !PERMISSIONS[userRole].includes(action)) {
                return res.status(403).json({ error: "Action non autorisée pour votre rôle" });
            }
        } catch (err) {
            return res.status(401).json({ error: "Session expirée" });
        }
    }

    try {
        let dataToSend;
        let requestHeaders = {};

        if (req.files && req.files.length > 0) {
            const form = new FormData();
            for (const key in req.body) { form.append(key, req.body[key]); }
            req.files.forEach(file => { form.append(file.fieldname, file.buffer, file.originalname); });
            dataToSend = form;
            requestHeaders = form.getHeaders();
        } else {
            dataToSend = req.body;
        }

        const response = await axios({
            method: req.method,
            url: secretUrl,
            params: req.query,
            data: dataToSend,
            headers: { ...requestHeaders },
            responseType: 'arraybuffer'
        });

        // SI LOGIN REUSSI : On génère le TOKEN
        if (action === 'login') {
            const makeData = JSON.parse(Buffer.from(response.data).toString());
            if (makeData.status === 'success') {
                const token = jwt.sign(
                    { id: makeData.id, role: makeData.role, nom: makeData.nom },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );
                makeData.token = token; // On injecte le token dans la réponse
                return res.json(makeData);
            }
        }

        res.set('Content-Type', response.headers['content-type']);
        res.send(response.data);

    } catch (error) {
        res.status(500).json({ error: "Erreur serveur" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur prêt`));
