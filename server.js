const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Mapping des actions vers tes variables Render
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

// Cette route gère TOUT (GET et POST)
app.all('/api/:action', async (req, res) => {
    const action = req.params.action;
    const secretUrl = WEBHOOKS[action];

    if (!secretUrl) {
        console.error(`Action inconnue demandée: ${action}`);
        return res.status(404).json({ error: "Action inconnue ou Webhook non configuré" });
    }

    try {
        console.log(`Proxy vers : ${action} (${req.method})`);
        
        // On prépare la requête vers Make
        const config = {
            method: req.method, // On garde la même méthode (GET ou POST)
            url: secretUrl,
            params: req.query, // On passe les paramètres d'URL (ex: ?id=...)
            data: req.body     // On passe les données (ex: formulaire)
        };

        const response = await axios(config);
        res.status(response.status).json(response.data);

    } catch (error) {
        console.error("Erreur Make:", error.message);
        // Si Make renvoie une erreur, on la renvoie au client
        if (error.response) {
             res.status(error.response.status).json(error.response.data);
        } else {
             res.status(500).json({ error: "Erreur serveur interne" });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur Proxy RH lancé sur le port ${PORT}`);
});
