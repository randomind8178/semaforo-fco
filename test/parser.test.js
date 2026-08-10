import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { estraiVoli } from '../src/fonte-adr.js'

const html = await readFile('test/fixture/pagina-arrivi.html', 'utf8')

test('estrae una riga per volo dalla pagina', () => {
  const voli = estraiVoli(html)
  assert.ok(voli.length >= 15, `attese almeno 15 righe, trovate ${voli.length}`)
})

test('ogni volo ha un orario previsto in formato HH:MM', () => {
  for (const volo of estraiVoli(html)) {
    assert.match(volo.previsto, /^\d{2}:\d{2}$/, `previsto malformato: ${JSON.stringify(volo)}`)
  }
})

test('ogni volo ha codice, origine e stato non vuoti', () => {
  for (const volo of estraiVoli(html)) {
    assert.ok(volo.codice, `codice mancante: ${JSON.stringify(volo)}`)
    assert.ok(volo.origine, `origine mancante: ${JSON.stringify(volo)}`)
    assert.ok(volo.stato, `stato mancante: ${JSON.stringify(volo)}`)
  }
})

test('il codice volo è sigla più numero', () => {
  for (const volo of estraiVoli(html)) {
    assert.match(volo.codice, /^[A-Z0-9]{2} \d{1,4}[A-Z]?$/, `codice malformato: ${volo.codice}`)
  }
})

test('almeno un volo ha orario effettivo diverso dal previsto', () => {
  const voli = estraiVoli(html)
  const conEffettivo = voli.filter((v) => v.effettivo && v.effettivo !== v.previsto)
  assert.ok(conEffettivo.length >= 1, 'nessun volo con orario effettivo: il campo dei ritardi non viene letto')
})

test('almeno un volo della pagina è un codeshare con operatoDa', () => {
  const voli = estraiVoli(html)
  const codeshare = voli.filter((v) => v.operatoDa)
  assert.ok(codeshare.length >= 1, 'nessun operatoDa trovato: la deduplica non avrebbe niente da deduplicare')
})
