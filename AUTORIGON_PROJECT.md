# AUTORIGON — PROJECT FILE
**Versione documento:** 1.0
**Basato su:** PWA_PROJECT_TEMPLATE.md v1.0 (progetto origine: Cosa Comprare) — stack riadattato, backend cloud rimosso
**Stack di riferimento:** HTML5 + CSS3 + Vanilla JS + IndexedDB + Service Worker + GitHub Pages (solo hosting statico)

---

## COME USARE QUESTO FILE

1. Caricalo nel progetto Claude "Manutenzione auto" come file di contesto permanente.
2. I prompt per Claude Code per ogni fase vengono costruiti nella chat del progetto partendo dalle sezioni qui sotto.
3. Non saltare le fasi in Sezione 7: ogni fase ha un test obbligatorio prima di passare alla successiva.
4. Aggiorna la Sezione 10 (Report) al termine di ogni fase — è la memoria del progetto.

---

## INDICE

1. [Dati di Produzione](#1-dati-di-produzione)
2. [Visione e Obiettivi](#2-visione-e-obiettivi)
3. [Architettura Tecnica](#3-architettura-tecnica)
4. [Struttura Dati](#4-struttura-dati)
5. [Funzionalità Core](#5-funzionalità-core)
6. [Specifiche Grafiche e UI](#6-specifiche-grafiche-e-ui)
7. [Piano di Sviluppo — Fasi](#7-piano-di-sviluppo--fasi)
8. [Pattern Noti e Soluzioni](#8-pattern-noti-e-soluzioni)
9. [Standard di Qualità](#9-standard-di-qualità)
10. [Report di Progetto](#10-report-di-progetto)
11. [Procedure Operative](#11-procedure-operative)
12. [Glossario](#12-glossario)
13. [Assunzioni fatte da confermare](#13-assunzioni-fatte-da-confermare)

---

## 1. Dati di Produzione

| Risorsa | Valore |
|---|---|
| Nome app | AutoRigon |
| URL PWA | [DA DEFINIRE dopo Fase 5] |
| Repository GitHub | [DA DEFINIRE] |
| Hosting | GitHub Pages (solo file statici — nessun dato utente vi transita) |
| Backend | Nessuno — tutta la logica gira nel browser del dispositivo |
| Storage dati | IndexedDB (locale, sul dispositivo) |
| Versione attuale | v1.0.0 |
| Account richiesti | Nessuno |

---

## 2. Visione e Obiettivi

### 2.1 Descrizione
AutoRigon è un registro/diario personale dei veicoli: anagrafica, documenti, storico manutenzioni e statistiche di spesa, con tutti i dati custoditi esclusivamente sul dispositivo dell'utente.

### 2.2 Obiettivi Primari
- [ ] Gestione completa di N veicoli (aggiunta, modifica, archiviazione, eliminazione) senza limite imposto dall'app
- [ ] Ogni scheda veicolo contiene anagrafica, storico proprietari, storico km, bollo/assicurazione, libretto, manutenzioni, foto, note — tutto modificabile in ogni momento
- [ ] Esportazione di un backup completo (dati + foto) in un singolo file, e reimportazione dello stesso per ripristino totale
- [ ] Esportazione PDF per singolo veicolo, sempre aggiornata al contenuto corrente della scheda (nessun problema di cache tra un export e l'altro)
- [ ] Sezione statistiche con confronto tra veicoli, spese carburante, manutenzioni e costo totale su range configurabili
- [ ] Nessun dato utente lascia mai il dispositivo

### 2.3 Cosa NON fa questa versione
- Non sincronizza tra più dispositivi (il backup/ripristino manuale è l'unico modo per portare i dati da un device all'altro)
- Non invia notifiche push per scadenze bollo/assicurazione (possibile estensione futura, fuori scope v1)
- Non fa OCR automatico sui documenti caricati (libretto, bollo, fatture) — sono solo immagini allegate
- Non stima automaticamente il valore di mercato del veicolo
- Non richiede né gestisce alcun account (Google o altro)
- Se l'utente disinstalla l'app o cancella i dati del browser senza aver esportato un backup, i dati sono persi in modo irreversibile — non esiste una copia altrove

### 2.4 Utenti e Dispositivi
- Utenti: uso personale (Igor)
- Autenticazione: nessuna
- Dispositivi target: mobile Android (uso primario), installata come PWA da schermata home
- Account backend: nessuno — non applicabile

---

## 3. Architettura Tecnica

### 3.1 Stack Tecnologico

| Livello | Tecnologia | Note |
|---|---|---|
| Frontend | HTML5 + CSS3 + Vanilla JS | Tutto in `index.html`, nessun framework |
| PWA | Service Worker + Web App Manifest | Installabile, cache offline degli asset statici |
| Storage dati | IndexedDB | Un unico database `AutoRigonDB`, vedi 3.3 |
| Storage impostazioni leggere | localStorage | Solo preferenze UI (es. ultimo tab attivo), mai dati veicolo |
| Generazione PDF | Libreria client-side (es. jsPDF) vendorizzata localmente nel repo, non caricata da CDN a runtime | Vedi Assunzione A5 in Sezione 13 |
| Hosting | GitHub Pages | Solo per servire i file statici via HTTPS (richiesto per il Service Worker) |
| Backend | Nessuno | Nessuna chiamata di rete per dati utente, mai |

### 3.2 Schema di Comunicazione

```
[Dispositivo Android]
        |
        |  Tutto avviene qui: UI, logica, storage
        v
[IndexedDB locale — database "AutoRigonDB"]
  Object store: veicoli
  Object store: impostazioni

[Nessuna rete coinvolta per i dati utente]
[GitHub Pages serve solo index.html, manifest.json, sw.js, icone — file statici, non dati personali]
```

### 3.3 IndexedDB — Struttura Database

Sostituisce i "fogli Google" del template originale. Un solo database, due object store.

**Database:** `AutoRigonDB` (versione 1)

**Object store: `veicoli`**

| Campo chiave | Tipo | Note |
|---|---|---|
| `id` (keyPath) | string | generato lato client, es. `veicolo_` + timestamp |
| `stato` | string | `attivo` \| `archiviato` |
| resto dei campi | oggetto | vedi struttura completa in Sezione 4.1 |

Indice secondario su `stato` per filtrare rapidamente Home vs Archivio senza scansionare tutto lo store.

**Object store: `impostazioni`**

| Campo chiave | Tipo | Note |
|---|---|---|
| `chiave` (keyPath) | string | es. `ultimoBackup`, `versioneApp` |
| `valore` | any | |

### 3.4 Modulo Storage — Operazioni Esposte

Sostituisce le "operazioni Apps Script" del template. Sono funzioni JS interne, non chiamate di rete.

| Operazione | Tipo | Input | Output |
|---|---|---|---|
| `DB.getVeicoli(stato)` | lettura | `'attivo'` \| `'archiviato'` | array di oggetti veicolo |
| `DB.getVeicolo(id)` | lettura | id veicolo | oggetto veicolo completo |
| `DB.salvaVeicolo(oggetto)` | scrittura | oggetto veicolo (nuovo o aggiornato) | conferma sincrona (IndexedDB dà sempre conferma, a differenza di GAS) |
| `DB.eliminaVeicolo(id)` | scrittura | id veicolo | conferma |
| `DB.cambiaStato(id, nuovoStato)` | scrittura | id, `'attivo'`\|`'archiviato'` | conferma |
| `DB.esportaBackup()` | lettura massiva | — | oggetto JSON completo (tutti i veicoli + foto in base64) pronto per il download |
| `DB.importaBackup(jsonFile)` | scrittura massiva | file JSON da backup | sovrascrive/ripristina il database, con conferma esplicita dell'utente prima di procedere |

---

## 4. Struttura Dati

### 4.1 Oggetto Veicolo — struttura completa

```javascript
const veicolo = {
  id: "veicolo_" + Date.now(),
  stato: "attivo", // 'attivo' | 'archiviato'

  // Anagrafica
  nomeScheda: "",
  marca: "",
  modello: "",
  allestimento: "",
  colore: "",
  cilindrata: null,       // cm³
  potenza: null,           // CV
  targa: "",
  annoPrimaImmatricolazione: null,

  // Chilometraggio
  kmAcquisto: null,
  kmAttuale: null,
  dataKmAttuale: null,      // data dell'ultimo aggiornamento km
  storicoKm: [
    // { km: 0, data: "YYYY-MM-DD" } — una riga per ogni aggiornamento nel tempo
  ],

  // Proprietari
  storicoProprietariPrecedenti: [
    // { nome: "", annoImmatricolazione: null, residenza: "", note: "" }
  ],
  proprietarioAttuale: {
    nome: "",
    annoImmatricolazione: null
  },

  // Bollo e assicurazione
  bollo: {
    scadenza: null,      // data
    costo: null
  },
  assicurazione: {
    costo: null,
    scadenza: null,       // data
    rinnovoMensile: false
  },

  // Documenti (Blob/base64 immagine)
  libretto: { fotoId: null },      // riferimento a foto in store separato o base64 diretto — vedi Assunzione A2
  bollettaBollo: { fotoId: null }, // foto bollo o screenshot bonifico

  // Manutenzioni
  manutenzioni: [
    // { id, descrizione, costo, esecutore, data, tipo: 'ordinaria'|'straordinaria', fotoFatturaId }
  ],

  // Foto generiche
  foto: [
    // { id, blob/base64, copertina: true|false }
  ],

  note: ""
};
```

### 4.2 Nota su formato immagini

Le immagini (libretto, bollo, fatture, galleria foto) vengono salvate come `Blob` all'interno di IndexedDB durante l'uso normale dell'app (più efficiente di base64, IndexedDB supporta Blob nativamente). Solo al momento dell'esportazione backup vengono convertite in base64 e incorporate nel file JSON, per avere un unico file portabile — vedi Assunzione A1 in Sezione 13.

### 4.3 AppState — Struttura

```javascript
const AppState = {
  veicoliAttivi: [],
  veicoliArchiviati: [],
  vistaCorrente: 'home',      // 'home' | 'archivio' | 'statistiche' | 'impostazioni' | 'dettaglioVeicolo'
  veicoloSelezionatoId: null,
  menuContestualeApertoPer: null,  // id veicolo se un long-press ha aperto un menu
  backupInCorso: false
};
```

---

## 5. Funzionalità Core

### 5.1 Splash screen
- Descrizione visiva: schermata a schermo intero con logo AutoRigon (A nera su sfondo rosso Ferrari) all'apertura dell'app
- Interazione: nessuna, scompare automaticamente dopo il caricamento (breve durata fissa, es. 1–1.5s)
- Comportamento errore: se il caricamento di IndexedDB fallisce, mostra messaggio d'errore invece di procedere alla Home

### 5.2 Home — griglia veicoli
- Descrizione visiva: griglia di schede quadrate, una per veicolo con stato `attivo`, ciascuna con foto copertina (o placeholder) e nome scheda sotto
- Interazione: tap su scheda → apre dettaglio veicolo; pulsante "+" in alto a destra → apre form nuovo veicolo
- Comportamento errore: se non ci sono veicoli attivi, mostra stato vuoto con invito ad aggiungerne uno

### 5.3 Long-press su scheda (Home)
- Descrizione visiva: menu contestuale con opzioni "Archivia", "Elimina", "Esporta PDF"
- Interazione: pressione prolungata sulla scheda, menu si chiude al tap fuori o dopo selezione
- Comportamento errore: "Elimina" richiede conferma esplicita (dialog) prima di procedere, essendo irreversibile

### 5.4 Archivio
- Descrizione visiva: griglia analoga alla Home ma con veicoli `archiviato`
- Interazione: long-press → menu "Riabilita" (torna `attivo`) / "Elimina definitivamente" (con conferma)
- Comportamento errore: stato vuoto se nessun veicolo archiviato

### 5.5 Aggiunta/modifica veicolo
- Descrizione visiva: form con tutti i campi elencati in Sezione 4.1, organizzato in sezioni scrollabili, ciascuna con colore distintivo (vedi 6.2)
- Interazione: ogni sezione è modificabile in ogni momento anche dopo la creazione iniziale; salvataggio incrementale (non serve compilare tutto in un'unica sessione)
- Comportamento errore: validazione sui campi numerici (cilindrata, potenza, km) — blocca il salvataggio del singolo campo non valido, non dell'intera scheda

### 5.6 Storico km e storico proprietari
- Descrizione visiva: elenco a righe, ciascuna aggiungibile/eliminabile singolarmente, ordinato cronologicamente
- Interazione: pulsante "aggiungi riga" per entrambe le sezioni, senza limite di righe
- Comportamento errore: nessuna riga obbligatoria — sezioni vuote per default

### 5.7 Manutenzioni
- Descrizione visiva: lista storico interventi con badge colorato per tipo (ordinaria/straordinaria), possibilità di allegare foto fattura per riga
- Interazione: aggiunta/modifica/eliminazione singolo intervento
- Comportamento errore: costo opzionale, tutti gli altri campi richiesti prima di salvare la riga

### 5.8 Galleria foto e copertina
- Descrizione visiva: griglia foto libera, con indicatore sulla foto scelta come copertina
- Interazione: tap lungo su una foto → "Imposta come copertina"; solo una foto può essere copertina alla volta
- Comportamento errore: se nessuna foto è impostata come copertina, la scheda in Home mostra un placeholder generico

### 5.9 Esportazione PDF
- Descrizione visiva: PDF con grafica pulita, intestazione con nome scheda e targa, tutte le sezioni della scheda in ordine leggibile
- Interazione: da menu long-press → genera e scarica subito il PDF con nome file univoco (timestamp incluso)
- Comportamento errore: se la generazione fallisce (es. libreria PDF non caricata), messaggio d'errore esplicito, nessun file corrotto scaricato — vedi Pattern P01 in Sezione 8

### 5.10 Backup — esportazione
- Descrizione visiva: pulsante in Impostazioni "Esporta backup completo"
- Interazione: genera un file `.json` con tutti i veicoli, storici, e foto in base64; nome file con data (es. `AutoRigon_backup_20260803.json`)
- Comportamento errore: se il backup supera dimensioni gestibili dal browser per il download, mostra avviso (vedi Pattern P03)

### 5.11 Backup — importazione/ripristino
- Descrizione visiva: pulsante in Impostazioni "Ripristina da backup", con selezione file
- Interazione: richiede conferma esplicita prima di sovrascrivere i dati correnti (dialog con avviso "operazione irreversibile")
- Comportamento errore: se il file non è un backup AutoRigon valido, rifiuta l'importazione con messaggio chiaro, dati correnti non toccati

### 5.12 Statistiche
- Descrizione visiva: sezione dedicata in footer, selezione multipla veicoli tramite checkbox/chip, grafici e numeri aggregati
- Interazione: filtro per range temporale personalizzabile; toggle tra vista singolo veicolo e comparativa
- Contenuto minimo richiesto:
  - Spese carburante nel tempo, con stima su range selezionato
  - Grafico manutenzioni per costo e per tipo (ordinaria/straordinaria)
  - Costo totale veicolo su range configurabile (bollo + assicurazione + manutenzioni + lavaggi)
- Statistiche aggiuntive proposte (da confermare, non obbligatorie in v1):
  - Costo medio al km (costo totale periodo / km percorsi nel periodo)
  - Andamento chilometraggio nel tempo (grafico a partire dallo storico km)
  - Conto alla rovescia su scadenza bollo/assicurazione più vicina tra i veicoli attivi
  - Ripartizione spesa per categoria (carburante / manutenzione / bollo / assicurazione / lavaggi) a torta
- Comportamento errore: se un veicolo selezionato non ha dati sufficienti nel range, mostra "dati insufficienti" invece di un grafico vuoto fuorviante

### 5.13 Impostazioni
- Descrizione visiva: sezione footer con backup/ripristino, informazioni versione app, eventuale reset totale dati
- Interazione: reset totale richiede doppia conferma (irreversibile)
- Comportamento errore: —

---

## 6. Specifiche Grafiche e UI

### 6.1 Stile Generale
- Tema: scuro, premium
- Ispirazione: riferimento fornito da Igor (screenshot stile dashboard/scheda) — dark con superfici a contrasto, sfumature morbide su sfondi e card, accenti netti sul colore primario
- Font: system font stack (nessun caricamento esterno, per garantire resa anche offline al primo avvio)

### 6.2 Palette Colori (proposta da confermare — Assunzione A3)

| Nome | Hex | Utilizzo |
|---|---|---|
| Sfondo principale | `#0A0A0A` | Sfondo app |
| Superficie card | `#1A1A1A` → sfumatura verso `#141414` | Schede veicolo, pannelli |
| Rosso Ferrari (accento primario) | `#D40000` | Pulsanti principali, icona, badge attivi |
| Rosso Ferrari scuro (sfumatura) | `#8C0000` | Gradiente su header/pulsanti |
| Testo primario | `#F5F5F5` | Titoli, valori |
| Testo secondario | `#9A9A9A` | Etichette, note |
| Colore sezione Libretto | `#2A4D6E` (blu petrolio) | Sfondo/bordo sezione |
| Colore sezione Bollo | `#6E5A2A` (ambra scuro) | Sfondo/bordo sezione |
| Colore sezione Manutenzioni | `#3A6E4D` (verde scuro) | Sfondo/bordo sezione |
| Colore sezione Foto | `#5A2A6E` (viola scuro) | Sfondo/bordo sezione |
| Colore sezione Note | `#4A4A4A` (grigio neutro) | Sfondo/bordo sezione |

### 6.3 Layout Struttura

```
┌─────────────────────────┐
│  AutoRigon        [+]   │  ← header con pulsante aggiungi
├─────────────────────────┤
│  ┌──────┐  ┌──────┐     │
│  │ Auto │  │ Auto │     │  ← griglia schede quadrate
│  │  1   │  │  2   │     │
│  └──────┘  └──────┘     │
│                          │
├─────────────────────────┤
│  [Archivio][Stat][Impost]│  ← footer navigazione
└─────────────────────────┘
```

### 6.4 Componenti Chiave

**Scheda veicolo (Home/Archivio):**
```css
background: linear-gradient(160deg, #1A1A1A, #141414);
border-radius: 16px;
padding: 12px;
aspect-ratio: 1 / 1;
```

**Pulsante primario:**
```css
background: linear-gradient(135deg, #D40000, #8C0000);
border-radius: 12px;
padding: 12px 20px;
```

**Sezione scheda veicolo (es. Manutenzioni):**
```css
border-left: 4px solid #3A6E4D;
background: rgba(58, 110, 77, 0.08);
border-radius: 8px;
padding: 16px;
```

### 6.5 Icona App
- Dimensioni richieste: `icon-512.png` (512×512px) e `icon-192.png` (192×192px)
- Design: lettera "A" nera, font moderno sans-serif, centrata
- Sfondo: rosso Ferrari pieno (`#D40000`) o con leggera sfumatura verso `#8C0000`
- Simbolo: solo la lettera, nessun elemento aggiuntivo
- Nota: il sistema operativo applica la maschera arrotondata automaticamente — il PNG va fornito quadrato pieno

---

## 7. Piano di Sviluppo — Fasi

**Regola fondamentale:** non si passa alla fase successiva senza aver completato il test della fase corrente.

---

### FASE 1 — Struttura Dati e IndexedDB (Storage locale)

**Obiettivo:** modulo `DB` funzionante e testabile da console prima di costruire qualsiasi interfaccia.

**Chi esegue:** Claude Code, guidato dal prompt costruito nella chat del progetto.

**Contenuto del prompt per Claude Code:**
*Costruito partendo da: struttura database (Sezione 3.3), operazioni (Sezione 3.4), oggetto veicolo (Sezione 4.1).*

**Test Fase 1 — obbligatorio prima di procedere:**
- [ ] `DB.salvaVeicolo(oggettoTest)` seguito da `DB.getVeicoli('attivo')` restituisce l'oggetto salvato
- [ ] `DB.cambiaStato(id, 'archiviato')` sposta correttamente il veicolo tra le due liste
- [ ] `DB.eliminaVeicolo(id)` rimuove il veicolo in modo permanente
- [ ] Chiudendo e riaprendo la pagina, i dati salvati sono ancora presenti (persistenza IndexedDB verificata)

**Compilare al termine:** Report Fase 1 in Sezione 10

---

### FASE 2 — Struttura HTML/CSS Base

**Obiettivo:** struttura statica con grafica definitiva, senza logica JS. Approvazione visiva prima di aggiungere codice.

**Prerequisito:** Sezione 6 compilata e approvata.

**Il prompt deve specificare:**
- Tutto il CSS in un tag `<style>` nel `<head>`
- Nessun JavaScript funzionale in questa fase (dati statici di esempio)
- Test a 320px di larghezza minima

**Test Fase 2:**
- [ ] Layout corretto a 320px e 390px, nessun overflow orizzontale
- [ ] Palette e componenti approvati visivamente
- [ ] Tutte le 5 sotto-sezioni della scheda veicolo visivamente distinte per colore

---

### FASE 3 — Logica JavaScript Core (collegata a IndexedDB)

**Obiettivo:** tutte le funzionalità di Sezione 5 operative, collegate al modulo `DB` della Fase 1. A differenza del template originale (che prevedeva prima dati in memoria e poi backend separato), qui le due fasi si uniscono: non esiste un "backend" da integrare dopo, IndexedDB è già la fonte dati reale.

**Prerequisito:** Fase 1 e Fase 2 completate e approvate.

**Struttura obbligatoria:**
- Un unico oggetto `AppState` con lo stato di navigazione (Sezione 4.3)
- Ogni funzione con commento JSDoc minimo
- Nessuna chiamata `fetch` verso l'esterno in nessuna fase del progetto

**Test Fase 3:**
- [ ] Tutte le funzionalità di Sezione 5 (5.2–5.13) funzionano senza errori in console
- [ ] Nessuna regressione sul layout della Fase 2
- [ ] Long-press, menu contestuali, form e statistiche tutti operativi

---

### FASE 4 — Esportazione/Importazione Backup e PDF

**Obiettivo:** funzioni di backup completo e generazione PDF, con attenzione ai pattern noti (Sezione 8).

**Prerequisito:** Fase 3 completata.

**Il prompt deve specificare:**
- `DB.esportaBackup()` e `DB.importaBackup()` come da Sezione 3.4
- Generazione PDF con nome file univoco per ogni export (Pattern P01)
- Libreria PDF vendorizzata nel repo, non da CDN (vedi Assunzione A5)

**Test Fase 4:**
- [ ] Backup esportato e reimportato su un profilo browser pulito ripristina tutti i dati, incluse le foto
- [ ] Due export PDF consecutivi sullo stesso veicolo, con una modifica in mezzo, producono due file distinti con contenuto aggiornato

---

### FASE 5 — PWA (Manifest + Service Worker)

**Obiettivo:** app installabile su schermata home.

**Prerequisito:** icone pronte (512×512 e 192×192px).

**File da creare:**
- `manifest.json`
- `sw.js` — cache-first per asset statici; **non deve mai intercettare o cachare le risposte legate a IndexedDB** (non applicabile via rete, ma attenzione a non cachare in modo scorretto il PDF generato — vedi Pattern P01)

**Test Fase 5** *(richiede HTTPS — testare su GitHub Pages)*:
- [ ] Banner "Aggiungi a schermata Home" su Chrome Android
- [ ] Apertura standalone
- [ ] Funzionamento offline completo (l'app non ha comunque mai bisogno di rete per i dati)

---

### FASE 6 — Pulizia, Ottimizzazione e Deploy Definitivo

**Checklist obbligatoria:**
- Rimuovi tutti i `console.log`/`console.error` di debug
- Ogni `catch` mostra feedback visivo, non solo log
- Validazione input numerici con `min`/`step` sull'HTML
- `CACHE_NAME` aggiornato alla versione finale
- Verifica layout a 320px

**File da creare/aggiornare:** `README.md` con descrizione, come fare backup, come aggiornare l'app

**Deploy:**
1. Repository GitHub (pubblico per GitHub Pages gratuito — nessun dato utente nel repo, solo codice)
2. Carica: `index.html`, `manifest.json`, `sw.js`, icone, libreria PDF vendorizzata, `README.md`
3. Settings → Pages → Branch main → Save
4. URL in Sezione 1

**Test Fase 6:**
- [ ] Ciclo completo end-to-end su dispositivo reale Android
- [ ] Nessun errore rosso in console
- [ ] PWA reinstallata dall'URL definitivo mantiene i dati (o correttamente parte vuota se è una reinstallazione pulita — da verificare quale comportamento ha il browser)

---

## 8. Pattern Noti e Soluzioni

---

### P01 — Esportazione PDF che restituisce sempre la prima versione (cache)
**Progetto origine:** "Budget" (progetto precedente di Igor)
**Problema:** esportazioni PDF ripetute a distanza di tempo restituivano sempre la prima versione generata, finché non si eliminavano manualmente i vecchi file dal telefono.
**Soluzione:** ogni esportazione genera un file con nome univoco (timestamp incluso, es. `AutoRigon_[targa]_20260803_143201.pdf`), e il contenuto del PDF viene generato da zero ad ogni click leggendo lo stato corrente della scheda da IndexedDB — mai da una versione cachata in memoria o in variabili non aggiornate.
**Prevenzione:** nel prompt Fase 4, specificare esplicitamente che la funzione di export deve rileggere i dati freschi da `DB.getVeicolo(id)` immediatamente prima di generare il PDF, non riusare un oggetto già in memoria da un render precedente.

---

### P02 — Quota di storage IndexedDB
**Problema potenziale:** IndexedDB ha limiti di quota legati allo spazio disponibile sul dispositivo/browser; con molte foto ad alta risoluzione la quota potrebbe saturarsi.
**Soluzione:** comprimere/ridimensionare le immagini lato client prima del salvataggio (es. lato più lungo massimo 1600px, qualità JPEG ~0.8) — vedi Assunzione A4.
**Prevenzione:** gestire l'errore `QuotaExceededError` con un messaggio chiaro all'utente invece di un crash silenzioso.

---

### P03 — File di backup molto grande
**Problema potenziale:** con molte foto in base64 nel JSON di backup, il file può diventare pesante (base64 aumenta le dimensioni di circa il 33% rispetto al file binario originale).
**Soluzione:** compressione immagini come in P02 riduce anche il peso del backup; se il file supera dimensioni gestibili, avvisare l'utente ma comunque completare l'export (la responsabilità della gestione del file è dell'utente, come da Sezione 2).

---

### P04 — Perdita dati per mancato backup
**Problema potenziale:** essendo tutto locale, disinstallare l'app, cancellare i dati del browser o cambiare dispositivo senza aver esportato un backup comporta perdita irreversibile.
**Soluzione:** promemoria visivo in Impostazioni con data dell'ultimo backup effettuato (salvato in object store `impostazioni`), per rendere visibile quanto tempo è passato dall'ultimo export.

---

## 9. Standard di Qualità

### 9.1 Checklist per ogni Fase
- [ ] Nessun errore rosso in console
- [ ] Funzionalità target verificata su dispositivo reale Android
- [ ] Nessuna regressione sulle fasi precedenti
- [ ] Codice leggibile, commenti JSDoc sulle funzioni
- [ ] Nessuna chiamata di rete introdotta per dati utente
- [ ] Report della fase compilato in Sezione 10

### 9.2 Comportamento Errori Standard

| Scenario | Comportamento atteso |
|---|---|
| IndexedDB non disponibile/bloccato dal browser | Messaggio esplicito, app non utilizzabile senza storage locale funzionante |
| Quota storage superata | Messaggio chiaro, salvataggio bloccato, nessun dato corrotto |
| Import backup non valido | Rifiutato con messaggio chiaro, dati correnti intatti |
| Generazione PDF fallita | Messaggio errore, nessun file corrotto scaricato |
| Input non valido | Validazione blocca, focus torna sull'input, nessun salvataggio parziale |

### 9.3 Cosa NON delegare a Claude Code
- Scelta e creazione delle icone app
- Deploy su GitHub (operazione manuale)
- Decisioni di design (palette, layout) — vanno confermate in Sezione 6 prima di scrivere codice
- Scelta finale della libreria PDF da vendorizzare (Claude Code la implementa una volta scelta/confermata)

### 9.4 Limitazioni Note dello Stack
- **Nessuna sincronizzazione multi-dispositivo:** ogni installazione ha i propri dati locali indipendenti
- **Responsabilità del backup:** interamente sull'utente, l'app non fa backup automatici su cloud per design
- **Supporto browser:** IndexedDB è supportato da tutti i browser Android moderni, ma va verificato il comportamento in modalità di navigazione privata (dati non persistenti in alcuni browser)
- **Nessuna conferma "di rete":** a differenza del pattern fire-and-forget del template originale, qui IndexedDB conferma sempre in modo sincrono il salvataggio — nessuna sync successiva necessaria

---

## 10. Report di Progetto

### Template Report
```
--- REPORT FASE [N] ---
Data completamento:
Fase: [nome]
Stato: ✅ Completata / ⚠️ Completata con deviazioni / ❌ In sospeso

COSA È STATO COSTRUITO:
[Descrizione in linguaggio semplice]

STRUTTURA TECNICA:
[File creati o modificati]

DECISIONI PRESE:
[Scelte diverse dalle specifiche originali, con motivazione]

PROBLEMI RISCONTRATI:
[Errori incontrati e come sono stati risolti]

TEST ESEGUITI:
[Elenco test con esito ✅ / ❌]

PROSSIMO STEP:
[Fase successiva e prerequisiti]
--- FINE REPORT FASE [N] ---
```

### Report Fase 0 — Setup e Pianificazione
```
--- REPORT FASE 0 ---
Data completamento: 2026-08-03
Fase: Setup, Pianificazione e Design
Stato: ⚠️ Completata con deviazioni (in attesa di conferma assunzioni — Sezione 13)

COSA È STATO COSTRUITO:
Questo file di contesto (AUTORIGON_PROJECT.md), a partire dal PWA_PROJECT_TEMPLATE.md
e dalle specifiche fornite da Igor. Nessun codice ancora scritto.

STRUTTURA TECNICA:
- AUTORIGON_PROJECT.md (questo file)

DECISIONI PRESE:
Stack riadattato da GAS+Sheets a IndexedDB 100% locale, per il vincolo esplicito di
Igor sui dati sensibili che non devono mai andare online. Vedi Sezione 13 per il
dettaglio di tutte le assunzioni tecniche prese in questa fase.

PROBLEMI RISCONTRATI:
Nessuno.

TEST ESEGUITI:
- Sezione 2 (Obiettivi) compilata — da approvare ❌
- Sezione 3 (Architettura) compilata — da approvare ❌
- Sezione 4 (Struttura Dati) compilata — da approvare ❌
- Sezione 5 (Funzionalità) compilata — da approvare ❌
- Sezione 6 (Grafica) compilata — da approvare ❌ (palette proposta, non confermata)

PROSSIMO STEP:
Conferma delle assunzioni in Sezione 13, poi Fase 1 — costruire il prompt per il
modulo DB (IndexedDB) nella chat del progetto Claude.
--- FINE REPORT FASE 0 ---
```

---

## 11. Procedure Operative

### 11.1 Come aggiornare l'app (index.html)
1. Modifica `index.html` in locale
2. Aggiorna `CACHE_NAME` in `sw.js` — obbligatorio per invalidare la cache dei visitatori esistenti
3. Push su GitHub → GitHub Pages si aggiorna entro 1-2 minuti
4. Sul telefono: chiudi e riapri la PWA per scaricare il nuovo Service Worker

### 11.2 Come vedere i dati grezzi
- Su Chrome Android/Desktop: DevTools → Application → IndexedDB → `AutoRigonDB`
- I dati sono visibili e ispezionabili ma non vanno modificati manualmente da lì (rischio di corrompere la struttura attesa dall'app)

### 11.3 Come fare un backup
- Impostazioni → "Esporta backup completo" → salva il file `.json` generato nel proprio cloud personale (Drive, altro)

### 11.4 Cosa fare se qualcosa smette di funzionare
1. Controlla la console del browser (Chrome DevTools → Console) per errori
2. Verifica che IndexedDB non sia bloccato (modalità privata, impostazioni privacy browser)
3. Se i dati sembrano corrotti, ripristina dall'ultimo backup esportato
4. Se il problema persiste dopo un aggiornamento, verifica che `CACHE_NAME` sia stato incrementato in `sw.js`

---

## 12. Glossario

| Termine | Significato |
|---|---|
| PWA | Progressive Web App — installabile su mobile, funziona offline |
| Service Worker (SW) | Script in background che gestisce cache e funzionamento offline |
| IndexedDB | Database del browser, locale al dispositivo, adatto a grandi volumi di dati incluse immagini (Blob) |
| Object store | L'equivalente di una "tabella" dentro un database IndexedDB |
| Blob | Formato binario per file (es. immagini) più efficiente del base64 per lo storage interno |
| base64 | Codifica testuale di dati binari, usata solo nel file di backup per portabilità |
| AppState | Oggetto JS unico con lo stato di navigazione dell'app |
| CACHE_NAME | Identificatore versione della cache del Service Worker — va aggiornato ad ogni deploy che modifica gli asset |
| cache-first | Strategia SW: controlla la cache locale prima di andare in rete |
| GitHub Pages | Hosting statico gratuito con HTTPS automatico, usato solo per servire i file dell'app |
| vendorizzare | Includere una libreria esterna come file locale nel repo, invece di caricarla da CDN a runtime |

---

## 13. Assunzioni fatte da confermare

Punti su cui non avevi dato un'indicazione esplicita e su cui ho dovuto decidere per poter compilare il documento. Da confermare o correggere prima di iniziare la Fase 1.

- **A1 — Formato di export del backup:** ho scelto JSON singolo con foto incorporate in base64, per avere un solo file da gestire nei tuoi cloud personali. Alternativa scartata: JSON + archivio foto separato (più leggero da aprire ma richiede gestire due file collegati). Se preferisci la seconda opzione, va invertita qui.
- **A2 — Storage interno immagini:** Blob in IndexedDB durante l'uso normale (più efficiente), conversione a base64 solo al momento dell'export. Alternativa scartata: base64 ovunque, più semplice da implementare ma più pesante per lo storage quotidiano.
- **A3 — Palette colori:** proposta nero + rosso Ferrari con 5 colori distinti per le sotto-sezioni della scheda veicolo (Sezione 6.2). Sono valori di partenza plausibili, non hai fornito codici hex specifici — da confermare visivamente in Fase 2.
- **A4 — Compressione immagini:** ho assunto un ridimensionamento automatico (max 1600px lato lungo, qualità JPEG ~0.8) prima del salvataggio, per contenere la quota IndexedDB e il peso del backup. Se preferisci mantenere le foto alla risoluzione originale, va rimossa questa logica (a costo di file più pesanti).
- **A5 — Libreria per generazione PDF:** ho assunto una libreria vendorizzata localmente nel repo (es. jsPDF) invece che caricata da CDN, per coerenza con il principio "tutto funziona in loco" anche se non si tratta di dati utente. Se per te va bene anche una dipendenza da CDN (più semplice da aggiornare, ma richiede rete al primo caricamento non cachato), fammelo sapere.
- **A6 — "Cosa non fa questa versione" (Sezione 2.3):** lista proposta da me in base al perimetro che hai descritto — nessuna sync multi-dispositivo, nessuna notifica scadenze, nessun OCR, nessuna stima valore auto. Confermami se va bene o se qualcosa va spostato dentro lo scope v1.
- **A7 — Comportamento alla reinstallazione della PWA:** non hai specificato se ci si aspetta che i dati sopravvivano a una disinstallazione/reinstallazione dell'app (dipende dal comportamento del browser verso IndexedDB, non è garantito). Ho segnalato il punto come verifica da fare in Fase 6 (test), non ho assunto un comportamento specifico.
