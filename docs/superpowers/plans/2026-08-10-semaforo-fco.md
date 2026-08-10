# semaforo-fco — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pagina web consultabile da cellulare che mostra gli arrivi di Fiumicino raggruppati in fasce da 30 minuti, colorate in verde/giallo/rosso in base a quanti aerei atterrano davvero in quella mezz'ora, con in cima il verdetto su cosa trova chi parte adesso.

**Architecture:** Un cron di GitHub Actions scarica la pagina arrivi pubblica di adr.it, deduplica i codeshare, aggrega in fasce e committa un `data.json` di pochi kB nel repo. La pagina statica servita da GitHub Pages legge solo quel file. Tre moduli con confini netti — lettore, aggregatore puro, pagina — e il cron è solo colla, così una futura versione serverless riscrive la colla e non i moduli.

**Tech Stack:** Node 22+, JavaScript ESM, `cheerio` come unica dipendenza runtime, `node:test` per i test, GitHub Actions + GitHub Pages. Nessun TypeScript, nessun bundler, nessun framework frontend.

**Spec di riferimento:** [`docs/superpowers/specs/2026-08-10-semaforo-fco-design.md`](../specs/2026-08-10-semaforo-fco-design.md)

## Global Constraints

- **Node 22 o superiore.** `package.json` dichiara `"type": "module"`: tutto ESM, mai `require`.
- **Una sola dipendenza runtime: `cheerio`.** Nessun'altra, né di sviluppo. `fetch`, `node:test` e `Intl` sono già dentro Node.
- **Nessun TypeScript, nessun bundler, nessun framework frontend.** La pagina è HTML + CSS + JS che il browser esegue così com'è.
- **Nomi in italiano** per funzioni, variabili e campi JSON (`voli`, `fasce`, `colore`, `previsto`, `effettivo`). Il dominio è italiano e la spec è italiana: non si mescolano le lingue a metà.
- **Mai aritmetica su fusi orari.** Un orario è sempre un numero di minuti dalla mezzanotte locale di Roma del giorno corrente. Le 00:15 di domani sono `1455`. L'unico punto in cui il fuso entra è `adessoInMinuti()`, che usa `Intl.DateTimeFormat` su `Europe/Rome`. Nessun `new Date(...)` con stringhe di orario, nessun `getHours()`.
- **Tutti i numeri stanno in `config.json`.** Zero costanti numeriche di dominio nel codice.
- **Test: solo il nucleo minimo concordato** (deduplica e soglie), più il test strutturale del parser previsto in Task 2. Non aggiungere altri test: il resto è nel backlog della spec per scelta esplicita dell'utente.
- **Le fixture sono HTML pubblico di orari aerei.** Nessun dato personale nel repo.
- **Il repo deve essere pubblico** su GitHub: è la condizione per avere Actions e Pages gratis illimitati.
- **Gentilezza verso adr.it:** pagine scaricate una alla volta, con pausa fra le richieste. Mai richieste in parallelo.

---

## File Structure

| File | Responsabilità |
| --- | --- |
| `package.json` | Nome, `type: module`, dipendenza `cheerio`, script `npm test` e `npm run genera` |
| `config.json` | Tutti i parametri regolabili. Unica fonte dei numeri |
| `src/tempo.js` | Conversioni fra `"HH:MM"` e minuti dalla mezzanotte; ora corrente a Roma. Nessuna dipendenza |
| `src/fonte-adr.js` | Parla solo con adr.it: costruisce l'URL del portlet, scarica, estrae le righe. Non conosce fasce né colori |
| `src/aggregatore.js` | Funzione pura: voli + config + adesso → fasce, verdetto, diagnostica. Zero rete, zero orologio |
| `src/genera.js` | La colla: scarica, aggrega, valida, scrive `data.json`. È l'unico file che il cron invoca |
| `strumenti/salva-fixture.js` | Salva una pagina HTML vera in `test/fixture/` |
| `strumenti/censisci-stati.js` | Elenca gli stati volo distinti su una giornata vera |
| `test/fixture/pagina-arrivi.html` | Una pagina HTML vera, per i test del parser |
| `test/fixture/voli-giornata.json` | I voli grezzi di una giornata intera, per il test sulla deduplica |
| `test/parser.test.js` | Invarianti strutturali del parser sulla fixture HTML |
| `test/aggregatore.test.js` | Deduplica e soglie di colore |
| `index.html`, `stile.css`, `app.js` | La pagina. Stanno nella radice perché GitHub Pages serve la radice di `main` |
| `data.json` | Generato dal cron, committato. Nella radice, accanto a `index.html` |
| `.github/workflows/aggiorna.yml` | Il cron |
| `README.md` | Cos'è, come si lancia a mano, come si tarano le soglie |

---

### Task 1: Scaffolding, URL del portlet, prima pagina scaricata

Il pezzo più a rischio del progetto è costruire l'URL giusto: un set di parametri incompleto restituisce HTTP 200 con "Nessun elemento è stato trovato" invece di un errore. Questa task esiste per chiudere quel rischio prima di scrivere qualsiasi altra cosa.

**Files:**
- Create: `package.json`
- Create: `config.json`
- Create: `src/fonte-adr.js`
- Create: `strumenti/salva-fixture.js`
- Create: `test/fixture/` (cartella, popolata dallo strumento)

**Interfaces:**
- Consumes: niente, è la prima task
- Produces:
  - `costruisciUrl({ pagina, orario, data, righePerPagina }) → string` — `righePerPagina` è obbligatorio, non ha default
  - `scaricaPagina({ pagina, orario, data, righePerPagina }, rete) → Promise<string>` (HTML), dove `rete` è il blocco `config.rete`

- [ ] **Step 1: Creare `package.json`**

```json
{
  "name": "semaforo-fco",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "node --test test/",
    "genera": "node src/genera.js",
    "fixture": "node strumenti/salva-fixture.js",
    "stati": "node strumenti/censisci-stati.js"
  },
  "dependencies": {
    "cheerio": "^1.0.0"
  }
}
```

- [ ] **Step 2: Creare `config.json`**

`statiEsclusi` resta vuoto: lo riempie la Task 4 con i valori veri osservati, non con quelli immaginati adesso.

```json
{
  "ampiezzaFasciaMinuti": 30,
  "minutiViaggio": 30,
  "soglie": { "giallo": 3, "verde": 6 },
  "oreAvantiInLista": 4,
  "righePerPagina": 20,
  "maxPagine": 80,
  "pausaFraPagineMs": 1200,
  "minimoVoliPlausibile": 100,
  "rapportoDeduplica": { "min": 2, "max": 4.5 },
  "etaAvvisoMinuti": 30,
  "etaNonAffidabileMinuti": 180,
  "rete": { "tentativi": 3, "attesaMs": 2000, "timeoutMs": 20000 },
  "statiEsclusi": []
}
```

Il blocco `rete` esiste perché il vincolo globale non ammette eccezioni: anche i
numeri tecnici stanno in configurazione. Sono anche quelli che si toccano davvero,
il giorno che adr.it risponde lento.

- [ ] **Step 3: Installare la dipendenza**

Run: `npm install`
Expected: `node_modules/` creata, `package-lock.json` creato, zero vulnerabilità segnalate.

- [ ] **Step 4: Scrivere `src/fonte-adr.js` — costruzione URL e scarico**

Il prefisso `_3_WAR_realtimeflightsportlet_` e i parametri vuoti non sono decorativi: senza di loro il portlet risponde "Nessun elemento è stato trovato".

```js
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
```

- [ ] **Step 5: Scrivere `strumenti/salva-fixture.js`**

```js
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { scaricaPagina } from '../src/fonte-adr.js'

const config = JSON.parse(await readFile('config.json', 'utf8'))
const pagina = Number(process.argv[2] ?? 1)
const destinazione = process.argv[3] ?? 'test/fixture/pagina-arrivi.html'

const html = await scaricaPagina({ pagina, righePerPagina: config.righePerPagina }, config.rete)
if (!html.includes('Orario previsto')) {
  console.error('ATTENZIONE: la pagina non contiene "Orario previsto".')
  console.error('Probabile URL incompleto: il portlet risponde 200 con "Nessun elemento è stato trovato".')
  process.exit(1)
}
await mkdir('test/fixture', { recursive: true })
await writeFile(destinazione, html, 'utf8')
console.log(`Salvato ${destinazione} (${html.length} caratteri)`)
```

- [ ] **Step 6: Eseguire lo strumento e verificare che la fixture contenga voli veri**

Run: `npm run fixture`
Expected: stampa `Salvato test/fixture/pagina-arrivi.html` con una lunghezza di qualche centinaio di migliaia di caratteri. Se stampa l'errore su "Orario previsto", l'URL è sbagliato: confrontare parametro per parametro con lo Step 4 prima di andare avanti.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json config.json src/fonte-adr.js strumenti/salva-fixture.js test/fixture/pagina-arrivi.html
git commit -m "feat: scarico della pagina arrivi ADR con il set completo di parametri del portlet"
```

---

### Task 2: Parser delle righe

**Nota sul perché questo test esiste**, dato che il nucleo minimo concordato erano deduplica e soglie: senza una verifica sul parser, il test sulla deduplica non sa distinguere "la deduplica è rotta" da "il parser non estrae più niente". Costa un test solo e rende diagnostico quello che conta.

**Files:**
- Modify: `src/fonte-adr.js` (aggiunta di `estraiVoli`)
- Create: `test/parser.test.js`

**Interfaces:**
- Consumes: `test/fixture/pagina-arrivi.html` da Task 1
- Produces: `estraiVoli(html) → Volo[]`, dove `Volo` è un oggetto semplice:

```js
{
  previsto: '13:05',      // sempre presente, formato HH:MM
  effettivo: '12:55',     // null se il volo è in orario
  vettore: 'ROYAL JORDANIAN',
  codice: 'RJ 101',       // sigla + numero, normalizzato con un solo spazio
  operatoDa: null,        // 'V7 2196' se la riga è un codeshare
  origine: 'AMMAN',
  iata: 'AMM',            // null se assente
  terminal: 'T3',         // null se assente
  stato: 'Arrivato'
}
```

- [ ] **Step 1: Scrivere il test che fallisce**

Il test verifica invarianti strutturali, non valori fissi: la fixture cambia a ogni cattura, i valori esatti no.

```js
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
    assert.match(volo.codice, /^[A-Z0-9]{2} \d{1,4}$/, `codice malformato: ${volo.codice}`)
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
```

- [ ] **Step 2: Eseguire il test per verificare che fallisca**

Run: `node --test test/parser.test.js`
Expected: FAIL con `estraiVoli is not a function` (o `is not exported`).

- [ ] **Step 3: Implementare `estraiVoli` in `src/fonte-adr.js`**

Aggiungere in fondo al file. Le celle si identificano per classe, non per posizione: le posizioni cambiano quando ADR aggiunge una colonna, le classi semantiche resistono di più.

```js
const testo = (nodo) => nodo.text().replace(/\s+/g, ' ').trim()

function orario (cella, etichetta) {
  const trovato = cella.match(new RegExp(`${etichetta}:\\s*(\\d{2}:\\d{2})`))
  return trovato ? trovato[1] : null
}

function normalizzaCodice (grezzo) {
  if (!grezzo) return null
  const trovato = grezzo.trim().match(/([A-Z0-9]{2})\s*(\d{1,4})$/)
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
```

- [ ] **Step 4: Eseguire i test**

Run: `node --test test/parser.test.js`
Expected: 6 test PASS.

Se fallisce quello sul codeshare, la pagina 1 di oggi non ne contiene: catturare un'altra pagina con `node strumenti/salva-fixture.js 3` e riprovare. Se fallisce quello sul formato del codice, stampare i valori grezzi con `console.log(estraiVoli(html).slice(0, 5))` e correggere `normalizzaCodice` sul caso vero, non a indovinare.

- [ ] **Step 5: Commit**

```bash
git add src/fonte-adr.js test/parser.test.js test/fixture/pagina-arrivi.html
git commit -m "feat: parser delle righe arrivi, con test strutturali su fixture vera"
```

---

### Task 3: Scarico di una giornata intera

**Files:**
- Modify: `src/fonte-adr.js` (aggiunta di `scaricaGiornata`)
- Modify: `strumenti/salva-fixture.js` (opzione per salvare la giornata in JSON)

**Interfaces:**
- Consumes: `scaricaPagina`, `estraiVoli` da Task 1 e 2
- Produces: `scaricaGiornata(config, { data }) → Promise<Volo[]>`

Le pagine HTML di una giornata pesano una ventina di megabyte: nel repo va la **giornata già estratta in JSON**, che sta in poche centinaia di kB. Le fixture HTML restano una o due, solo per il parser.

- [ ] **Step 1: Implementare `scaricaGiornata` in `src/fonte-adr.js`**

```js
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
```

- [ ] **Step 2: Estendere `strumenti/salva-fixture.js` per salvare la giornata**

Sostituire il corpo del file con questo, che tiene entrambi i modi:

```js
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { scaricaPagina, scaricaGiornata } from '../src/fonte-adr.js'

const config = JSON.parse(await readFile('config.json', 'utf8'))
const modo = process.argv[2] ?? 'pagina'
await mkdir('test/fixture', { recursive: true })

if (modo === 'giornata') {
  const voli = await scaricaGiornata(config)
  await writeFile('test/fixture/voli-giornata.json', JSON.stringify(voli, null, 1), 'utf8')
  console.log(`Salvati ${voli.length} voli grezzi in test/fixture/voli-giornata.json`)
} else {
  const pagina = Number(process.argv[3] ?? 1)
  const html = await scaricaPagina({ pagina, righePerPagina: config.righePerPagina }, config.rete)
  if (!html.includes('Orario previsto')) {
    console.error('ATTENZIONE: la pagina non contiene "Orario previsto". URL probabilmente incompleto.')
    process.exit(1)
  }
  await writeFile('test/fixture/pagina-arrivi.html', html, 'utf8')
  console.log(`Salvata pagina ${pagina} (${html.length} caratteri)`)
}
```

- [ ] **Step 3: Scaricare una giornata vera e leggere il numero**

Run: `node strumenti/salva-fixture.js giornata`
Expected: qualche decina di secondi (c'è la pausa fra le pagine), poi `Salvati N voli grezzi`.

**Questo numero va guardato, non ignorato.** Atteso: intorno a 800. Se è sotto 300, la paginazione si ferma troppo presto — probabile che l'ultima pagina restituisca meno di `righePerPagina` per un altro motivo. Se è esattamente `maxPagine × righePerPagina`, la giornata è troncata e va alzato `maxPagine`. Annotare il valore osservato nel messaggio di commit: è il riferimento contro cui si misurerà la deduplica.

- [ ] **Step 4: Commit**

```bash
git add src/fonte-adr.js strumenti/salva-fixture.js test/fixture/voli-giornata.json
git commit -m "feat: scarico paginato di una giornata intera (osservati N voli grezzi)"
```

---

### Task 4: Censimento degli stati volo

Questa task chiude l'unica incognita dichiarata della spec: quali valori usa ADR nella colonna "Stato del volo". Finché non lo sappiamo, la regola su cosa escludere è indovinata.

**Files:**
- Create: `strumenti/censisci-stati.js`
- Modify: `config.json` (riempimento di `statiEsclusi`)
- Modify: `docs/superpowers/specs/2026-08-10-semaforo-fco-design.md` (registrazione dei valori osservati)

**Interfaces:**
- Consumes: `test/fixture/voli-giornata.json` da Task 3
- Produces: `config.statiEsclusi` popolato con valori veri

- [ ] **Step 1: Scrivere `strumenti/censisci-stati.js`**

```js
import { readFile } from 'node:fs/promises'

const voli = JSON.parse(await readFile('test/fixture/voli-giornata.json', 'utf8'))
const conteggio = new Map()
for (const volo of voli) {
  conteggio.set(volo.stato, (conteggio.get(volo.stato) ?? 0) + 1)
}

console.log(`${voli.length} voli, ${conteggio.size} stati distinti:\n`)
for (const [stato, n] of [...conteggio].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(5)}  ${stato}`)
}
```

- [ ] **Step 2: Eseguirlo e leggere l'elenco**

Run: `npm run stati`
Expected: un elenco di stati con i conteggi. `Arrivato` e `Schedulato` sono attesi e devono coprire la grande maggioranza.

- [ ] **Step 3: Decidere quali stati escludere, sui valori veri**

Regola: si escludono solo gli stati che significano "questo aereo non porta passeggeri a Fiumicino" — cancellato e dirottato, con la grafia esatta che ADR usa. Tutto il resto si conta. In dubbio, **si conta**: un volo contato per errore sposta un colore di poco, un volo escluso per errore svuota una fascia.

Scrivere i valori osservati in `config.json`, per esempio:

```json
"statiEsclusi": ["Cancellato", "Dirottato"]
```

Se il censimento mostra grafie diverse (`Volo cancellato`, `Cancellato/Annullato`, maiuscole diverse), usare quelle esatte. Il confronto nel codice sarà case-insensitive, ma i valori in configurazione devono essere quelli che ADR stampa davvero.

- [ ] **Step 4: Registrare l'esito nella spec**

Aggiungere in fondo all'appendice della spec una sottosezione `### Stati volo osservati (censiti il <data>)` con l'elenco completo e i conteggi, e una riga che dice quali sono stati esclusi e perché. È l'incognita che la spec dichiarava aperta: va chiusa lì, non solo in `config.json`.

- [ ] **Step 5: Commit**

```bash
git add strumenti/censisci-stati.js config.json docs/superpowers/specs/2026-08-10-semaforo-fco-design.md
git commit -m "feat: censimento degli stati volo ADR e chiusura dell'incognita nella spec"
```

---

### Task 5: Deduplica dei codeshare

Il pezzo che decide se i numeri sono giusti. Senza, ogni fascia è gonfiata di circa il 40%, e lo è di più sulle rotte più vendute in codeshare.

**Files:**
- Create: `src/tempo.js`
- Create: `src/aggregatore.js`
- Create: `test/aggregatore.test.js`

**Interfaces:**
- Consumes: `Volo[]` come definito in Task 2; `test/fixture/voli-giornata.json` da Task 3
- Produces:
  - `src/tempo.js`: `inMinuti('14:35') → 875`, `inOrario(875) → '14:35'`, `adessoInMinuti() → number`
  - `src/aggregatore.js`: `deduplica(voli) → Volo[]`, `escludiStati(voli, statiEsclusi) → Volo[]`, `sospettiDuplicati(voli) → number`, `minutiArrivo(volo) → number`

- [ ] **Step 1: Scrivere i test che falliscono**

```js
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
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test test/aggregatore.test.js`
Expected: FAIL, `Cannot find module '../src/aggregatore.js'`.

- [ ] **Step 3: Scrivere `src/tempo.js`**

Serve già adesso perché la rete di sicurezza della deduplica raggruppa per orario.

```js
export function inMinuti (orario) {
  const trovato = /^(\d{1,2}):(\d{2})$/.exec(orario ?? '')
  if (!trovato) throw new Error(`orario non valido: ${JSON.stringify(orario)}`)
  return Number(trovato[1]) * 60 + Number(trovato[2])
}

export function inOrario (minuti) {
  const dentroGiorno = ((minuti % 1440) + 1440) % 1440
  const ore = String(Math.floor(dentroGiorno / 60)).padStart(2, '0')
  const min = String(dentroGiorno % 60).padStart(2, '0')
  return `${ore}:${min}`
}

// L'unico punto del progetto in cui esiste un fuso orario.
export function adessoInMinuti (adesso = new Date()) {
  const parti = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(adesso)
  const valore = (tipo) => Number(parti.find((p) => p.type === tipo).value)
  return valore('hour') * 60 + valore('minute')
}

export function oggiARoma (adesso = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(adesso)
}
```

- [ ] **Step 4: Scrivere `src/aggregatore.js` con deduplica ed esclusione stati**

```js
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
```

- [ ] **Step 5: Eseguire i test**

Run: `node --test test/aggregatore.test.js`
Expected: 7 test PASS.

Se fallisce solo l'ultimo (la forchetta), leggere i due numeri nel messaggio prima di toccare il codice.

- Risultato vicino al totale grezzo → il campo `operatoDa` non viene estratto: il problema è nel parser, non qui. Stampare `voli.filter(v => v.operatoDa).length` sulla fixture e tornare alla Task 2.
- Risultato molto sotto il minimo → `deduplica` sta scartando troppo: controllare la regola dell'orfano, che deve tenere **una** riga per `operatoDa` non risolto e non zero.

Il test sui due voli distinti da CDG allo stesso orario serve a impedire che qualcuno reintroduca la fusione per origine e orario: sono due aerei veri, e devono restare due.

- [ ] **Step 6: Commit**

```bash
git add src/tempo.js src/aggregatore.js test/aggregatore.test.js
git commit -m "feat: deduplica dei codeshare, con verifica del totale su una giornata vera"
```

---

### Task 6: Fasce e colori

**Files:**
- Modify: `src/aggregatore.js`
- Modify: `test/aggregatore.test.js`

**Interfaces:**
- Consumes: `deduplica`, `escludiStati`, `minutiArrivo` da Task 5; `inMinuti`, `inOrario` da `src/tempo.js`
- Produces:
  - `colore(voli, soglie) → 'verde' | 'giallo' | 'rosso'`
  - `costruisciFasce(voli, config) → [{ inizioMinuti, inizio, voli, colore }]` — copre le 24 ore, fasce vuote incluse

- [ ] **Step 1: Aggiungere i test che falliscono**

Le soglie sono `{ giallo: 3, verde: 6 }`, quindi i confini da inchiodare sono 2/3 e 5/6.

```js
import { colore, costruisciFasce } from '../src/aggregatore.js'

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
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test test/aggregatore.test.js`
Expected: FAIL con `colore is not a function`.

- [ ] **Step 3: Implementare in `src/aggregatore.js`**

```js
export function colore (numeroVoli, soglie) {
  if (numeroVoli >= soglie.verde) return 'verde'
  if (numeroVoli >= soglie.giallo) return 'giallo'
  return 'rosso'
}

export function costruisciFasce (voli, config) {
  const ampiezza = config.ampiezzaFasciaMinuti
  const quante = Math.floor(1440 / ampiezza)
  const conteggi = new Array(quante).fill(0)

  for (const volo of voli) {
    const indice = Math.floor((minutiArrivo(volo) % 1440) / ampiezza)
    conteggi[indice] += 1
  }

  return conteggi.map((numeroVoli, indice) => ({
    inizioMinuti: indice * ampiezza,
    inizio: inOrario(indice * ampiezza),
    voli: numeroVoli,
    colore: colore(numeroVoli, config.soglie)
  }))
}
```

Aggiungere `inOrario` all'import da `./tempo.js`.

- [ ] **Step 4: Eseguire i test**

Run: `node --test test/`
Expected: tutti PASS (parser + aggregatore).

- [ ] **Step 5: Commit**

```bash
git add src/aggregatore.js test/aggregatore.test.js
git commit -m "feat: fasce da 30 minuti sull'orario aggiornato e colore sulle soglie"
```

---

### Task 7: Il verdetto a finestra mobile

La griglia resta a fasce fisse perché serve a confrontare. Il verdetto no: chi atterra alle 14:28 non deve leggere i sei voli della fascia 14:00-14:30, che sono già scesi.

**Files:**
- Modify: `src/aggregatore.js`
- Modify: `test/aggregatore.test.js`

**Interfaces:**
- Consumes: `minutiArrivo`, `colore` da Task 5 e 6; `inOrario` da `src/tempo.js`
- Produces: `calcolaVerdetto(voli, config, adessoMinuti) → { arrivoStimato, arrivoMinuti, voli, colore }`

- [ ] **Step 1: Aggiungere i test che falliscono**

```js
import { calcolaVerdetto } from '../src/aggregatore.js'

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
  const voli = [volo({ previsto: '00:10' })]
  const verdetto = calcolaVerdetto(voli, configBase, 23 * 60 + 50)
  assert.equal(verdetto.arrivoStimato, '00:20')
  assert.equal(verdetto.voli, 1, 'i voli dopo la mezzanotte non vengono visti')
})
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

Run: `node --test test/aggregatore.test.js`
Expected: FAIL con `calcolaVerdetto is not a function`.

- [ ] **Step 3: Implementare in `src/aggregatore.js`**

Il confronto avviene sul cerchio delle 24 ore, così il caso della mezzanotte non ha bisogno di codice dedicato.

```js
export function calcolaVerdetto (voli, config, adessoMinuti) {
  const arrivo = adessoMinuti + config.minutiViaggio
  const larghezza = config.ampiezzaFasciaMinuti
  const dentro = voli.filter((v) => {
    const distanza = ((minutiArrivo(v) - arrivo) % 1440 + 1440) % 1440
    return distanza < larghezza
  })
  return {
    arrivoMinuti: arrivo % 1440,
    arrivoStimato: inOrario(arrivo),
    voli: dentro.length,
    colore: colore(dentro.length, config.soglie)
  }
}
```

- [ ] **Step 4: Eseguire i test**

Run: `node --test test/`
Expected: tutti PASS.

- [ ] **Step 5: Commit**

```bash
git add src/aggregatore.js test/aggregatore.test.js
git commit -m "feat: verdetto a finestra mobile di 30 minuti dall'arrivo stimato"
```

---

### Task 8: La colla, la validazione e `data.json`

**Files:**
- Create: `src/genera.js`
- Create: `data.json` (generato)

**Interfaces:**
- Consumes: `scaricaGiornata` da Task 3; `deduplica`, `escludiStati`, `costruisciFasce`, `calcolaVerdetto` da Task 5-7; `adessoInMinuti`, `oggiARoma` da `src/tempo.js`
- Produces: `data.json` nella radice, con lo schema della spec

- [ ] **Step 1: Scrivere `src/genera.js`**

Il controllo di plausibilità è il punto centrale di questo file: se il parser muore, `data.json` uscirebbe con zero voli, e zero voli si colorano di rosso. Un'app che funziona benissimo e dice sempre di restare a casa.

```js
import { readFile, writeFile } from 'node:fs/promises'
import { scaricaGiornata } from './fonte-adr.js'
import { deduplica, escludiStati, costruisciFasce, calcolaVerdetto, sospettiDuplicati } from './aggregatore.js'
import { adessoInMinuti, oggiARoma } from './tempo.js'

const config = JSON.parse(await readFile('config.json', 'utf8'))

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

await writeFile('data.json', JSON.stringify(uscita, null, 1) + '\n', 'utf8')
console.log(
  `data.json scritto: ${grezzi.length} righe → ${dedotti.length} voli → ${contabili.length} contabili. ` +
  `Verdetto ${uscita.verdetto.arrivoStimato}: ${uscita.verdetto.voli} voli (${uscita.verdetto.colore}).`
)
```

- [ ] **Step 2: Generare `data.json` per la prima volta**

Run: `npm run genera`
Expected: una riga di riepilogo con quattro numeri, e `data.json` creato.

- [ ] **Step 3: Guardare il file con occhio critico**

Run: `node -e "const d=require('./data.json'); console.log(d.verdetto); console.log(d.fasce.filter(f=>f.voli>0).slice(0,8))"`

Da verificare a mano, perché nessun test lo copre. **Attenzione: la fonte è una board live
con una finestra mobile** (misurato: scaricando alle 16:53 il primo `previsto` era 14:00 e
l'ultimo 23:55, quindi ~2-3 ore indietro e nient'altro). Quindi i controlli sulle fasce
valgono solo per le ore che cadono dentro la finestra, e dipendono dall'ora dello scarico:
- le fasce **dentro la finestra** e prima dell'ora corrente devono avere voli in stato
  `Arrivato`; quelle dopo, voli `Schedulato`. Se è invertito, gli orari sono sfasati
- le fasce **fuori dalla finestra** sono vuote perché la fonte non le fornisce, non perché
  non atterri niente: non leggerle come un guasto
- il rapporto `righeScaricate / voliDopoDeduplica` deve stare fra `rapportoDeduplica.min` e
  `max` (osservato 2,88). Il totale assoluto **non** è un riferimento utile: cambia con l'ora
- `verdetto.arrivoStimato` deve essere l'ora corrente più mezz'ora

- [ ] **Step 4: Commit**

```bash
git add src/genera.js data.json
git commit -m "feat: generazione di data.json con controllo di plausibilità che fallisce invece di mentire"
```

---

### Task 9: La pagina

**Files:**
- Create: `index.html`
- Create: `stile.css`
- Create: `app.js`

**Interfaces:**
- Consumes: `data.json` prodotto da Task 8
- Produces: la pagina servita da GitHub Pages

Layout approvato: verdetto grande in cima, lista compatta delle fasce successive, giornata intera a richiesta, età del dato sempre visibile. Il numero di voli è **scritto dentro** ogni fascia e non affidato solo al colore: al sole non si distingue il verde dal giallo, e una persona su dieci è daltonica.

- [ ] **Step 1: Scrivere `index.html`**

```html
<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Semaforo Fiumicino</title>
<link rel="stylesheet" href="stile.css">
</head>
<body>
<header>
  <span>Fiumicino · arrivi</span>
  <span id="eta">…</span>
</header>

<main>
  <div id="avviso" hidden></div>
  <section id="verdetto" class="verdetto"></section>
  <h2>Poi</h2>
  <ul id="prossime" class="fasce"></ul>
  <button id="apriGiornata" type="button">Tutta la giornata</button>
  <ul id="giornata" class="fasce" hidden></ul>
</main>

<footer>
  <p>Conta gli aerei che atterrano, non i taxi già in fila.</p>
</footer>

<script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Scrivere `stile.css`**

```css
:root {
  --verde: #cdeccd; --verde-pieno: #4f9c4f;
  --giallo: #fbe9b8; --giallo-pieno: #d9a520;
  --rosso: #f6cfcf; --rosso-pieno: #c04b4b;
  --grigio: #e6e6e8; --testo: #14161a;
}
* { box-sizing: border-box; }
body {
  margin: 0; font-family: system-ui, sans-serif; color: var(--testo);
  background: #fbfbfc; -webkit-text-size-adjust: 100%;
}
header {
  display: flex; justify-content: space-between; gap: 1rem;
  background: #14161a; color: #fff; padding: .6rem .9rem; font-size: .8rem;
  position: sticky; top: 0;
}
main { padding: .9rem; max-width: 32rem; margin: 0 auto; }
h2 { font-size: .75rem; text-transform: uppercase; letter-spacing: .12em; color: #666; margin: 1.2rem 0 .5rem; }

#avviso { background: #fff3cd; border: 1px solid #e0c97f; border-radius: .5rem; padding: .7rem .8rem; font-size: .85rem; margin-bottom: .9rem; }

.verdetto { border-radius: .8rem; padding: 1.1rem; color: #fff; }
.verdetto .etichetta { font-size: .65rem; letter-spacing: .12em; text-transform: uppercase; opacity: .9; }
.verdetto .ora { font-size: 2.2rem; font-weight: 800; line-height: 1.1; }
.verdetto .dettaglio { font-size: .9rem; }
.verdetto.verde { background: var(--verde-pieno); }
.verdetto.giallo { background: var(--giallo-pieno); }
.verdetto.rosso { background: var(--rosso-pieno); }
.verdetto.spento { background: var(--grigio); color: var(--testo); }

.fasce { list-style: none; margin: 0; padding: 0; }
.fasce li {
  display: flex; align-items: center; gap: .6rem;
  padding: .55rem .7rem; margin-bottom: .25rem; border-radius: .5rem;
  font-variant-numeric: tabular-nums;
}
.fasce li .conteggio { margin-left: auto; font-weight: 700; }
.fasce li.verde { background: var(--verde); }
.fasce li.giallo { background: var(--giallo); }
.fasce li.rosso { background: var(--rosso); }
.fasce li.spento { background: var(--grigio); }
.fasce li.passata { opacity: .45; }

button {
  width: 100%; margin-top: .8rem; padding: .7rem; font: inherit;
  background: none; border: 1px solid #ccc; border-radius: .5rem; color: #444;
}
footer { padding: 1.4rem .9rem 2.4rem; text-align: center; font-size: .78rem; color: #777; }
```

- [ ] **Step 3: Scrivere `app.js`**

La pagina non ha numeri suoi: legge le soglie, le ore da mostrare e i limiti di
età dal blocco `config` che `data.json` si porta dietro.

```js
const elemento = (id) => document.getElementById(id)

function minutiDa (isoUtc) {
  return Math.floor((Date.now() - new Date(isoUtc).getTime()) / 60000)
}

function testoEta (minuti) {
  if (minuti < 1) return 'aggiornato ora'
  if (minuti < 60) return `aggiornato ${minuti} min fa`
  const ore = Math.floor(minuti / 60)
  return `aggiornato ${ore} ${ore === 1 ? 'ora' : 'ore'} fa`
}

function disegnaVerdetto (dati, affidabile) {
  const { verdetto } = dati
  const contenitore = elemento('verdetto')
  contenitore.className = `verdetto ${affidabile ? verdetto.colore : 'spento'}`
  const frase = { verde: 'Vale il viaggio.', giallo: 'Può andare.', rosso: 'Meglio restare in città.' }
  contenitore.innerHTML = `
    <div class="etichetta">Se parti adesso, arrivi per le</div>
    <div class="ora">${verdetto.arrivoStimato}</div>
    <div class="dettaglio">${verdetto.voli} ${verdetto.voli === 1 ? 'volo' : 'voli'} nella mezz'ora successiva${
      affidabile ? ' · ' + frase[verdetto.colore] : ''
    }</div>`
}

function riga (fascia, affidabile, passata) {
  const classi = [affidabile ? fascia.colore : 'spento']
  if (passata) classi.push('passata')
  return `<li class="${classi.join(' ')}">
    <b>${fascia.inizio}</b>
    <span class="conteggio">${fascia.voli}</span>
  </li>`
}

function disegnaFasce (dati, affidabile) {
  const daMinuti = dati.verdetto.arrivoMinuti
  const larghezzaLista = dati.config.oreAvantiInLista * 60
  const prossime = dati.fasce.filter((f) => {
    const distanza = ((f.inizioMinuti - daMinuti) % 1440 + 1440) % 1440
    return distanza <= larghezzaLista
  })
  elemento('prossime').innerHTML = prossime.map((f) => riga(f, affidabile, false)).join('')
  elemento('giornata').innerHTML = dati.fasce
    .map((f) => riga(f, affidabile, f.inizioMinuti < daMinuti))
    .join('')
}

async function avvia () {
  let dati
  try {
    const risposta = await fetch(`data.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`)
    dati = await risposta.json()
  } catch {
    elemento('avviso').hidden = false
    elemento('avviso').textContent = 'Non riesco a leggere i dati. Senza connessione vedi l\'ultima versione salvata dal telefono.'
    return
  }

  const eta = minutiDa(dati.generatoAlle)
  const affidabile = eta < dati.config.etaNonAffidabileMinuti
  elemento('eta').textContent = testoEta(eta)

  if (!affidabile) {
    elemento('avviso').hidden = false
    elemento('avviso').textContent = `Dati vecchi di oltre ${Math.floor(eta / 60)} ore: i colori sono spenti perché non sarebbero affidabili.`
  } else if (eta >= dati.config.etaAvvisoMinuti) {
    elemento('avviso').hidden = false
    elemento('avviso').textContent = `Dati di ${eta} minuti fa: l'aggiornamento automatico è in ritardo.`
  }

  disegnaVerdetto(dati, affidabile)
  disegnaFasce(dati, affidabile)

  elemento('apriGiornata').addEventListener('click', () => {
    const lista = elemento('giornata')
    lista.hidden = !lista.hidden
    elemento('apriGiornata').textContent = lista.hidden ? 'Tutta la giornata' : 'Chiudi'
  })
}

avvia()
```

- [ ] **Step 4: Aprire la pagina in locale e guardarla**

Run: `npx --yes serve . -l 8080` (oppure `python -m http.server 8080`)
Aprire `http://localhost:8080`.

Da verificare a occhio:
- il verdetto in cima mostra l'ora corrente più mezz'ora, con un colore
- la lista sotto parte dalla fascia di arrivo e va avanti circa quattro ore
- "Tutta la giornata" apre le 48 fasce, con le passate smorzate
- restringendo la finestra a 360px di larghezza nulla esce dallo schermo

Poi la prova del degrado, che è la parte che nessuno prova mai: modificare a mano `generatoAlle` in `data.json` mettendo una data di ieri, ricaricare, e verificare che i colori si spengano e compaia l'avviso. Rimettere il valore giusto rigenerando con `npm run genera`.

- [ ] **Step 5: Commit**

```bash
git add index.html stile.css app.js
git commit -m "feat: pagina mobile con verdetto in cima e colori che si spengono su dati vecchi"
```

---

### Task 10: Il cron e la pubblicazione

**Files:**
- Create: `.github/workflows/aggiorna.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: `npm run genera` da Task 8
- Produces: `data.json` aggiornato e committato ogni 15 minuti; sito pubblicato

⚠️ **Questa task contiene passi che l'agente non può eseguire da solo**: creare il repo su GitHub, renderlo pubblico e attivare Pages richiedono l'intervento dell'utente. Vanno chiesti, non aggirati.

- [ ] **Step 1: Scrivere `.github/workflows/aggiorna.yml`**

```yaml
name: aggiorna i dati

on:
  schedule:
    - cron: '*/15 * * * *'
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: aggiorna
  cancel-in-progress: false

jobs:
  aggiorna:
    runs-on: ubuntu-latest
    env:
      TZ: Europe/Rome
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run genera
      - name: committa se qualcosa è cambiato
        run: |
          git config user.name  'semaforo-fco'
          git config user.email 'actions@users.noreply.github.com'
          if git diff --quiet data.json; then
            echo 'nessuna variazione'
            exit 0
          fi
          git add data.json
          git commit -m "dati: aggiornamento automatico"
          git push
```

Note sul perché di alcune righe. `TZ: Europe/Rome` non è strettamente necessario — il codice usa `Intl` con il fuso esplicito — ma se un giorno qualcuno aggiunge un `new Date().getHours()` senza pensarci, questa riga gli salva la giornata. `npm test` gira prima di generare: se la deduplica si è rotta, il cron si ferma invece di committare numeri gonfiati. `concurrency` evita che due esecuzioni sovrapposte si diano il push sui piedi.

- [ ] **Step 2: Scrivere `README.md`**

Deve contenere: cos'è in tre righe; il limite dichiarato (misura la domanda, non la concorrenza); come si lancia a mano (`npm ci && npm run genera`); **come si tarano le soglie** (aprire `config.json`, cambiare `soglie`, committare — l'operazione che l'utente farà più spesso); e il link alla spec.

- [ ] **Step 3: Chiedere all'utente di creare il repo pubblico su GitHub**

Serve un repo **pubblico** (Actions e Pages gratis illimitati) chiamato `semaforo-fco`. Poi:

```bash
git remote add origin https://github.com/<utente>/semaforo-fco.git
git push -u origin main
```

- [ ] **Step 4: Chiedere all'utente di attivare Pages e i permessi di scrittura**

Due impostazioni nel repo, entrambe da interfaccia web:
- **Settings → Pages → Source: Deploy from a branch**, branch `main`, cartella `/ (root)`
- **Settings → Actions → General → Workflow permissions: Read and write permissions** (senza questo il `git push` del workflow fallisce con 403)

- [ ] **Step 5: Lanciare il workflow a mano e verificare**

Dalla scheda Actions del repo, `aggiorna i dati` → **Run workflow**.
Expected: job verde, e un commit nuovo `dati: aggiornamento automatico`.

Se fallisce sul push con 403, manca lo Step 4. Se fallisce su `npm test`, i test dicono cosa: leggere il messaggio, non riprovare.

- [ ] **Step 6: Aprire il sito dal cellulare**

`https://<utente>.github.io/semaforo-fco/`

Verificare dal telefono vero, non dal simulatore del browser: che si legga al sole, che il pollice arrivi al pulsante, che l'età del dato sia visibile senza scorrere.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/aggiorna.yml README.md
git commit -m "feat: cron ogni 15 minuti e pubblicazione su GitHub Pages"
```

---

### Task 11: La verifica che conta

Nessun test sostituisce questa, ed è l'unica che dice se il progetto è servito a qualcosa.

**Files:** nessuno. Si modifica solo `config.json` se le soglie risultano sbagliate.

- [ ] **Step 1: Confronto col tabellone**

Un pomeriggio, aprire l'app e la pagina arrivi di adr.it affiancate. Scegliere tre fasce e contare a mano i voli, **saltando le righe che dicono "Operato da"**. I numeri devono coincidere. Se l'app conta di più, la deduplica sta lasciando passare dei codeshare.

- [ ] **Step 2: Verifica dei ritardi**

Trovare su adr.it un volo con orario barrato e orario aggiornato molto diverso, e controllare che nell'app risulti nella fascia dell'orario aggiornato e non di quello programmato.

- [ ] **Step 3: Taratura delle soglie con l'utente**

Dopo qualche giorno d'uso, la domanda al tassista è una: **le fasce verdi ti hanno reso più delle gialle?** Se no, il problema non è il codice: sono i numeri in `soglie`. Si cambiano in `config.json`, si committa, e al giro successivo del cron l'app è tarata.

Annotare nel README la data della taratura e i valori scelti: al terzo cambio nessuno si ricorda più da dove si era partiti.

- [ ] **Step 4: Registrare l'esito nella spec**

Aggiornare la sezione Test della spec con quello che il confronto ha rivelato, e spostare nel backlog quello che è emerso e non era previsto.

---

## Self-Review

**Copertura della spec.** Ogni sezione della spec ha una task: fonte ADR → 1-3, censimento stati (incognita dichiarata) → 4, deduplica → 5, fasce e colori → 6, verdetto a finestra mobile → 7, `data.json` e plausibilità → 8, pagina e degrado → 9, cron e Pages → 10, prova sul campo e taratura → 11. Il backlog non genera task, per definizione.

**Scostamenti dichiarati.** Tutti riportati anche nella spec, che è stata aggiornata di conseguenza.

1. Gli orari nel `data.json` sono ora locale a muro e non timestamp ISO. Motivo: elimina l'aritmetica sui fusi e sul cambio dell'ora dall'intero progetto.
2. Task 2 aggiunge test sul parser oltre al nucleo minimo concordato. Motivo: senza, il test sulla deduplica non sa distinguere una deduplica rotta da un parser morto.
3. **La "rete di sicurezza" della deduplica è stata declassata da regola a diagnostica.** Trovato in self-review: la regola come scritta (fondere per `origine + orario previsto`) e il test che pretende che due voli distinti da Parigi allo stesso minuto restino due sono incompatibili, e la parte sbagliata era la regola. Adesso `sospettiDuplicati` conta e segnala senza cancellare niente. Un numero gonfiato che si vede in diagnostica è meglio di un volo vero sparito in silenzio.
4. **Il blocco `config` di `data.json` è più ampio di quello della spec originale.** Trovato in self-review: la pagina è servita staticamente e non può leggere `config.json`, quindi con lo schema iniziale avrebbe dovuto tenersi i propri numeri in casa — in violazione del vincolo globale che vuole tutti i numeri in configurazione. Ora `oreAvantiInLista`, `etaAvvisoMinuti` e `etaNonAffidabileMinuti` viaggiano nel file.

**Coerenza dei nomi verificata:** `estraiVoli`, `scaricaPagina`, `scaricaGiornata`, `deduplica`, `escludiStati`, `minutiArrivo`, `colore`, `costruisciFasce`, `calcolaVerdetto`, `inMinuti`, `inOrario`, `adessoInMinuti`, `oggiARoma`. I campi del volo (`previsto`, `effettivo`, `codice`, `operatoDa`, `iata`, `stato`) sono gli stessi in Task 2, 5, 6 e 7. I campi delle fasce (`inizioMinuti`, `inizio`, `voli`, `colore`) sono gli stessi in Task 6, 8 e 9. `verdetto.arrivoMinuti` prodotto in Task 7 è consumato da `app.js` in Task 9.

**Rischio residuo più alto:** i selettori CSS del parser in Task 2 sono stati letti da una cattura reale del 2026-08-10, ma se ADR ha già cambiato qualcosa il test strutturale fallisce subito e in modo leggibile. È il punto in cui il piano può richiedere una correzione sul campo, e per questo è la seconda task e non l'ottava.
