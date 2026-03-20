/* ==========================================
   RAHMAPOINT — app.js
   ========================================== */

// ── STATE ──────────────────────────────────
let situations = JSON.parse(localStorage.getItem('rahmapoint_situations') || '[]');
let currentLang = 'fr';
let currentFilter = 'all';
let selectedType = '';
let tempLatLng = null;
let map, markersLayer;

// Default center: Sétif, Algeria
const DEFAULT_CENTER = [36.19, 5.41];

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
  // else modal stays active (it starts with class active in HTML)
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
  renderAll();
  updateStats();
});

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

  // Load default style
  const def = tileLayers.carto;
  currentTileLayer = L.tileLayer(def.url, { attribution: def.attr, maxZoom: 19 }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  // ── Click on map: if modal open → pick location, else → open modal pre-filled
  map.on('click', (e) => {
    const modalOpen = document.getElementById('signalModal').classList.contains('active');

    // Always update coordinates
    tempLatLng = e.latlng;
    const coordStr = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    document.getElementById('locationInput').value = coordStr;

    // Hide the hint after first click
    if (!hintHidden) {
      hintHidden = true;
      const hint = document.getElementById('mapHint');
      if (hint) hint.classList.add('hidden');
    }

    if (modalOpen) {
      // Just update location field + show temp marker
      showTempMarker(e.latlng);
      showToast(currentLang === 'fr' ? '📍 Position mise à jour' : '📍 تم تحديث الموقع');
    } else {
      // Open signal modal pre-filled with clicked position
      openSignalModal();
      showTempMarker(e.latlng);
      // Small delay so modal animation plays first
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
  // Move tile layer below markers
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

  return `
    <div class="popup-inner">
      <div class="popup-type">${cfg.emoji} ${typeLabel}</div>
      <div class="popup-desc">${shortDesc}</div>
      <button class="popup-btn" onclick="openDetail('${s.id}')"> ${detailLabel}</button>
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

  card.innerHTML = `
    <div class="card-header" style="background:${s.resolved ? '#5B8A5B' : cfg.color}">
      <span class="card-type">${cfg.emoji} ${typeLabel}</span>
      <span class="card-badge ${s.resolved ? 'resolved-badge' : ''}">${status}</span>
    </div>
    <div class="card-body">
      <p class="card-desc">${s.description}</p>
      <div class="card-meta">
        <span>🕐 ${timeAgo}</span>
        ${s.location ? `<span>📍 ${s.location}</span>` : ''}
        ${s.contact ? `<span>📞 ${s.contact}</span>` : ''}
        ${s.reportCount > 0 ? `<span style="color:#C0392B">⚠️ ${s.reportCount}</span>` : ''}
      </div>
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
    </div>`;

  return card;
}

// ── DETAIL MODAL ─────────────────────────────
function openDetail(id) {
  const s = situations.find(x => x.id === id);
  if (!s) return;
  const cfg = typeConfig[s.type] || typeConfig.autre;
  const typeLabel = cfg[currentLang] || cfg.fr;
  map.closePopup();

  const comments = s.comments || [];
  const commentsHTML = comments.map(c => `
    <div class="comment-item">
      ${c.text}
      <div class="comment-time">${getTimeAgo(c.createdAt)}</div>
    </div>`).join('');

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
      <div class="detail-label">${currentLang === 'fr' ? 'Statut' : 'الحالة'}</div>
      <div class="detail-value">${s.resolved
        ? `<span style="color:#5B8A5B;font-weight:700">${currentLang === 'fr' ? '✓ Situation résolue' : '✓ تم حل الموقف'}</span>`
        : `<span style="color:#C0392B">${currentLang === 'fr' ? '⏳ En attente d\'aide' : '⏳ بانتظار المساعدة'}</span>`
      }</div>
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

function submitSignal() {
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

  const newS = {
    id: Date.now().toString(),
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
  };

  situations.push(newS);
  save();
  closeSignalModal();
  if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
  renderAll();
  map.setView([newS.lat, newS.lng], 14);
  showToast(currentLang === 'fr' ? '✓ Situation publiée !' : '✓ تم نشر الموقف!');
}

// ── ACTIONS ───────────────────────────────────
function toggleResolve(id) {
  const s = situations.find(x => x.id === id);
  if (!s) return;
  s.resolved = !s.resolved;
  save();
  renderAll();
  showToast(currentLang === 'fr'
    ? (s.resolved ? '✓ Marqué comme résolu' : '↩ Rouvert')
    : (s.resolved ? '✓ وُضعت علامة محلول' : '↩ أُعيد فتحه')
  );
}

function resolveFromMap(id) {
  toggleResolve(id);
  map.closePopup();
}

function reportSituation(id) {
  const s = situations.find(x => x.id === id);
  if (!s) return;
  s.reportCount = (s.reportCount || 0) + 1;

  // Auto-suppression si 2 signalements de fausse information
  if (s.reportCount >= 2) {
    situations = situations.filter(x => x.id !== id);
    save();
    renderAll();
    // Fermer le modal détail si ouvert
    document.getElementById('detailModal').classList.remove('active');
    showToast(currentLang === 'fr'
      ? '🗑️ Situation supprimée automatiquement (2 signalements)'
      : '🗑️ تم حذف الموقف تلقائياً (بلاغان)');
    return;
  }

  save();
  renderAll();
  showToast(currentLang === 'fr'
    ? `⚠️ Signalé (${s.reportCount}/2 — suppression auto à 2)`
    : `⚠️ تم الإبلاغ (${s.reportCount}/2 — يُحذف تلقائياً عند 2)`);
}

function addComment(id) {
  const input = document.getElementById(`commentInput_${id}`);
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  const s = situations.find(x => x.id === id);
  if (!s) return;
  s.comments = s.comments || [];
  s.comments.push({ text, createdAt: new Date().toISOString() });
  save();
  showToast(currentLang === 'fr' ? '💬 Commentaire ajouté' : '💬 تمت إضافة التعليق');
  openDetail(id);
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

  // Update all data-fr / data-ar elements (inclut le modal confidentialité)
  document.querySelectorAll('[data-fr][data-ar]').forEach(el => {
    el.textContent = currentLang === 'ar' ? el.dataset.ar : el.dataset.fr;
  });

  renderAll();
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
      lat: 36.1914,
      lng: 5.4108,
      createdAt: new Date(Date.now() - 3600000 * 3).toISOString(),
      resolved: false,
      reportCount: 0,
      comments: [{ text: 'Je peux apporter de la nourriture ce soir.', createdAt: new Date(Date.now() - 1800000).toISOString() }],
    },
    {
      id: '2',
      type: 'medical',
      description: 'Personne âgée nécessitant un accompagnement médical. Pas de moyen de transport.',
      location: 'Cité El Hidhab, Sétif',
      contact: '0666 98 76 54',
      lat: 36.1972,
      lng: 5.4001,
      createdAt: new Date(Date.now() - 3600000 * 7).toISOString(),
      resolved: true,
      reportCount: 0,
      comments: [],
    },
    {
      id: '3',
      type: 'vetement',
      description: 'Vêtements chauds pour enfants 4-8 ans recherchés. Hiver difficile.',
      location: 'Quartier Bazerdjemane, Sétif',
      contact: '',
      lat: 36.1843,
      lng: 5.4223,
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      resolved: false,
      reportCount: 0,
      comments: [],
    },
  ];
  situations = demos;
  save();
}