window.onerror = function(msg) {
  document.getElementById('loading-tag').textContent = '⚠ ' + msg;
  return false;
};

// ============================================================
// CONFIGURATION API — Apps Script backend
// ============================================================
const API_BASE_URL = 'https://script.google.com/macros/s/AKfycby8xjgcmphN3uhq7TbXwRaai2xsrNroM8wMetaQpmKOsprC0hjLZ9WPvdsokGIAHsC3/exec';
const API_TOKEN = 'ezafzgerhgerdsfefe4fef4e5de5dfef74ezDF634EFCE879E';

function apiGet(action, extraParams) {
  let url = API_BASE_URL + '?action=' + encodeURIComponent(action) + '&token=' + encodeURIComponent(API_TOKEN);
  if (extraParams) {
    Object.keys(extraParams).forEach(function(k) {
      url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(extraParams[k]);
    });
  }
  return fetch(url)
    .then(function(r) { return r.json(); })
    .then(function(json) {
      if (!json.success) throw new Error(json.error || 'Erreur API');
      return json.data;
    });
}

function apiPost(action, payload) {
  const body = Object.assign({}, payload, { token: API_TOKEN });
  return fetch(API_BASE_URL + '?action=' + encodeURIComponent(action), {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  })
    .then(function(r) { return r.json(); })
    .then(function(json) {
      if (!json.success) throw new Error(json.error || 'Erreur API');
      return json.data;
    });
}

// ============================================================
// ÉTAT GLOBAL
// ============================================================
let saisieState = { type: 'Dépense', groupe: '', categorie: '' };
let modeEdition = false; // false = création ; sinon { row, id } de la transaction éditée
let historiqueOffset = 0;
let historiqueItems = [];
const HISTORIQUE_LOT = 10;

// ============================================================
// CHARGEMENT INITIAL
// ============================================================
apiGet('getComptesData').then(render).catch(onError);

function fmtEUR(v) {
  if (v === '' || v === undefined || v === null) return '—';
  const n = Number(v);
  if (isNaN(n)) return String(v);
  return n.toLocaleString('fr-FR', {minimumFractionDigits:0, maximumFractionDigits:0}) + ' €';
}

function iconFor(label) {
  const l = (label || '').toLowerCase();
  if (l.includes('lep')) return '📙';
  if (l.includes('livret') || l.includes('csl') || l.includes('ldds')) return '📘';
  if (l.includes('cash de secours')) return '💵';
  if (l.includes('fonds €') || l.includes('assurance')) return '🛡️';
  if (l.includes('gold') || l.includes('lingotin')) return '🥇';
  if (l.includes('scpi')) return '🏢';
  if (l.includes('obligation')) return '📜';
  if (l.includes('résidence') || l.includes('prêt immobilier') || l.includes('mensualité')) return '🏠';
  if (l.includes('locatif')) return '🏘️';
  if (l.includes('climat') || l.includes('ingerop')) return '📊';
  if (l.includes('msci') || l.includes('invexo')) return '📈';
  if (l.includes('pea')) return '📊';
  if (l.includes('cto') || l.includes('actions')) return '📈';
  if (l.includes('private equity')) return '🚀';
  if (l.includes('crowdlending') || l.includes('créances')) return '🤝';
  if (l.includes('crypto') || l.includes('bitcoin') || l.includes('ethereum')) return '🪙';
  if (l.includes('bnp') || l.includes('bourso') || l.includes('boursorama') || l.includes('trade republic') || l.includes('liquidité')) return '🏦';
  return '💼';
}

function navTo(screenId, btn) {
  showScreen(screenId);
  document.querySelectorAll('.nav-item').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  if (screenId === 'screen-historique' && historiqueItems.length === 0) chargerHistorique(true);
  if (screenId === 'screen-budget') chargerBudget();
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}

function nouvelleSaisie() {
  modeEdition = false;
  saisieState = { type: 'Dépense', groupe: '', categorie: '' };
  document.getElementById('input-montant').value = '';
  document.getElementById('input-note').value = '';
  document.getElementById('input-date').valueAsDate = new Date();
  setType('Dépense');
  document.getElementById('submit-btn').textContent = "Enregistrer l'écriture";
  navTo('screen-saisie', null);
}

function render(data) {
  try {
    document.getElementById('loading-tag').textContent = data.nomFichier;
    document.getElementById('sub-title').textContent = 'Adrien & Selma';

    document.getElementById('valeur-nette').innerHTML = fmtEUR(data.kpis.valeurNette).replace(' €','') + ' <sup>€</sup>';
    document.getElementById('liquidites').textContent = fmtEUR(data.kpis.liquidites);
    document.getElementById('taux-epargne').textContent = data.kpis.tauxEpargne || '—';
    const bilanEl = document.getElementById('bilan-assentis');
    const bilanVal = Number(data.kpis.bilanAssentis);
    bilanEl.textContent = fmtEUR(data.kpis.bilanAssentis);
    bilanEl.style.color = (bilanVal < 0) ? 'var(--coral)' : '';
    renderRoadmap(data.feuilleDeRoute || []);

    let allocHtml = '';
    (data.allocation.lignes || []).forEach(function(l) {
      const pctNum = parseFloat(String(l.pct).replace('%','')) || 0;
      allocHtml += '<div class="alloc-row">' +
          '<div class="alloc-top">' +
            '<div class="alloc-name"><span class="alloc-icon">' + iconFor(l.placement) + '</span>' + l.placement + '</div>' +
            '<div class="alloc-values">' +
              '<div class="alloc-amount">' + fmtEUR(l.montant) + '</div>' +
              '<div class="alloc-pct">' + l.pct + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="alloc-bar-bg"><div class="alloc-bar-fill" style="width:' + pctNum + '%"></div></div>' +
        '</div>';
    });
    document.getElementById('allocation-container').innerHTML = allocHtml;

    const bySection = {};
    (data.comptes || []).forEach(function(c) {
      if (!bySection[c.section]) bySection[c.section] = [];
      bySection[c.section].push(c);
    });
    let html = '';
    Object.keys(bySection).forEach(function(section) {
      html += '<div class="section-title">' + section + '</div><div class="accounts">';
      bySection[section].forEach(function(c) {
        html += '<div class="account-row">' +
            '<div class="acc-left"><div class="acc-icon">' + iconFor(c.nom) + '</div>' +
              '<div><div class="acc-name">' + c.nom + '</div></div></div>' +
            '<div class="acc-amount">' + fmtEUR(c.valeur) + '</div>' +
          '</div>';
      });
      html += '</div>';
    });
    document.getElementById('comptes-container').innerHTML = html;

    let txHtml = '';
    (data.dernieres || []).forEach(function(t) {
      const isDep = t.type === 'Dépense';
      const sign = isDep ? '−' : '+';
      const color = isDep ? 'var(--coral)' : 'var(--sage)';
      txHtml += '<div class="account-row">' +
          '<div class="acc-left"><div class="acc-icon">' + (isDep ? '💸' : '💶') + '</div>' +
            '<div><div class="acc-name">' + t.categorie + '</div><div class="acc-sub">' + t.date + '</div></div></div>' +
          '<div class="acc-amount" style="color:' + color + '">' + sign + fmtEUR(t.montant).replace('−','').replace('+','') + '</div>' +
        '</div>';
    });
    document.getElementById('transactions-container').innerHTML = txHtml;

    const compteSelect = document.getElementById('input-compte');
    const comptesListe = data.comptesListe || [];
    compteSelect.innerHTML = comptesListe.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    const defaultCompte = comptesListe.find(function(c) { return c.toLowerCase().includes('trade republic'); });
    if (defaultCompte && !modeEdition) compteSelect.value = defaultCompte;
    if (!document.getElementById('input-date').value) {
      document.getElementById('input-date').valueAsDate = new Date();
    }
    renderGroupesOuCategories();
  } catch (e) {
    document.getElementById('loading-tag').textContent = '⚠ render: ' + e.message;
  }
}

function onError(err) {
  document.getElementById('loading-tag').textContent = '⚠ ' + err.message;
}

function setType(t) {
  saisieState.type = t;
  saisieState.groupe = '';
  document.getElementById('seg-dep').classList.toggle('active', t === 'Dépense');
  document.getElementById('seg-rev').classList.toggle('active', t === 'Revenu');
  renderGroupesOuCategories();
}

function renderGroupesOuCategories() {
  const groupZone = document.getElementById('group-zone');
  const chipZone = document.getElementById('chip-zone');

  if (saisieState.type === 'Dépense') {
    groupZone.style.display = '';
    const groupes = Object.keys(CATEGORIES_DEPENSE_GROUPES);
    document.getElementById('group-scroll').innerHTML = groupes.map(function(g) {
      return '<div class="chip ' + (saisieState.groupe===g ? 'active':'') + '" data-groupe="' + g + '" onclick="selectGroupe(this)">' +
        '<div class="chip-stamp">' + CATEGORIES_DEPENSE_GROUPES[g].icon + '</div>' +
        '<div class="chip-label">' + g + '</div>' +
      '</div>';
    }).join('');

    if (!saisieState.groupe) {
      chipZone.style.display = 'none';
      document.getElementById('chip-scroll').innerHTML = '';
      saisieState.categorie = '';
    } else {
      chipZone.style.display = '';
      renderSousCategories(CATEGORIES_DEPENSE_GROUPES[saisieState.groupe].items);
    }
  } else {
    groupZone.style.display = 'none';
    chipZone.style.display = '';
    renderSousCategories(CATEGORIES_REVENU);
  }
}

function renderSousCategories(items) {
  document.getElementById('chip-scroll').innerHTML = items.map(function(c, i) {
    return '<div class="chip ' + (i===0 ? 'active':'') + '" data-cat="' + c + '" onclick="selectChip(this)">' +
      '<div class="chip-stamp">' + iconForCategorie(c) + '</div>' +
      '<div class="chip-label">' + c + '</div>' +
    '</div>';
  }).join('');
  saisieState.categorie = items[0] || '';
}

function selectGroupe(el) {
  document.querySelectorAll('#group-scroll .chip').forEach(function(c) { c.classList.remove('active'); });
  el.classList.add('active');
  saisieState.groupe = el.getAttribute('data-groupe');
  renderGroupesOuCategories();
}

function selectChip(el) {
  document.querySelectorAll('#chip-scroll .chip').forEach(function(c) { c.classList.remove('active'); });
  el.classList.add('active');
  saisieState.categorie = el.getAttribute('data-cat');
}

const EMOJI_CATEGORIES = {
  'salaire adrien': '💶',
  'salaire selma': '💶',
  'revenus assentis': '💼',
  'cpam': '⚕️',
  'caf': '👶',
  'ventes vinted / leboncoin': '🛍️',
  'remboursement prêt étudiant': '🎓',
  'cadeaux': '🎁',
  'tickets restaurant': '🍽️',
  'cheques CESU': '🍽️',
  'autres revenus': '💰',
  'charges de copropriété': '🏢',
  'electricité': '💡',
  'gaz': '🔥',
  'mensualité prêt immobilier': '🏠',
  'assurance prêt': '🛡️',
  'assurance habitation': '🏚️',
  'taxe foncière': '🏛️',
  'autres (logement)': '🏠',
  'carburant': '⛽',
  'train / avion / bus / taxi': '🚆',
  'péage': '🛣️',
  'stationnement': '🅿️',
  'contraventions': '🚨',
  'transports en commun': '🚌',
  'entretien, réparations': '🔧',
  'autres (transport)': '🚕',
  'impôt sur le revenu': '🧾',
  'don asf/mcf pour écoles': '🎗️',
  'prévoyance': '🛟',
  'frais bancaires': '🏦',
  'assurance et crm assentis': '📇',
  'forfait téléphone adrien': '📱',
  'forfait téléphone selma': '📱',
  'crèche': '🍼',
  'sport (salle, club…)': '🏋️',
  'denier du culte / paroisse': '⛪',
  'cotisations assos / organisations politiques': '🗳️',
  'courses alimentaires': '🛒',
  'fruits et légumes': '🥦',
  'viande / oeufs': '🥩',
  'fromage et produits laitiers': '🧀',
  'épicerie (pâtes, riz, pizzas, conserves)': '🥫',
  'alcool': '🍷',
  'boissons': '🥤',
  'sucré': '🍬',
  'apéritif': '🍿',
  'nourriture bébé (lait, petits pots)': '🍼',
  'couches bébé': '🧷',
  'equipement/habits bébé': '👶',
  'vêtements / chaussures': '👟',
  'coiffeur': '💇',
  'equipement maison / fourniture / déco / etc.': '🛋️',
  'hygiène, beauté, pq': '🧴',
  'produits entretien, etc.': '🧽',
  'bricolage /travaux': '🛠️',
  'médecin': '🩺',
  'pharmacie': '💊',
  'hôpital': '🏥',
  'dentiste / lunettes / spécialistes': '🦷',
  'kiné / ostéo': '💆',
  'autres divers (santé)': '⚕️',
  'remboursement mutuelle': '🩹',
  'livres': '📚',
  'bar': '🍸',
  'restaurant': '🍽️',
  'spectacles / concerts / sorties': '🎭',
  'trajets': '🚗',
  'hébergement': '🏨',
  'activités / loisirs': '🎨',
  'anniversaires / noël': '🎂',
  'mariages / évènements / invitations': '💍',
  'autres divers': '🔹',
  'administratif (cni, courrier, fournitures, etc.)': '🗂️'
};

function normalizeCat_(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const CATEGORIES_DEPENSE_GROUPES = {
  'Logement': { icon:'🏠', items:['Charges de copropriété','Electricité','Gaz','Mensualité prêt immobilier','Assurance prêt','Assurance habitation','Autres (Logement)','Bricolage / Travaux','Taxe foncière'] },
  'Transport': { icon:'🚗', items:['Carburant','Train / avion / bus / taxi','Péage','Stationnement','Contraventions','Transports en commun','Entretien, réparations','Autres (Transport)'] },
  'Impôts': { icon:'🧾', items:['Impôt sur le revenu','Don ASF/MCF pour écoles'] },
  'Abonnements & cotisations': { icon:'🔁', items:['Prévoyance','Frais bancaires','Assurance et CRM ASSENTIS','Forfait téléphone Adrien','Forfait téléphone Selma','Sport (salle, club…)','Cotisations assos / organisations politiques','Denier du culte / paroisse'] },
  'Alimentation': { icon:'🛒', items:['Courses alimentaires','Fruits et légumes','Viande / oeufs','Fromage et produits laitiers','Épicerie (pâtes, riz, pizzas, conserves)','Alcool','Boissons','Sucré','Apéritif'] },
  'Enfants': { icon:'👶', items:['Crèche','Nourriture bébé (lait, petits pots)','Couches bébé','Equipement/habits bébé'] },
  'Santé': { icon:'⚕️', items:['Médecin','Pharmacie','Hôpital','Dentiste / lunettes / spécialistes','Kiné / Ostéo','Autres divers (Santé)','Remboursement Mutuelle'] },
  'Vie quotidienne': { icon:'🧴', items:['Vêtements / chaussures','Coiffeur','Equipement maison / fourniture / déco / etc.','Hygiène, beauté, PQ','Produits entretien, etc.','Autres divers'] },
  'Loisirs & sorties': { icon:'🎭', items:['Livres','Bar','Restaurant','Spectacles / Concerts / Sorties'] },
  'Vacances & voyages': { icon:'✈️', items:['Trajets','Hébergement','Activités / loisirs'] },
  'Cadeaux': { icon:'🎁', items:['Anniversaires / Noël','Mariages / évènements / invitations'] },
  'Administratif': { icon:'🗂️', items:['Administratif (CNI, courrier, fournitures, etc.)'] }
};

const CATEGORIES_REVENU = [
  'Salaire Adrien','Salaire Selma','Revenus ASSENTIS','CPAM','CAF',
  'Ventes Vinted / Leboncoin','Remboursement prêt étudiant','Cadeaux',
  'Tickets restaurant','Cheques CESU','Autres revenus'
];

function iconForCategorie(cat) {
  return EMOJI_CATEGORIES[normalizeCat_(cat)] || '➕';
}

function soumettreTransaction() {
  const montant = document.getElementById('input-montant').value;
  const date = document.getElementById('input-date').value;
  const compte = document.getElementById('input-compte').value;
  const note = document.getElementById('input-note').value;

  if (!montant || Number(String(montant).replace(',', '.')) <= 0) {
    alertInline('Indique un montant valide.');
    return;
  }
  if (!saisieState.categorie) {
    alertInline('Choisis une catégorie.');
    return;
  }

  const btn = document.getElementById('submit-btn');
  const enEdition = !!modeEdition;
  btn.disabled = true;
  btn.textContent = enEdition ? 'Modification...' : 'Enregistrement...';

  const payload = { montant: montant, type: saisieState.type, categorie: saisieState.categorie, compte: compte, note: note, date: date };
  if (enEdition) { payload.row = modeEdition.row; payload.id = modeEdition.id; }

  apiPost(enEdition ? 'modifierTransaction' : 'enregistrerTransaction', payload)
    .then(function(data) {
      render(data);
      if (enEdition) {
        modeEdition = false;
        navTo('screen-historique', document.querySelector('[data-screen="screen-historique"]'));
        chargerHistorique(true);
      } else {
        navTo('screen-comptes', document.querySelector('[data-screen="screen-comptes"]'));
      }
      playStamp();
      resetSaisieForm();
      btn.disabled = false;
      btn.textContent = "Enregistrer l'écriture";
    })
    .catch(function(err) {
      alertInline('Erreur : ' + err.message);
      btn.disabled = false;
      btn.textContent = enEdition ? "Modifier l'écriture" : "Enregistrer l'écriture";
    });
}

function resetSaisieForm() {
  document.getElementById('input-montant').value = '';
  document.getElementById('input-note').value = '';
  document.getElementById('input-date').valueAsDate = new Date();
}

function playStamp() {
  const ov = document.getElementById('stampOverlay');
  ov.classList.add('show');
  setTimeout(function() { ov.classList.remove('show'); }, 1100);
}

function alertInline(msg) {
  const tag = document.getElementById('loading-tag');
  const original = tag.textContent;
  tag.textContent = '⚠ ' + msg;
  setTimeout(function() { tag.textContent = original; }, 2500);
}

// ============================================================
// FEUILLE DE ROUTE (Objectifs)
// ============================================================
function renderRoadmap(items) {
  const groups = { PASSÉE: [], PROCHAINEMENT: [], FUTUR: [] };
  items.forEach(function(it) {
    if (!groups[it.statut]) groups[it.statut] = [];
    groups[it.statut].push(it);
  });
  const labels = { PASSÉE: 'Passées', PROCHAINEMENT: 'Prochainement', FUTUR: 'Futur' };

  let html = '';
  ['PASSÉE', 'PROCHAINEMENT', 'FUTUR'].forEach(function(key) {
    html += '<div class="section-title">' + labels[key] + '</div>';
    if (!groups[key].length) {
      html += '<div class="roadmap-empty">Aucun élément</div>';
    } else {
      groups[key].forEach(function(it) {
        html += '<div class="roadmap-item">' +
            '<input class="roadmap-input" type="text" value="' + escapeHtml_(it.texte) + '"' +
              ' data-row="' + it.row + '"' +
              ' onblur="saveRoadmapItem(this)"' +
              ' onkeydown="if(event.key===\'Enter\'){this.blur();}">' +
            '<select class="roadmap-select" data-row="' + it.row + '" onchange="saveRoadmapItem(this)">' +
              '<option value="PASSÉE" ' + (key==='PASSÉE'?'selected':'') + '>Passée</option>' +
              '<option value="PROCHAINEMENT" ' + (key==='PROCHAINEMENT'?'selected':'') + '>Prochainement</option>' +
              '<option value="FUTUR" ' + (key==='FUTUR'?'selected':'') + '>Futur</option>' +
            '</select>' +
            '<button class="roadmap-delete" data-row="' + it.row + '" data-confirm="0" onclick="deleteRoadmapItemUI(this)" title="Supprimer">✕</button>' +
          '</div>';
      });
    }
  });

  html += '<div class="section-title">Ajouter un élément</div>' +
    '<div class="roadmap-add-row">' +
      '<input class="roadmap-add-input" type="text" id="new-roadmap-texte" placeholder="Nouvelle ligne...">' +
      '<button class="roadmap-add-btn" onclick="addRoadmapItemUI()">Ajouter</button>' +
    '</div>';

  document.getElementById('roadmap-container').innerHTML = html;
}

function deleteRoadmapItemUI(btn) {
  if (btn.getAttribute('data-confirm') !== '1') {
    btn.setAttribute('data-confirm', '1');
    btn.textContent = '✓?';
    btn.style.color = 'var(--coral)';
    setTimeout(function() {
      if (btn.isConnected) {
        btn.setAttribute('data-confirm', '0');
        btn.textContent = '✕';
        btn.style.color = '';
      }
    }, 2500);
    return;
  }
  const row = btn.getAttribute('data-row');
  apiPost('deleteRoadmapItem', { row: row })
    .then(function(data) { render(data); })
    .catch(function(err) { alertInline('Erreur : ' + err.message); });
}

function addRoadmapItemUI() {
  const texte = document.getElementById('new-roadmap-texte').value.trim();
  if (!texte) return;
  apiPost('addRoadmapItem', { texte: texte, statut: 'FUTUR' })
    .then(function(data) { render(data); playStamp(); })
    .catch(function(err) { alertInline('Erreur : ' + err.message); });
}

function escapeHtml_(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function saveRoadmapItem(el) {
  const container = el.closest('.roadmap-item');
  const row = container.querySelector('.roadmap-input').getAttribute('data-row');
  const texte = container.querySelector('.roadmap-input').value.trim();
  const statut = container.querySelector('.roadmap-select').value;
  if (!texte) return;

  apiPost('updateRoadmapItem', { row: row, texte: texte, statut: statut })
    .then(function(data) {
      render(data);
      playStamp();
    })
    .catch(function(err) { alertInline('Erreur : ' + err.message); });
}

// ============================================================
// HISTORIQUE
// ============================================================
function chargerHistorique(reset) {
  if (reset) { historiqueOffset = 0; historiqueItems = []; }
  apiGet('getTransactions', { offset: historiqueOffset, limit: HISTORIQUE_LOT })
    .then(function(data) {
      historiqueItems = historiqueItems.concat(data.transactions);
      historiqueOffset += data.transactions.length;
      renderHistorique(data.hasMore);
    })
    .catch(onError);
}

function chargerPlusHistorique() { chargerHistorique(false); }

function renderHistorique(hasMore) {
  let html = '';
  historiqueItems.forEach(function(t) {
    const isDep = t.type === 'Dépense';
    const sign = isDep ? '−' : '+';
    const color = isDep ? 'var(--coral)' : 'var(--sage)';
    html += '<div class="account-row" style="cursor:pointer" onclick="ouvrirEditionTransaction(\'' + t.row + '\')">' +
        '<div class="acc-left"><div class="acc-icon">' + (isDep ? '💸' : '💶') + '</div>' +
          '<div><div class="acc-name">' + t.categorie + '</div><div class="acc-sub">' + t.date + (t.note ? ' · ' + t.note : '') + '</div></div></div>' +
        '<div class="acc-amount" style="color:' + color + '">' + sign + fmtEUR(t.montant).replace('−','').replace('+','') + '</div>' +
      '</div>';
  });
  document.getElementById('historique-container').innerHTML = html || '<div class="roadmap-empty">Aucune transaction</div>';
  document.getElementById('historique-charger-plus').style.display = hasMore ? '' : 'none';
}

function ouvrirEditionTransaction(row) {
  const t = historiqueItems.find(function(x) { return String(x.row) === String(row); });
  if (!t) return;
  modeEdition = { row: t.row, id: t.id };

  setType(t.type);
  if (t.type === 'Dépense') {
    const groupe = Object.keys(CATEGORIES_DEPENSE_GROUPES).find(function(g) {
      return CATEGORIES_DEPENSE_GROUPES[g].items.some(function(i) { return i.toLowerCase() === t.categorie.toLowerCase(); });
    });
    if (groupe) {
      saisieState.groupe = groupe;
      renderGroupesOuCategories();
      document.querySelectorAll('#group-scroll .chip').forEach(function(c) {
        c.classList.toggle('active', c.getAttribute('data-groupe') === groupe);
      });
    }
  }
  saisieState.categorie = t.categorie;
  document.querySelectorAll('#chip-scroll .chip').forEach(function(c) {
    c.classList.toggle('active', c.getAttribute('data-cat') === t.categorie);
  });

  document.getElementById('input-montant').value = String(t.montant).replace('.', ',');
  document.getElementById('input-date').value = t.dateISO || '';
  document.getElementById('input-compte').value = t.compte;
  document.getElementById('input-note').value = t.note || '';

  document.getElementById('submit-btn').textContent = "Modifier l'écriture";
  navTo('screen-saisie', null);
}

// ============================================================
// BUDGET
// ============================================================
function chargerBudget() {
  apiGet('getBudgetParGroupe').then(renderBudget).catch(onError);
}

function renderBudget(data) {
  let html = '<div class="section-title" style="padding-top:6px">' + data.moisLabels.join(' · ') + ' — ' + data.moyenneLabel + '</div>';
  data.groupes.forEach(function(g, idx) {
    const dernierMois = g.mois[g.mois.length - 1] || 0;
    html += '<div class="alloc-row" style="cursor:pointer" onclick="toggleBudgetGroupe(' + idx + ')">' +
        '<div class="alloc-top">' +
          '<div class="alloc-name">' + g.nom + '</div>' +
          '<div class="alloc-values"><div class="alloc-amount">' + fmtEUR(dernierMois) + '</div></div>' +
        '</div>' +
        '<div style="font-family:\'IBM Plex Mono\',monospace; font-size:10.5px; color:var(--paper-dim);">' +
          g.mois.map(function(m, i) { return (data.moisLabels[i] || '') + ' : ' + fmtEUR(m); }).join(' · ') + ' · Moy : ' + fmtEUR(g.moyenne) +
        '</div>' +
      '</div>' +
      '<div class="accounts" id="budget-detail-' + idx + '" style="display:none; padding-left:12px;">' +
        (g.detail.map(function(d) {
          return '<div class="account-row">' +
            '<div class="acc-left"><div>' +
              '<div class="acc-name" style="font-size:12.5px">' + d.nom + '</div>' +
              '<div class="acc-sub">' + d.mois.map(function(m, i) { return (data.moisLabels[i] || '') + ': ' + fmtEUR(m); }).join(' · ') + ' · Moy : ' + fmtEUR(d.moyenne) + '</div>' +
            '</div></div>' +
          '</div>';
        }).join('') || '<div class="roadmap-empty">Aucun détail</div>') +
      '</div>';
  });
  document.getElementById('budget-container').innerHTML = html;
}

function toggleBudgetGroupe(idx) {
  const el = document.getElementById('budget-detail-' + idx);
  el.style.display = (el.style.display === 'none') ? '' : 'none';
}
