/**
 * db.js — Modulo di accesso a IndexedDB per l'app AutoRigon.
 * Vanilla JS, nessun framework, nessuna dipendenza esterna, nessuna chiamata di rete.
 *
 * Espone l'oggetto globale `DB` con le funzioni di lettura/scrittura sul database
 * "AutoRigonDB", composto da due object store:
 *  - "veicoli"      (keyPath: "id", indice secondario su "stato")
 *  - "impostazioni" (keyPath: "chiave")
 *
 * Storico versioni schema:
 *  - v1: creazione iniziale di "veicoli" (+ indice "stato") e "impostazioni".
 *  - v2: verifica di integrità dell'indice "stato" in onupgradeneeded — se un
 *        database locale aveva già un indice "stato" con keyPath o flag "unique"
 *        non corretti, viene eliminato e ricreato correttamente.
 */

const DB = (function () {
  'use strict';

  const DB_NAME = 'AutoRigonDB';
  const DB_VERSION = 2;
  const STORE_VEICOLI = 'veicoli';
  const STORE_IMPOSTAZIONI = 'impostazioni';
  const INDEX_STATO = 'stato';

  /** @type {IDBDatabase|null} */
  let dbInstance = null;

  /**
   * Converte un DOMException/Event di errore IndexedDB in un messaggio leggibile.
   * Gestisce esplicitamente il caso QuotaExceededError (storage pieno).
   * @param {any} error - Oggetto errore ricevuto da un IDBRequest/IDBTransaction.
   * @param {string} contesto - Descrizione dell'operazione in corso, per il messaggio.
   * @returns {Error} Errore con messaggio leggibile pronto per essere rigettato.
   */
  function creaErroreLeggibile(error, contesto) {
    const nome = error && error.name ? error.name : 'ErroreSconosciuto';
    if (nome === 'QuotaExceededError') {
      return new Error(
        `Spazio di archiviazione esaurito durante "${contesto}". ` +
        `Libera spazio sul dispositivo o rimuovi foto/veicoli non necessari e riprova.`
      );
    }
    const messaggioOriginale = error && error.message ? error.message : String(error);
    return new Error(`Errore durante "${contesto}" (${nome}): ${messaggioOriginale}`);
  }

  /**
   * Apre (creando se necessario) il database AutoRigonDB, gestendo l'upgrade di versione
   * con la creazione degli object store e dell'indice secondario richiesti.
   * Le chiamate successive riutilizzano la stessa connessione già aperta.
   * @returns {Promise<IDBDatabase>} Promise che risolve con l'istanza del database aperto.
   * @throws Rigetta la Promise se l'apertura del database fallisce o è bloccata.
   */
  function init() {
    if (dbInstance) {
      return Promise.resolve(dbInstance);
    }

    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error('Questo browser non supporta IndexedDB: impossibile inizializzare il database.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        let storeVeicoli;
        if (!db.objectStoreNames.contains(STORE_VEICOLI)) {
          storeVeicoli = db.createObjectStore(STORE_VEICOLI, { keyPath: 'id' });
        } else {
          storeVeicoli = event.target.transaction.objectStore(STORE_VEICOLI);
        }
        if (storeVeicoli.indexNames.contains(INDEX_STATO)) {
          const indiceEsistente = storeVeicoli.index(INDEX_STATO);
          const keyPathCorretto = indiceEsistente.keyPath === 'stato' && indiceEsistente.unique === false;
          if (!keyPathCorretto) {
            storeVeicoli.deleteIndex(INDEX_STATO);
            storeVeicoli.createIndex(INDEX_STATO, 'stato', { unique: false });
          }
        } else {
          storeVeicoli.createIndex(INDEX_STATO, 'stato', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_IMPOSTAZIONI)) {
          db.createObjectStore(STORE_IMPOSTAZIONI, { keyPath: 'chiave' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = event.target.result;
        dbInstance.onversionchange = () => {
          dbInstance.close();
          dbInstance = null;
        };
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        reject(creaErroreLeggibile(event.target.error, 'apertura del database'));
      };

      request.onblocked = () => {
        reject(new Error(
          'Apertura del database bloccata: chiudi le altre schede/finestre che usano AutoRigon e riprova.'
        ));
      };
    });
  }

  /**
   * Restituisce l'elenco dei veicoli filtrati per stato, usando l'indice secondario
   * "stato" per evitare la scansione completa dello store.
   * @param {"attivo"|"archiviato"} stato - Stato dei veicoli da recuperare.
   * @returns {Promise<Array<Object>>} Promise che risolve con l'array di oggetti veicolo.
   * @throws Rigetta la Promise se lo stato non è valido o la lettura fallisce.
   */
  function getVeicoli(stato) {
    if (stato !== 'attivo' && stato !== 'archiviato') {
      return Promise.reject(new Error(`Stato non valido: "${stato}". Valori ammessi: "attivo" | "archiviato".`));
    }

    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_VEICOLI, 'readonly');
        const store = tx.objectStore(STORE_VEICOLI);
        const index = store.index(INDEX_STATO);
        const risultati = [];

        const request = index.openCursor(IDBKeyRange.only(stato));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            risultati.push(cursor.value);
            cursor.continue();
          } else {
            resolve(risultati);
          }
        };
        request.onerror = (event) => {
          reject(creaErroreLeggibile(event.target.error, `lettura veicoli con stato "${stato}"`));
        };
      });
    });
  }

  /**
   * Recupera un singolo veicolo dato il suo id.
   * @param {string} id - Identificativo del veicolo (es. "veicolo_1699999999999").
   * @returns {Promise<Object|null>} Promise che risolve con l'oggetto veicolo, o null se non trovato.
   * @throws Rigetta la Promise se la lettura fallisce.
   */
  function getVeicolo(id) {
    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_VEICOLI, 'readonly');
        const store = tx.objectStore(STORE_VEICOLI);
        const request = store.get(id);

        request.onsuccess = (event) => {
          resolve(event.target.result || null);
        };
        request.onerror = (event) => {
          reject(creaErroreLeggibile(event.target.error, `lettura veicolo "${id}"`));
        };
      });
    });
  }

  /**
   * Salva un veicolo: lo crea se non esiste, lo sovrascrive se esiste già (usa "put").
   * @param {Object} veicolo - Oggetto veicolo completo, deve contenere il campo "id".
   * @returns {Promise<string>} Promise che risolve con l'id del veicolo salvato.
   * @throws Rigetta la Promise se manca il campo "id", se lo storage è esaurito
   *         (QuotaExceededError) o se la scrittura fallisce per altri motivi.
   */
  function salvaVeicolo(veicolo) {
    if (!veicolo || typeof veicolo.id !== 'string' || veicolo.id.length === 0) {
      return Promise.reject(new Error('Impossibile salvare il veicolo: campo "id" mancante o non valido.'));
    }

    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_VEICOLI, 'readwrite');
        const store = tx.objectStore(STORE_VEICOLI);
        const request = store.put(veicolo);

        request.onsuccess = () => {
          resolve(veicolo.id);
        };
        request.onerror = (event) => {
          reject(creaErroreLeggibile(event.target.error, `salvataggio veicolo "${veicolo.id}"`));
        };
      });
    });
  }

  /**
   * Elimina permanentemente un veicolo dal database.
   * @param {string} id - Identificativo del veicolo da eliminare.
   * @returns {Promise<void>} Promise che risolve quando l'eliminazione è completata.
   * @throws Rigetta la Promise se l'eliminazione fallisce.
   */
  function eliminaVeicolo(id) {
    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_VEICOLI, 'readwrite');
        const store = tx.objectStore(STORE_VEICOLI);
        const request = store.delete(id);

        request.onsuccess = () => {
          resolve();
        };
        request.onerror = (event) => {
          reject(creaErroreLeggibile(event.target.error, `eliminazione veicolo "${id}"`));
        };
      });
    });
  }

  /**
   * Aggiorna solo il campo "stato" di un veicolo esistente, lasciando invariato il resto.
   * @param {string} id - Identificativo del veicolo.
   * @param {"attivo"|"archiviato"} nuovoStato - Nuovo valore dello stato.
   * @returns {Promise<void>} Promise che risolve quando l'aggiornamento è completato.
   * @throws Rigetta la Promise se lo stato non è valido, se il veicolo non esiste,
   *         o se la scrittura fallisce (incluso QuotaExceededError).
   */
  function cambiaStato(id, nuovoStato) {
    if (nuovoStato !== 'attivo' && nuovoStato !== 'archiviato') {
      return Promise.reject(new Error(`Stato non valido: "${nuovoStato}". Valori ammessi: "attivo" | "archiviato".`));
    }

    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_VEICOLI, 'readwrite');
        const store = tx.objectStore(STORE_VEICOLI);
        const getRequest = store.get(id);

        getRequest.onsuccess = (event) => {
          const veicolo = event.target.result;
          if (!veicolo) {
            reject(new Error(`Nessun veicolo trovato con id "${id}": impossibile cambiare stato.`));
            return;
          }
          veicolo.stato = nuovoStato;
          const putRequest = store.put(veicolo);
          putRequest.onsuccess = () => {
            resolve();
          };
          putRequest.onerror = (ev) => {
            reject(creaErroreLeggibile(ev.target.error, `cambio stato veicolo "${id}"`));
          };
        };
        getRequest.onerror = (event) => {
          reject(creaErroreLeggibile(event.target.error, `lettura veicolo "${id}" per cambio stato`));
        };
      });
    });
  }

  /**
   * Elimina permanentemente tutti i veicoli dallo store "veicoli" (reset totale dati).
   * Non tocca lo store "impostazioni".
   * @returns {Promise<void>} Promise che risolve quando lo svuotamento è completato.
   * @throws Rigetta la Promise se l'operazione fallisce.
   */
  function resetTotale() {
    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_VEICOLI, 'readwrite');
        const store = tx.objectStore(STORE_VEICOLI);
        const request = store.clear();

        request.onsuccess = () => {
          resolve();
        };
        request.onerror = (event) => {
          reject(creaErroreLeggibile(event.target.error, 'reset totale dei veicoli'));
        };
      });
    });
  }

  /**
   * Recupera il valore di un'impostazione salvata.
   * @param {string} chiave - Nome dell'impostazione (es. "ultimoBackup", "versioneApp").
   * @returns {Promise<any>} Promise che risolve con il valore salvato, o null se non presente.
   * @throws Rigetta la Promise se la lettura fallisce.
   */
  function getImpostazione(chiave) {
    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_IMPOSTAZIONI, 'readonly');
        const store = tx.objectStore(STORE_IMPOSTAZIONI);
        const request = store.get(chiave);

        request.onsuccess = (event) => {
          const record = event.target.result;
          resolve(record ? record.valore : null);
        };
        request.onerror = (event) => {
          reject(creaErroreLeggibile(event.target.error, `lettura impostazione "${chiave}"`));
        };
      });
    });
  }

  /**
   * Imposta (crea o sovrascrive) il valore di un'impostazione.
   * @param {string} chiave - Nome dell'impostazione.
   * @param {any} valore - Valore da salvare (qualsiasi tipo strutturabile da IndexedDB).
   * @returns {Promise<void>} Promise che risolve quando il salvataggio è completato.
   * @throws Rigetta la Promise se lo storage è esaurito (QuotaExceededError) o la scrittura fallisce.
   */
  function setImpostazione(chiave, valore) {
    if (typeof chiave !== 'string' || chiave.length === 0) {
      return Promise.reject(new Error('Impossibile salvare l\'impostazione: "chiave" mancante o non valida.'));
    }

    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_IMPOSTAZIONI, 'readwrite');
        const store = tx.objectStore(STORE_IMPOSTAZIONI);
        const request = store.put({ chiave: chiave, valore: valore });

        request.onsuccess = () => {
          resolve();
        };
        request.onerror = (event) => {
          reject(creaErroreLeggibile(event.target.error, `salvataggio impostazione "${chiave}"`));
        };
      });
    });
  }

  /**
   * Converte ricorsivamente ogni Blob presente in un valore (oggetto/array annidato)
   * in un marcatore serializzabile { __blob, tipo, datiBase64 } tramite FileReader.
   * @param {any} valore - Valore da attraversare (tipicamente un oggetto veicolo).
   * @returns {Promise<any>} Promise che risolve con una copia del valore, Blob convertiti.
   */
  function convertiBlobRicorsivo(valore) {
    return new Promise((resolve, reject) => {
      if (valore instanceof Blob) {
        const reader = new FileReader();
        reader.onload = () => resolve({ __blob: true, tipo: valore.type || 'application/octet-stream', datiBase64: reader.result });
        reader.onerror = () => reject(reader.error || new Error('Errore nella lettura di un file immagine durante l\'export.'));
        reader.readAsDataURL(valore);
      } else if (Array.isArray(valore)) {
        Promise.all(valore.map(convertiBlobRicorsivo)).then(resolve, reject);
      } else if (valore && typeof valore === 'object') {
        const chiavi = Object.keys(valore);
        Promise.all(chiavi.map((k) => convertiBlobRicorsivo(valore[k]))).then((valoriConvertiti) => {
          const nuovoOggetto = {};
          chiavi.forEach((k, i) => { nuovoOggetto[k] = valoriConvertiti[i]; });
          resolve(nuovoOggetto);
        }, reject);
      } else {
        resolve(valore);
      }
    });
  }

  /**
   * Converte una data URL base64 in un Blob nativo.
   * @param {string} dataUrl - Stringa "data:<mime>;base64,<dati>".
   * @param {string} tipoFallback - MIME type da usare se non deducibile dalla data URL.
   * @returns {Blob}
   */
  function dataUrlABlob(dataUrl, tipoFallback) {
    const virgola = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, virgola);
    const base64 = dataUrl.slice(virgola + 1);
    const match = /data:(.*?);base64/.exec(meta);
    const tipo = (match && match[1]) || tipoFallback || 'application/octet-stream';
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return new Blob([bytes], { type: tipo });
  }

  /**
   * Converte ricorsivamente ogni marcatore { __blob, tipo, datiBase64 } in un Blob nativo.
   * Operazione sincrona (atob non richiede callback).
   * @param {any} valore - Valore da attraversare (tipicamente un oggetto veicolo importato).
   * @returns {any} Copia del valore, con i marcatori riconvertiti in Blob.
   */
  function convertiBase64Ricorsivo(valore) {
    if (valore && typeof valore === 'object' && valore.__blob === true && typeof valore.datiBase64 === 'string') {
      return dataUrlABlob(valore.datiBase64, valore.tipo);
    }
    if (Array.isArray(valore)) {
      return valore.map(convertiBase64Ricorsivo);
    }
    if (valore && typeof valore === 'object') {
      const nuovo = {};
      Object.keys(valore).forEach((k) => { nuovo[k] = convertiBase64Ricorsivo(valore[k]); });
      return nuovo;
    }
    return valore;
  }

  /**
   * Esporta un backup completo: tutti i veicoli (attivi + archiviati) e le impostazioni,
   * con ogni Blob (foto) convertito in base64 per la serializzazione JSON.
   * Non gestisce il download del file: ritorna l'oggetto pronto per JSON.stringify.
   * @returns {Promise<{versione:number, dataEsportazione:string, veicoli:Array, impostazioni:Array}>}
   * @throws Rigetta la Promise se la lettura dal database o la conversione di un file falliscono.
   */
  function esportaBackup() {
    return init().then((db) => {
      return new Promise((resolve, reject) => {
        const tx = db.transaction([STORE_VEICOLI, STORE_IMPOSTAZIONI], 'readonly');
        const veicoliReq = tx.objectStore(STORE_VEICOLI).getAll();
        const impostazioniReq = tx.objectStore(STORE_IMPOSTAZIONI).getAll();
        let veicoliRisultato = [];
        let impostazioniRisultato = [];

        veicoliReq.onsuccess = () => { veicoliRisultato = veicoliReq.result || []; };
        impostazioniReq.onsuccess = () => { impostazioniRisultato = impostazioniReq.result || []; };
        tx.onerror = (event) => reject(creaErroreLeggibile(event.target.error, 'lettura dati per il backup'));
        tx.onabort = () => reject(creaErroreLeggibile(tx.error, 'lettura dati per il backup'));
        tx.oncomplete = () => resolve({ veicoli: veicoliRisultato, impostazioni: impostazioniRisultato });
      });
    }).then(({ veicoli, impostazioni }) => {
      return Promise.all(veicoli.map(convertiBlobRicorsivo)).then((veicoliConvertiti) => ({
        versione: 1,
        dataEsportazione: new Date().toISOString(),
        veicoli: veicoliConvertiti,
        impostazioni: impostazioni
      }));
    }).catch((err) => {
      if (err instanceof Error) throw err;
      throw creaErroreLeggibile(err, 'preparazione del backup');
    });
  }

  /**
   * Importa un backup da file JSON, sovrascrivendo interamente gli store "veicoli" e
   * "impostazioni". Valida la struttura del file PRIMA di toccare il database: se non
   * valido, nessuna scrittura viene effettuata.
   * @param {File} jsonFile - File JSON selezionato dall'utente (da input[type=file]).
   * @returns {Promise<void>} Promise che risolve a importazione completata.
   * @throws Rigetta la Promise se il file non è un backup valido o se la scrittura fallisce
   *         (incluso QuotaExceededError).
   */
  function importaBackup(jsonFile) {
    if (!jsonFile) {
      return Promise.reject(new Error('Nessun file di backup selezionato.'));
    }

    return jsonFile.text().then((testo) => {
      let dati;
      try {
        dati = JSON.parse(testo);
      } catch (e) {
        throw new Error('Il file selezionato non è un backup AutoRigon valido: JSON non leggibile.');
      }
      if (!dati || typeof dati.versione === 'undefined' || !Array.isArray(dati.veicoli)) {
        throw new Error('Il file selezionato non ha la struttura di un backup AutoRigon valido (campi "versione"/"veicoli" mancanti).');
      }
      return dati;
    }).then((dati) => {
      const veicoliConvertiti = dati.veicoli.map(convertiBase64Ricorsivo);
      const impostazioniConvertite = Array.isArray(dati.impostazioni) ? dati.impostazioni : [];

      return init().then((db) => {
        return new Promise((resolve, reject) => {
          const tx = db.transaction([STORE_VEICOLI, STORE_IMPOSTAZIONI], 'readwrite');
          const veicoliStore = tx.objectStore(STORE_VEICOLI);
          const impostazioniStore = tx.objectStore(STORE_IMPOSTAZIONI);

          veicoliStore.clear();
          impostazioniStore.clear();
          veicoliConvertiti.forEach((v) => veicoliStore.put(v));
          impostazioniConvertite.forEach((imp) => impostazioniStore.put(imp));

          tx.oncomplete = () => resolve();
          tx.onerror = (event) => reject(creaErroreLeggibile(event.target.error, 'importazione del backup'));
          tx.onabort = () => reject(creaErroreLeggibile(tx.error, 'importazione del backup'));
        });
      });
    });
  }

  return {
    init,
    getVeicoli,
    getVeicolo,
    salvaVeicolo,
    eliminaVeicolo,
    cambiaStato,
    resetTotale,
    getImpostazione,
    setImpostazione,
    esportaBackup,
    importaBackup
  };
})();
