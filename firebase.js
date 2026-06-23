// ==========================================
// RAHMAPOINT — firebase.js
// ==========================================
// Site statique GitHub Pages → imports via CDN gstatic (pas npm/bundler)

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAnalytics }    from "https://www.gstatic.com/firebasejs/10.13.0/firebase-analytics.js";
import { getFirestore }    from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth }         from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyCUrMrLy-bFPOT9YCglSWZTFxcusnsctJQ",
  authDomain:        "rahma-point.firebaseapp.com",
  projectId:         "rahma-point",
  storageBucket:     "rahma-point.firebasestorage.app",
  messagingSenderId: "169407709238",
  appId:             "1:169407709238:web:aa822072edee91b9d01897",
  measurementId:     "G-DD05YNHGDE"
};

// ── Initialisation Firebase ────────────────
const app = initializeApp(firebaseConfig);

// Analytics (facultatif — ne bloque pas le site en local / http)
let analytics;
try {
  analytics = getAnalytics(app);
} catch (e) {
  console.warn("Analytics non initialisé (normal en local/http) :", e);
}

// Firestore — base de données des signalements
const db = getFirestore(app);

// Auth — nécessaire pour Google Sign-In
const auth = getAuth(app);

export { app, analytics, db, auth };
