/* ==========================================
   RAHMAPOINT — app.js (v2 — Confirmation + Expiration 5j + Auth obligatoire)
   ========================================== */

import { db, auth } from './firebase.js';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  arrayUnion,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

// ── STATE ──────────────────────────────────
let situations = JSON.parse(localStorage.getItem('rahmapoint_situations') || '[]');
let currentLang = 'fr';
let currentUser = null;
let currentFilter = 'all';
let selectedType = '';
let tempLatLng = null;
let map, markersLayer;

const DEFAULT_CENTER = [36.19, 5.41];
const EXPIRATION_DAYS = 5;

// ── TYPE CONFIG ─────────────────────────────
const typeConfig = {
  nourriture: { emoji: '🍞', color: '#C0392B', fr: 'Nourriture', ar: 'طعام' },
  medical:    { emoji: '🏥', color: '#8E44AD', fr: 'Médical',    ar: 'طبي' },
  vetement:   { emoji: '👕', color: '#2980B9', fr: 'Vêtement',   ar: 'ملابس' },
  abri:       { emoji: '🏠', color: '#D35400', fr: 'Abri',       ar: 'مأوى' },
  autre:      { emoji: '💬', color: '#27AE60', fr: 'Autre',       ar: 'أخرى' },
};

// ── PRIVACY / TERMS ──────────────────────────
const PRIVACY_KEY = 'rahmapoint_privacy_accepted';

function checkPrivacyAccepted() {
  if (localStorage.getItem(PRIVACY_KEY) === 'yes') {
    document.getElementById('privacyModal').classList.remove('active');
  }
}

function updateAcceptBtn() {
  const checked = document.getElementById('acceptCheck').checked;
  document.getElementById('acceptBtn').disabled = !checked;
}

function acceptPrivacy() {
  localStorage.setItem(PRIVACY_KEY, 'yes');
  document.getElementById('privacyModal').classList.remove('active');
  showToast(currentLang === 'fr' ? '✓ Bienvenue sur RahmaPoint !' : '✓ مرحباً بك في رحمة بوينت!');
}

// ── INIT ────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkPrivacyAccepted();
  initMap();
  initAuth();
  renderAll();
  updateStats();
  listenToFirestore();
});

// ── AUTO-EXPIRATION 5 JOURS ──────────────────
async function purgeExpiredSituations(docs) {
  const now = Date.now();
  const limitMs = EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
  for (const s of docs) {
    const created = new Date(s.createdAt).getTime();
    if (now - created > limitMs) {
      try {
        await deleteDoc(doc(db, "signalements", s.id));
        console.log(`[RahmaPoint] Situation ${s.id} supprimée (> ${EXPIRATION_DAYS} jours)`);
      } catch (e) {
        console.warn("Erreur suppression expirée :", e);
      }
    }
  }
}

// ── FIRESTORE SYNC ────────────────────────────
function listenToFirestore() {
  try {
    const q = query(collection(db, "signalements"), orderBy("createdAt", "asc"));
    onSnapshot(q, (snapshot) => {
      situations = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      localStorage.setItem('rahmapoint_situations', JSON.stringify(situations));
      purgeExpiredSituations(situations);
      renderAll();
    }, (error) => {
      console.error("Erreur de synchronisation Firestore :", error);
      showToast(currentLang === 'fr'
        ? '⚠️ Connexion à Firebase impossible — données locales affichées'
        : '⚠️ تعذّر الاتصال بـ Firebase — تُعرض البيانات المحلية');
    });
  } catch (error) {
    console.error(error);
  }
}

// ── AUTH GOOGLE ───────────────────────────────
function initAuth() {
  onAuthStateChanged(auth, (user) => {
    currentUser = user;
    renderAuthZone();
    renderAll(); // re-render pour mettre à jour les boutons selon état auth
  });
}

function renderAuthZone() {
  const zone = document.getElementById('authZone');
  if (!zone) return;

  if (currentUser) {
    const photo = currentUser.photoURL
      ? `<img src="${currentUser.photoURL}" alt="avatar" class="user-avatar" referrerpolicy="no-referrer">`
      : `<div class="user-avatar user-avatar-placeholder">${currentUser.displayName?.[0] ?? '?'}</div>`;

    zone.innerHTML = `
      <div class="user-info">
        ${photo}
        <span class="user-name">${currentUser.displayName || currentUser.email}</span>
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
      ? `✓ Bienvenue ${auth.currentUser?.displayName ?? ''} !`
      : `✓ أهلاً ${auth.currentUser?.displayName ?? ''} !`);
  } catch (error) {
    if (error.code !== 'auth/popup-closed-by-user') {
      console.error(error);
      showToast(currentLang === 'fr'
        ? '❌ Connexion annulée ou échouée'
        : '❌ فشل تسجيل الدخول أو تم إلغاؤه');
    }
  }
}

async function logoutUser() {
  try {
    await signOut(auth);
    showToast(currentLang === 'fr' ? '👋 Déconnecté' : '👋 تم تسجيل الخروج');
  } catch (error) {
    console.error(error);
  }
}

// ── MAP TILE LAYERS ──────────────────────────
const tileLayers = {
  carto: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/">OSM</a>',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© <a href="https://www.esri.com/">Esri</a> — Satellite imagery',
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/">OSM</a>',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '© <a href="https://opentopomap.org/">OpenTopoMap</a> © <a href="https://www.openstreetmap.org/">OSM</a>',
  },
};

let currentTileLayer = null;
let tempMarker = null;
let hintHidden = false;

// ── MAP ─────────────────────────────────────
function initMap() {
  map = L.map('map', { zoomControl: true }).setView(DEFAULT_CENTER, 12);

  const def = tileLayers.carto;
  currentTileLayer = L.tileLayer(def.url, { attribution: def.attr, maxZoom: 19 }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  map.on('click', (e) => {
    const modalOpen = document.getElementById('signalModal').classList.contains('active');

    tempLatLng = e.latlng;
    const coordStr = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    document.getElementById('locationInput').value = coordStr;

    if (!hintHidden) {
      hintHidden = true;
      const hint = document.getElementById('mapHint');
      if (hint) hint.classList.add('hidden');
    }

    if (modalOpen) {
      showTempMarker(e.latlng);
      showToast(currentLang === 'fr' ? '📍 Position mise à jour' : '📍 تم تحديث الموقع');
    } else {
      openSignalModal();
      showTempMarker(e.latlng);
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
    html: `<div class="temp-marker-anim" style="
      width:18px;height:18px;border-radius:50%;
      background:var(--primary,#C0392B);
      border:3px solid #fff;
      box-shadow:0 2px 10px rgba(192,57,43,0.5);
    "></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
  tempMarker = L.marker(latlng, { icon, zIndexOffset: 1000 }).addTo(map);
}

function switchMapStyle(style, btn) {
  if (!tileLayers[style]) return;
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  const cfg = tileLayers[style];
  currentTileLayer = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: 19 }).addTo(map);
  currentTileLayer.bringToBack();

  document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  showToast(currentLang === 'fr'
    ? `🗺 Style carte : ${style}`
    : `🗺 نمط الخريطة: ${style}`);
}

function renderMarkers() {
  markersLayer.clearLayers();
  const filtered = getFiltered();
  filtered.forEach(s => addMarker(s));
}

function addMarker(s) {
  const cfg = typeConfig[s.type] || typeConfig.autre;
  const color = s.resolved ? '#5B8A5B' : cfg.color;

  const icon = L.divIcon({
    className: '',
    html: `<div class="rahma-marker" style="background:${color}">
             <div class="rahma-marker-inner">${cfg.emoji}</div>
           </div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -38],
  });

  const marker = L.marker([s.lat, s.lng], { icon });
  marker.bindPopup(buildPopupHTML(s), { maxWidth: 260 });
  marker.addTo(markersLayer);
}

function buildPopupHTML(s) {
  const cfg = typeConfig[s.type] || typeConfig.autre;
  const typeLabel = cfg[currentLang] || cfg.fr;
  const shortDesc = s.description.length > 80 ? s.description.slice(0, 80) + '…' : s.description;
  const resolvedLabel = currentLang === 'fr' ? 'Résolu ✓' : 'تم الحل ✓';
  const detailLabel = currentLang === 'fr' ? 'Voir détail' : 'عرض التفاصيل';
  const resolveLabel = currentLang === 'fr' ? 'Marquer résolu' : 'تم الحل';
  const confirmCount = (s.confirmedBy || []).length;
  const confirmLabel = currentLang === 'fr'
    ? `✓ Confirmé (${confirmCount})`
    : `✓ مؤكد (${confirmCount})`;

  return `
    <div class="popup-inner">
      <div class="popup-type">${cfg.emoji} ${typeLabel}</div>
      <div class="popup-desc">${shortDesc}</div>
      ${confirmCount > 0 ? `<div class="popup-confirms">${confirmLabel}</div>` : ''}
      <button class="popup-btn" onclick="openDetail('${s.id}')">${detailLabel}</button>
      ${!s.resolved
        ? `<button class="popup-btn green" onclick="resolveFromMap('${s.id}')">✓ ${resolveLabel}</button>`
        : `<span style="font-size:0.75rem;color:#5B8A5B;font-weight:700">${resolvedLabel}</span>`
      }
    </div>`;
}

// ── RENDER ───────────────────────────────────
function renderAll() {
  renderCards();
  renderMarkers();
  updateStats();
}

function renderCards() {
  const grid = document.getElementById('cardsGrid');
  const empty = document.getElementById('emptyState');
  const filtered = getFiltered();

  grid.innerHTML = '';
  if (filtered.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  filtered.slice().reverse().forEach((s, i) => {
    const card = buildCard(s, i);
    grid.appendChild(card);
  });
}

function buildCard(s, delay) {
  const cfg = typeConfig[s.type] || typeConfig.autre;
  const typeLabel = cfg[currentLang] || cfg.fr;
  const timeAgo = getTimeAgo(s.createdAt);

  // ── Confirmation ──────────────────────────
  const confirmedBy = s.confirmedBy || [];
  const confirmCount = confirmedBy.length;
  const alreadyConfirmed = currentUser && confirmedBy.includes(currentUser.uid);

  const confirmBtnFr = alreadyConfirmed ? '✓ Déjà confirmé' : `✓ Confirmer cette situation`;
  const confirmBtnAr = alreadyConfirmed ? '✓ تم التأكيد مسبقاً' : `✓ تأكيد هذا الموقف`;
  const confirmCountLabel = confirmCount > 0
    ? `<span class="confirm-count">${currentLang === 'fr' ? `${confirmCount} confirmation${confirmCount > 1 ? 's' : ''}` : `${confirmCount} تأكيد`}</span>`
    : '';

  const card = document.createElement('div');
  card.className = `card${s.resolved ? ' resolved' : ''}`;
  card.style.animationDelay = `${delay * 0.07}s`;

  const statusFr = s.resolved ? 'Résolu' : 'En attente';
  const statusAr = s.resolved ? 'تم الحل' : 'بانتظار';
  const status = currentLang === 'fr' ? statusFr : statusAr;

  const detailFr = 'Détail'; const detailAr = 'تفاصيل';
  const routeFr = 'Itinéraire'; const routeAr = 'الطريق';
  const resolveFr = s.resolved ? 'Résolu ✓' : 'Marquer résolu';
  const resolveAr = s.resolved ? 'تم الحل ✓' : 'وضع علامة محلول';
  const reportFr = 'Signaler'; const reportAr = 'إبلاغ';

  // Expiration countdown
  const daysLeft = getDaysLeft(s.createdAt);
  const expiryLabel = daysLeft !== null
    ? `<span class="expiry-badge" title="${currentLang === 'fr' ? 'Suppression automatique' : 'حذف تلقائي'}">⏳ ${daysLeft}j</span>`
    : '';

  card.innerHTML = `
    <div class="card-header" style="background:${s.resolved ? '#5B8A5B' : cfg.color}">
      <span class="card-type">${cfg.emoji} ${typeLabel}</span>
      <span class="card-badge ${s.resolved ? 'resolved-badge' : ''}">${status}</span>
    </div>
    <div class="card-body">
      <p class="card-desc">${s.description}</p>
      <div class="card-meta">
        <span>🕐 ${timeAgo}</span>
        ${expiryLabel}
        ${s.location ? `<span>📍 ${s.location}</span>` : ''}
        ${s.contact ? `<span>📞 ${s.contact}</span>` : ''}
        ${s.reportCount > 0 ? `<span style="color:#C0392B">⚠️ ${s.reportCount}</span>` : ''}
      </div>
      ${confirmCountLabel}
      <div class="card-actions">
        <button class="card-btn primary" onclick="openDetail('${s.id}')">
          ${currentLang === 'fr' ? detailFr : detailAr}
        </button>
        ${s.lat ? `<button class="card-btn gray" onclick="goToRoute(${s.lat},${s.lng})">
          🗺 ${currentLang === 'fr' ? routeFr : routeAr}
        </button>` : ''}
        <button class="card-btn ${s.resolved ? 'gray' : 'green'}" onclick="toggleResolve('${s.id}')">
          ${currentLang === 'fr' ? resolveFr : resolveAr}
        </button>
        <button class="card-btn gray" onclick="reportSituation('${s.id}')">
          ⚠️ ${currentLang === 'fr' ? reportFr : reportAr}
        </button>
      </div>
      <button
        class="btn-confirm${alreadyConfirmed ? ' confirmed' : ''}"
        onclick="confirmSituation('${s.id}')"
        ${alreadyConfirmed ? 'disabled' : ''}
      >
        ${currentLang === 'fr' ? confirmBtnFr : confirmBtnAr}
      </button>
    </div>`;

  return card;
}

// ── CONFIRMATION DE SITUATION ─────────────────
async function confirmSituation(id) {
  // 1. Vérification connexion
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return;
  }

  const s = situations.find(x => x.id === id);
  if (!s) return;

  // 2. Vérification anti-doublon côté client (défense en profondeur)
  const confirmedBy = s.confirmedBy || [];
  if (confirmedBy.includes(currentUser.uid)) {
    showToast(currentLang === 'fr'
      ? '⚠️ Vous avez déjà confirmé cette situation'
      : '⚠️ لقد أكدت هذا الموقف مسبقاً');
    return;
  }

  try {
    // 3. arrayUnion garantit l'unicité côté Firestore (sécurité serveur)
    await updateDoc(doc(db, "signalements", id), {
      confirmedBy: arrayUnion(currentUser.uid),
    });

    showToast(currentLang === 'fr'
      ? '✓ Situation confirmée — merci !'
      : '✓ تم تأكيد الموقف — شكراً!');
  } catch (error) {
    console.error("Erreur confirmation :", error);
    showToast(currentLang === 'fr' ? '❌ Erreur Firebase' : '❌ خطأ في Firebase');
  }
}

// ── DETAIL MODAL ─────────────────────────────
function openDetail(id) {
  const s = situations.find(x => x.id === id);
  if (!s) return;
  const cfg = typeConfig[s.type] || typeConfig.autre;
  const typeLabel = cfg[currentLang] || cfg.fr;
  map.closePopup();

  const comments = s.comments || [];
  const confirmedBy = s.confirmedBy || [];
  const confirmCount = confirmedBy.length;
  const alreadyConfirmed = currentUser && confirmedBy.includes(currentUser.uid);

  const commentsHTML = comments.map(c => `
    <div class="comment-item">
      ${c.text}
      <div class="comment-time">${getTimeAgo(c.createdAt)}</div>
    </div>`).join('');

  const confirmBtnFr = alreadyConfirmed ? '✓ Déjà confirmé' : '✓ Confirmer cette situation';
  const confirmBtnAr = alreadyConfirmed ? '✓ تم التأكيد مسبقاً' : '✓ تأكيد هذا الموقف';

  const daysLeft = getDaysLeft(s.createdAt);

  const content = `
    <div class="detail-header" style="background:${s.resolved ? '#5B8A5B' : cfg.color}">
      <div class="detail-type">${cfg.emoji} ${typeLabel}</div>
      <div class="detail-title">${s.description}</div>
    </div>
    ${s.location ? `<div class="detail-section">
      <div class="detail-label">${currentLang === 'fr' ? 'Localisation' : 'الموقع'}</div>
      <div class="detail-value">📍 ${s.location}</div>
    </div>` : ''}
    ${s.contact ? `<div class="detail-section">
      <div class="detail-label">${currentLang === 'fr' ? 'Contact' : 'التواصل'}</div>
      <div class="detail-value">📞 ${s.contact}</div>
    </div>` : ''}
    <div class="detail-section">
      <div class="detail-label">${currentLang === 'fr' ? 'Signalé le' : 'أُبلغ في'}</div>
      <div class="detail-value">${new Date(s.createdAt).toLocaleString(currentLang === 'ar' ? 'ar-DZ' : 'fr-DZ')}</div>
    </div>
    <div class="detail-section">
      <div class="detail-label">${currentLang === 'fr' ? 'Expiration' : 'انتهاء الصلاحية'}</div>
      <div class="detail-value">⏳ ${daysLeft !== null
        ? (currentLang === 'fr' ? `Suppression dans ${daysLeft} jour(s)` : `يُحذف خلال ${daysLeft} يوم`)
        : (currentLang === 'fr' ? 'Expiré' : 'منتهي الصلاحية')}</div>
    </div>
    <div class="detail-section">
      <div class="detail-label">${currentLang === 'fr' ? 'Statut' : 'الحالة'}</div>
      <div class="detail-value">${s.resolved
        ? `<span style="color:#5B8A5B;font-weight:700">${currentLang === 'fr' ? '✓ Situation résolue' : '✓ تم حل الموقف'}</span>`
        : `<span style="color:#C0392B">${currentLang === 'fr' ? '⏳ En attente d\'aide' : '⏳ بانتظار المساعدة'}</span>`
      }</div>
    </div>
    <div class="detail-section">
      <div class="detail-label">${currentLang === 'fr' ? 'Confirmations terrain' : 'تأكيدات ميدانية'}</div>
      <div class="detail-value">
        <span class="confirm-count-detail">
          ✓ ${confirmCount} ${currentLang === 'fr'
            ? `personne${confirmCount > 1 ? 's ont' : ' a'} confirmé cette situation`
            : `شخص أكّد وجود هذا الموقف`}
        </span>
      </div>
    </div>
    <div class="detail-actions">
      ${s.lat ? `<button class="card-btn green" onclick="goToRoute(${s.lat},${s.lng})">
        🗺 ${currentLang === 'fr' ? 'Itinéraire' : 'الطريق'}
      </button>` : ''}
      <button class="card-btn ${s.resolved ? 'gray' : 'primary'}" onclick="toggleResolve('${s.id}'); document.getElementById('detailModal').classList.remove('active')">
        ${s.resolved
          ? (currentLang === 'fr' ? 'Rouvrir' : 'إعادة فتح')
          : (currentLang === 'fr' ? '✓ Marquer résolu' : '✓ تم الحل')
        }
      </button>
      <button class="card-btn gray" onclick="reportSituation('${s.id}')">⚠️</button>
    </div>

    <button
      class="btn-confirm-detail${alreadyConfirmed ? ' confirmed' : ''}"
      onclick="confirmSituation('${s.id}')"
      ${alreadyConfirmed ? 'disabled' : ''}
    >
      ${currentLang === 'fr' ? confirmBtnFr : confirmBtnAr}
    </button>

    <div class="comments-section">
      <div class="comments-title">${currentLang === 'fr' ? `Commentaires (${comments.length})` : `التعليقات (${comments.length})`}</div>
      ${commentsHTML || `<p style="font-size:0.80rem;color:#999">${currentLang === 'fr' ? 'Aucun commentaire.' : 'لا توجد تعليقات.'}</p>`}
      <div class="comment-input-row">
        <input type="text" id="commentInput_${s.id}" placeholder="${currentLang === 'fr' ? 'Ajouter un commentaire…' : 'أضف تعليقاً…'}" />
        <button onclick="addComment('${s.id}')">${currentLang === 'fr' ? 'Envoyer' : 'إرسال'}</button>
      </div>
    </div>`;

  document.getElementById('detailContent').innerHTML = content;
  document.getElementById('detailModal').classList.add('active');
}

// ── SIGNAL MODAL ──────────────────────────────
function openSignalModal() {
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return;
  }

  selectedType = '';
  tempLatLng = null;
  document.getElementById('descInput').value = '';
  document.getElementById('locationInput').value = '';
  document.getElementById('contactInput').value = '';
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
    () => showToast(currentLang === 'fr' ? 'Impossible de détecter la position' : 'تعذّر تحديد موقعك')
  );
}

async function submitSignal() {
  const desc = document.getElementById('descInput').value.trim();
  const contact = document.getElementById('contactInput').value.trim();
  const locText = document.getElementById('locationInput').value.trim();

  if (!selectedType) {
    showToast(currentLang === 'fr' ? '⚠️ Choisissez un type' : '⚠️ اختر نوعاً');
    return;
  }
  if (!desc) {
    showToast(currentLang === 'fr' ? '⚠️ Ajoutez une description' : '⚠️ أضف وصفاً');
    return;
  }
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return;
  }

  const newS = {
    type: selectedType,
    description: desc,
    location: locText,
    contact,
    lat: tempLatLng ? tempLatLng.lat : DEFAULT_CENTER[0] + (Math.random() - 0.5) * 0.02,
    lng: tempLatLng ? tempLatLng.lng : DEFAULT_CENTER[1] + (Math.random() - 0.5) * 0.02,
    createdAt: new Date().toISOString(),
    resolved: false,
    reportCount: 0,
    comments: [],
    confirmedBy: [],       // ← nouveau champ : tableau des UIDs ayant confirmé
    userId:    currentUser.uid,
    userName:  currentUser.displayName  || '',
    userEmail: currentUser.email        || '',
    userPhoto: currentUser.photoURL     || '',
  };

  try {
    await addDoc(collection(db, "signalements"), newS);
    closeSignalModal();
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    renderAll();
    showToast(currentLang === 'fr'
      ? '✓ Signalement enregistré dans Firebase'
      : '✓ تم حفظ البلاغ في Firebase');
  } catch (error) {
    console.error(error);
    showToast(currentLang === 'fr' ? 'Erreur Firebase' : 'خطأ في Firebase');
  }
}

// ── ACTIONS ───────────────────────────────────
async function toggleResolve(id) {
  // Auth obligatoire
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return;
  }
  const s = situations.find(x => x.id === id);
  if (!s) return;
  const newResolved = !s.resolved;
  try {
    await updateDoc(doc(db, "signalements", id), { resolved: newResolved });
    showToast(currentLang === 'fr'
      ? (newResolved ? '✓ Marqué comme résolu' : '↩ Rouvert')
      : (newResolved ? '✓ وُضعت علامة محلول' : '↩ أُعيد فتحه')
    );
  } catch (error) {
    console.error(error);
    showToast(currentLang === 'fr' ? 'Erreur Firebase' : 'خطأ في Firebase');
  }
}

function resolveFromMap(id) {
  toggleResolve(id);
  map.closePopup();
}

async function reportSituation(id) {
  // Auth obligatoire
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return;
  }
  const s = situations.find(x => x.id === id);
  if (!s) return;
  const newCount = (s.reportCount || 0) + 1;

  try {
    if (newCount >= 2) {
      await deleteDoc(doc(db, "signalements", id));
      document.getElementById('detailModal').classList.remove('active');
      showToast(currentLang === 'fr'
        ? '🗑️ Situation supprimée automatiquement (2 signalements)'
        : '🗑️ تم حذف الموقف تلقائياً (بلاغان)');
      return;
    }
    await updateDoc(doc(db, "signalements", id), { reportCount: newCount });
    showToast(currentLang === 'fr'
      ? `⚠️ Signalé (${newCount}/2 — suppression auto à 2)`
      : `⚠️ تم الإبلاغ (${newCount}/2 — يُحذف تلقائياً عند 2)`);
  } catch (error) {
    console.error(error);
    showToast(currentLang === 'fr' ? 'Erreur Firebase' : 'خطأ في Firebase');
  }
}

async function addComment(id) {
  if (!currentUser) {
    document.getElementById('loginRequiredModal').classList.add('active');
    return;
  }
  const input = document.getElementById(`commentInput_${id}`);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const s = situations.find(x => x.id === id);
  if (!s) return;
  const newComments = [...(s.comments || []), { text, createdAt: new Date().toISOString() }];

  try {
    await updateDoc(doc(db, "signalements", id), { comments: newComments });
    showToast(currentLang === 'fr' ? '💬 Commentaire ajouté' : '💬 تمت إضافة التعليق');
    openDetail(id);
  } catch (error) {
    console.error(error);
    showToast(currentLang === 'fr' ? 'Erreur Firebase' : 'خطأ في Firebase');
  }
}

function goToRoute(lat, lng) {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  window.open(url, '_blank');
}

// ── FILTER ────────────────────────────────────
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAll();
}

function getFiltered() {
  if (currentFilter === 'all') return situations;
  return situations.filter(s => s.type === currentFilter);
}

// ── STATS ─────────────────────────────────────
function updateStats() {
  document.getElementById('totalCount').textContent = situations.length;
  document.getElementById('resolvedCount').textContent = situations.filter(s => s.resolved).length;
  document.getElementById('activeCount').textContent = situations.filter(s => !s.resolved).length;
}

// ── LANGUAGE ──────────────────────────────────
function toggleLang() {
  currentLang = currentLang === 'fr' ? 'ar' : 'fr';
  document.documentElement.setAttribute('lang', currentLang);
  document.documentElement.setAttribute('dir', currentLang === 'ar' ? 'rtl' : 'ltr');
  document.body.classList.toggle('ar', currentLang === 'ar');

  const btn = document.getElementById('langToggle');
  btn.textContent = currentLang === 'fr' ? 'العربية' : 'Français';

  document.querySelectorAll('[data-fr][data-ar]').forEach(el => {
    el.textContent = currentLang === 'ar' ? el.dataset.ar : el.dataset.fr;
  });

  renderAll();
}

function applyLang(lang) {
  document.querySelectorAll('[data-fr][data-ar]').forEach(el => {
    el.textContent = lang === 'ar' ? el.dataset.ar : el.dataset.fr;
  });
}

// ── MODALS ────────────────────────────────────
function closeOnOverlay(event, modalId) {
  if (event.target === document.getElementById(modalId)) {
    document.getElementById(modalId).classList.remove('active');
  }
}

// ── TOAST ─────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── UTILS ─────────────────────────────────────
function getTimeAgo(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (currentLang === 'ar') {
    if (mins < 1) return 'الآن';
    if (mins < 60) return `منذ ${mins} دقيقة`;
    if (hrs < 24) return `منذ ${hrs} ساعة`;
    return `منذ ${days} يوم`;
  }
  if (mins < 1) return 'À l\'instant';
  if (mins < 60) return `Il y a ${mins} min`;
  if (hrs < 24) return `Il y a ${hrs}h`;
  return `Il y a ${days}j`;
}

function getDaysLeft(isoString) {
  const created = new Date(isoString).getTime();
  const elapsed = Date.now() - created;
  const limitMs = EXPIRATION_DAYS * 24 * 60 * 60 * 1000;
  const remaining = limitMs - elapsed;
  if (remaining <= 0) return null;
  return Math.ceil(remaining / (24 * 60 * 60 * 1000));
}

function save() {
  localStorage.setItem('rahmapoint_situations', JSON.stringify(situations));
}

// ── DEMO DATA (first visit) ──────────────────
if (situations.length === 0) {
  const demos = [
    {
      id: '1',
      type: 'nourriture',
      description: 'Famille de 5 personnes sans nourriture depuis 2 jours. Besoin urgent.',
      location: 'Rue Didouche Mourad, Sétif',
      contact: '0555 12 34 56',
      lat: 36.1914, lng: 5.4108,
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      resolved: false, reportCount: 0, comments: [], confirmedBy: [],
    },
    {
      id: '2',
      type: 'medical',
      description: 'Personne âgée nécessitant un accompagnement médical. Pas de moyen de transport.',
      location: 'Cité El Hidhab, Sétif',
      contact: '0666 98 76 54',
      lat: 36.1972, lng: 5.4001,
      createdAt: new Date(Date.now() - 3600000 * 7).toISOString(),
      resolved: true, reportCount: 0, comments: [], confirmedBy: [],
    },
    {
      id: '3',
      type: 'vetement',
      description: 'Vêtements chauds pour enfants 4-8 ans recherchés. Hiver difficile.',
      location: 'Quartier Bazerdjemane, Sétif',
      contact: '',
      lat: 36.1843, lng: 5.4223,
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      resolved: false, reportCount: 0, comments: [], confirmedBy: [],
    },
  ];
  situations = demos;
  save();
}

// ── EXPOSITION GLOBALE ───────────────────────
window.loginWithGoogle    = loginWithGoogle;
window.logoutUser         = logoutUser;
window.acceptPrivacy      = acceptPrivacy;
window.updateAcceptBtn    = updateAcceptBtn;
window.openSignalModal    = openSignalModal;
window.closeSignalModal   = closeSignalModal;
window.selectType         = selectType;
window.getLocation        = getLocation;
window.submitSignal       = submitSignal;
window.toggleLang         = toggleLang;
window.toggleResolve      = toggleResolve;
window.resolveFromMap     = resolveFromMap;
window.reportSituation    = reportSituation;
window.addComment         = addComment;
window.goToRoute          = goToRoute;
window.openDetail         = openDetail;
window.setFilter          = setFilter;
window.switchMapStyle     = switchMapStyle;
window.closeOnOverlay     = closeOnOverlay;
window.confirmSituation   = confirmSituation;   // ← nouveau
