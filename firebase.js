// ==========================================
// RAHMAPOINT — firebase.js (corrigé)
// ==========================================
// IMPORTANT : ce fichier est chargé en tant que <script type="module">
// directement dans le navigateur (pas de bundler/Webpack/Vite).
// Les imports "firebase/app" tout court (sans URL) ne fonctionnent
// QUE si vous avez un outil de build (npm + bundler). Comme ce site
// est un simple site statique (HTML/CSS/JS) hébergé sur GitHub Pages,
// il faut importer le SDK Firebase depuis l'URL du CDN officiel.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// Votre configuration Firebase (web app)
const firebaseConfig = {
  apiKey: "AIzaSyCUrMrLy-bFPOT9YCglSWZTFxcusnsctJQ",
  authDomain: "rahma-point.firebaseapp.com",
  projectId: "rahma-point",
  storageBucket: "rahma-point.firebasestorage.app",
  messagingSenderId: "169407709238",
  appId: "1:169407709238:web:aa822072edee91b9d01897",
  measurementId: "G-DD05YNHGDE"
};

// Initialisation de Firebase
const app = initializeApp(firebaseConfig);

// Analytics (optionnel, ne bloque pas le site s'il échoue, ex: en local sans https)
let analytics;
try {
  analytics = getAnalytics(app);
} catch (e) {
  console.warn("Analytics non initialisé (normal en local / http) :", e);
}

// Firestore — c'était la pièce manquante : sans ceci, app.js ne pouvait
// pas lire/écrire de "signalements" dans la base de données.
const db = getFirestore(app);

// On exporte db pour pouvoir l'utiliser dans app.js
export { app, analytics, db };
