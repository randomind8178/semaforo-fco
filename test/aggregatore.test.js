import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { deduplica, escludiStati, colore, costruisciFasce, calcolaVerdetto } from '../src/aggregatore.js'

const config = JSON.parse(await readFile('config.json', 'utf8'))

const volo = (over = {}) => ({
  previsto: '13:00', effettivo: null, vettore: 'TIZIO', codice: 'TZ 100',
  operatoDa: null, origine: 'PARIGI', iata: 'CDG', terminal: 'T1',
  stato: 'Schedulato', ...over
})

test('la riga codeshare sparisce e resta quella operativa', () => {
  const voli = [
    volo({ codice: 'V7 2196', vettore: 'VOLOTEA' }),
    volo({ codice: 'AZ 7119', vettore: 'ITA', operatoDa: 'V7 2196' })
  ]
  const risultato = deduplica(voli)
  assert.equal(risultato.length, 1)
  assert.equal(risultato[0].codice, 'V7 2196')
})

test('tre vettori sullo stesso aereo diventano un volo', () => {
  const voli = [
    volo({ codice: 'V7 2196' }),
    volo({ codice: 'AZ 7119', operatoDa: 'V7 2196' }),
    volo({ codice: 'AF 1234', operatoDa: 'V7 2196' })
  ]
  assert.equal(deduplica(voli).length, 1)
})

test('se la riga operativa non è nella finestra, ne resta una sola', () => {
  const voli = [
    volo({ codice: 'AZ 7119', operatoDa: 'V7 2196' }),
    volo({ codice: 'AF 1234', operatoDa: 'V7 2196' })
  ]
  const risultato = deduplica(voli)
  assert.equal(risultato.length, 1)
  assert.equal(risultato[0].operatoDa, 'V7 2196')
})

test('due voli veri con stessa origine e stesso orario non vengono fusi se hanno codici diversi e nessun operatoDa', () => {
  const voli = [
    volo({ codice: 'AZ 100', iata: 'CDG' }),
    volo({ codice: 'AF 200', iata: 'CDG' })
  ]
  assert.equal(deduplica(voli).length, 2)
})

test('due righe identiche in ogni campo diventano una', () => {
  const voli = [volo({ codice: 'BQ 1975', origine: 'MOSTAR' }), volo({ codice: 'BQ 1975', origine: 'MOSTAR' })]
  assert.equal(deduplica(voli).length, 1)
})

test('due righe che differiscono in un solo campo restano due', () => {
  const voli = [volo({ codice: 'BQ 1975', terminal: 'T1' }), volo({ codice: 'BQ 1975', terminal: 'T3' })]
  assert.equal(deduplica(voli).length, 2)
})

test('i voli senza codeshare passano intatti', () => {
  const voli = [volo({ codice: 'MS 791' }), volo({ codice: 'RJ 101', previsto: '13:05' })]
  assert.equal(deduplica(voli).length, 2)
})

test('gli stati esclusi non arrivano al conteggio', () => {
  const voli = [volo({ stato: 'Arrivato' }), volo({ codice: 'XX 999', stato: config.statiEsclusi[0] ?? 'Cancellato' })]
  assert.equal(escludiStati(voli, config.statiEsclusi.length ? config.statiEsclusi : ['Cancellato']).length, 1)
})

// Il controllo è sul RAPPORTO grezzi/dedotti, non sul totale assoluto: la fonte è una
// board live con una finestra mobile di poche ore, quindi il numero di voli dipende
// dall'ora in cui gira lo scarico, mentre il rapporto no. Osservato sul campo: 634
// righe grezze → 224 voli fisici, rapporto 2,83.
test('su una giornata vera la deduplica ha un rapporto plausibile', async () => {
  const grezzi = JSON.parse(await readFile('test/fixture/voli-giornata.json', 'utf8'))
  const puliti = deduplica(grezzi)
  const rapporto = grezzi.length / puliti.length
  const { min, max } = config.rapportoDeduplica
  assert.ok(
    rapporto >= min && rapporto <= max,
    `atteso un rapporto fra ${min} e ${max}, ottenuto ${rapporto.toFixed(2)} ` +
    `(${grezzi.length} grezzi → ${puliti.length} dedotti). ` +
    'Vicino a 1 la deduplica non sta funzionando; molto sopra sta fondendo voli distinti.'
  )
})

test('il colore cambia esattamente sulle soglie', () => {
  const soglie = { giallo: 3, verde: 6 }
  assert.equal(colore(0, soglie), 'rosso')
  assert.equal(colore(2, soglie), 'rosso')
  assert.equal(colore(3, soglie), 'giallo')
  assert.equal(colore(5, soglie), 'giallo')
  assert.equal(colore(6, soglie), 'verde')
  assert.equal(colore(40, soglie), 'verde')
})

test('le fasce coprono le 24 ore anche dove non atterra niente', () => {
  const fasce = costruisciFasce([], { ampiezzaFasciaMinuti: 30, soglie: { giallo: 3, verde: 6 } })
  assert.equal(fasce.length, 48)
  assert.equal(fasce[0].inizio, '00:00')
  assert.equal(fasce[47].inizio, '23:30')
  assert.ok(fasce.every((f) => f.voli === 0 && f.colore === 'rosso'))
})

test('un volo ritardato cade nella fascia del suo orario aggiornato', () => {
  const voli = [volo({ previsto: '13:05', effettivo: '17:00' })]
  const fasce = costruisciFasce(voli, { ampiezzaFasciaMinuti: 30, soglie: { giallo: 3, verde: 6 } })
  const tredici = fasce.find((f) => f.inizio === '13:00')
  const diciassette = fasce.find((f) => f.inizio === '17:00')
  assert.equal(tredici.voli, 0, 'il volo è rimasto nella fascia programmata invece di seguire il ritardo')
  assert.equal(diciassette.voli, 1)
})

const configBase = { ampiezzaFasciaMinuti: 30, minutiViaggio: 30, soglie: { giallo: 3, verde: 6 } }

test('il verdetto guarda i 30 minuti dopo l’arrivo, non la fascia fissa', () => {
  // Adesso 13:58 → arrivo 14:28. La finestra è 14:28-14:58.
  const voli = [
    volo({ previsto: '14:05' }),  // fuori: già atterrato quando arriva
    volo({ previsto: '14:10' }),  // fuori
    volo({ previsto: '14:35' }),  // dentro
    volo({ previsto: '14:40' }),  // dentro
    volo({ previsto: '14:50' })   // dentro
  ]
  const verdetto = calcolaVerdetto(voli, configBase, 13 * 60 + 58)
  assert.equal(verdetto.arrivoStimato, '14:28')
  assert.equal(verdetto.voli, 3, 'la finestra mobile sta contando i voli della fascia fissa')
  assert.equal(verdetto.colore, 'giallo')
})

test('la finestra include l’istante di arrivo ed esclude la fine', () => {
  const voli = [volo({ previsto: '14:30' }), volo({ previsto: '15:00' })]
  const verdetto = calcolaVerdetto(voli, configBase, 14 * 60)
  assert.equal(verdetto.arrivoStimato, '14:30')
  assert.equal(verdetto.voli, 1, 'il volo alle 15:00 è fuori: la finestra 14:30-15:00 esclude l’estremo destro')
})

test('il verdetto scavalca la mezzanotte', () => {
  // Adesso 23:50 → arrivo 00:20, quindi la finestra 00:20-00:50 sta a cavallo del
  // giorno. Il volo alle 00:10 deve restare FUORI: atterra prima che tu arrivi,
  // esattamente come quello alle 14:05 nel test della finestra mobile. La prima
  // stesura di questo test lo contava come dentro, in contraddizione con gli altri due.
  const voli = [
    volo({ previsto: '00:10' }), // fuori: già atterrato quando arrivi
    volo({ previsto: '00:30' }), // dentro
    volo({ previsto: '00:49' }), // dentro, ultimo minuto utile
    volo({ previsto: '00:50' })  // fuori: la finestra esclude l'estremo destro
  ]
  const verdetto = calcolaVerdetto(voli, configBase, 23 * 60 + 50)
  assert.equal(verdetto.arrivoStimato, '00:20')
  assert.equal(verdetto.voli, 2, 'i voli dopo la mezzanotte non vengono visti, oppure la finestra non si chiude')
})
