import { inMinuti } from './tempo.js'

export function deduplica (voli) {
  const operativiPresenti = new Set(voli.filter((v) => !v.operatoDa).map((v) => v.codice))
  const orfaniVisti = new Set()
  const risultato = []

  for (const volo of voli) {
    if (!volo.operatoDa) {
      risultato.push(volo)
      continue
    }
    // La riga operativa è nella finestra: questa riga è un duplicato puro.
    if (operativiPresenti.has(volo.operatoDa)) continue
    // Operativo fuori finestra: si tiene il primo orfano e si scartano i fratelli.
    if (orfaniVisti.has(volo.operatoDa)) continue
    orfaniVisti.add(volo.operatoDa)
    risultato.push(volo)
  }

  return risultato
}

// Non fonde niente: conta le righe che sembrano lo stesso aereo senza dichiararlo.
// Fondere per origine e orario cancellerebbe due voli veri e distinti da Parigi
// che atterrano allo stesso minuto, cosa che a Fiumicino succede.
export function sospettiDuplicati (voli) {
  const gruppi = new Map()
  for (const volo of voli) {
    const chiave = `${volo.iata ?? volo.origine}@${volo.previsto}#${volo.effettivo ?? ''}`
    gruppi.set(chiave, (gruppi.get(chiave) ?? 0) + 1)
  }
  let sospetti = 0
  for (const quanti of gruppi.values()) if (quanti > 1) sospetti += quanti - 1
  return sospetti
}

export function escludiStati (voli, statiEsclusi = []) {
  const esclusi = statiEsclusi.map((s) => s.toLowerCase())
  return voli.filter((volo) => !esclusi.includes((volo.stato ?? '').toLowerCase()))
}

export function minutiArrivo (volo) {
  return inMinuti(volo.effettivo ?? volo.previsto)
}
