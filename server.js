const express = require('express');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
app.use(cors()); // Autorise ton site à parler au serveur
app.use(bodyParser.json());

// --- C'EST ICI QUE TU CACHES TES URLS MAKE ---
// On utilise des variables d'environnement (process.env) pour ne pas écrire les secrets ici
const WEBHOOKS = {
    login: process.env.MAKE_LOGIN_URL,
    read: process.env.MAKE_READ_URL,
    write: process.env.MAKE_WRITE_URL,
    clock: process.env.MAKE_CLOCK_URL
    // Ajoute les autres ici...
};

// --- LA ROUTE MAGIQUE ---
// Ton site va appeler : https://ton-serveur.onrender.com/api/login
// Le serveur va appeler en secret le vrai webhook
app.post('/api/:action', async (req, res) => {
    const action = req.params.action; // ex: 'login', 'read'
    const secretUrl = WEBHOOKS[action];

    if (!secretUrl) {
        return res.status(404).json({ error: "Action inconnue" });
    }

    try {
        // Le serveur appelle Make
        // On transfère les données (req.body) et les paramètres (req.query)
        const response = await axios.post(secretUrl, req.body, { params: req.query });
        
        // On renvoie la réponse de Make au client
        res.json(response.data);
    } catch (error) {
        console.error("Erreur Make:", error.message);
        res.status(500).json({ error: "Erreur de communication avec le serveur" });
    }
});

// Lancer le serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});