import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaricaGiornata } from './fonte-adr.js'
import { deduplica, escludiStati, costruisciFasce, calcolaVerdetto, sospettiDuplicati } from './aggregatore.js'
import { adessoInMinuti, oggiARoma } from './tempo.js'

// Questo file lo lancia il cron, che non garantisce da quale cartella: config.json
// in ingresso e data.json in uscita si risolvono dalla radice del progetto, non
// dalla cwd. Con i percorsi relativi un cron mal configurato scriverebbe data.json
// in una cartella qualunque, e la pagina continuerebbe a leggere quello vecchio
// senza che nulla segnali l'errore.
const radice = dirname(dirname(fileURLToPath(import.meta.url)))
const config = JSON.parse(await readFile(join(radice, 'config.json'), 'utf8'))

const grezzi = await scaricaGiornata(config)

if (grezzi.length < config.minimoVoliPlausibile) {
  console.error(
    `ESTRAZIONE IMPLAUSIBILE: ${grezzi.length} voli, minimo atteso ${config.minimoVoliPlausibile}.\n` +
    'Probabile che ADR abbia cambiato la pagina. data.json NON viene riscritto: ' +
    'meglio un dato vecchio di mezz\'ora che una giornata vuota colorata di rosso.'
  )
  process.exit(1)
}

const dedotti = deduplica(grezzi)
const contabili = escludiStati(dedotti, config.statiEsclusi)
const adesso = adessoInMinuti()

const uscita = {
  generatoAlle: new Date().toISOString(),
  giorno: oggiARoma(),
  // Tutto quello che serve a interpretare o a disegnare i numeri viaggia col file:
  // la pagina non legge config.json, quindi qui dentro non ci sono opzionali.
  config: {
    ampiezzaFasciaMinuti: config.ampiezzaFasciaMinuti,
    minutiViaggio: config.minutiViaggio,
    soglie: config.soglie,
    oreAvantiInLista: config.oreAvantiInLista,
    etaAvvisoMinuti: config.etaAvvisoMinuti,
    etaNonAffidabileMinuti: config.etaNonAffidabileMinuti
  },
  verdetto: calcolaVerdetto(contabili, config, adesso),
  fasce: costruisciFasce(contabili, config),
  diagnostica: {
    righeScaricate: grezzi.length,
    voliDopoDeduplica: dedotti.length,
    voliContabili: contabili.length,
    scartatiPerStato: dedotti.length - contabili.length,
    sospettiDuplicati: sospettiDuplicati(contabili)
  }
}

await writeFile(join(radice, 'data.json'), JSON.stringify(uscita, null, 1) + '\n', 'utf8')
console.log(
  `data.json scritto: ${grezzi.length} righe → ${dedotti.length} voli → ${contabili.length} contabili. ` +
  `Verdetto ${uscita.verdetto.arrivoStimato}: ${uscita.verdetto.voli} voli (${uscita.verdetto.colore}).`
)
