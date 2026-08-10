import * as cheerio from 'cheerio'

const BASE = 'https://www.adr.it/pax-fco-voli-in-tempo-reale'
const P = '_3_WAR_realtimeflightsportlet_'
const AGENTE = 'semaforo-fco/0.1 (progetto personale, uso non commerciale)'

export function costruisciUrl ({ pagina = 1, orario = '00:00-24:00', data = '', righePerPagina }) {
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
  const url = costruisciUrl(opzioni)
  let ultimoErrore
  for (let n = 1; n <= rete.tentativi; n++) {
    try {
      const risposta = await fetch(url, {
        headers: { 'User-Agent': AGENTE, 'Accept-Language': 'it-IT,it' },
        signal: AbortSignal.timeout(rete.timeoutMs)
      })
      if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`)
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
