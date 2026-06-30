/*
 * RahmaPoint — app.js
 * v3 : sécurité renforcée + barre de recherche carte
 */

import { db, auth } from './firebase.js';
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// ─── Configuration ───────────────────────────────────────────────────────────

const EXPIRATION_DAYS = 5;
const DEFAULT_CENTER  = [36.19, 5.41];
const PRIVACY_KEY     = 'rahmapoint_privacy_accepted';

const VALID_TYPES = new Set(['nourriture', 'medical', 'vetement', 'abri', 'autre']);

const TYPE_CONFIG = {
  nourriture: { emoji: '🍞', color: '#C0392B', fr: 'Nourriture', ar: 'طعام' },
  medical:    { emoji: '🏥', color: '#8E44AD', fr: 'Médical',    ar: 'طبي'  },
  vetement:   { emoji: '👕', color: '#2980B9', fr: 'Vêtement',   ar: 'ملابس' },
  abri:       { emoji: '🏠', color: '#D35400', fr: 'Abri',       ar: 'مأوى' },
  autre:      { emoji: '💬', color: '#27AE60', fr: 'Autre',      ar: 'أخرى' },
};

const TILE_LAYERS = {
  carto:     { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',  attr: '© CARTO © OSM' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '© Esri' },
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',             attr: '© CARTO © OSM' },
  topo:      { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',                          attr: '© OpenTopoMap © OSM' },
};

// ─── State ───────────────────────────────────────────────────────────────────

let situations  = [];
let currentLang = 'fr';
let currentUser = null;
let activeFilter = 'all';
let selectedType  = '';
let tempLatLng    = null;
let map, markersLayer, currentTileLayer, tempMarker;
let searchDebounceTimer = null;
let hintHidden = false;

// ─── Security helpers ─────────────────────────────────────────────────────────

// Échapper tout caractère HTML avant injection dans le DOM
function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// Valider les données avant envoi à Firestore
function validateSignal(type, description, contact) {
  if (!VALID_TYPES.has(type))           return 'Type invalide.';
  if (!description || description.length < 10) return currentLang === 'fr'
    ? '⚠️ Description trop courte (10 caractères min)'
    : '⚠️ الوصف قصير جداً (10 أحرف على الأقل)';
  if (description.length > 500)         return currentLang === 'fr'
    ? '⚠️ Description trop longue (500 caractères max)'
    : '⚠️ الوصف طويل جداً (500 حرف كحد أقصى)';
  if (contact && contact.length > 50)   return currentLang === 'fr'
    ? '⚠️ Contact trop long'
    : '⚠️ معلومات الاتصال طويلة جداً';
  return null; // valide
}

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Charger le cache local pendant que Firestore se connecte
  try {
    situations = JSON.parse(localStorage.getItem('rahmapoint_situations') || '[]');
  } catch (_) { situations = []; }

  checkPrivacyAccepted();
  initMap();
  initSearchBar();
  initAuth();
  renderAll();
});

// ─── Politique de confidentialité ────────────────────────────────────────────

function checkPrivacyAccepted() {
  if (localStorage.getItem(PRIVACY_KEY) === 'yes') {
    document.getElementById('privacyModal').classList.remove('active');
  }
}

function updateAcceptBtn() {
  document.getElementById('acceptBtn').disabled =
    !document.getElementById('acceptCheck').checked;
}

function acceptPrivacy() {
  localStorage.setItem(PRIVACY_KEY, 'yes');
  document.getElementById('privacyModal').classList.remove('active');
  showToast(currentLang === 'fr' ? '✓ Bienvenue sur RahmaPoint !' : '✓ مرحباً بك في رحمة بوينت!');
}

// ─── Firestore ────────────────────────────────────────────────────────────────

function listenToFirestore() {
  const q = query(collection(db, 'signalements'), orderBy('createdAt', 'asc'));
  onSnapshot(q,
    (snapshot) => {
      situations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      localStorage.setItem('rahmapoint_situations', JSON.stringify(situations));
      purgeExpired();
      renderAll();
    },
    (err) => {
      console.error('Firestore sync error:', err);
      showToast(currentLang === 'fr'
        ? '⚠️ Connexion Firebase impossible — données locales affichées'
        : '⚠️ تعذّر الاتصال — البيانات المحلية معروضة');
    }
  );
}

// Supprime côté Firestore les signalements trop anciens
async function purgeExpired() {
  const cutoff = Date.now() - EXPIRATION_DAYS * 86400000;
  for (const s of situations) {
    if (new Date(s.createdAt).getTime() < cutoff) {
      try {
        await deleteDoc(doc(db, 'signalements', s.id));
      } catch (e) {
        console.warn('Purge failed:', s.id, e.message);
      }
    }
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function initAuth() {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    renderAuthZone();
    renderAll();
    // Démarrer l'écoute Firestore une fois qu'on sait si l'utilisateur est connecté
    if (!window._firestoreListening) {
      window._firestoreListening = true;
      listenToFirestore();
    }
  });
}

function renderAuthZone() {
  const zone = document.getElementById('authZone');
  if (!zone) return;

  if (currentUser) {
    const avatarHTML = currentUser.photoURL
      ? `<img src="${esc(currentUser.photoURL)}" alt="avatar" class="user-avatar" referrerpolicy="no-referrer">`
      : `<div class="user-avatar user-avatar-placeholder">${esc(currentUser.displayName?.[0] ?? '?')}</div>`;

    zone.innerHTML = `
      <div class="user-info">
        ${avatarHTML}
        <span class="user-name">${esc(currentUser.displayName || currentUser.email)}</span>
      </div>
      <button class="btn-logout" onclick="logoutUser()">
        <span data-fr="Déconnexion" data-ar="تسجيل خروج">Déconnexion</span>
      </button>`;
  } else {
    zone.innerHTML = `
      <button class="btn-google-login" onclick="loginWithGoogle()">
        <svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.36-8.16 2.36-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        </svg>
        <span data-fr="Continuer avec Google" data-ar="تسجيل الدخول بـ Google">Continuer avec Google</span>
      </button>`;
  }

  applyLang(currentLang);
}

async function loginWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
    showToast(currentLang === 'fr'
      ? `✓ Bienvenue ${esc(auth.currentUser?.displayName ?? '')} !`
      : `✓ أهلاً ${esc(auth.currentUser?.displayName ?? '')} !`);
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      console.error(err);
      showToast(currentLang === 'fr' ? '❌ Connexion échouée' : '❌ فشل تسجيل الدخول');
    }
  }
}

async function logoutUser() {
  await signOut(auth).catch(console.error);
  showToast(currentLang === 'fr' ? '👋 Déconnecté' : '👋 تم تسجيل الخروج');
}

// ─── Carte ────────────────────────────────────────────────────────────────────

function initMap() {
  map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, 12);
  const def = TILE_LAYERS.carto;
  currentTileLayer = L.tileLayer(def.url, { attribution: def.attr, maxZoom: 19 }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    const isModalOpen = document.getElementById('signalModal').classList.contains('active');
    tempLatLng = e.latlng;
    const coordStr = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    document.getElementById('locationInput').value = coordStr;

    if (!hintHidden) {
      hintHidden = true;
      document.getElementById('mapHint')?.classList.add('hidden');
    }

    showTempMarker(e.latlng);

    if (isModalOpen) {
      showToast(currentLang === 'fr' ? '📍 Position mise à jour' : '📍 تم تحديث الموقع');
    } else {
      openSignalModal();
      setTimeout(() => {
        document.getElementById('locationInput').value = coordStr;
        showToast(currentLang === 'fr'
          ? '📍 Position sélectionnée — complétez le formulaire'
          : '📍 تم اختيار الموقع — أكمل النموذج');
      }, 150);
    }
  });
}

function showTempMarker(latlng) {
  if (tempMarker) map.removeLayer(tempMarker);
  const icon = L.divIcon({
    className: '',
    html: '<div class="temp-marker-anim"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  tempMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);
}

function switchMapStyle(style, btn) {
  if (!TILE_LAYERS[style]) return;
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  const cfg = TILE_LAYERS[style];
  currentTileLayer = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: 19 }).addTo(map);
  currentTileLayer.bringToBack();
  document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  showToast(`🗺 ${style}`);
}

// ─── Barre de recherche (Nominatim / OpenStreetMap) ──────────────────────────

function initSearchBar() {
  const wrapper = document.getElementById('mapSearchWrapper');
  if (!wrapper) return;

  const input    = wrapper.querySelector('#mapSearchInput');
  const results  = wrapper.querySelector('#mapSearchResults');
  const clearBtn = wrapper.querySelector('#mapSearchClear');

  if (!input || !results) return;

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearBtn.style.display = q ? 'flex' : 'none';
    clearTimeout(searchDebounceTimer);
    if (q.length < 2) { results.innerHTML = ''; results.classList.remove('open'); return; }
    searchDebounceTimer = setTimeout(() => geocodeSearch(q, results), 400);
  });

  // Fermer la liste si on clique ailleurs
  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      results.innerHTML = '';
      results.classList.remove('open');
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    results.innerHTML = '';
    results.classList.remove('open');
    clearBtn.style.display = 'none';
    input.focus();
  });
}

async function geocodeSearch(query, resultsEl) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&q=${encodeURIComponent(query)}&countrycodes=dz`;
    const res  = await fetch(url, { headers: { 'Accept-Language': currentLang } });
    if (!res.ok) throw new Error('Nominatim error');
    const data = await res.json();

    if (!data.length) {
      resultsEl.innerHTML = `<div class="search-no-result">${currentLang === 'fr' ? 'Aucun résultat' : 'لا توجد نتائج'}</div>`;
      resultsEl.classList.add('open');
      return;
    }

    resultsEl.innerHTML = data.map(place => {
      const name = esc(place.display_name);
      return `<div class="search-result-item" data-lat="${place.lat}" data-lon="${place.lon}" tabindex="0">
        <span class="search-pin">📍</span>
        <span class="search-name">${name}</span>
      </div>`;
    }).join('');
    resultsEl.classList.add('open');

    resultsEl.querySelectorAll('.search-result-item').forEach(item => {
      const go = () => {
        const lat = parseFloat(item.dataset.lat);
        const lon = parseFloat(item.dataset.lon);
        map.setView([lat, lon], 15, { animate: true });
        resultsEl.innerHTML = '';
        resultsEl.classList.remove('open');
        document.getElementById('mapSearchInput').value = item.querySelector('.search-name').textContent;
        document.getElementById('mapSearchClear').style.display = 'flex';
      };
      item.addEventListener('click', go);
      item.addEventListener('keydown', (e) => e.key === 'Enter' && go());
    });
  } catch (err) {
    console.error('Geocode error:', err);
    resultsEl.innerHTML = `<div class="search-no-result">⚠️ ${currentLang === 'fr' ? 'Erreur de recherche' : 'خطأ في البحث'}</div>`;
    resultsEl.classList.add('open');
  }
}

// ─── Marqueurs ────────────────────────────────────────────────────────────────

function renderMarkers() {
  markersLayer.clearLayers();
  getFiltered().forEach(addMarker);
}

function addMarker(s) {
  const cfg   = TYPE_CONFIG[s.type] || TYPE_CONFIG.autre;
  const color = s.resolved ? '#5B8A5B' : cfg.color;

  const icon = L.divIcon({
    className: '',
    html: `<div class="rahma-marker" style="background:${color}"><div class="rahma-marker-inner">${cfg.emoji}</div></div>`,
    iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -38],
  });

  L.marker([s.lat, s.lng], { icon })
    .bindPopup(buildPopupHTML(s), { maxWidth: 260 })
    .addTo(markersLayer);
}

function buildPopupHTML(s) {
  const cfg          = TYPE_CONFIG[s.type] || TYPE_CONFIG.autre;
  const label        = cfg[currentLang] || cfg.fr;
  const shortDesc    = esc(s.description.length > 80 ? s.description.slice(0, 80) + '…' : s.description);
  const confirmCount = (s.confirmedBy || []).length;
  const fr = currentLang === 'fr';

  return `
    <div class="popup-inner">
      <div class="popup-type">${cfg.emoji} ${label}</div>
      <div class="popup-desc">${shortDesc}</div>
      ${confirmCount > 0 ? `<div class="popup-confirms">✓ ${fr ? `${confirmCount} confirmation${confirmCount > 1 ? 's' : ''}` : `${confirmCount} تأكيد`}</div>` : ''}
      <button class="popup-btn" onclick="openDetail('${esc(s.id)}')">${fr ? 'Voir détail' : 'عرض التفاصيل'}</button>
      ${s.resolved
        ? `<span class="popup-resolved">${fr ? 'Résolu ✓' : 'تم الحل ✓'}</span>`
        : `<button class="popup-btn green" onclick="resolveFromMap('${esc(s.id)}')">✓ ${fr ? 'Marquer résolu' : 'تم الحل'}</button>`}
    </div>`;
}

// ─── Rendu ────────────────────────────────────────────────────────────────────

function renderAll() {
  renderCards();
  renderMarkers();
  updateStats();
}

function renderCards() {
  const grid  = document.getElementById('cardsGrid');
  const empty = document.getElementById('emptyState');
  const items = getFiltered().slice().reverse();

  grid.innerHTML = '';
  empty.style.display = items.length ? 'none' : 'block';
  items.forEach((s, i) => grid.appendChild(buildCard(s, i)));
}

function buildCard(s, delay) {
  const cfg    = TYPE_CONFIG[s.type] || TYPE_CONFIG.autre;
  const fr     = currentLang === 'fr';
  const label  = cfg[currentLang] || cfg.fr;
  const timeAgo = getTimeAgo(s.createdAt);
  const daysLeft = getDaysLeft(s.createdAt);

  const confirmedBy      = s.confirmedBy || [];
  const confirmCount     = confirmedBy.length;
  const alreadyConfirmed = currentUser && confirmedBy.includes(currentUser.uid);

  const card = document.createElement('div');
  card.className = `card${s.resolved ? ' resolved' : ''}`;
  card.style.animationDelay = `${delay * 0.07}s`;

  // On utilise esc() sur toutes les données utilisateur avant injection
  card.innerHTML = `
    <div class="card-header" style="background:${s.resolved ? '#5B8A5B' : cfg.color}">
      <span class="card-type">${cfg.emoji} ${label}</span>
      <span class="card-badge${s.resolved ? ' resolved-badge' : ''}">${fr ? (s.resolved ? 'Résolu' : 'En attente') : (s.resolved ? 'تم الحل' : 'بانتظار')}</span>
    </div>
    <div class="card-body">
      <p class="card-desc">${esc(s.description)}</p>
      <div class="card-meta">
        <span>🕐 ${timeAgo}</span>
        ${daysLeft !== null ? `<span class="expiry-badge" title="${fr ? 'Expiration automatique' : 'حذف تلقائي'}">⏳ ${daysLeft}j</span>` : ''}
        ${s.location ? `<span>📍 ${esc(s.location)}</span>` : ''}
        ${s.contact  ? `<span>📞 ${esc(s.contact)}</span>`  : ''}
        ${s.reportCount > 0 ? `<span class="report-count">⚠️ ${s.reportCount}</span>` : ''}
      </div>
      ${confirmCount > 0 ? `<span class="confirm-count">✓ ${fr ? `${confirmCount} confirmation${confirmCount > 1 ? 's' : ''}` : `${confirmCount} تأكيد`}</span>` : ''}
      <div class="card-actions">
        <button class="card-btn primary" onclick="openDetail('${esc(s.id)}')">${fr ? 'Détail' : 'تفاصيل'}</button>
        ${s.lat ? `<button class="card-btn gray" onclick="goToRoute(${s.lat},${s.lng})">🗺 ${fr ? 'Itinéraire' : 'الطريق'}</button>` : ''}
        <button class="card-btn ${s.resolved ? 'gray' : 'green'}" onclick="toggleResolve('${esc(s.id)}')">
          ${s.resolved ? (fr ? 'Résolu ✓' : 'تم الحل ✓') : (fr ? 'Marquer résolu' : 'وضع علامة محلول')}
        </button>
        <button class="card-btn gray" onclick="reportSituation('${esc(s.id)}')">⚠️ ${fr ? 'Signaler' : 'إبلاغ'}</button>
      </div>
      <button class="btn-confirm${alreadyConfirmed ? ' confirmed' : ''}" onclick="confirmSituation('${esc(s.id)}')" ${alreadyConfirmed ? 'disabled' : ''}>
        ${alreadyConfirmed ? (fr ? '✓ Déjà confirmé' : '✓ تم التأكيد مسبقاً') : (fr ? '✓ Confirmer cette situation' : '✓ تأكيد هذا الموقف')}
      </button>
    </div>`;

  return card;
}

// ─── Modal détail ─────────────────────────────────────────────────────────────

function openDetail(id) {
  const s = situations.find(x => x.id === id);
  if (!s) return;
  map.closePopup();

  const cfg    = TYPE_CONFIG[s.type] || TYPE_CONFIG.autre;
  const fr     = currentLang === 'fr';
  const label  = cfg[currentLang] || cfg.fr;
  const daysLeft = getDaysLeft(s.createdAt);

  const confirmedBy      = s.confirmedBy || [];
  const confirmCount     = confirmedBy.length;
  const alreadyConfirmed = currentUser && confirmedBy.includes(currentUser.uid);

  const commentsHTML = (s.comments || []).map(c => `
    <div class="comment-item">
      <p>${esc(c.text)}</p>
      <div class="comment-time">${getTimeAgo(c.createdAt)}</div>
    </div>`).join('') || `<p class="no-comments">${fr ? 'Aucun commentaire.' : 'لا توجد تعليقات.'}</p>`;

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-header" style="background:${s.resolved ? '#5B8A5B' : cfg.color}">
      <div class="detail-type">${cfg.emoji} ${label}</div>
      <div class="detail-title">${esc(s.description)}</div>
    </div>

    ${s.location ? `
    <div class="detail-section">
      <div class="detail-label">${fr ? 'Localisation' : 'الموقع'}</div>
      <div class="detail-value">📍 ${esc(s.location)}</div>
    </div>` : ''}

    ${s.contact ? `
    <div class="detail-section">
      <div class="detail-label">${fr ? 'Contact' : 'التواصل'}</div>
      <div class="detail-value">📞 ${esc(s.contact)}</div>
    </div>` : ''}

    <div class="detail-section">
      <div class="detail-label">${fr ? 'Signalé le' : 'أُبلغ في'}</div>
      <div class="detail-value">${new Date(s.createdAt).toLocaleString(fr ? 'fr-DZ' : 'ar-DZ')}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">${fr ? 'Expiration' : 'انتهاء الصلاحية'}</div>
      <div class="detail-value">⏳ ${daysLeft !== null
        ? (fr ? `Suppression dans ${daysLeft} jour(s)` : `يُحذف خلال ${daysLeft} يوم`)
        : (fr ? 'Expiré' : 'منتهي الصلاحية')}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">${fr ? 'Statut' : 'الحالة'}</div>
      <div class="detail-value">${s.resolved
        ? `<span style="color:#5B8A5B;font-weight:700">✓ ${fr ? 'Situation résolue' : 'تم حل الموقف'}</span>`
        : `<span style="color:#C0392B">⏳ ${fr ? "En attente d'aide" : 'بانتظار المساعدة'}</span>`}</div>
    </div>

    <div class="detail-section">
      <div class="detail-label">${fr ? 'Confirmations terrain' : 'تأكيدات ميدانية'}</div>
      <div class="detail-value confirm-count-detail">
        ✓ ${confirmCount} ${fr
          ? `personne${confirmCount > 1 ? 's ont' : ' a'} confirmé`
          : 'شخص أكّد وجود هذا الموقف'}
      </div>
    </div>

    <div class="detail-actions">
      ${s.lat ? `<button class="card-btn green" onclick="goToRoute(${s.lat},${s.lng})">🗺 ${fr ? 'Itinéraire' : 'الطريق'}</button>` : ''}
      <button class="card-btn ${s.resolved ? 'gray' : 'primary'}"
        onclick="toggleResolve('${esc(s.id)}'); document.getElementById('detailModal').classList.remove('active')">
        ${s.resolved ? (fr ? 'Rouvrir' : 'إعادة فتح') : (fr ? '✓ Marquer résolu' : '✓ تم الحل')}
      </button>
      <button class="card-btn gray" onclick="reportSituation('${esc(s.id)}')">⚠️</button>
    </div>

    <button class="btn-confirm-detail${alreadyConfirmed ? ' confirmed' : ''}"
      onclick="confirmSituation('${esc(s.id)}')" ${alreadyConfirmed ? 'disabled' : ''}>
      ${alreadyConfirmed ? (fr ? '✓ Déjà confirmé' : '✓ تم التأكيد مسبقاً') : (fr ? '✓ Confirmer cette situation' : '✓ تأكيد هذا الموقف')}
    </button>

    <div class="comments-section">
      <div class="comments-title">${fr ? `Commentaires (${(s.comments || []).length})` : `التعليقات (${(s.comments || []).length})`}</div>
      ${commentsHTML}
      <div class="comment-input-row">
        <input type="text" id="commentInput_${esc(s.id)}" maxlength="300"
          placeholder="${fr ? 'Ajouter un commentaire…' : 'أضف تعليقاً…'}" />
        <button onclick="addComment('${esc(s.id)}')">${fr ? 'Envoyer' : 'إرسال'}</button>
      </div>
    </div>`;

  document.getElementById('detailModal').classList.add('active');
}

// ─── Modal signalement ────────────────────────────────────────────────────────

function openSignalModal() {
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return;
  }
  selectedType = '';
  tempLatLng   = null;
  document.getElementById('descInput').value     = '';
  document.getElementById('locationInput').value = '';
  document.getElementById('contactInput').value  = '';
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('signalModal').classList.add('active');
}

function closeSignalModal() {
  document.getElementById('signalModal').classList.remove('active');
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
}

function selectType(btn) {
  document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedType = btn.dataset.type;
}

function getLocation() {
  if (!navigator.geolocation) {
    showToast(currentLang === 'fr' ? 'Géolocalisation non disponible' : 'تحديد الموقع غير متاح');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      tempLatLng = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      document.getElementById('locationInput').value =
        `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      map.setView([pos.coords.latitude, pos.coords.longitude], 15);
      showToast(currentLang === 'fr' ? '📍 Position détectée !' : '📍 تم تحديد الموقع!');
    },
    () => showToast(currentLang === 'fr' ? 'Position indisponible' : 'تعذّر تحديد موقعك')
  );
}

async function submitSignal() {
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return;
  }

  const desc    = document.getElementById('descInput').value.trim();
  const contact = document.getElementById('contactInput').value.trim();
  const locText = document.getElementById('locationInput').value.trim();

  if (!selectedType) {
    showToast(currentLang === 'fr' ? '⚠️ Choisissez un type' : '⚠️ اختر نوعاً');
    return;
  }

  const validationError = validateSignal(selectedType, desc, contact);
  if (validationError) { showToast(validationError); return; }

  const payload = {
    type:        selectedType,
    description: desc,
    location:    locText.slice(0, 100),
    contact:     contact.slice(0, 50),
    lat:         tempLatLng ? tempLatLng.lat : DEFAULT_CENTER[0] + (Math.random() - 0.5) * 0.02,
    lng:         tempLatLng ? tempLatLng.lng : DEFAULT_CENTER[1] + (Math.random() - 0.5) * 0.02,
    createdAt:   new Date().toISOString(),
    resolved:    false,
    reportCount: 0,
    reportedBy:  [],       // anti-doublon pour les signalements abusifs
    comments:    [],
    confirmedBy: [],
    userId:      currentUser.uid,
    userName:    currentUser.displayName || '',
    userPhoto:   currentUser.photoURL   || '',
  };

  try {
    await addDoc(collection(db, 'signalements'), payload);
    closeSignalModal();
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    showToast(currentLang === 'fr' ? '✓ Signalement publié' : '✓ تم نشر البلاغ');
  } catch (err) {
    console.error(err);
    showToast(currentLang === 'fr' ? '❌ Erreur Firebase' : '❌ خطأ في Firebase');
  }
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function requireAuth() {
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return false;
  }
  return true;
}

async function toggleResolve(id) {
  if (!requireAuth()) return;
  const s = situations.find(x => x.id === id);
  if (!s) return;
  const next = !s.resolved;
  try {
    await updateDoc(doc(db, 'signalements', id), { resolved: next });
    showToast(currentLang === 'fr'
      ? (next ? '✓ Marqué comme résolu' : '↩ Rouvert')
      : (next ? '✓ وُضعت علامة محلول'  : '↩ أُعيد فتحه'));
  } catch (err) {
    console.error(err);
    showToast(currentLang === 'fr' ? '❌ Erreur Firebase' : '❌ خطأ في Firebase');
  }
}

function resolveFromMap(id) {
  toggleResolve(id);
  map.closePopup();
}

async function reportSituation(id) {
  if (!requireAuth()) return;
  const s = situations.find(x => x.id === id);
  if (!s) return;

  // Anti-doublon : un même user ne peut reporter qu'une fois
  const reportedBy = s.reportedBy || [];
  if (reportedBy.includes(currentUser.uid)) {
    showToast(currentLang === 'fr'
      ? '⚠️ Vous avez déjà signalé cette situation'
      : '⚠️ لقد أبلغت عن هذا الموقف مسبقاً');
    return;
  }

  const newCount = (s.reportCount || 0) + 1;

  try {
    if (newCount >= 2) {
      await deleteDoc(doc(db, 'signalements', id));
      document.getElementById('detailModal')?.classList.remove('active');
      showToast(currentLang === 'fr'
        ? '🗑️ Situation supprimée (2 signalements)'
        : '🗑️ تم حذف الموقف تلقائياً');
      return;
    }
    await updateDoc(doc(db, 'signalements', id), {
      reportCount: newCount,
      reportedBy: arrayUnion(currentUser.uid),
    });
    showToast(currentLang === 'fr'
      ? `⚠️ Signalé (${newCount}/2)`
      : `⚠️ تم الإبلاغ (${newCount}/2)`);
  } catch (err) {
    console.error(err);
    showToast(currentLang === 'fr' ? '❌ Erreur Firebase' : '❌ خطأ في Firebase');
  }
}

async function confirmSituation(id) {
  if (!requireAuth()) return;
  const s = situations.find(x => x.id === id);
  if (!s) return;

  const confirmedBy = s.confirmedBy || [];
  if (confirmedBy.includes(currentUser.uid)) {
    showToast(currentLang === 'fr'
      ? '⚠️ Vous avez déjà confirmé cette situation'
      : '⚠️ لقد أكدت هذا الموقف مسبقاً');
    return;
  }

  try {
    // arrayUnion côté Firestore garantit l'unicité même en cas de race condition
    await updateDoc(doc(db, 'signalements', id), {
      confirmedBy: arrayUnion(currentUser.uid),
    });
    showToast(currentLang === 'fr' ? '✓ Situation confirmée — merci !' : '✓ تم التأكيد — شكراً!');
  } catch (err) {
    console.error(err);
    showToast(currentLang === 'fr' ? '❌ Erreur Firebase' : '❌ خطأ في Firebase');
  }
}

async function addComment(id) {
  if (!requireAuth()) return;
  const input = document.getElementById(`commentInput_${id}`);
  const text  = input?.value.trim();
  if (!text || text.length > 300) return;

  const s = situations.find(x => x.id === id);
  if (!s) return;

  const updated = [...(s.comments || []), {
    text,
    createdAt: new Date().toISOString(),
    userId: currentUser.uid,
    userName: currentUser.displayName || '',
  }];

  try {
    await updateDoc(doc(db, 'signalements', id), { comments: updated });
    showToast(currentLang === 'fr' ? '💬 Commentaire ajouté' : '💬 تمت إضافة التعليق');
    openDetail(id);
  } catch (err) {
    console.error(err);
    showToast(currentLang === 'fr' ? '❌ Erreur Firebase' : '❌ خطأ في Firebase');
  }
}

function goToRoute(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

// ─── Filtres & stats ──────────────────────────────────────────────────────────

function setFilter(filter, btn) {
  activeFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
}

function getFiltered() {
  return activeFilter === 'all' ? situations : situations.filter(s => s.type === activeFilter);
}

function updateStats() {
  document.getElementById('totalCount').textContent    = situations.length;
  document.getElementById('resolvedCount').textContent = situations.filter(s => s.resolved).length;
  document.getElementById('activeCount').textContent   = situations.filter(s => !s.resolved).length;
}

// ─── Langue ───────────────────────────────────────────────────────────────────

function toggleLang() {
  currentLang = currentLang === 'fr' ? 'ar' : 'fr';
  document.documentElement.setAttribute('lang', currentLang);
  document.documentElement.setAttribute('dir', currentLang === 'ar' ? 'rtl' : 'ltr');
  document.body.classList.toggle('ar', currentLang === 'ar');
  document.getElementById('langToggle').textContent = currentLang === 'fr' ? 'العربية' : 'Français';
  applyLang(currentLang);
  renderAll();
}

function applyLang(lang) {
  document.querySelectorAll('[data-fr][data-ar]').forEach(el => {
    el.textContent = lang === 'ar' ? el.dataset.ar : el.dataset.fr;
  });
}

// ─── Modals & toasts ──────────────────────────────────────────────────────────

function closeOnOverlay(event, modalId) {
  if (event.target === document.getElementById(modalId)) {
    document.getElementById(modalId).classList.remove('active');
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ─── Utilitaires ──────────────────────────────────────────────────────────────

function getTimeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  const hrs  = Math.floor(mins / 60);
  const days = Math.floor(hrs  / 24);
  if (currentLang === 'ar') {
    if (mins < 1)  return 'الآن';
    if (mins < 60) return `منذ ${mins} دقيقة`;
    if (hrs  < 24) return `منذ ${hrs} ساعة`;
    return `منذ ${days} يوم`;
  }
  if (mins < 1)  return "À l'instant";
  if (mins < 60) return `Il y a ${mins} min`;
  if (hrs  < 24) return `Il y a ${hrs}h`;
  return `Il y a ${days}j`;
}

function getDaysLeft(iso) {
  const remaining = EXPIRATION_DAYS * 86400000 - (Date.now() - new Date(iso));
  return remaining > 0 ? Math.ceil(remaining / 86400000) : null;
}

// ─── Exposition globale (nécessaire pour les onclick dans les templates HTML) ─

Object.assign(window, {
  loginWithGoogle, logoutUser,
  acceptPrivacy, updateAcceptBtn,
  openSignalModal, closeSignalModal, selectType, getLocation, submitSignal,
  toggleLang,
  toggleResolve, resolveFromMap, reportSituation, confirmSituation, addComment,
  goToRoute, openDetail,
  setFilter, switchMapStyle, closeOnOverlay,
});
