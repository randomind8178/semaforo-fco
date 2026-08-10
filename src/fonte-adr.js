import * as cheerio from 'cheerio'

const BASE = 'https://www.adr.it/pax-fco-voli-in-tempo-reale'
const P = '_3_WAR_realtimeflightsportlet_'
const AGENTE = 'semaforo-fco/0.1 (progetto personale, uso non commerciale)'

export function costruisciUrl ({ pagina = 1, orario = '00:00-24:00', data = '', righePerPagina } = {}) {
  if (!righePerPagina) {
    throw new Error('costruisciUrl: righePerPagina è obbligatorio e arriva da config.json')
  }
  const q = new URLSearchParams({
    p_p_id: '3_WAR_realtimeflightsportlet',
    p_p_lifecycle: '0',
    p_p_state: 'normal',
    p_p_mode: 'view',
    [P + 'tab']: 'arrival',
    [P + 'airport']: '',
    [P + 'carrier']: '',
    [P + 'codNat']: '',
    [P + 'codScaOpe']: '',
    [P + 'codVet']: '',
    [P + 'date']: data,
    [P + 'dataNumVol']: '',
    [P + 'numVol']: '',
    [P + 'rouIata']: '',
    [P + 'orario']: orario,
    [P + 'searchType']: 'completeSmall',
    [P + 'isParent']: 'false',
    [P + 'airportId']: '0',
    [P + 'orderByCol']: 'comparationTime',
    [P + 'orderByType']: 'asc',
    [P + 'resetCur']: 'false',
    [P + 'delta']: String(righePerPagina),
    [P + 'cur']: String(pagina)
  })
  return `${BASE}?${q}`
}

const pausa = (ms) => new Promise((r) => setTimeout(r, ms))

export async function scaricaPagina (opzioni, rete) {
  if (!rete) {
    throw new Error('scaricaPagina: il blocco rete di config.json è obbligatorio (tentativi, attesaMs, timeoutMs)')
  }
  const url = costruisciUrl(opzioni)
  let ultimoErrore
  for (let n = 1; n <= rete.tentativi; n++) {
    try {
      const risposta = await fetch(url, {
        headers: { 'User-Agent': AGENTE, 'Accept-Language': 'it-IT,it' },
        signal: AbortSignal.timeout(rete.timeoutMs)
      })
      if (!risposta.ok) {
        // Un "HTTP 403" nudo non dice niente: puo' essere il sito che non c'e' piu' o un
        // WAF che rifiuta l'IP da cui parte la richiesta. Il corpo e l'header server
        // portano il codice di riferimento del WAF, che e' l'unica cosa utile per capirlo.
        const corpo = (await risposta.text()).replace(/\s+/g, ' ').trim().slice(0, 300)
        throw new Error(
          `HTTP ${risposta.status} (server: ${risposta.headers.get('server') ?? 'n/d'}) — ` +
          `inizio risposta: ${corpo || '(vuota)'}`
        )
      }
      return await risposta.text()
    } catch (errore) {
      ultimoErrore = errore
      if (n < rete.tentativi) await pausa(rete.attesaMs * n)
    }
  }
  throw new Error(
    `scaricaPagina fallita dopo ${rete.tentativi} tentativi: ` +
    (ultimoErrore?.message ?? 'nessun tentativo eseguito, tentativi <= 0 in config.json')
  )
}

const testo = (nodo) => nodo.text().replace(/\s+/g, ' ').trim()

function orario (cella, etichetta) {
  const trovato = cella.match(new RegExp(`${etichetta}:\\s*(\\d{2}:\\d{2})`))
  return trovato ? trovato[1] : null
}

function normalizzaCodice (grezzo) {
  if (!grezzo) return null
  // Il suffisso a lettera (FR 5873A) e' una numerazione legittima, usata per i
  // settori extra: senza di lui il codice usciva null e il numero finiva nel vettore.
  const trovato = grezzo.trim().match(/([A-Z0-9]{2})\s*(\d{1,4}[A-Z]?)$/)
  return trovato ? `${trovato[1]} ${trovato[2]}` : null
}

function leggiVolo (cellaVolo) {
  const [primaParte, secondaParte] = cellaVolo.split(/Operato da:/)
  const operatoDa = normalizzaCodice(secondaParte)
  const codice = normalizzaCodice(primaParte)
  const vettore = codice
    ? primaParte.slice(0, primaParte.lastIndexOf(codice.split(' ')[0])).replace(/[-\s]+$/, '').trim()
    : primaParte.trim()
  return { codice, vettore, operatoDa }
}

export function estraiVoli (html) {
  const $ = cheerio.load(html)
  const voli = []

  $('tbody tr[data-qa-id="row"]').each((_, riga) => {
    const $riga = $(riga)
    const cellaOrari = testo($riga.find('td.lfr-scheduled-time-column'))
    const cellaVolo = testo($riga.find('td.card-fg__code'))
    const cellaOrigine = testo($riga.find('td.card-fg__dest'))
    const cellaTerminal = testo($riga.find('td.card-fg__terminal'))
    const cellaStato = testo($riga.find('td.card-fg__arrivals'))

    const previsto = orario(cellaOrari, 'Orario previsto')
    if (!previsto) return

    const { codice, vettore, operatoDa } = leggiVolo(cellaVolo)
    const iata = cellaOrigine.match(/\(([A-Z]{3})\)/)
    const terminal = cellaTerminal.match(/\bT(\d)\b/)

    voli.push({
      previsto,
      effettivo: orario(cellaOrari, 'Orario effettivo'),
      vettore,
      codice,
      operatoDa,
      origine: cellaOrigine.replace(/\s*\([A-Z]{3}\)\s*/, '').trim(),
      iata: iata ? iata[1] : null,
      terminal: terminal ? `T${terminal[1]}` : null,
      stato: cellaStato.replace(/^Stato volo:\s*/, '').trim()
    })
  })

  return voli
}

export async function scaricaGiornata (config, { data = '' } = {}) {
  const voli = []
  let pagine = 0

  for (let pagina = 1; pagina <= config.maxPagine; pagina++) {
    const html = await scaricaPagina({ pagina, data, righePerPagina: config.righePerPagina }, config.rete)
    const lotto = estraiVoli(html)
    pagine = pagina
    voli.push(...lotto)
    if (lotto.length < config.righePerPagina) break
    await pausa(config.pausaFraPagineMs)
  }

  if (pagine === config.maxPagine) {
    console.warn(`attenzione: raggiunto maxPagine=${config.maxPagine}, la giornata potrebbe essere troncata`)
  }
  return voli
}
