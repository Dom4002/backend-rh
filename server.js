const express = require('express');
const axios = require('axios');
const cors = require('cors');
const multer = require('multer'); // Indispensable pour recevoir les fichiers
const FormData = require('form-data'); // Indispensable pour renvoyer les fichiers vers Make

const app = express();
const upload = multer(); // Gestion des uploads en mémoire

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mapping des actions vers tes variables d'environnement Render
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

// Route universelle (upload.any() permet d'accepter des fichiers n'importe où)
app.all('/api/:action', upload.any(), async (req, res) => {
    const action = req.params.action;
    const secretUrl = WEBHOOKS[action];

    if (!secretUrl) {
        return res.status(404).json({ error: "Action inconnue ou Webhook non configuré" });
    }

    try {
        // 1. Préparation des données (Gestion Spéciale Fichiers)
        let dataToSend;
        let requestHeaders = {};

        if (req.files && req.files.length > 0) {
            // S'il y a des fichiers (Photo, Contrat scan)
            const form = new FormData();
            
            // On ajoute les champs textes
            for (const key in req.body) {
                form.append(key, req.body[key]);
            }
            
            // On ajoute les fichiers
            req.files.forEach(file => {
                form.append(file.fieldname, file.buffer, file.originalname);
            });

            dataToSend = form;
            requestHeaders = form.getHeaders(); // Headers spécifiques pour multipart
        } else {
            // Si c'est juste du texte/JSON (Login, Clock, etc.)
            dataToSend = req.body;
        }

        // 2. Appel vers Make
        const response = await axios({
            method: req.method,
            url: secretUrl,
            params: req.query, // Pour les GET (ex: badge?id=...)
            data: dataToSend,  // Pour les POST
            headers: { ...requestHeaders }, // Fusion des headers
            responseType: 'arraybuffer' // Astuce: On récupère les données brutes (pour gérer Images et HTML)
        });

        // 3. Réponse intelligente au navigateur
        // On transfère le type de contenu que Make nous a donné (JSON ou HTML)
        const contentType = response.headers['content-type'];
        res.set('Content-Type', contentType);
        res.send(response.data); // .send() s'adapte (contrairement à .json qui force le texte)

    } catch (error) {
        console.error(`Erreur sur ${action}:`, error.message);
        if (error.response) {
             res.status(error.response.status).send(error.response.data);
        } else {
             res.status(500).json({ error: "Erreur serveur interne" });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur Proxy RH lancé sur le port ${PORT}`);
});
