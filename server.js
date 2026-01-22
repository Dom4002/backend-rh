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

// Clé secrète pour les tokens (laisse celle par défaut pour le dev ou configure-la dans Render)
const JWT_SECRET = process.env.JWT_SECRET || 'cle_de_secours_indev';

// --- NOUVELLE CONFIGURATION UNIQUE ---
// Une seule variable d'environnement à configurer dans Render : URL_MASTER
const MASTER_WEBHOOK_URL = process.env.URL_MASTER;

/* 
   MIDDLEWARE D'AUTHENTIFICATION 
   Vérifie le token pour toutes les routes SAUF 'login'.
*/
const authenticateToken = (req, res, next) => {
    const action = req.params.action;
    
    // Liste des actions accessibles sans être connecté
    // On peut ajouter 'read-config' ici si tu veux charger le logo sur la page de login plus tard
    const publicActions = ['login']; 
    
    if (publicActions.includes(action)) {
        return next();
    }

    const authHeader = req.headers['authorization'];
    // Format attendu : "Bearer LE_TOKEN_JWT"
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.status(401).json({ error: "Authentification requise" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Session expirée ou invalide" });
        // On stocke les infos du user décodé pour les utiliser si besoin
        req.user = user;
        next();
    });
};

/*
   ROUTEUR UNIVERSEL (Le cœur du système SaaS)
   Toutes les requêtes /api/:action passent par ici.
   Le serveur ne "sait" plus ce que font les actions, il transmet tout à Make.
*/
app.all('/api/:action', upload.any(), authenticateToken, async (req, res) => {
    const action = req.params.action;

    // Sécurité : On vérifie que l'URL Master est bien configurée
    if (!MASTER_WEBHOOK_URL) {
        console.error("ERREUR CRITIQUE : La variable URL_MASTER n'est pas définie dans Render.");
        return res.status(500).json({ error: "Configuration serveur manquante (URL_MASTER)" });
    }

    try {
        let dataToSend;
        let requestHeaders = {};

        // 1. Préparation des données (JSON ou Fichiers Multipart)
        if (req.files && req.files.length > 0) {
            // Cas complexe : Envoi de fichiers (ex: photo de profil, justificatif)
            const form = new FormData();
            
            // On ajoute les champs texte du formulaire
            for (const key in req.body) {
                form.append(key, req.body[key]);
            }
            
            // On ajoute les fichiers binaires
            req.files.forEach(file => {
                form.append(file.fieldname, file.buffer, file.originalname);
            });

            dataToSend = form;
            requestHeaders = form.getHeaders();
        } else {
            // Cas simple : JSON standard
            dataToSend = req.body;
            requestHeaders['Content-Type'] = 'application/json';
        }

        // 2. Envoi vers le MASTER SCENARIO Make
        // L'astuce magique : on ajoute ?action=... dans l'URL pour que le Routeur Make sache quoi faire
        const makeResponse = await axios({
            method: req.method,
            url: `${MASTER_WEBHOOK_URL}?action=${action}`, 
            data: dataToSend,
            params: req.method === 'GET' ? req.query : {}, // Si c'est un GET, on passe les paramètres d'URL
            headers: { ...requestHeaders },
            responseType: 'arraybuffer' // Important pour relayer les PDF ou Images générés
        });

        // 3. Traitement Spécial : LOGIN
        // Le serveur Node.js reste le garant de la sécurité JWT.
        // Make vérifie les identifiants, Node.js signe le token.
        if (action === 'login') {
            const responseText = Buffer.from(makeResponse.data).toString();
            try {
                const userData = JSON.parse(responseText);
                
                if (userData.status === 'success') {
                    // Création du token signé par le serveur
                    const token = jwt.sign(
                        { 
                            id: userData.id, 
                            nom: userData.nom, 
                            role: (userData.role || 'EMPLOYEE').toUpperCase()
                        },
                        JWT_SECRET,
                        { expiresIn: '24h' }
                    );
                    
                    // On renvoie la réponse de Make + le Token généré ici
                    return res.json({ ...userData, token: token });
                }
            } catch (e) {
                console.error("Erreur parsing réponse login Make:", e);
                // On continue pour renvoyer l'erreur brute si le JSON est malformé
            }
        }

        // 4. Relai de la réponse standard (Proxy transparent)
        // On copie le type de contenu (JSON, PDF, HTML...) reçu de Make vers le Frontend
        if (makeResponse.headers['content-type']) {
            res.set('Content-Type', makeResponse.headers['content-type']);
        }
        
        // On envoie les données brutes
        res.send(makeResponse.data);

    } catch (error) {
        console.error(`Erreur Proxy [${action}]:`, error.message);
        
        if (error.response) {
            // Si Make a répondu une erreur (400, 404, 500)
            res.status(error.response.status).send(error.response.data);
        } else {
            // Si Make est injoignable (timeout, URL fausse)
            res.status(502).json({ error: "Service RH indisponible (Make injoignable)" });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur SaaS Universal Actif sur le port ${PORT}`));
