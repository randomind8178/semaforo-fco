import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { deduplica, escludiStati } from '../src/aggregatore.js'

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
// dall'ora in cui gira lo scarico, mentre il rapporto no. Osservato sul campo: 717
// righe grezze → 249 voli fisici, rapporto 2,88.
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
