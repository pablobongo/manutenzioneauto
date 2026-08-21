/**
 * app.js — Logica applicativa AutoRigon (Fase 2B).
 * Collega index.html (statico, Fase 2) a db.js (Fase 1). Vanilla JS, nessuna
 * dipendenza esterna, nessuna chiamata fetch/rete in nessun punto.
 * Ogni accesso ai dati passa esclusivamente da DB.* (mai IndexedDB diretto).
 */

/**
 * Stato globale dell'applicazione (forma fissata dalle specifiche di Fase 2B).
 * Altri stati di lavoro (veicolo in editing, selezioni statistiche, ecc.)
 * sono tenuti in variabili di modulo separate per non alterare questa forma.
 */
const AppState = {
  veicoliAttivi: [],
  veicoliArchiviati: [],
  vistaCorrente: 'home',
  veicoloSelezionatoId: null,
  menuContestualeApertoPer: null,
  backupInCorso: false
};

const VERSIONE_APP = '1.0.0';

/** Veicolo attualmente aperto nella vista dettaglio/form (nuovo o esistente). */
let veicoloCorrente = null;

/** true se il form dettaglio ha modifiche non ancora salvate (input dell'utente dall'ultimo salvataggio). */
let formSporco = false;

/**
 * Id delle sezioni scheda veicolo attualmente collassate. Si azzera ogni volta che si
 * apre una scheda (nuova o esistente) — quindi non persiste tra ricariche della pagina —
 * ma resta valido tra un salvataggio e l'altro nella stessa sessione di editing, così
 * collassare una sezione non la fa "riaprire" ad ogni singolo salvataggio di un'altra.
 */
let sezioniCollassate = new Set();

/** Stato selezione/filtri della vista Statistiche (non fa parte di AppState). */
let statisticheInizializzate = false;
let statisticheVeicoliTutti = [];
let statisticheSelezionate = new Set();

/* ==========================================================
   UTILITÀ GENERICHE
   ========================================================== */

/** Genera un id univoco con prefisso leggibile. */
function generaId(prefisso) {
  return `${prefisso}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Escapa una stringa per uso sicuro dentro innerHTML/attributi. */
function escapeHtml(valore) {
  return String(valore == null ? '' : valore).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Valida un valore numerico da input; vuoto è ammesso salvo diversa richiesta. */
function validaNumero(valore, opzioni) {
  const { consentiVuoto = true, min = 0 } = opzioni || {};
  if (valore === '' || valore === null || valore === undefined) {
    return { valido: consentiVuoto, numero: null };
  }
  const n = Number(valore);
  if (!Number.isFinite(n) || n < min) {
    return { valido: false, numero: null };
  }
  return { valido: true, numero: n };
}

/** Formatta una data ISO "YYYY-MM-DD" in "GG/MM/AAAA"; ritorna un trattino se assente. */
function formattaData(iso) {
  if (!iso) return '—';
  const parti = String(iso).split('-');
  if (parti.length !== 3) return iso;
  return `${parti[2]}/${parti[1]}/${parti[0]}`;
}

/** Come formattaData, ma per popolare il value di un input testo (stringa vuota se assente). */
function formattaDataPerInput(iso) {
  if (!iso) return '';
  const parti = String(iso).split('-');
  if (parti.length !== 3) return '';
  return `${parti[2]}/${parti[1]}/${parti[0]}`;
}

/**
 * Valida una data digitata in formato "GG/MM/AAAA" (input testo libero, non date picker
 * nativo — vedi Modifica 2) e la converte in ISO "AAAA-MM-GG" per lo storage, coerente
 * con il formato già usato in tutto il resto del progetto (storicoKm, bollo.scadenza, ecc.).
 * Vuoto è ammesso salvo diversa richiesta; controlla anche la validità reale del giorno
 * nel mese indicato (es. rifiuta 31/04/2026).
 */
function validaData(testo, opzioni) {
  const { consentiVuoto = true } = opzioni || {};
  const valore = (testo || '').trim();
  if (valore === '') {
    return { valido: consentiVuoto, iso: null };
  }
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valore);
  if (!match) return { valido: false, iso: null };
  const giorno = parseInt(match[1], 10);
  const mese = parseInt(match[2], 10);
  const anno = parseInt(match[3], 10);
  if (mese < 1 || mese > 12) return { valido: false, iso: null };
  const giorniNelMese = new Date(anno, mese, 0).getDate();
  if (giorno < 1 || giorno > giorniNelMese) return { valido: false, iso: null };
  const iso = `${String(anno).padStart(4, '0')}-${String(mese).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
  return { valido: true, iso };
}

/** Formatta un numero con separatore delle migliaia in stile italiano. */
function formattaNumero(n) {
  return (Number(n) || 0).toLocaleString('it-IT');
}

/** Formatta un importo in euro. */
function formattaValuta(n) {
  return '€ ' + (Number(n) || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

/** Converte un oggetto Date in stringa "YYYY-MM-DD" per input[type=date]. */
function formattaDataInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Legge un valore annidato tramite percorso puntato ("a.b.c"). */
function getDeep(obj, percorso) {
  return percorso.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

/** Imposta un valore annidato tramite percorso puntato, creando gli oggetti mancanti. */
function setDeep(obj, percorso, valore) {
  const parti = percorso.split('.');
  let cur = obj;
  for (let i = 0; i < parti.length - 1; i++) {
    if (typeof cur[parti[i]] !== 'object' || cur[parti[i]] === null) cur[parti[i]] = {};
    cur = cur[parti[i]];
  }
  cur[parti[parti.length - 1]] = valore;
}

/** Mostra/nasconde lo stato di errore inline su un campo (wrapper .campo-form). */
function impostaErroreCampo(inputEl, mostra) {
  const wrapper = inputEl.closest('.campo-form');
  if (!wrapper) return;
  wrapper.classList.toggle('con-errore', mostra);
  const err = wrapper.querySelector('.errore-campo');
  if (err) err.classList.toggle('visibile', mostra);
}

/** Rimuove tutti gli stati di errore inline all'interno di un contenitore. */
function pulisciErroriForm(container) {
  container.querySelectorAll('.campo-form').forEach((w) => {
    w.classList.remove('con-errore');
    const err = w.querySelector('.errore-campo');
    if (err) err.classList.remove('visibile');
  });
}

/**
 * Legge tutti i campi con [data-campo] dentro un contenitore e li applica a target.
 * I campi in un wrapper con [data-campo-numerico] vengono validati come numero, quelli
 * con [data-campo-data] come data "GG/MM/AAAA" (convertita in ISO per lo storage):
 * se non validi, quel singolo campo viene saltato (mostrando l'errore inline)
 * senza bloccare il salvataggio degli altri campi della sezione.
 * @returns {boolean} true se almeno un campo non era valido.
 */
function applicaCampiSezione(container, target) {
  let ciSonoErrori = false;
  container.querySelectorAll('[data-campo]').forEach((input) => {
    const percorso = input.dataset.campo;
    const wrapper = input.closest('.campo-form');
    if (wrapper) {
      wrapper.classList.remove('con-errore');
      const err = wrapper.querySelector('.errore-campo');
      if (err) err.classList.remove('visibile');
    }

    if (wrapper && wrapper.hasAttribute('data-campo-numerico')) {
      const { valido, numero } = validaNumero(input.value);
      if (!valido) {
        ciSonoErrori = true;
        wrapper.classList.add('con-errore');
        const err = wrapper.querySelector('.errore-campo');
        if (err) err.classList.add('visibile');
        return;
      }
      setDeep(target, percorso, numero);
    } else if (wrapper && wrapper.hasAttribute('data-campo-data')) {
      const { valido, iso } = validaData(input.value);
      if (!valido) {
        ciSonoErrori = true;
        wrapper.classList.add('con-errore');
        const err = wrapper.querySelector('.errore-campo');
        if (err) err.classList.add('visibile');
        return;
      }
      setDeep(target, percorso, iso);
    } else if (input.type === 'checkbox') {
      setDeep(target, percorso, input.checked);
    } else {
      setDeep(target, percorso, input.value);
    }
  });
  return ciSonoErrori;
}

/** Mostra un messaggio di conferma nativo prima di un'azione distruttiva. */
function confermaAzione(messaggio) {
  return window.confirm(messaggio);
}

/** Mostra un toast di feedback visivo (mai solo console.error). Gli errori restano visibili più a lungo. */
function mostraToast(messaggio, tipo) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${tipo || 'info'}`;
  el.textContent = messaggio;
  container.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'errore' ? 6000 : 3200);
}

/* ==========================================================
   STRUTTURA VEICOLO
   ========================================================== */

/**
 * Crea un nuovo oggetto veicolo vuoto, con array/oggetti annidati inizializzati.
 * Include "ruote" (Fase 2) e "rifornimenti" (deviazione dichiarata, Sezione 5.12).
 */
function creaVeicoloVuoto() {
  return {
    id: 'veicolo_' + Date.now(),
    stato: 'attivo',
    nomeScheda: '', marca: '', modello: '', allestimento: '', colore: '',
    cilindrata: null, potenza: null, targa: '', numeroTelaio: '', annoPrimaImmatricolazione: null,
    kmAcquisto: null, kmAttuale: null, dataKmAttuale: null, storicoKm: [],
    storicoProprietariPrecedenti: [],
    proprietarioAttuale: { nome: '', annoImmatricolazione: null },
    bollo: { scadenza: null, costo: null },
    assicurazione: { costo: null, scadenza: null, rinnovoMensile: false },
    ruote: [],
    libretto: { fotoId: null }, bollettaBollo: { fotoId: null },
    manutenzioni: [], foto: [], note: '',
    rifornimenti: []
  };
}

/** Garantisce che un veicolo letto dal DB abbia tutti i campi/array attesi (retro-compatibilità). */
function normalizzaVeicolo(v) {
  if (typeof v.numeroTelaio !== 'string') v.numeroTelaio = '';
  v.storicoKm = v.storicoKm || [];
  v.storicoProprietariPrecedenti = v.storicoProprietariPrecedenti || [];
  v.proprietarioAttuale = v.proprietarioAttuale || { nome: '', annoImmatricolazione: null };
  v.bollo = v.bollo || { scadenza: null, costo: null };
  v.assicurazione = v.assicurazione || { costo: null, scadenza: null, rinnovoMensile: false };
  v.ruote = v.ruote || [];
  v.libretto = v.libretto || { fotoId: null };
  v.bollettaBollo = v.bollettaBollo || { fotoId: null };
  v.manutenzioni = v.manutenzioni || [];
  v.foto = v.foto || [];
  v.rifornimenti = v.rifornimenti || [];
  if (typeof v.note !== 'string') v.note = '';
  return v;
}

/** Cerca una foto per id dentro l'array foto[] di un veicolo. */
function trovaFoto(v, id) {
  return (v.foto || []).find((f) => f.id === id) || null;
}

/* ==========================================================
   NAVIGAZIONE / VISTE (5.1, 5.2, 5.4, 5.12, 5.13)
   ========================================================== */

/** Durata dello splash screen prima di passare automaticamente alla Home (ms). */
const DURATA_SPLASH_MS = 5000;

/** Avvia l'app: apre il DB, mostra Home dopo lo splash o un errore se init fallisce. */
function avviaApp() {
  DB.init().then(() => {
    setTimeout(() => {
      const splash = document.querySelector('.splash');
      if (splash) splash.hidden = true;
      mostraVista('home');
    }, DURATA_SPLASH_MS);
  }).catch((err) => {
    const splash = document.querySelector('.splash');
    if (splash) {
      splash.innerHTML = `<div style="text-align:center; padding:24px; color:#0A0A0A;">
        <p style="font-size:1.1rem; font-weight:800; margin-bottom:8px;">Errore di avvio</p>
        <p style="font-size:0.85rem; font-weight:600;">${escapeHtml(err && err.message ? err.message : 'Impossibile aprire il database locale.')}</p>
      </div>`;
    }
  });
}

/** Cambia vista corrente, aggiorna footer/nav e ricarica i dati necessari. */
function mostraVista(nome) {
  document.querySelectorAll('[data-vista]').forEach((sec) => {
    sec.hidden = sec.dataset.vista !== nome;
  });
  AppState.vistaCorrente = nome;
  document.querySelectorAll('.footer-nav a[data-vista-link]').forEach((a) => {
    a.classList.toggle('attivo', a.dataset.vistaLink === nome);
  });
  window.scrollTo(0, 0);

  if (nome === 'home') caricaHome();
  else if (nome === 'archivio') caricaArchivio();
  else if (nome === 'statistiche') avviaStatistiche();
  else if (nome === 'impostazioni') caricaImpostazioni();
}

/** Carica i veicoli attivi, popola AppState e renderizza griglia + banner scadenze. */
function caricaHome() {
  DB.getVeicoli('attivo').then((veicoli) => {
    veicoli.forEach(normalizzaVeicolo);
    AppState.veicoliAttivi = veicoli;
    renderGrigliaVeicoli('griglia-veicoli-home', 'stato-vuoto-home', veicoli, 'home');
    renderBannerScadenze(veicoli);
  }).catch((err) => mostraToast(err.message || 'Errore nel caricamento dei veicoli', 'errore'));
}

/** Carica i veicoli archiviati, popola AppState e renderizza la griglia. */
function caricaArchivio() {
  DB.getVeicoli('archiviato').then((veicoli) => {
    veicoli.forEach(normalizzaVeicolo);
    AppState.veicoliArchiviati = veicoli;
    renderGrigliaVeicoli('griglia-veicoli-archivio', 'stato-vuoto-archivio', veicoli, 'archivio');
  }).catch((err) => mostraToast(err.message || "Errore nel caricamento dell'archivio", 'errore'));
}

/** Legge/inizializza la versione app mostrata in Impostazioni. */
function caricaImpostazioni() {
  const el = document.getElementById('valore-versione-app');
  DB.getImpostazione('versioneApp').then((v) => {
    if (v) { el.textContent = v; return; }
    return DB.setImpostazione('versioneApp', VERSIONE_APP).then(() => { el.textContent = VERSIONE_APP; });
  }).catch(() => { el.textContent = VERSIONE_APP; });
  aggiornaEtichettaUltimoBackup();
}

/** Aggiorna la riga "ultimo backup" in Impostazioni leggendo l'impostazione salvata (Pattern P04). */
function aggiornaEtichettaUltimoBackup() {
  const el = document.getElementById('valore-ultimo-backup');
  if (!el) return;
  DB.getImpostazione('ultimoBackup').then((iso) => {
    if (!iso) { el.textContent = 'Nessun backup ancora effettuato'; return; }
    const data = new Date(iso);
    el.textContent = Number.isNaN(data.getTime())
      ? 'Nessun backup ancora effettuato'
      : `Ultimo backup: ${data.toLocaleDateString('it-IT')} ${data.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
  }).catch(() => { el.textContent = 'Nessun backup ancora effettuato'; });
}

/* ==========================================================
   GRIGLIA VEICOLI + CARD (5.2, 5.3, 5.4)
   ========================================================== */

/** Renderizza una griglia di card veicolo (Home o Archivio) con stato vuoto. */
function renderGrigliaVeicoli(idContenitore, idStatoVuoto, veicoli, contesto) {
  const container = document.getElementById(idContenitore);
  const vuoto = document.getElementById(idStatoVuoto);
  container.innerHTML = '';
  if (!veicoli || veicoli.length === 0) {
    vuoto.hidden = false;
    container.hidden = true;
    return;
  }
  vuoto.hidden = true;
  container.hidden = false;
  veicoli.forEach((v) => container.appendChild(creaCardVeicolo(v, contesto)));
}

/** Crea l'elemento DOM di una card veicolo con foto copertina/placeholder e gesture. */
function creaCardVeicolo(veicolo, contesto) {
  const a = document.createElement('a');
  a.href = '#dettaglio-veicolo';
  a.className = 'veicolo-card';
  a.dataset.id = veicolo.id;

  const fotoBox = document.createElement('div');
  fotoBox.className = 'foto-copertina-placeholder';
  const copertina = (veicolo.foto || []).find((f) => f.copertina);
  if (copertina && copertina.blob) {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(copertina.blob);
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'cover';
    fotoBox.appendChild(img);
  } else {
    fotoBox.innerHTML = '<svg aria-hidden="true"><use href="#icona-auto"></use></svg>';
  }
  a.appendChild(fotoBox);

  const nome = document.createElement('p');
  nome.className = 'nome-scheda';
  nome.textContent = veicolo.nomeScheda || `${veicolo.marca || ''} ${veicolo.modello || ''}`.trim() || 'Senza nome';
  a.appendChild(nome);

  if (contesto === 'home' && calcolaScadenzeVeicolo(veicolo).length > 0) {
    const pallino = document.createElement('span');
    pallino.className = 'pallino-avviso';
    pallino.title = 'Scadenza imminente';
    a.appendChild(pallino);
  }

  abilitaPressioneLunga(
    a,
    () => apriMenuVeicolo(veicolo, contesto),
    () => apriDettaglio(veicolo.id)
  );

  return a;
}

/**
 * Abilita un gesto di pressione lunga (500ms) su un elemento, con fallback mouse
 * per test da desktop. Un click "corto" (senza long-press) esegue onClickBreve.
 */
function abilitaPressioneLunga(elemento, onLongPress, onClickBreve) {
  const DURATA_MS = 500;
  const SOGLIA_MOVIMENTO = 12;
  let timerId = null;
  let scattato = false;
  let startX = 0, startY = 0;

  function avvia(x, y) {
    scattato = false;
    startX = x; startY = y;
    timerId = setTimeout(() => {
      scattato = true;
      onLongPress();
    }, DURATA_MS);
  }
  function annulla() {
    if (timerId) { clearTimeout(timerId); timerId = null; }
  }
  function movimentoEccessivo(x, y) {
    return Math.abs(x - startX) > SOGLIA_MOVIMENTO || Math.abs(y - startY) > SOGLIA_MOVIMENTO;
  }

  elemento.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    avvia(t.clientX, t.clientY);
  }, { passive: true });
  elemento.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (timerId && movimentoEccessivo(t.clientX, t.clientY)) annulla();
  }, { passive: true });
  elemento.addEventListener('touchend', annulla);

  elemento.addEventListener('mousedown', (e) => avvia(e.clientX, e.clientY));
  elemento.addEventListener('mousemove', (e) => {
    if (timerId && movimentoEccessivo(e.clientX, e.clientY)) annulla();
  });
  elemento.addEventListener('mouseup', annulla);
  elemento.addEventListener('mouseleave', annulla);

  elemento.addEventListener('click', (e) => {
    e.preventDefault();
    if (scattato) { scattato = false; return; }
    onClickBreve(e);
  });
}

/* ==========================================================
   MENU CONTESTUALE (5.3, 5.4)
   ========================================================== */

/** Apre il menu contestuale (foglio inferiore) per un veicolo, in base al contesto. */
function apriMenuVeicolo(veicolo, contesto) {
  AppState.menuContestualeApertoPer = veicolo.id;
  const overlay = document.getElementById('overlay-menu-contestuale');
  const foglio = document.getElementById('foglio-menu-contestuale');

  let html = `<p class="titolo-foglio">${escapeHtml(veicolo.nomeScheda || 'Veicolo')}</p>`;
  if (contesto === 'home') {
    html += `
      <button type="button" class="voce-menu" data-menu-azione="archivia">Archivia</button>
      <button type="button" class="voce-menu pericolo" data-menu-azione="elimina">Elimina</button>
      <button type="button" class="voce-menu" data-menu-azione="esporta-pdf">Esporta PDF</button>
    `;
  } else {
    html += `
      <button type="button" class="voce-menu" data-menu-azione="riabilita">Riabilita</button>
      <button type="button" class="voce-menu pericolo" data-menu-azione="elimina-definitivo">Elimina definitivamente</button>
      <button type="button" class="voce-menu" data-menu-azione="esporta-pdf">Esporta PDF</button>
    `;
  }
  foglio.innerHTML = html;
  overlay.hidden = false;

  foglio.querySelectorAll('button[data-menu-azione]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const azione = btn.dataset.menuAzione;
      chiudiMenuContestuale();
      eseguiAzioneMenuVeicolo(azione, veicolo);
    });
  });
}

/** Chiude il menu contestuale corrente. */
function chiudiMenuContestuale() {
  AppState.menuContestualeApertoPer = null;
  document.getElementById('overlay-menu-contestuale').hidden = true;
  document.getElementById('foglio-menu-contestuale').innerHTML = '';
}

/** Esegue l'azione scelta dal menu contestuale di un veicolo (Home o Archivio). */
function eseguiAzioneMenuVeicolo(azione, veicolo) {
  const nome = veicolo.nomeScheda || 'questo veicolo';
  if (azione === 'archivia') {
    DB.cambiaStato(veicolo.id, 'archiviato')
      .then(() => { mostraToast('Veicolo archiviato', 'successo'); caricaHome(); })
      .catch((err) => mostraToast(err.message || "Errore durante l'archiviazione", 'errore'));
  } else if (azione === 'elimina') {
    if (!confermaAzione(`Eliminare definitivamente "${nome}"? L'operazione non è reversibile.`)) return;
    DB.eliminaVeicolo(veicolo.id)
      .then(() => { mostraToast('Veicolo eliminato', 'successo'); caricaHome(); })
      .catch((err) => mostraToast(err.message || "Errore durante l'eliminazione", 'errore'));
  } else if (azione === 'riabilita') {
    DB.cambiaStato(veicolo.id, 'attivo')
      .then(() => { mostraToast('Veicolo riabilitato', 'successo'); caricaArchivio(); })
      .catch((err) => mostraToast(err.message || 'Errore durante la riabilitazione', 'errore'));
  } else if (azione === 'elimina-definitivo') {
    if (!confermaAzione(`Eliminare definitivamente "${nome}"? L'operazione non è reversibile.`)) return;
    DB.eliminaVeicolo(veicolo.id)
      .then(() => { mostraToast('Veicolo eliminato definitivamente', 'successo'); caricaArchivio(); })
      .catch((err) => mostraToast(err.message || "Errore durante l'eliminazione", 'errore'));
  } else if (azione === 'esporta-pdf') {
    esportaPdfVeicolo(veicolo.id);
  }
}

/* ==========================================================
   AVVISO SCADENZE (5.13 / decisione A6)
   ========================================================== */

/** Calcola le scadenze (bollo/assicurazione) entro 30 giorni o già scadute per un veicolo. */
function calcolaScadenzeVeicolo(v) {
  const risultati = [];
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  const voci = [
    ['Bollo', v.bollo && v.bollo.scadenza],
    ['Assicurazione', v.assicurazione && v.assicurazione.scadenza]
  ];
  voci.forEach(([etichetta, scadenzaStr]) => {
    if (!scadenzaStr) return;
    const scad = new Date(scadenzaStr + 'T00:00:00');
    if (Number.isNaN(scad.getTime())) return;
    const giorni = Math.round((scad - oggi) / 86400000);
    if (giorni <= 30) risultati.push({ tipo: etichetta, scadenza: scadenzaStr, giorni });
  });
  return risultati;
}

/** Aggrega le scadenze imminenti/scadute di un elenco di veicoli, ordinate per urgenza. */
function calcolaScadenzeImminenti(veicoli) {
  const elenco = [];
  veicoli.forEach((v) => {
    calcolaScadenzeVeicolo(v).forEach((s) => elenco.push({
      veicoloId: v.id,
      nomeScheda: v.nomeScheda || `${v.marca || ''} ${v.modello || ''}`.trim() || 'Veicolo',
      ...s
    }));
  });
  elenco.sort((a, b) => a.giorni - b.giorni);
  return elenco;
}

/** Renderizza il banner scadenze in cima alla Home (nascosto se non ce ne sono). */
function renderBannerScadenze(veicoli) {
  const elenco = calcolaScadenzeImminenti(veicoli);
  const banner = document.getElementById('banner-scadenze');
  const lista = document.getElementById('lista-scadenze');
  if (elenco.length === 0) { banner.hidden = true; lista.innerHTML = ''; return; }
  lista.innerHTML = elenco.map((s) => {
    const testo = s.giorni < 0 ? `Scaduto da ${Math.abs(s.giorni)} giorni`
      : (s.giorni === 0 ? 'Scade oggi' : `Scade tra ${s.giorni} giorni`);
    return `<li>${escapeHtml(s.nomeScheda)} — ${escapeHtml(s.tipo)}: <span class="giorni-scadenza">${testo}</span></li>`;
  }).join('');
  banner.hidden = false;
}

/* ==========================================================
   DETTAGLIO / FORM VEICOLO (5.5, 5.6, 5.7, 5.8, nuova Ruote)
   ========================================================== */

/** Apre la vista dettaglio: id nullo per un veicolo nuovo, altrimenti carica dal DB. */
function apriDettaglio(id) {
  AppState.veicoloSelezionatoId = id;
  if (id === null) {
    veicoloCorrente = creaVeicoloVuoto();
    formSporco = false;
    sezioniCollassate = new Set();
    mostraVista('dettaglioVeicolo');
    renderDettaglioVeicolo();
    return;
  }
  DB.getVeicolo(id).then((v) => {
    if (!v) { mostraToast('Veicolo non trovato', 'errore'); mostraVista('home'); return; }
    veicoloCorrente = normalizzaVeicolo(v);
    formSporco = false;
    sezioniCollassate = new Set();
    mostraVista('dettaglioVeicolo');
    renderDettaglioVeicolo();
  }).catch((err) => mostraToast(err.message || 'Errore nel caricamento del veicolo', 'errore'));
}

/**
 * Salva l'intero veicoloCorrente tramite DB.salvaVeicolo, con feedback visivo.
 * @param {string} messaggioSuccesso - Testo del toast mostrato al salvataggio riuscito.
 * @param {Function} [onErrore] - Callback opzionale invocata (con l'errore) se il salvataggio
 *   fallisce — usata per annullare in memoria una modifica ottimistica già renderizzata
 *   (es. una foto aggiunta alla galleria) così la UI non mostra come "salvato" qualcosa
 *   che in realtà non è stato persistito (vedi bug upload foto, Fase 6).
 */
function persistiVeicoloCorrente(messaggioSuccesso, onErrore) {
  DB.salvaVeicolo(veicoloCorrente).then(() => {
    AppState.veicoloSelezionatoId = veicoloCorrente.id;
    formSporco = false;
    mostraToast(messaggioSuccesso, 'successo');
    aggiornaTestataDettaglio();
  }).catch((err) => {
    mostraToast(err.message || 'Errore durante il salvataggio', 'errore');
    if (typeof onErrore === 'function') onErrore(err);
  });
}

/**
 * Genera l'involucro standard di una sezione scheda veicolo: header centrato con
 * titolo e freccia collassa/espandi, più il corpo con il contenuto fornito. Lo stato
 * aperto/chiuso non persiste tra ricariche della pagina (si azzera ad ogni apertura
 * veicolo, vedi apriDettaglio), solo entro la stessa sessione di editing.
 * @param {string} idSezione - Identificativo stabile della sezione (es. "anagrafica").
 * @param {string} classeColore - Classe CSS colore bordo/sfondo (es. "sec-anagrafica").
 * @param {string} titolo - Titolo visibile della sezione.
 * @param {string} contenutoHtml - Markup del corpo della sezione.
 * @param {string} [idCorpo] - Id opzionale da assegnare al div del corpo (per applicaCampiSezione).
 */
function involucroSezione(idSezione, classeColore, titolo, contenutoHtml, idCorpo) {
  const collassata = sezioniCollassate.has(idSezione);
  return `
    <article class="sezione-scheda ${classeColore}${collassata ? ' collassata' : ''}" data-sezione-id="${idSezione}">
      <h3 data-azione="toggla-sezione" data-sezione-id="${idSezione}" aria-expanded="${collassata ? 'false' : 'true'}">
        <span class="titolo-testo-sezione">${escapeHtml(titolo)}</span>
        <span class="btn-collassa" aria-hidden="true"><svg class="icona-chevron"><use href="#icona-chevron"></use></svg></span>
      </h3>
      <div class="corpo-sezione"${idCorpo ? ` id="${idCorpo}"` : ''}>
        ${contenutoHtml}
      </div>
    </article>
  `;
}

/** Ri-renderizza il form dettaglio mantenendo la posizione di scorrimento. */
function reRenderDettaglioPreservandoScroll() {
  const y = window.scrollY;
  renderDettaglioVeicolo();
  window.scrollTo(0, y);
}

/** Aggiorna titolo e sottotitolo della vista dettaglio in base ai dati correnti. */
function aggiornaTestataDettaglio() {
  const v = veicoloCorrente;
  document.getElementById('dettaglio-titolo').textContent =
    v.nomeScheda || ((v.marca || v.modello) ? `${v.marca || ''} ${v.modello || ''}`.trim() : 'Nuovo veicolo');
  const parti = [v.marca, v.modello, v.allestimento].filter(Boolean);
  document.getElementById('dettaglio-sottotitolo').textContent = parti.join(' · ');
}

/** Renderizza tutte le sezioni della scheda veicolo dentro #dettaglio-contenuto. */
function renderDettaglioVeicolo() {
  aggiornaTestataDettaglio();
  const cont = document.getElementById('dettaglio-contenuto');
  cont.innerHTML =
    generaHtmlAnagrafica(veicoloCorrente) +
    generaHtmlChilometraggio(veicoloCorrente) +
    generaHtmlProprietari(veicoloCorrente) +
    generaHtmlBolloAssicurazione(veicoloCorrente) +
    generaHtmlRuote(veicoloCorrente) +
    generaHtmlLibretto(veicoloCorrente) +
    generaHtmlBollettaBollo(veicoloCorrente) +
    generaHtmlManutenzioni(veicoloCorrente) +
    generaHtmlRifornimenti(veicoloCorrente) +
    generaHtmlFoto(veicoloCorrente) +
    generaHtmlNote(veicoloCorrente);
  popolaMiniatureFoto(veicoloCorrente);
}

/* ---- Anagrafica ---- */

function generaHtmlAnagrafica(v) {
  const contenuto = `
      <div class="campo-form">
        <label for="campo-nome-scheda">Nome scheda</label>
        <input type="text" id="campo-nome-scheda" data-campo="nomeScheda" value="${escapeHtml(v.nomeScheda)}" placeholder="Es. Panda 4x4">
      </div>
      <div class="riga-doppia-colonna">
        <div class="campo-form">
          <label for="campo-marca">Marca</label>
          <input type="text" id="campo-marca" data-campo="marca" value="${escapeHtml(v.marca)}" placeholder="Fiat">
        </div>
        <div class="campo-form">
          <label for="campo-modello">Modello</label>
          <input type="text" id="campo-modello" data-campo="modello" value="${escapeHtml(v.modello)}" placeholder="Panda">
        </div>
      </div>
      <div class="riga-doppia-colonna">
        <div class="campo-form">
          <label for="campo-allestimento">Allestimento</label>
          <input type="text" id="campo-allestimento" data-campo="allestimento" value="${escapeHtml(v.allestimento)}">
        </div>
        <div class="campo-form">
          <label for="campo-colore">Colore</label>
          <input type="text" id="campo-colore" data-campo="colore" value="${escapeHtml(v.colore)}">
        </div>
      </div>
      <div class="riga-doppia-colonna">
        <div class="campo-form" data-campo-numerico>
          <label for="campo-cilindrata">Cilindrata (cc)</label>
          <input type="number" min="0" id="campo-cilindrata" data-campo="cilindrata" value="${v.cilindrata ?? ''}">
          <span class="errore-campo">Valore non valido</span>
        </div>
        <div class="campo-form" data-campo-numerico>
          <label for="campo-potenza">Potenza (CV)</label>
          <input type="number" min="0" id="campo-potenza" data-campo="potenza" value="${v.potenza ?? ''}">
          <span class="errore-campo">Valore non valido</span>
        </div>
      </div>
      <div class="riga-doppia-colonna">
        <div class="campo-form">
          <label for="campo-targa">Targa</label>
          <input type="text" id="campo-targa" data-campo="targa" value="${escapeHtml(v.targa)}">
        </div>
        <div class="campo-form" data-campo-numerico>
          <label for="campo-anno">Prima immatricolazione (anno)</label>
          <input type="number" min="1900" max="2100" id="campo-anno" data-campo="annoPrimaImmatricolazione" value="${v.annoPrimaImmatricolazione ?? ''}">
          <span class="errore-campo">Anno non valido</span>
        </div>
      </div>
      <div class="campo-form">
        <label for="campo-numero-telaio">Numero di telaio</label>
        <input type="text" id="campo-numero-telaio" data-campo="numeroTelaio" value="${escapeHtml(v.numeroTelaio)}">
      </div>
      <button type="button" class="btn-primario" data-azione="salva-anagrafica">Salva sezione</button>
  `;
  return involucroSezione('anagrafica', 'sec-anagrafica', 'Anagrafica', contenuto, 'fieldset-anagrafica');
}

function salvaSezioneAnagrafica() {
  const errori = applicaCampiSezione(document.getElementById('fieldset-anagrafica'), veicoloCorrente);
  persistiVeicoloCorrente(errori ? 'Sezione salvata (controlla i campi evidenziati)' : 'Anagrafica salvata');
}

/* ---- Chilometraggio + storico km (5.6) ---- */

function generaHtmlChilometraggio(v) {
  const ordinato = v.storicoKm.map((r, i) => Object.assign({}, r, { _idx: i }))
    .sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  const righe = ordinato.map((r) => `
    <div class="riga-storico riga-con-elimina">
      <span class="riga-cliccabile" data-azione="modifica-km" data-indice="${r._idx}" style="flex:1; display:flex; justify-content:space-between; gap:8px;">
        <span class="valore-km">${formattaNumero(r.km)} km</span>
        <span class="data-storico">${formattaData(r.data)}</span>
      </span>
      <button type="button" class="btn-elimina-riga" data-azione="elimina-km" data-indice="${r._idx}" aria-label="Elimina">×</button>
    </div>
  `).join('');

  const contenuto = `
      <div class="riga-doppia-colonna">
        <div class="campo-form" data-campo-numerico>
          <label for="campo-km-attuale">Km attuale</label>
          <input type="number" min="0" id="campo-km-attuale" data-campo="kmAttuale" value="${v.kmAttuale ?? ''}">
          <span class="errore-campo">Km non valido</span>
        </div>
        <div class="campo-form" data-campo-data>
          <label for="campo-data-km-attuale">Aggiornato il</label>
          <input type="text" id="campo-data-km-attuale" data-campo="dataKmAttuale" placeholder="GG/MM/AAAA" value="${formattaDataPerInput(v.dataKmAttuale)}">
          <span class="errore-campo">Formato data non valido (GG/MM/AAAA)</span>
        </div>
      </div>
      <div class="campo-form" data-campo-numerico>
        <label for="campo-km-acquisto">Km all'acquisto</label>
        <input type="number" min="0" id="campo-km-acquisto" data-campo="kmAcquisto" value="${v.kmAcquisto ?? ''}">
        <span class="errore-campo">Km non valido</span>
      </div>
      <button type="button" class="btn-primario" data-azione="salva-km">Salva sezione</button>

      <div class="elenco-storico" id="elenco-storico-km">
        ${righe || '<p class="stato-vuoto" style="padding:10px 0;">Nessuna registrazione km.</p>'}
      </div>
      <button type="button" class="btn-aggiungi-riga" data-azione="mostra-form-km">+ Aggiungi registrazione km</button>
      <div class="form-riga-mini" id="form-mini-km" data-indice-edit="-1" hidden>
        <div class="riga-doppia-colonna">
          <div class="campo-form" data-campo-numerico>
            <label>Km</label>
            <input type="number" min="0" id="km-form-valore">
            <span class="errore-campo">Km non valido</span>
          </div>
          <div class="campo-form">
            <label>Data</label>
            <input type="text" id="km-form-data" placeholder="GG/MM/AAAA">
            <span class="errore-campo">Formato data non valido (GG/MM/AAAA)</span>
          </div>
        </div>
        <div class="riga-azioni-mini">
          <button type="button" class="btn-secondario-piccolo" data-azione="annulla-form-km">Annulla</button>
          <button type="button" class="btn-primario-piccolo" data-azione="salva-riga-km">Salva riga</button>
        </div>
      </div>
  `;
  return involucroSezione('chilometraggio', 'sec-chilometraggio', 'Chilometraggio', contenuto, 'fieldset-km');
}

function salvaSezioneKmSemplice() {
  const errori = applicaCampiSezione(document.getElementById('fieldset-km'), veicoloCorrente);
  persistiVeicoloCorrente(errori ? 'Sezione salvata (controlla i campi evidenziati)' : 'Chilometraggio salvato');
}

function mostraFormKm(indice) {
  const form = document.getElementById('form-mini-km');
  const item = indice >= 0 ? veicoloCorrente.storicoKm[indice] : null;
  form.dataset.indiceEdit = String(indice);
  document.getElementById('km-form-valore').value = item ? item.km : '';
  document.getElementById('km-form-data').value = item ? formattaDataPerInput(item.data) : '';
  pulisciErroriForm(form);
  form.hidden = false;
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function salvaRigaKm() {
  const form = document.getElementById('form-mini-km');
  const campoValore = document.getElementById('km-form-valore');
  const campoData = document.getElementById('km-form-data');
  pulisciErroriForm(form);
  const { valido, numero } = validaNumero(campoValore.value, { consentiVuoto: false });
  if (!valido) { impostaErroreCampo(campoValore, true); mostraToast('Inserisci un valore km valido', 'errore'); return; }
  const { valido: dataValida, iso } = validaData(campoData.value);
  if (!dataValida) { impostaErroreCampo(campoData, true); mostraToast('Formato data non valido (GG/MM/AAAA)', 'errore'); return; }

  const indice = parseInt(form.dataset.indiceEdit, 10);
  const riga = { km: numero, data: iso };
  if (indice >= 0) veicoloCorrente.storicoKm[indice] = riga;
  else veicoloCorrente.storicoKm.push(riga);

  persistiVeicoloCorrente('Storico km aggiornato');
  reRenderDettaglioPreservandoScroll();
}

function eliminaRigaKm(indice) {
  if (!confermaAzione('Eliminare questa registrazione km?')) return;
  veicoloCorrente.storicoKm.splice(indice, 1);
  persistiVeicoloCorrente('Registrazione eliminata');
  reRenderDettaglioPreservandoScroll();
}

/* ---- Proprietari + storico proprietari (5.6) ---- */

function generaHtmlProprietari(v) {
  const ordinati = v.storicoProprietariPrecedenti.map((r, i) => Object.assign({}, r, { _idx: i }))
    .sort((a, b) => (a.annoImmatricolazione ?? Infinity) - (b.annoImmatricolazione ?? Infinity));

  const righe = ordinati.map((r) => `
    <div class="blocco-proprietario">
      <div class="riga-con-elimina">
        <p class="etichetta-proprietario riga-cliccabile" data-azione="modifica-proprietario" data-indice="${r._idx}" style="flex:1;">Proprietario precedente</p>
        <button type="button" class="btn-elimina-riga" data-azione="elimina-proprietario" data-indice="${r._idx}" aria-label="Elimina">×</button>
      </div>
      <dl class="griglia-dati riga-cliccabile" data-azione="modifica-proprietario" data-indice="${r._idx}">
        <dt>Nome</dt><dd>${escapeHtml(r.nome) || '—'}</dd>
        <dt>Immatricolato</dt><dd>${r.annoImmatricolazione ?? '—'}</dd>
        <dt>Residenza</dt><dd>${escapeHtml(r.residenza) || '—'}</dd>
        ${r.note ? `<dt>Note</dt><dd>${escapeHtml(r.note)}</dd>` : ''}
      </dl>
    </div>
  `).join('');

  const contenuto = `
      <div class="blocco-proprietario" id="fieldset-proprietario-attuale">
        <p class="etichetta-proprietario">Proprietario attuale</p>
        <div class="riga-doppia-colonna">
          <div class="campo-form">
            <label for="campo-proprietario-nome">Nome</label>
            <input type="text" id="campo-proprietario-nome" data-campo="proprietarioAttuale.nome" value="${escapeHtml(v.proprietarioAttuale.nome)}">
          </div>
          <div class="campo-form" data-campo-numerico>
            <label for="campo-proprietario-anno">Dal (anno)</label>
            <input type="number" min="1900" max="2100" id="campo-proprietario-anno" data-campo="proprietarioAttuale.annoImmatricolazione" value="${v.proprietarioAttuale.annoImmatricolazione ?? ''}">
            <span class="errore-campo">Anno non valido</span>
          </div>
        </div>
        <button type="button" class="btn-primario" data-azione="salva-proprietario-attuale">Salva sezione</button>
      </div>

      <div id="elenco-proprietari-precedenti" style="margin-top:14px;">
        ${righe}
      </div>
      <button type="button" class="btn-aggiungi-riga" data-azione="mostra-form-proprietario">+ Aggiungi proprietario precedente</button>
      <div class="form-riga-mini" id="form-mini-proprietario" data-indice-edit="-1" hidden>
        <div class="riga-doppia-colonna">
          <div class="campo-form">
            <label>Nome</label>
            <input type="text" id="proprietario-form-nome">
          </div>
          <div class="campo-form" data-campo-numerico>
            <label>Anno immatricolazione</label>
            <input type="number" min="1900" max="2100" id="proprietario-form-anno">
            <span class="errore-campo">Anno non valido</span>
          </div>
        </div>
        <div class="campo-form">
          <label>Residenza</label>
          <input type="text" id="proprietario-form-residenza">
        </div>
        <div class="campo-form">
          <label>Note</label>
          <input type="text" id="proprietario-form-note">
        </div>
        <div class="riga-azioni-mini">
          <button type="button" class="btn-secondario-piccolo" data-azione="annulla-form-proprietario">Annulla</button>
          <button type="button" class="btn-primario-piccolo" data-azione="salva-riga-proprietario">Salva riga</button>
        </div>
      </div>
  `;
  return involucroSezione('proprietari', 'sec-proprietari', 'Proprietari', contenuto);
}

function salvaSezioneProprietarioAttuale() {
  const errori = applicaCampiSezione(document.getElementById('fieldset-proprietario-attuale'), veicoloCorrente);
  persistiVeicoloCorrente(errori ? 'Sezione salvata (controlla i campi evidenziati)' : 'Proprietario attuale salvato');
}

function mostraFormProprietario(indice) {
  const form = document.getElementById('form-mini-proprietario');
  const item = indice >= 0 ? veicoloCorrente.storicoProprietariPrecedenti[indice] : null;
  form.dataset.indiceEdit = String(indice);
  document.getElementById('proprietario-form-nome').value = item ? (item.nome || '') : '';
  document.getElementById('proprietario-form-anno').value = item && item.annoImmatricolazione != null ? item.annoImmatricolazione : '';
  document.getElementById('proprietario-form-residenza').value = item ? (item.residenza || '') : '';
  document.getElementById('proprietario-form-note').value = item ? (item.note || '') : '';
  pulisciErroriForm(form);
  form.hidden = false;
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function salvaRigaProprietario() {
  const form = document.getElementById('form-mini-proprietario');
  pulisciErroriForm(form);
  const campoAnno = document.getElementById('proprietario-form-anno');
  const { valido, numero } = validaNumero(campoAnno.value);
  if (!valido) { impostaErroreCampo(campoAnno, true); mostraToast('Anno non valido', 'errore'); return; }

  const indice = parseInt(form.dataset.indiceEdit, 10);
  const riga = {
    nome: document.getElementById('proprietario-form-nome').value.trim(),
    annoImmatricolazione: numero,
    residenza: document.getElementById('proprietario-form-residenza').value.trim(),
    note: document.getElementById('proprietario-form-note').value.trim()
  };
  if (indice >= 0) veicoloCorrente.storicoProprietariPrecedenti[indice] = riga;
  else veicoloCorrente.storicoProprietariPrecedenti.push(riga);

  persistiVeicoloCorrente('Proprietario precedente salvato');
  reRenderDettaglioPreservandoScroll();
}

function eliminaRigaProprietario(indice) {
  if (!confermaAzione('Eliminare questo proprietario precedente?')) return;
  veicoloCorrente.storicoProprietariPrecedenti.splice(indice, 1);
  persistiVeicoloCorrente('Proprietario precedente eliminato');
  reRenderDettaglioPreservandoScroll();
}

/* ---- Bollo / Assicurazione ---- */

function generaHtmlBolloAssicurazione(v) {
  const contenuto = `
      <div class="riga-doppia-colonna">
        <div class="campo-form" data-campo-data>
          <label for="campo-bollo-scadenza">Scadenza bollo</label>
          <input type="text" id="campo-bollo-scadenza" data-campo="bollo.scadenza" placeholder="GG/MM/AAAA" value="${formattaDataPerInput(v.bollo.scadenza)}">
          <span class="errore-campo">Formato data non valido (GG/MM/AAAA)</span>
        </div>
        <div class="campo-form" data-campo-numerico>
          <label for="campo-bollo-costo">Costo bollo (€)</label>
          <input type="number" min="0" step="0.01" id="campo-bollo-costo" data-campo="bollo.costo" value="${v.bollo.costo ?? ''}">
          <span class="errore-campo">Valore non valido</span>
        </div>
      </div>
      <div class="riga-doppia-colonna">
        <div class="campo-form" data-campo-data>
          <label for="campo-assicurazione-scadenza">Scadenza assicurazione</label>
          <input type="text" id="campo-assicurazione-scadenza" data-campo="assicurazione.scadenza" placeholder="GG/MM/AAAA" value="${formattaDataPerInput(v.assicurazione.scadenza)}">
          <span class="errore-campo">Formato data non valido (GG/MM/AAAA)</span>
        </div>
        <div class="campo-form" data-campo-numerico>
          <label for="campo-assicurazione-costo">Costo assicurazione (€)</label>
          <input type="number" min="0" step="0.01" id="campo-assicurazione-costo" data-campo="assicurazione.costo" value="${v.assicurazione.costo ?? ''}">
          <span class="errore-campo">Valore non valido</span>
        </div>
      </div>
      <div class="campo-form">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input type="checkbox" id="campo-rinnovo-mensile" data-campo="assicurazione.rinnovoMensile" ${v.assicurazione.rinnovoMensile ? 'checked' : ''} style="width:auto;">
          Rinnovo mensile
        </label>
      </div>
      <button type="button" class="btn-primario" data-azione="salva-bollo-assicurazione">Salva sezione</button>
  `;
  return involucroSezione('bollo-assicurazione', 'sezione-bollo', 'Bollo e assicurazione', contenuto, 'fieldset-bollo-assicurazione');
}

function salvaSezioneBolloAssicurazione() {
  const errori = applicaCampiSezione(document.getElementById('fieldset-bollo-assicurazione'), veicoloCorrente);
  persistiVeicoloCorrente(errori ? 'Sezione salvata (controlla i campi evidenziati)' : 'Bollo e assicurazione salvati');
  caricaHome_refreshBannerSeVisibile();
}

/** Se la Home è la vista attiva, ricalcola il banner scadenze dopo una modifica a bollo/assicurazione. */
function caricaHome_refreshBannerSeVisibile() {
  if (AppState.vistaCorrente === 'home') caricaHome();
}

/* ---- Ruote (nuova, Fase 2) ---- */

function generaHtmlRuote(v) {
  const righe = v.ruote.map((r) => `
    <div class="voce-ruota riga-cliccabile" data-azione="modifica-ruota" data-id="${r.id}">
      <div class="riga-titolo-badge">
        <span class="marchio-ruota">${escapeHtml(r.marchio) || 'Senza marchio'}</span>
        <span class="badge-tipo dimensioni">${escapeHtml(r.dimensioni) || '—'}</span>
      </div>
      <div class="dettagli-ruota">
        <span>Data: <strong>${formattaData(r.data)}</strong></span>
        ${r.note ? `<span>Note: <strong>${escapeHtml(r.note)}</strong></span>` : ''}
      </div>
      <button type="button" class="btn-elimina-riga" data-azione="elimina-ruota" data-id="${r.id}" style="margin-top:4px;">Elimina ×</button>
    </div>
  `).join('');

  const contenuto = `
      <div class="elenco-ruote" id="elenco-ruote">
        ${righe || '<p class="stato-vuoto" style="padding:10px 0;">Nessuna registrazione ruote.</p>'}
      </div>
      <button type="button" class="btn-aggiungi-riga" data-azione="mostra-form-ruota">+ Aggiungi cambio ruote</button>
      <div class="form-riga-mini" id="form-mini-ruota" data-id-edit="" hidden>
        <div class="riga-doppia-colonna">
          <div class="campo-form" data-campo-data>
            <label>Data</label>
            <input type="text" id="ruota-form-data" placeholder="GG/MM/AAAA">
            <span class="errore-campo">Formato data non valido (GG/MM/AAAA)</span>
          </div>
          <div class="campo-form">
            <label>Marchio</label>
            <input type="text" id="ruota-form-marchio">
          </div>
        </div>
        <div class="campo-form">
          <label>Dimensioni</label>
          <input type="text" id="ruota-form-dimensioni" placeholder="205/55 R16">
        </div>
        <div class="campo-form">
          <label>Note</label>
          <input type="text" id="ruota-form-note">
        </div>
        <div class="riga-azioni-mini">
          <button type="button" class="btn-secondario-piccolo" data-azione="annulla-form-ruota">Annulla</button>
          <button type="button" class="btn-primario-piccolo" data-azione="salva-riga-ruota">Salva riga</button>
        </div>
      </div>
  `;
  return involucroSezione('ruote', 'sec-ruote', 'Ruote', contenuto);
}

function mostraFormRuota(id) {
  const form = document.getElementById('form-mini-ruota');
  const item = id ? veicoloCorrente.ruote.find((r) => r.id === id) : null;
  form.dataset.idEdit = id || '';
  document.getElementById('ruota-form-data').value = item ? formattaDataPerInput(item.data) : '';
  document.getElementById('ruota-form-marchio').value = item ? (item.marchio || '') : '';
  document.getElementById('ruota-form-dimensioni').value = item ? (item.dimensioni || '') : '';
  document.getElementById('ruota-form-note').value = item ? (item.note || '') : '';
  pulisciErroriForm(form);
  form.hidden = false;
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function salvaRigaRuota() {
  const form = document.getElementById('form-mini-ruota');
  pulisciErroriForm(form);
  const campoData = document.getElementById('ruota-form-data');
  const { valido, iso } = validaData(campoData.value);
  if (!valido) { impostaErroreCampo(campoData, true); mostraToast('Formato data non valido (GG/MM/AAAA)', 'errore'); return; }

  const idEdit = form.dataset.idEdit;
  const riga = {
    id: idEdit || generaId('ruota'),
    data: iso,
    marchio: document.getElementById('ruota-form-marchio').value.trim(),
    dimensioni: document.getElementById('ruota-form-dimensioni').value.trim(),
    note: document.getElementById('ruota-form-note').value.trim()
  };
  if (idEdit) {
    const idx = veicoloCorrente.ruote.findIndex((r) => r.id === idEdit);
    if (idx >= 0) veicoloCorrente.ruote[idx] = riga;
  } else {
    veicoloCorrente.ruote.push(riga);
  }
  persistiVeicoloCorrente('Ruota salvata');
  reRenderDettaglioPreservandoScroll();
}

/* ---- Libretto (card indipendente) ---- */

function generaHtmlLibretto(v) {
  const fotoLibretto = trovaFoto(v, v.libretto.fotoId);
  const contenuto = `
      <div class="placeholder-documento">
        <svg aria-hidden="true"><use href="#icona-documento"></use></svg>
        <span>${fotoLibretto ? 'Foto caricata' : 'Foto libretto non ancora caricata'}</span>
      </div>
      <div class="riga-azioni-mini">
        <button type="button" class="btn-secondario-piccolo" data-azione="carica-libretto">Carica foto</button>
        ${fotoLibretto ? '<button type="button" class="btn-secondario-piccolo" data-azione="rimuovi-libretto">Rimuovi</button>' : ''}
      </div>
  `;
  return involucroSezione('libretto', 'sezione-libretto', 'Libretto', contenuto);
}

/* ---- Bolletta bollo (card indipendente) ---- */

function generaHtmlBollettaBollo(v) {
  const fotoBolletta = trovaFoto(v, v.bollettaBollo.fotoId);
  const contenuto = `
      <div class="placeholder-documento">
        <svg aria-hidden="true"><use href="#icona-documento"></use></svg>
        <span>${fotoBolletta ? 'Foto caricata' : 'Foto bolletta non ancora caricata'}</span>
      </div>
      <div class="riga-azioni-mini">
        <button type="button" class="btn-secondario-piccolo" data-azione="carica-bolletta">Carica foto</button>
        ${fotoBolletta ? '<button type="button" class="btn-secondario-piccolo" data-azione="rimuovi-bolletta">Rimuovi</button>' : ''}
      </div>
  `;
  return involucroSezione('bolletta-bollo', 'sec-bolletta-bollo', 'Bolletta bollo', contenuto);
}

function rimuoviLibretto() {
  veicoloCorrente.libretto.fotoId = null;
  persistiVeicoloCorrente('Libretto rimosso');
  reRenderDettaglioPreservandoScroll();
}

function rimuoviBollettaBollo() {
  veicoloCorrente.bollettaBollo.fotoId = null;
  persistiVeicoloCorrente('Bolletta bollo rimossa');
  reRenderDettaglioPreservandoScroll();
}

function gestisciUploadLibretto(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const nuovaFoto = { id: generaId('foto'), blob: file, copertina: false };
  veicoloCorrente.foto.push(nuovaFoto);
  veicoloCorrente.libretto.fotoId = nuovaFoto.id;
  persistiVeicoloCorrente('Libretto caricato', () => {
    // Salvataggio fallito (es. QuotaExceededError): annulla la modifica ottimistica,
    // altrimenti la UI mostrerebbe il libretto come caricato pur non essendo stato salvato.
    veicoloCorrente.foto = veicoloCorrente.foto.filter((f) => f.id !== nuovaFoto.id);
    veicoloCorrente.libretto.fotoId = null;
    reRenderDettaglioPreservandoScroll();
  });
  reRenderDettaglioPreservandoScroll();
}

function gestisciUploadBollettaBollo(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const nuovaFoto = { id: generaId('foto'), blob: file, copertina: false };
  veicoloCorrente.foto.push(nuovaFoto);
  veicoloCorrente.bollettaBollo.fotoId = nuovaFoto.id;
  persistiVeicoloCorrente('Bolletta bollo caricata', () => {
    veicoloCorrente.foto = veicoloCorrente.foto.filter((f) => f.id !== nuovaFoto.id);
    veicoloCorrente.bollettaBollo.fotoId = null;
    reRenderDettaglioPreservandoScroll();
  });
  reRenderDettaglioPreservandoScroll();
}

/* ---- Manutenzioni (5.7) ---- */

function generaHtmlManutenzioni(v) {
  const ordinate = [...v.manutenzioni].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const righe = ordinate.map((m) => `
    <div class="voce-manutenzione riga-cliccabile" data-azione="modifica-manutenzione" data-id="${m.id}">
      <div class="riga-titolo-badge">
        <span class="descrizione">${escapeHtml(m.descrizione)}</span>
        <span class="badge-tipo ${m.tipo === 'straordinaria' ? 'straordinaria' : 'ordinaria'}">${m.tipo === 'straordinaria' ? 'Straordinaria' : 'Ordinaria'}</span>
      </div>
      <div class="dettagli-manutenzione">
        <span>Esecutore: <strong>${escapeHtml(m.esecutore)}</strong></span>
        <span>Data: <strong>${formattaData(m.data)}</strong></span>
        <span>Costo: <strong>${m.costo != null ? formattaValuta(m.costo) : '—'}</strong></span>
      </div>
      <button type="button" class="btn-elimina-riga" data-azione="elimina-manutenzione" data-id="${m.id}" style="margin-top:4px;">Elimina ×</button>
    </div>
  `).join('');

  const contenuto = `
      <div class="elenco-manutenzioni" id="elenco-manutenzioni">
        ${righe || '<p class="stato-vuoto" style="padding:10px 0;">Nessuna manutenzione registrata.</p>'}
      </div>
      <button type="button" class="btn-aggiungi-riga" data-azione="mostra-form-manutenzione">+ Aggiungi manutenzione</button>
      <div class="form-riga-mini" id="form-mini-manutenzione" data-id-edit="" hidden>
        <div class="campo-form">
          <label>Descrizione</label>
          <input type="text" id="manutenzione-form-descrizione">
          <span class="errore-campo">Campo obbligatorio</span>
        </div>
        <div class="riga-doppia-colonna">
          <div class="campo-form">
            <label>Esecutore</label>
            <input type="text" id="manutenzione-form-esecutore">
            <span class="errore-campo">Campo obbligatorio</span>
          </div>
          <div class="campo-form">
            <label>Data</label>
            <input type="text" id="manutenzione-form-data" placeholder="GG/MM/AAAA">
            <span class="errore-campo">Data obbligatoria (GG/MM/AAAA)</span>
          </div>
        </div>
        <div class="riga-doppia-colonna">
          <div class="campo-form">
            <label>Tipo</label>
            <select id="manutenzione-form-tipo">
              <option value="">Seleziona…</option>
              <option value="ordinaria">Ordinaria</option>
              <option value="straordinaria">Straordinaria</option>
            </select>
            <span class="errore-campo">Campo obbligatorio</span>
          </div>
          <div class="campo-form" data-campo-numerico>
            <label>Costo (€, opzionale)</label>
            <input type="number" min="0" step="0.01" id="manutenzione-form-costo">
            <span class="errore-campo">Valore non valido</span>
          </div>
        </div>
        <div class="riga-azioni-mini">
          <button type="button" class="btn-secondario-piccolo" data-azione="annulla-form-manutenzione">Annulla</button>
          <button type="button" class="btn-primario-piccolo" data-azione="salva-riga-manutenzione">Salva riga</button>
        </div>
      </div>
  `;
  return involucroSezione('manutenzioni', 'sezione-manutenzioni', 'Manutenzioni', contenuto);
}

function mostraFormManutenzione(id) {
  const form = document.getElementById('form-mini-manutenzione');
  const item = id ? veicoloCorrente.manutenzioni.find((m) => m.id === id) : null;
  form.dataset.idEdit = id || '';
  document.getElementById('manutenzione-form-descrizione').value = item ? (item.descrizione || '') : '';
  document.getElementById('manutenzione-form-esecutore').value = item ? (item.esecutore || '') : '';
  document.getElementById('manutenzione-form-data').value = item ? formattaDataPerInput(item.data) : '';
  document.getElementById('manutenzione-form-tipo').value = item ? (item.tipo || '') : '';
  document.getElementById('manutenzione-form-costo').value = item && item.costo != null ? item.costo : '';
  pulisciErroriForm(form);
  form.hidden = false;
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function salvaRigaManutenzione() {
  const form = document.getElementById('form-mini-manutenzione');
  pulisciErroriForm(form);
  const campoDescrizione = document.getElementById('manutenzione-form-descrizione');
  const campoEsecutore = document.getElementById('manutenzione-form-esecutore');
  const campoData = document.getElementById('manutenzione-form-data');
  const campoTipo = document.getElementById('manutenzione-form-tipo');
  const campoCosto = document.getElementById('manutenzione-form-costo');

  let errori = false;
  if (!campoDescrizione.value.trim()) { impostaErroreCampo(campoDescrizione, true); errori = true; }
  if (!campoEsecutore.value.trim()) { impostaErroreCampo(campoEsecutore, true); errori = true; }
  const { valido: dataValida, iso: dataIso } = validaData(campoData.value, { consentiVuoto: false });
  if (!dataValida) { impostaErroreCampo(campoData, true); errori = true; }
  if (!campoTipo.value) { impostaErroreCampo(campoTipo, true); errori = true; }
  const { valido: costoValido, numero: costoNumero } = validaNumero(campoCosto.value);
  if (!costoValido) { impostaErroreCampo(campoCosto, true); errori = true; }
  if (errori) { mostraToast('Compila i campi obbligatori evidenziati', 'errore'); return; }

  const idEdit = form.dataset.idEdit;
  const esistente = idEdit ? veicoloCorrente.manutenzioni.find((m) => m.id === idEdit) : null;
  const riga = {
    id: idEdit || generaId('manutenzione'),
    descrizione: campoDescrizione.value.trim(),
    esecutore: campoEsecutore.value.trim(),
    data: dataIso,
    tipo: campoTipo.value,
    costo: costoNumero,
    fotoFatturaId: esistente ? (esistente.fotoFatturaId || null) : null
  };
  if (idEdit) {
    const idx = veicoloCorrente.manutenzioni.findIndex((m) => m.id === idEdit);
    if (idx >= 0) veicoloCorrente.manutenzioni[idx] = riga;
  } else {
    veicoloCorrente.manutenzioni.push(riga);
  }
  persistiVeicoloCorrente('Manutenzione salvata');
  reRenderDettaglioPreservandoScroll();
}

/* ---- Rifornimenti (deviazione dichiarata, Sezione 11) ---- */

function generaHtmlRifornimenti(v) {
  const ordinati = [...(v.rifornimenti || [])].sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const righe = ordinati.map((r) => `
    <div class="voce-manutenzione riga-cliccabile" data-azione="modifica-rifornimento" data-id="${r.id}">
      <div class="riga-titolo-badge">
        <span class="descrizione">${formattaData(r.data)}</span>
        <span class="badge-tipo dimensioni">${r.litri != null ? r.litri + ' L' : '—'}</span>
      </div>
      <div class="dettagli-manutenzione">
        <span>Costo: <strong>${r.costo != null ? formattaValuta(r.costo) : '—'}</strong></span>
        <span>Km: <strong>${r.km != null ? formattaNumero(r.km) + ' km' : '—'}</strong></span>
      </div>
      <button type="button" class="btn-elimina-riga" data-azione="elimina-rifornimento" data-id="${r.id}" style="margin-top:4px;">Elimina ×</button>
    </div>
  `).join('');

  const contenuto = `
      <div class="elenco-manutenzioni" id="elenco-rifornimenti">
        ${righe || '<p class="stato-vuoto" style="padding:10px 0;">Nessun rifornimento registrato.</p>'}
      </div>
      <button type="button" class="btn-aggiungi-riga" data-azione="mostra-form-rifornimento">+ Aggiungi rifornimento</button>
      <div class="form-riga-mini" id="form-mini-rifornimento" data-id-edit="" hidden>
        <div class="riga-doppia-colonna">
          <div class="campo-form" data-campo-data>
            <label>Data</label>
            <input type="text" id="rifornimento-form-data" placeholder="GG/MM/AAAA">
            <span class="errore-campo">Formato data non valido (GG/MM/AAAA)</span>
          </div>
          <div class="campo-form" data-campo-numerico>
            <label>Litri</label>
            <input type="number" min="0" step="0.01" id="rifornimento-form-litri">
            <span class="errore-campo">Valore non valido</span>
          </div>
        </div>
        <div class="riga-doppia-colonna">
          <div class="campo-form" data-campo-numerico>
            <label>Costo (€)</label>
            <input type="number" min="0" step="0.01" id="rifornimento-form-costo">
            <span class="errore-campo">Valore non valido</span>
          </div>
          <div class="campo-form" data-campo-numerico>
            <label>Km</label>
            <input type="number" min="0" id="rifornimento-form-km">
            <span class="errore-campo">Valore non valido</span>
          </div>
        </div>
        <div class="riga-azioni-mini">
          <button type="button" class="btn-secondario-piccolo" data-azione="annulla-form-rifornimento">Annulla</button>
          <button type="button" class="btn-primario-piccolo" data-azione="salva-riga-rifornimento">Salva riga</button>
        </div>
      </div>
  `;
  return involucroSezione('rifornimenti', 'sec-rifornimenti', 'Rifornimenti carburante', contenuto);
}

function mostraFormRifornimento(id) {
  const form = document.getElementById('form-mini-rifornimento');
  const item = id ? veicoloCorrente.rifornimenti.find((r) => r.id === id) : null;
  form.dataset.idEdit = id || '';
  document.getElementById('rifornimento-form-data').value = item ? formattaDataPerInput(item.data) : '';
  document.getElementById('rifornimento-form-litri').value = item && item.litri != null ? item.litri : '';
  document.getElementById('rifornimento-form-costo').value = item && item.costo != null ? item.costo : '';
  document.getElementById('rifornimento-form-km').value = item && item.km != null ? item.km : '';
  pulisciErroriForm(form);
  form.hidden = false;
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function salvaRigaRifornimento() {
  const form = document.getElementById('form-mini-rifornimento');
  pulisciErroriForm(form);
  const campoData = document.getElementById('rifornimento-form-data');
  const campoLitri = document.getElementById('rifornimento-form-litri');
  const campoCosto = document.getElementById('rifornimento-form-costo');
  const campoKm = document.getElementById('rifornimento-form-km');
  const data = validaData(campoData.value);
  const litri = validaNumero(campoLitri.value);
  const costo = validaNumero(campoCosto.value);
  const km = validaNumero(campoKm.value);
  let errori = false;
  if (!data.valido) { impostaErroreCampo(campoData, true); errori = true; }
  if (!litri.valido) { impostaErroreCampo(campoLitri, true); errori = true; }
  if (!costo.valido) { impostaErroreCampo(campoCosto, true); errori = true; }
  if (!km.valido) { impostaErroreCampo(campoKm, true); errori = true; }
  if (errori) { mostraToast('Controlla i valori inseriti', 'errore'); return; }

  const idEdit = form.dataset.idEdit;
  const riga = {
    id: idEdit || generaId('rifornimento'),
    data: data.iso,
    litri: litri.numero, costo: costo.numero, km: km.numero
  };
  if (!veicoloCorrente.rifornimenti) veicoloCorrente.rifornimenti = [];
  if (idEdit) {
    const idx = veicoloCorrente.rifornimenti.findIndex((r) => r.id === idEdit);
    if (idx >= 0) veicoloCorrente.rifornimenti[idx] = riga;
  } else {
    veicoloCorrente.rifornimenti.push(riga);
  }
  persistiVeicoloCorrente('Rifornimento salvato');
  reRenderDettaglioPreservandoScroll();
}

/* ---- Foto e copertina (5.8) ---- */

function generaHtmlFoto(v) {
  const tiles = v.foto.map((f) => `
    <div class="foto-placeholder-quadrata" data-id="${f.id}">
      <svg aria-hidden="true"><use href="#icona-foto"></use></svg>
      ${f.copertina ? '<span class="etichetta-copertina">Copertina</span>' : ''}
    </div>
  `).join('');

  const contenuto = `
      <div class="griglia-foto" id="griglia-foto-veicolo">
        <div class="foto-placeholder-quadrata tile-aggiungi" data-azione="apri-upload-foto" aria-label="Aggiungi foto">+</div>
        ${tiles}
      </div>
      <p class="nota-anteprima" style="margin-top:10px;">Tocca a lungo una foto per impostarla come copertina o rimuoverla.</p>
  `;
  return involucroSezione('foto', 'sezione-foto', 'Foto', contenuto);
}

/** Dopo il render, inserisce le miniature reali (Blob→object URL) e abilita il tap lungo. */
function popolaMiniatureFoto(v) {
  const cont = document.getElementById('griglia-foto-veicolo');
  if (!cont) return;
  v.foto.forEach((f) => {
    if (!f.blob) return;
    const item = cont.querySelector(`[data-id="${f.id}"]`);
    if (!item) return;
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f.blob);
    item.insertBefore(img, item.firstChild);
  });
  cont.querySelectorAll('.foto-placeholder-quadrata[data-id]').forEach((item) => {
    const fotoId = item.dataset.id;
    abilitaPressioneLunga(item, () => apriMenuFoto(fotoId), () => {});
  });
}

/** Apre il menu contestuale per una foto della galleria (copertina / rimozione). */
function apriMenuFoto(fotoId) {
  const overlay = document.getElementById('overlay-menu-contestuale');
  const foglio = document.getElementById('foglio-menu-contestuale');
  foglio.innerHTML = `
    <p class="titolo-foglio">Foto</p>
    <button type="button" class="voce-menu" data-menu-azione-foto="copertina">Imposta come copertina</button>
    <button type="button" class="voce-menu pericolo" data-menu-azione-foto="rimuovi">Rimuovi foto</button>
  `;
  overlay.hidden = false;
  foglio.querySelectorAll('button[data-menu-azione-foto]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const azione = btn.dataset.menuAzioneFoto;
      chiudiMenuContestuale();
      if (azione === 'copertina') impostaCopertina(fotoId);
      else if (azione === 'rimuovi') rimuoviFoto(fotoId);
    });
  });
}

/** Imposta una foto come copertina, azzerando il flag su tutte le altre. */
function impostaCopertina(fotoId) {
  veicoloCorrente.foto.forEach((f) => { f.copertina = f.id === fotoId; });
  persistiVeicoloCorrente('Copertina aggiornata');
  reRenderDettaglioPreservandoScroll();
}

/** Rimuove una foto dalla galleria e scollega eventuali riferimenti libretto/bolletta. */
function rimuoviFoto(fotoId) {
  if (!confermaAzione('Rimuovere questa foto?')) return;
  veicoloCorrente.foto = veicoloCorrente.foto.filter((f) => f.id !== fotoId);
  if (veicoloCorrente.libretto.fotoId === fotoId) veicoloCorrente.libretto.fotoId = null;
  if (veicoloCorrente.bollettaBollo.fotoId === fotoId) veicoloCorrente.bollettaBollo.fotoId = null;
  persistiVeicoloCorrente('Foto rimossa');
  reRenderDettaglioPreservandoScroll();
}

/**
 * Gestisce la selezione di uno o più file dalla galleria generale foto[].
 * Se il salvataggio su DB fallisce (es. QuotaExceededError), le foto appena
 * aggiunte vengono rimosse di nuovo dalla UI: senza questo rollback la scheda
 * mostrerebbe le foto come caricate anche quando in realtà non sono state
 * persistite, dando l'impressione errata che l'upload sia riuscito (bug segnalato
 * dall'utente — causa identificata: render ottimistico + errore silenziosamente
 * "perso" nel toast, vedi indagine in Sezione 8/Fase 6).
 */
function gestisciUploadFoto(e) {
  const files = e.target.files;
  e.target.value = '';
  if (!files || files.length === 0) return;
  const nuoveFoto = Array.from(files).map((file) => ({ id: generaId('foto'), blob: file, copertina: false }));
  nuoveFoto.forEach((f) => veicoloCorrente.foto.push(f));
  persistiVeicoloCorrente(nuoveFoto.length > 1 ? 'Foto caricate' : 'Foto caricata', () => {
    const idNuoveFoto = new Set(nuoveFoto.map((f) => f.id));
    veicoloCorrente.foto = veicoloCorrente.foto.filter((f) => !idNuoveFoto.has(f.id));
    reRenderDettaglioPreservandoScroll();
  });
  reRenderDettaglioPreservandoScroll();
}

/* ---- Note ---- */

function generaHtmlNote(v) {
  const contenuto = `
      <div class="campo-form">
        <textarea id="campo-note" data-campo="note" rows="4" style="width:100%; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:10px 12px; font-size:0.85rem; color:var(--testo-primario); font-family:inherit; resize:vertical;">${escapeHtml(v.note)}</textarea>
      </div>
      <button type="button" class="btn-primario" data-azione="salva-note">Salva sezione</button>
  `;
  return involucroSezione('note', 'sezione-note', 'Note', contenuto, 'fieldset-note');
}

function salvaSezioneNote() {
  applicaCampiSezione(document.getElementById('fieldset-note'), veicoloCorrente);
  persistiVeicoloCorrente('Note salvate');
}

/* ---- Eliminazione riga generica per array con id (ruote/manutenzioni/rifornimenti) ---- */

function eliminaRigaConId(nomeArray, id, messaggio) {
  if (!confermaAzione('Eliminare questa riga?')) return;
  veicoloCorrente[nomeArray] = veicoloCorrente[nomeArray].filter((item) => item.id !== id);
  persistiVeicoloCorrente(messaggio);
  reRenderDettaglioPreservandoScroll();
}

/** Nasconde un form mini di aggiunta/modifica riga. */
function nascondiForm(idForm) {
  document.getElementById(idForm).hidden = true;
}

/** Gestore delegato per tutti i click dentro #dettaglio-contenuto. */
function gestisciClickDettaglio(event) {
  const el = event.target.closest('[data-azione]');
  if (!el) return;
  const azione = el.dataset.azione;

  switch (azione) {
    case 'salva-anagrafica': salvaSezioneAnagrafica(); break;

    case 'salva-km': salvaSezioneKmSemplice(); break;
    case 'mostra-form-km': mostraFormKm(-1); break;
    case 'annulla-form-km': nascondiForm('form-mini-km'); break;
    case 'modifica-km': mostraFormKm(parseInt(el.dataset.indice, 10)); break;
    case 'elimina-km': eliminaRigaKm(parseInt(el.dataset.indice, 10)); break;
    case 'salva-riga-km': salvaRigaKm(); break;

    case 'salva-proprietario-attuale': salvaSezioneProprietarioAttuale(); break;
    case 'mostra-form-proprietario': mostraFormProprietario(-1); break;
    case 'annulla-form-proprietario': nascondiForm('form-mini-proprietario'); break;
    case 'modifica-proprietario': mostraFormProprietario(parseInt(el.dataset.indice, 10)); break;
    case 'elimina-proprietario': eliminaRigaProprietario(parseInt(el.dataset.indice, 10)); break;
    case 'salva-riga-proprietario': salvaRigaProprietario(); break;

    case 'salva-bollo-assicurazione': salvaSezioneBolloAssicurazione(); break;

    case 'mostra-form-ruota': mostraFormRuota(null); break;
    case 'annulla-form-ruota': nascondiForm('form-mini-ruota'); break;
    case 'modifica-ruota': mostraFormRuota(el.dataset.id); break;
    case 'elimina-ruota': eliminaRigaConId('ruote', el.dataset.id, 'Ruota eliminata'); break;
    case 'salva-riga-ruota': salvaRigaRuota(); break;

    case 'carica-libretto': document.getElementById('input-upload-libretto').click(); break;
    case 'rimuovi-libretto': rimuoviLibretto(); break;
    case 'carica-bolletta': document.getElementById('input-upload-bolletta-bollo').click(); break;
    case 'rimuovi-bolletta': rimuoviBollettaBollo(); break;

    case 'mostra-form-manutenzione': mostraFormManutenzione(null); break;
    case 'annulla-form-manutenzione': nascondiForm('form-mini-manutenzione'); break;
    case 'modifica-manutenzione': mostraFormManutenzione(el.dataset.id); break;
    case 'elimina-manutenzione': eliminaRigaConId('manutenzioni', el.dataset.id, 'Manutenzione eliminata'); break;
    case 'salva-riga-manutenzione': salvaRigaManutenzione(); break;

    case 'mostra-form-rifornimento': mostraFormRifornimento(null); break;
    case 'annulla-form-rifornimento': nascondiForm('form-mini-rifornimento'); break;
    case 'modifica-rifornimento': mostraFormRifornimento(el.dataset.id); break;
    case 'elimina-rifornimento': eliminaRigaConId('rifornimenti', el.dataset.id, 'Rifornimento eliminato'); break;
    case 'salva-riga-rifornimento': salvaRigaRifornimento(); break;

    case 'salva-note': salvaSezioneNote(); break;

    case 'apri-upload-foto': document.getElementById('input-upload-foto').click(); break;

    case 'toggla-sezione': {
      const idSezione = el.dataset.sezioneId;
      const articolo = el.closest('.sezione-scheda');
      const collassa = !articolo.classList.contains('collassata');
      articolo.classList.toggle('collassata', collassa);
      el.setAttribute('aria-expanded', String(!collassa));
      if (collassa) sezioniCollassate.add(idSezione);
      else sezioniCollassate.delete(idSezione);
      break;
    }

    default: break;
  }
}

/* ==========================================================
   STATISTICHE (5.12)
   ========================================================== */

/** Verifica se una data ISO ricade nel range [da, a] (stringhe ISO, confronto lessicografico). */
function nelRange(dataStr, da, a) {
  return !!dataStr && dataStr >= da && dataStr <= a;
}

/** Calcola i costi aggregati di un veicolo nel range di date indicato. */
function calcolaStatisticheVeicolo(v, da, a) {
  const manutenzioniRange = (v.manutenzioni || []).filter((m) => nelRange(m.data, da, a));
  const rifornimentiRange = (v.rifornimenti || []).filter((r) => nelRange(r.data, da, a));
  const costoManutenzioni = manutenzioniRange.reduce((s, m) => s + (Number(m.costo) || 0), 0);
  const costoOrdinaria = manutenzioniRange.filter((m) => m.tipo === 'ordinaria').reduce((s, m) => s + (Number(m.costo) || 0), 0);
  const costoStraordinaria = manutenzioniRange.filter((m) => m.tipo === 'straordinaria').reduce((s, m) => s + (Number(m.costo) || 0), 0);
  const costoCarburante = rifornimentiRange.reduce((s, r) => s + (Number(r.costo) || 0), 0);
  const costoBollo = (v.bollo && v.bollo.scadenza && nelRange(v.bollo.scadenza, da, a)) ? (Number(v.bollo.costo) || 0) : 0;
  const costoAssicurazione = (v.assicurazione && v.assicurazione.scadenza && nelRange(v.assicurazione.scadenza, da, a)) ? (Number(v.assicurazione.costo) || 0) : 0;
  const costoTotale = costoManutenzioni + costoCarburante + costoBollo + costoAssicurazione;
  const haDatiSufficienti = manutenzioniRange.length > 0 || rifornimentiRange.length > 0 || costoBollo > 0 || costoAssicurazione > 0;
  return {
    manutenzioniRange, rifornimentiRange, costoManutenzioni, costoOrdinaria,
    costoStraordinaria, costoCarburante, costoBollo, costoAssicurazione,
    costoTotale, haDatiSufficienti
  };
}

/** Carica i veicoli attivi (i soli selezionabili) e prepara la vista Statistiche. */
function avviaStatistiche() {
  DB.getVeicoli('attivo').then((attivi) => {
    attivi.forEach(normalizzaVeicolo);
    statisticheVeicoliTutti = attivi;

    if (!statisticheInizializzate) {
      attivi.forEach((v) => statisticheSelezionate.add(v.id));
      statisticheInizializzate = true;
    }
    // Rimuove dalla selezione eventuali veicoli non più attivi (es. archiviati nel frattempo).
    const idAttivi = new Set(attivi.map((v) => v.id));
    Array.from(statisticheSelezionate).forEach((id) => {
      if (!idAttivi.has(id)) statisticheSelezionate.delete(id);
    });

    if (!document.getElementById('stat-data-a').value) {
      const oggi = new Date();
      document.getElementById('stat-data-a').value = formattaDataInput(oggi);
      const unAnnoFa = new Date(oggi);
      unAnnoFa.setFullYear(unAnnoFa.getFullYear() - 1);
      document.getElementById('stat-data-da').value = formattaDataInput(unAnnoFa);
    }
    renderChipVeicoliStatistiche();
    renderStatistiche();
  }).catch((err) => mostraToast(err.message || 'Errore nel caricamento delle statistiche', 'errore'));
}

/** Renderizza le chip di selezione multipla veicoli per le statistiche. */
function renderChipVeicoliStatistiche() {
  const cont = document.getElementById('chip-selezione-veicoli');
  const vuoto = document.getElementById('stato-vuoto-statistiche');
  if (statisticheVeicoliTutti.length === 0) {
    cont.innerHTML = '';
    vuoto.hidden = false;
    return;
  }
  vuoto.hidden = true;
  cont.innerHTML = statisticheVeicoliTutti.map((v) => {
    const nome = v.nomeScheda || `${v.marca || ''} ${v.modello || ''}`.trim() || 'Veicolo';
    const selezionato = statisticheSelezionate.has(v.id) ? 'selezionato' : '';
    return `<button type="button" class="${selezionato}" data-id="${v.id}">${escapeHtml(nome)}</button>`;
  }).join('');
  cont.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (statisticheSelezionate.has(id)) statisticheSelezionate.delete(id);
      else statisticheSelezionate.add(id);
      btn.classList.toggle('selezionato');
      renderStatistiche();
    });
  });
}

/** Renderizza il riepilogo statistiche (costi + grafico) per i veicoli selezionati. */
function renderStatistiche() {
  const cont = document.getElementById('contenitore-statistiche');
  const notaSel = document.getElementById('nota-selezione-statistiche');
  if (statisticheVeicoliTutti.length === 0) { cont.innerHTML = ''; notaSel.hidden = true; return; }

  const selezionati = statisticheVeicoliTutti.filter((v) => statisticheSelezionate.has(v.id));
  if (selezionati.length === 0) { notaSel.hidden = false; cont.innerHTML = ''; return; }
  notaSel.hidden = true;

  const da = document.getElementById('stat-data-da').value || '0000-01-01';
  const a = document.getElementById('stat-data-a').value || '9999-12-31';

  cont.innerHTML = selezionati.map((v) => generaHtmlStatisticheVeicolo(v, da, a)).join('');

  selezionati.forEach((v) => {
    const s = calcolaStatisticheVeicolo(v, da, a);
    const canvas = document.getElementById(`grafico-${v.id}`);
    if (canvas && (s.costoOrdinaria > 0 || s.costoStraordinaria > 0)) {
      disegnaGraficoBarre(canvas, { ordinaria: s.costoOrdinaria, straordinaria: s.costoStraordinaria });
    }
  });
}

/** Genera il markup del riepilogo statistiche per un singolo veicolo. */
function generaHtmlStatisticheVeicolo(v, da, a) {
  const s = calcolaStatisticheVeicolo(v, da, a);
  const nome = v.nomeScheda || `${v.marca || ''} ${v.modello || ''}`.trim() || 'Veicolo';
  if (!s.haDatiSufficienti) {
    return `
      <div class="riepilogo-statistiche-veicolo">
        <h4>${escapeHtml(nome)}</h4>
        <p class="testo-dati-insufficienti">Dati insufficienti nel periodo selezionato.</p>
      </div>
    `;
  }
  const haGrafico = s.costoOrdinaria > 0 || s.costoStraordinaria > 0;
  return `
    <div class="riepilogo-statistiche-veicolo">
      <h4>${escapeHtml(nome)}</h4>
      <p class="riepilogo-costo-totale">${formattaValuta(s.costoTotale)}</p>
      <dl class="griglia-dati">
        <dt>Manutenzioni</dt><dd>${formattaValuta(s.costoManutenzioni)}</dd>
        <dt>Carburante</dt><dd>${formattaValuta(s.costoCarburante)}</dd>
        <dt>Bollo</dt><dd>${formattaValuta(s.costoBollo)}</dd>
        <dt>Assicurazione</dt><dd>${formattaValuta(s.costoAssicurazione)}</dd>
      </dl>
      ${haGrafico ? `
        <canvas class="canvas-grafico" id="grafico-${v.id}" width="600" height="160"></canvas>
        <div class="legenda-grafico">
          <span class="voce-legenda"><span class="pallino-legenda" style="background:#3A6E4D"></span> Ordinaria</span>
          <span class="voce-legenda"><span class="pallino-legenda" style="background:#D40000"></span> Straordinaria</span>
        </div>
      ` : ''}
    </div>
  `;
}

/** Disegna un grafico a barre (costo manutenzioni ordinarie/straordinarie) su canvas nativo. */
function disegnaGraficoBarre(canvas, dati) {
  const ctx = canvas.getContext('2d');
  const larghezza = canvas.width, altezza = canvas.height;
  ctx.clearRect(0, 0, larghezza, altezza);

  const valori = [
    { etichetta: 'Ordinaria', valore: dati.ordinaria, colore: '#3A6E4D' },
    { etichetta: 'Straordinaria', valore: dati.straordinaria, colore: '#D40000' }
  ];
  const massimo = Math.max(valori[0].valore, valori[1].valore, 1);
  const padding = 24;
  const larghezzaBarra = 80;
  const spazio = (larghezza - padding * 2 - larghezzaBarra * valori.length) / (valori.length + 1);

  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  valori.forEach((v, i) => {
    const altBarra = Math.round(((altezza - 40) * v.valore) / massimo);
    const x = padding + spazio * (i + 1) + larghezzaBarra * i;
    const y = altezza - 24 - altBarra;
    ctx.fillStyle = v.colore;
    ctx.fillRect(x, y, larghezzaBarra, altBarra);
    ctx.fillStyle = '#F5F5F5';
    ctx.fillText(formattaValuta(v.valore), x + larghezzaBarra / 2, Math.max(y - 6, 12));
    ctx.fillStyle = '#9A9A9A';
    ctx.fillText(v.etichetta, x + larghezzaBarra / 2, altezza - 8);
  });
}

/* ==========================================================
   BACKUP: export / import (5.9, 5.10 — Pattern P03/P04)
   ========================================================== */

/** Soglia (byte) oltre la quale si avvisa l'utente prima del download, senza bloccarlo (Pattern P03). */
const SOGLIA_AVVISO_BACKUP_BYTE = 50 * 1024 * 1024;

/**
 * Esporta un backup completo (dati + foto) e avvia il download del file JSON.
 * Aggiorna l'impostazione "ultimoBackup" al termine (Pattern P04).
 */
function gestisciBackup() {
  AppState.backupInCorso = true;
  const btn = document.getElementById('btn-backup');
  btn.disabled = true;

  DB.esportaBackup().then((dati) => {
    const json = JSON.stringify(dati);
    if (json.length > SOGLIA_AVVISO_BACKUP_BYTE) {
      mostraToast(`Attenzione: il backup pesa circa ${(json.length / (1024 * 1024)).toFixed(1)} MB. Il download procede comunque.`, 'info');
    }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const oggi = new Date();
    const nomeFile = `AutoRigon_backup_${formattaDataInput(oggi).replace(/-/g, '')}.json`;
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeFile;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    return DB.setImpostazione('ultimoBackup', oggi.toISOString());
  }).then(() => {
    mostraToast('Backup esportato correttamente', 'successo');
    aggiornaEtichettaUltimoBackup();
  }).catch((err) => {
    mostraToast(err.message || "Errore durante l'esportazione del backup", 'errore');
  }).finally(() => {
    AppState.backupInCorso = false;
    btn.disabled = false;
  });
}

/** Apre il selettore file per il ripristino da backup. */
function gestisciRipristino() {
  document.getElementById('input-ripristino-backup').click();
}

/**
 * Gestisce il file di backup selezionato: richiede conferma esplicita (i dati attuali
 * vengono sovrascritti), poi chiama DB.importaBackup(). In caso di errore i dati
 * correnti restano intatti (DB.importaBackup non scrive nulla se il file non è valido).
 */
function gestisciFileRipristino(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;

  if (!confermaAzione('Questa operazione sovrascriverà tutti i dati attuali. Continuare?')) return;

  DB.importaBackup(file).then(() => {
    mostraToast('Backup ripristinato correttamente', 'successo');
    statisticheInizializzate = false;
    statisticheSelezionate = new Set();
    mostraVista('home');
  }).catch((err) => {
    mostraToast(err.message || 'Errore durante il ripristino del backup: il file non è un backup AutoRigon valido.', 'errore');
  });
}

/* ==========================================================
   ESPORTAZIONE PDF (Pattern P01 — CRITICO)
   ========================================================== */

/**
 * Avvia l'esportazione PDF di un veicolo. Rilegge SEMPRE i dati freschi da
 * DB.getVeicolo(id) immediatamente prima di generare il documento — mai un
 * oggetto già in memoria — per evitare il Pattern P01 (PDF sempre alla prima versione).
 * @param {string} id - Id del veicolo da esportare.
 */
function esportaPdfVeicolo(id) {
  if (!window.jspdf || typeof window.jspdf.jsPDF !== 'function') {
    mostraToast('Libreria PDF non disponibile: impossibile generare il documento.', 'errore');
    return;
  }
  DB.getVeicolo(id).then((v) => {
    if (!v) { mostraToast('Veicolo non trovato', 'errore'); return; }
    normalizzaVeicolo(v);
    generaEScaricaPdf(v);
  }).catch((err) => mostraToast(err.message || 'Errore durante la generazione del PDF', 'errore'));
}

/** Costruisce un nome file univoco per l'export PDF (targa/nomeScheda + timestamp). */
function costruisciNomeFilePdf(v) {
  const ora = new Date();
  const timestamp = formattaDataInput(ora).replace(/-/g, '') + '_'
    + String(ora.getHours()).padStart(2, '0')
    + String(ora.getMinutes()).padStart(2, '0')
    + String(ora.getSeconds()).padStart(2, '0');
  const identificativo = (v.targa && v.targa.trim()) || (v.nomeScheda && v.nomeScheda.trim()) || 'veicolo';
  const pulito = identificativo.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'veicolo';
  return `AutoRigon_${pulito}_${timestamp}.pdf`;
}

/**
 * Genera il documento PDF di una scheda veicolo (dati già freschi dal DB) e avvia il download.
 * Nessun errore silenzioso: qualunque eccezione mostra un toast, nessun file corrotto scaricato.
 * @param {Object} v - Oggetto veicolo completo e normalizzato.
 */
function generaEScaricaPdf(v) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const marginX = 15;
    const marginBasso = 15;
    const larghezzaPagina = doc.internal.pageSize.getWidth();
    const altezzaPagina = doc.internal.pageSize.getHeight();
    let y = 18;

    const nuovaPaginaSeNecessario = (altezzaRichiesta) => {
      if (y + altezzaRichiesta > altezzaPagina - marginBasso) {
        doc.addPage();
        y = 18;
      }
    };
    const scriviTitolo = (testo) => {
      nuovaPaginaSeNecessario(10);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(testo, marginX, y);
      y += 5.5;
      doc.setDrawColor(180);
      doc.line(marginX, y - 3.5, larghezzaPagina - marginX, y - 3.5);
      y += 1.5;
    };
    const scriviRiga = (etichetta, valore) => {
      const testoValore = (valore === null || valore === undefined || valore === '') ? '—' : String(valore);
      const testoCompleto = etichetta ? `${etichetta}: ${testoValore}` : testoValore;
      const righe = doc.splitTextToSize(testoCompleto, larghezzaPagina - marginX * 2);
      nuovaPaginaSeNecessario(righe.length * 5);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(righe, marginX, y);
      y += righe.length * 5;
    };
    const spazio = (mm) => { y += mm; };

    // Intestazione
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(v.nomeScheda || 'Scheda veicolo', marginX, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Targa: ${v.targa || '—'}`, marginX, y);
    y += 5;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(`Esportato il ${new Date().toLocaleString('it-IT')}`, marginX, y);
    doc.setTextColor(0);
    y += 8;

    scriviTitolo('Anagrafica');
    scriviRiga('Marca', v.marca);
    scriviRiga('Modello', v.modello);
    scriviRiga('Allestimento', v.allestimento);
    scriviRiga('Colore', v.colore);
    scriviRiga('Cilindrata', v.cilindrata != null ? v.cilindrata + ' cc' : null);
    scriviRiga('Potenza', v.potenza != null ? v.potenza + ' CV' : null);
    scriviRiga('Targa', v.targa);
    scriviRiga('Numero di telaio', v.numeroTelaio);
    scriviRiga('Prima immatricolazione', v.annoPrimaImmatricolazione);
    spazio(3);

    scriviTitolo('Chilometraggio');
    scriviRiga('Km attuale', v.kmAttuale != null ? formattaNumero(v.kmAttuale) + ' km' : null);
    scriviRiga('Aggiornato il', v.dataKmAttuale ? formattaData(v.dataKmAttuale) : null);
    scriviRiga("Km all'acquisto", v.kmAcquisto != null ? formattaNumero(v.kmAcquisto) + ' km' : null);
    [...(v.storicoKm || [])].sort((a, b) => (a.data || '').localeCompare(b.data || '')).forEach((r) => {
      scriviRiga('Storico', `${formattaNumero(r.km)} km — ${formattaData(r.data)}`);
    });
    spazio(3);

    scriviTitolo('Proprietari');
    scriviRiga('Proprietario attuale', `${v.proprietarioAttuale.nome || '—'} (dal ${v.proprietarioAttuale.annoImmatricolazione ?? '—'})`);
    (v.storicoProprietariPrecedenti || []).forEach((p) => {
      scriviRiga('Precedente', `${p.nome || '—'} — immatricolato ${p.annoImmatricolazione ?? '—'} — ${p.residenza || '—'}`);
    });
    spazio(3);

    scriviTitolo('Bollo e assicurazione');
    scriviRiga('Scadenza bollo', v.bollo.scadenza ? formattaData(v.bollo.scadenza) : null);
    scriviRiga('Costo bollo', v.bollo.costo != null ? formattaValuta(v.bollo.costo) : null);
    scriviRiga('Scadenza assicurazione', v.assicurazione.scadenza ? formattaData(v.assicurazione.scadenza) : null);
    scriviRiga('Costo assicurazione', v.assicurazione.costo != null ? formattaValuta(v.assicurazione.costo) : null);
    scriviRiga('Rinnovo mensile', v.assicurazione.rinnovoMensile ? 'Sì' : 'No');
    spazio(3);

    scriviTitolo('Ruote');
    if ((v.ruote || []).length === 0) scriviRiga(null, 'Nessuna registrazione.');
    (v.ruote || []).forEach((r) => {
      scriviRiga(formattaData(r.data), `${r.marchio || '—'} — ${r.dimensioni || '—'}${r.note ? ' — ' + r.note : ''}`);
    });
    spazio(3);

    scriviTitolo('Libretto');
    scriviRiga('Documento', trovaFoto(v, v.libretto.fotoId) ? 'Foto caricata' : 'Non caricato');
    spazio(3);

    scriviTitolo('Bolletta bollo');
    scriviRiga('Documento', trovaFoto(v, v.bollettaBollo.fotoId) ? 'Foto caricata' : 'Non caricato');
    spazio(3);

    scriviTitolo('Manutenzioni');
    if ((v.manutenzioni || []).length === 0) scriviRiga(null, 'Nessuna manutenzione registrata.');
    [...(v.manutenzioni || [])].sort((a, b) => (b.data || '').localeCompare(a.data || '')).forEach((m) => {
      const tipo = m.tipo === 'straordinaria' ? 'Straordinaria' : 'Ordinaria';
      scriviRiga(`${formattaData(m.data)} (${tipo})`, `${m.descrizione || '—'} — ${m.esecutore || '—'} — ${m.costo != null ? formattaValuta(m.costo) : '—'}`);
    });
    spazio(3);

    scriviTitolo('Rifornimenti carburante');
    if ((v.rifornimenti || []).length === 0) scriviRiga(null, 'Nessun rifornimento registrato.');
    [...(v.rifornimenti || [])].sort((a, b) => (b.data || '').localeCompare(a.data || '')).forEach((r) => {
      scriviRiga(formattaData(r.data), `${r.litri != null ? r.litri + ' L' : '—'} — ${r.costo != null ? formattaValuta(r.costo) : '—'} — ${r.km != null ? formattaNumero(r.km) + ' km' : '—'}`);
    });
    spazio(3);

    scriviTitolo('Note');
    scriviRiga(null, v.note && v.note.trim() ? v.note : 'Nessuna nota.');

    doc.save(costruisciNomeFilePdf(v));
  } catch (err) {
    mostraToast('Errore durante la generazione del PDF: ' + (err && err.message ? err.message : 'errore sconosciuto'), 'errore');
  }
}

/** Reset totale dati: doppia conferma esplicita, poi svuota lo store veicoli via DB.resetTotale(). */
function gestisciResetTotale() {
  if (!confermaAzione('Questa operazione eliminerà DEFINITIVAMENTE tutti i veicoli salvati (attivi e archiviati). Continuare?')) return;
  if (!confermaAzione('Conferma di nuovo: sei assolutamente sicuro di voler cancellare tutti i dati? Non potrai recuperarli.')) return;

  DB.resetTotale().then(() => {
    mostraToast('Tutti i dati sono stati eliminati', 'successo');
    AppState.veicoliAttivi = [];
    AppState.veicoliArchiviati = [];
    statisticheInizializzate = false;
    statisticheSelezionate = new Set();
    mostraVista('home');
  }).catch((err) => mostraToast(err.message || 'Errore durante il reset', 'errore'));
}

/* ==========================================================
   INIZIALIZZAZIONE / WIRING GLOBALE
   ========================================================== */

/**
 * Naviga alla Home da qualsiasi vista. Se si è nel form dettaglio/modifica veicolo
 * con modifiche non salvate, chiede conferma esplicita prima di uscire (nessun
 * autosalvataggio: confermando, le modifiche pendenti vengono perse).
 */
function gestisciNavigazioneHome() {
  if (AppState.vistaCorrente === 'dettaglioVeicolo' && formSporco) {
    if (!confermaAzione('Ci sono modifiche non salvate. Uscire comunque?')) return;
  }
  formSporco = false;
  mostraVista('home');
}

/** Collega tutti i gestori di eventi globali (header, footer, menu, upload, impostazioni). */
function inizializzaGestoriGlobali() {
  document.getElementById('titolo-app').addEventListener('click', () => gestisciNavigazioneHome());
  document.getElementById('btn-nuovo-veicolo').addEventListener('click', (e) => { e.preventDefault(); apriDettaglio(null); });
  document.getElementById('link-torna-home').addEventListener('click', (e) => { e.preventDefault(); gestisciNavigazioneHome(); });

  document.querySelectorAll('.footer-nav a[data-vista-link]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      if (a.dataset.vistaLink === 'home') gestisciNavigazioneHome();
      else mostraVista(a.dataset.vistaLink);
    });
  });

  document.getElementById('overlay-menu-contestuale').addEventListener('click', (e) => {
    if (e.target.id === 'overlay-menu-contestuale') chiudiMenuContestuale();
  });

  document.getElementById('dettaglio-contenuto').addEventListener('click', gestisciClickDettaglio);
  document.getElementById('dettaglio-contenuto').addEventListener('input', () => { formSporco = true; });
  document.getElementById('dettaglio-contenuto').addEventListener('change', () => { formSporco = true; });

  document.getElementById('input-upload-foto').addEventListener('change', gestisciUploadFoto);
  document.getElementById('input-upload-libretto').addEventListener('change', gestisciUploadLibretto);
  document.getElementById('input-upload-bolletta-bollo').addEventListener('change', gestisciUploadBollettaBollo);
  document.getElementById('input-ripristino-backup').addEventListener('change', gestisciFileRipristino);

  document.getElementById('btn-backup').addEventListener('click', gestisciBackup);
  document.getElementById('btn-ripristino').addEventListener('click', gestisciRipristino);
  document.getElementById('btn-reset-totale').addEventListener('click', gestisciResetTotale);

  document.getElementById('stat-data-da').addEventListener('change', renderStatistiche);
  document.getElementById('stat-data-a').addEventListener('change', renderStatistiche);
}

document.addEventListener('DOMContentLoaded', () => {
  inizializzaGestoriGlobali();
  avviaApp();
});
