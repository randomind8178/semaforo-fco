# semaforo-fco — Design

**Data:** 2026-08-10
**Stato:** approvato, pronto per il piano di implementazione
**Contesto:** progetto personale, un solo utente reale (un tassista), vincolo di costo zero

---

## Il problema

Un tassista deve decidere se conviene puntare su Fiumicino per prendere una corsa
non prenotata. La sua domanda è una sola: *se vado adesso, trovo passeggeri quando
arrivo?*

L'app legge gli arrivi di Fiumicino, li raggruppa in fasce da 30 minuti tenendo
conto dei ritardi, e colora ogni fascia in base a quanti aerei atterrano davvero
in quella mezz'ora. In cima risponde direttamente alla domanda di sopra.

Si consulta da cellulare, in strada, con una mano.

---

## Decisioni prese

| Decisione | Scelta | Perché |
| --- | --- | --- |
| Momento d'uso | Prossime ore in primo piano, giornata scorribile dietro | Serve sia per il "vado adesso?" sia per organizzare il turno, ma comanda l'adesso |
| Peso dei voli | Conteggio semplice: un volo vale 1 | Trasparente e verificabile a occhio. La pesatura è rimandata (→ backlog) |
| Fonte dati | Scraping della pagina arrivi pubblica di adr.it | È l'unica opzione a costo zero che contiene gli **orari aggiornati**, cioè i ritardi |
| Ampiezza fascia | 30 minuti | È l'unità di decisione reale: da Roma a Fiumicino ci vuole mezz'ora. Un'ora nasconde i picchi |
| Colore | Soglie assolute, da tarare con l'utente | Una colorazione relativa alla giornata dipingerebbe di verde un martedì morto |
| Runtime | Cron su GitHub Actions che pre-cucina un `data.json`, pagina statica su GitHub Pages | Zero euro strutturale, nessun server, e accumula storico gratis nella storia git |
| Tempo di viaggio | Fisso a 30 minuti, in configurazione | Rimandato il controllo in UI (→ backlog) |
| Linguaggio | Node, JavaScript moderno, no TypeScript, no bundler | Tiene aperta la porta a una versione serverless senza riscrivere niente |
| Test | Nucleo minimo subito, il resto rimandato | Vedi § Test |

---

## Fuori scope

- Pesatura dei voli per provenienza o per tipo di aeromobile
- Geolocalizzazione del tassista
- Distinzione fra Terminal 1 e Terminal 3
- Partenze, e aeroporto di Ciampino
- Login, account, notifiche, storico visibile in UI

---

## Il limite che non risolviamo

**L'app misura la domanda, non la concorrenza.** Sa quanti passeggeri stanno
atterrando; non sa quanti taxi sono già in fila ad aspettarli. Una fascia verde
con trenta colleghi in coda vale meno di una fascia gialla vuota, e quel dato non
esiste in forma leggibile da nessuna parte.

La scelta consapevole è colorare la domanda e lasciare che l'utente ci metta sopra
la sua esperienza, che sull'affollamento della fila è migliore di qualunque stima
nostra. Questo limite va detto all'utente, non nascosto dietro un colore.

---

## Architettura

Quattro pezzi con confini netti. Il motivo dei confini è tenere aperta la
possibilità di passare a una versione serverless: chi legge ADR e chi decide i
colori non devono sapere se girano dentro un cron o dentro una funzione.

### `fonte-adr` — il lettore

Parla **solo** con adr.it. Interfaccia: data + finestra oraria → lista di voli
grezzi. Non conosce le fasce, non conosce i colori.

Campi estratti per volo:

- orario previsto
- orario aggiornato (assente se il volo è in orario)
- vettore, numero volo
- `operatoDa` (vettore + numero del volo operativo, se la riga è un codeshare)
- origine, codice IATA origine
- terminal
- stato volo

È l'unico pezzo che si rompe quando ADR rifà il sito. Per questo è l'unico che va
inchiodato con test su HTML salvato su file.

### `aggregatore` — le regole

Funzione **pura**: lista di voli + configurazione + istante "adesso" → fasce con
conteggio e colore, più il verdetto.

Zero rete, zero orologio: l'ora corrente è un parametro, altrimenti non si può
testare cosa succede a mezzanotte o al cambio dell'ora. Qui vivono tutte le
decisioni discutibili del progetto (§ Regole di conteggio).

### `data.json` — il contratto

Il confine fra backend e telefono. Pochi kB. Contiene anche la configurazione con
cui è stato calcolato: sembra ridondante, ma è ciò che permette di guardare un
file di tre settimane fa e sapere con che soglie era stato colorato.

```json
{
  "generatoAlle": "2026-08-10T12:05:31.000Z",
  "giorno": "2026-08-10",
  "config": {
    "ampiezzaFasciaMinuti": 30,
    "minutiViaggio": 30,
    "soglie": { "giallo": 3, "verde": 6 },
    "oreAvantiInLista": 4,
    "etaAvvisoMinuti": 30,
    "etaNonAffidabileMinuti": 180
  },
  "copertura": { "daMinuti": 1080, "aMinuti": 1440 },
  "verdetto": {
    "arrivoMinuti": 875,
    "arrivoStimato": "14:35",
    "voli": 6,
    "colore": "verde"
  },
  "fasce": [
    { "inizio": "14:00", "voli": 7, "colore": "verde" },
    { "inizio": "14:30", "voli": 6, "colore": "verde" }
  ],
  "diagnostica": {
    "righeScaricate": 812,
    "voliDopoDeduplica": 468,
    "voliContabili": 465,
    "scartatiPerStato": 3,
    "sospettiDuplicati": 2
  }
}
```

**Gli orari delle fasce sono ora locale a muro, non timestamp.** ADR pubblica
`13:05` come ora locale di Roma, e le fasce sono fasce locali: se non convertiamo
mai in UTC e mai indietro, l'aritmetica sui fusi e sul cambio dell'ora non entra
nel progetto. Internamente un orario è un numero di minuti dalla mezzanotte locale
del giorno corrente (le 00:15 di domani sono 1455).

L'unico timestamp reale è `generatoAlle`, in UTC, che serve alla pagina per
calcolare l'età del dato. Quello non può essere ora locale, perché l'età è una
differenza fra due istanti veri.

Il blocco `diagnostica` non serve alla UI: serve a noi per accorgerci che la
deduplica ha smesso di funzionare.

**`copertura` dice fin dove arriva il dato, e serve a non mentire con uno zero.**
`fasce` copre sempre le 24 ore, ma la fonte è una board live che dà circa due ore di
passato e il resto della giornata: delle fasce fuori da quell'intervallo non sappiamo
niente, e `voli: 0` sarebbe un'assenza travestita da conteggio. Misurato: generando
alle 20:46, `copertura.daMinuti` era 1080, cioè le 18:00. Senza questo campo la pagina
mostrava la mattinata di Fiumicino a zero voli — e nella lista predefinita, alle 21:10,
già disegnava le fasce 00:00, 00:30 e 01:00 del giorno dopo, di cui la fonte non ha
ancora nulla.
Il confine si ricava dagli orari **previsti**, non da quelli d'arrivo: un volo molto
in ritardo atterra dopo la mezzanotte (osservato: previsto 19:55, stimato 01:55) e
falserebbe qualunque minimo o massimo calcolato sugli arrivi.

### La pagina

HTML, CSS e JavaScript, senza framework e senza build. Legge `data.json` e
disegna. Deve aprirsi su un telefono vecchio con una tacca di segnale.

Layout (approvato su mockup):

- **In cima, il verdetto**: un blocco grande colorato — "se parti adesso, arrivi
  per le 14:35", il numero di voli, una frase secca.
- **Sotto, la lista compatta** delle fasce successive, una riga per fascia, con il
  numero **scritto dentro** e non solo il colore: al sole non distingui il verde
  dal giallo, e un utente su dieci è daltonico.
  La lista mostra **solo le fasce di cui esiste il dato** (vedi `copertura`),
  intersecate con un intorno dell'arrivo: una fascia di passato recente, smorzata,
  per dare contesto, e `oreAvantiInLista` in avanti. Se l'arrivo stimato cade dopo la
  mezzanotte — succede fra le 23:30 e le 24:00 — non c'è nessuna fascia da mostrare e
  al suo posto compare una riga che lo dice.
- ~~**"Tutta la giornata"** apre il resto, fasce passate incluse ma smorzate.~~
  **Rimosso in implementazione**, deciso col proprietario. Prometteva una giornata che
  la fonte non fornisce: apriva le 48 fasce e la mattinata usciva a zero voli, quando
  in quelle ore erano atterrati centinaia di aerei di cui non abbiamo le righe. Una
  vista che mente su metà del suo contenuto vale meno che non averla.
- **L'ora dell'ultimo aggiornamento, sempre visibile.** Se il cron è fermo,
  l'utente deve accorgersene dallo schermo.

### Il cron

Solo colla, una ventina di righe: chiama il lettore, chiama l'aggregatore, valida,
scrive `data.json`, committa. Ogni 10-15 minuti.

Se un giorno servisse la versione serverless, si riscrive questa colla e i tre
pezzi sopra non si toccano.

---

## Regole di conteggio

**Quale orario conta.** Un volo cade nella fascia del suo **orario aggiornato** se
presente, altrimenti del programmato. Conseguenza da non nascondere: un volo può
cambiare fascia fra due aggiornamenti, quindi i numeri delle fasce future si
muovono. Non è un difetto, è il ritardo che si sposta.

**Deduplica dei codeshare.** Un aereo compare più volte, una riga per vettore che
vende quel volo.

0. Se due righe sono identiche in **ogni** campo, sono la stessa riga vista due
   volte e se ne tiene una. Non è una regola di fusione: nessun volo vero condivide
   codice, orario, origine, terminal e stato con un altro volo vero. Basta un campo
   diverso — un terminal, un orario aggiornato — e restano entrambe.
1. Se una riga ha `operatoDa`, si scarta la riga e si tiene quella del volo
   operativo.
2. Se la riga operativa non è nella finestra scaricata (succede ai bordi), si
   tiene la prima e si scartano le altre con lo stesso `operatoDa`.
3. Sui dati sporchi — righe che *sembrano* lo stesso aereo, con origine e orario
   uguali ma codice diverso — non si fonde niente: si **conta e si segnala**. Un
   contatore in `diagnostica` riporta quante righe condividono origine, orario
   previsto e orario aggiornato senza dichiarare un codeshare.

Il punto 3 era nato come regola di fusione ed è stato declassato a diagnostica
durante la stesura del piano, per un motivo concreto: da Parigi possono atterrare
due voli veri e distinti allo stesso minuto, e una regola che fonde per
`origine + orario` li cancellerebbe. Meglio un numero gonfiato che si vede in
diagnostica che un volo vero sparito in silenzio.

Il punto 0 è arrivato dopo, dai dati veri, e non contraddice il 3: il 3 rifiuta di
fondere righe che si *somigliano*, il 0 scarta righe **identiche**. Servono perché
la fonte è una lista viva che si sposta durante i due minuti di paginazione, e la
regola 1 non le vede: filtra per `operatoDa`, mentre le righe duplicate che
restano hanno `operatoDa` nullo. Misurato sul campo: 8 righe duplicate esatte su
634, di cui 5 già assorbite dalla regola 1 e 3 che sopravvivevano. Sono l'1,4% del
totale, e con soglie a 3 e 6 un volo fantasma basta a cambiare il colore di una
fascia.

**Va misurato, non sperato.** Misurato: 634 righe grezze in una finestra
pomeridiana, 224 voli veri, rapporto **2,83**. Se il rapporto resta vicino a 1 la
deduplica non funziona e ogni fascia è gonfiata di circa il 180%, peggio sulle
rotte più vendute in codeshare. Il conteggio assoluto non è un riferimento utile
perché la fonte è a finestra mobile (§ Errori e degrado): dipende dall'ora.
`sospettiDuplicati` sui contabili è scesa da 4 a 1 con l'introduzione del punto 0,
e quell'1 residuo è una coincidenza vera fra due voli distinti — cioè esattamente
il caso che il punto 3 protegge.

**Cosa non si conta.** I cancellati (passeggeri non ne portano) e i dirottati
(atterrano altrove). Attenzione: gli stati osservati finora sono solo `Arrivato` e
`Schedulato`; l'elenco completo va censito su qualche giorno di dati veri prima di
scrivere la regola definitiva. Fino ad allora la regola prudente è **contare
tutto tranne ciò che riconosciamo come cancellato o dirottato**.

**Fuso orario.** GitHub Actions gira in UTC, ADR pubblica ora locale di Roma.
Senza attenzione l'app sbaglia di due ore d'estate e di una d'inverno. La difesa
non è convertire bene: è **non convertire affatto** (vedi § `data.json`). Gli
orari restano ora locale a muro dall'inizio alla fine, e l'unico punto in cui il
fuso entra in gioco è la domanda "che ora è adesso a Roma", risolta con
`Intl.DateTimeFormat` su `Europe/Rome`.

Residuo noto e accettato: nella notte in cui l'ora torna indietro, la fascia
02:00-02:30 esiste due volte nella realtà e l'app le fonde in una sola, mostrando
la somma dei voli. Una notte all'anno, alle due e mezza, su una fascia che è rossa
comunque.

**Mezzanotte.** Alle 23:50 il verdetto punta al giorno dopo: lo scarico deve
includere anche la prima fascia del giorno successivo.

**Soglie iniziali.** Rosso fino a 2 voli, giallo da 3 a 5, verde da 6. Sono
un'ipotesi, non un dato: stanno in configurazione con un commento che dice che
sono da tarare con l'utente dopo qualche giorno d'uso.

**Il verdetto usa una finestra mobile, non la fascia fissa.** La griglia resta a
fasce fisse perché serve a leggere e confrontare. Il verdetto in cima invece conta
i voli che atterrano nei 30 minuti **a partire dall'arrivo stimato del tassista**.
Motivo: chi atterra alle 14:28 vedrebbe "6 voli" nella fascia 14:00-14:30 quando
quei sei aerei sono già scesi, e arriverebbe sul vuoto. Costa poche righe e
rimuove l'unico caso in cui l'app manda in aeroporto per niente.

---

## Configurazione

Un solo file, con dentro: ampiezza fascia, minuti di viaggio, soglie di colore,
quante ore avanti mostrare nella lista compatta, forchetta di plausibilità del
totale giornaliero. Nessuno di questi numeri va scritto nel codice.

La cadenza del cron **non** sta qui: sta nel workflow di GitHub Actions, che è
l'unico posto che la può far rispettare.

In `data.json` viene copiato il sottoinsieme che serve a **interpretare o a
disegnare** i numeri: ampiezza fascia, minuti di viaggio, soglie, ore da mostrare
nella lista, limiti di età oltre i quali avvisare o spegnere i colori. La pagina
non legge `config.json` — è servita staticamente e `config.json` non le arriva —
quindi tutto ciò che le serve deve viaggiare dentro `data.json`. Il resto dei
parametri (paginazione, pause, forchette di plausibilità) riguarda solo lo scarico
e resta fuori.

Le soglie definiscono due confini, non tre: `giallo` e `verde`. Rosso è tutto
quello che sta sotto `giallo`.

---

## Errori e degrado

Il guasto più insidioso non è quello che si vede: è quello che si traveste da
risposta. Se ADR rifà il sito e il parser non trova più righe, `data.json` esce con
zero voli, e **zero voli si colorano di rosso**: l'app resta funzionante e dice
all'utente di restare a casa per sempre.

- **La fonte non dà una giornata di calendario, ma una finestra mobile.** Misurato sul
  campo: scaricando alle 16:53 il primo `previsto` era 14:00 e l'ultimo 23:55. La pagina
  «voli in tempo reale» mostra ~2-3 ore indietro e il resto della giornata, e non c'è
  modo di chiederle le ore già passate. Funzionalmente non è un problema — il semaforo
  guarda `oreAvantiInLista` ore avanti — ma **ogni soglia calibrata su un giorno intero è
  sbagliata**, e ogni conteggio assoluto dipende dall'ora in cui gira il cron.
- **Controllo di plausibilità nel cron.** Se lo scarico produce meno di
  `minimoVoliPlausibile` righe, il cron **falla rumorosamente e non scrive `data.json`**:
  difende dal parser morto. Un dato di quaranta minuti fa è meglio di un dato vuoto
  verniciato di rosso.
  **Punto aperto**, da chiudere insieme agli orari del cron (§ Task 10): con la finestra
  mobile, a tarda sera restano legittimamente poche decine di voli, quindi una soglia
  fissa a 100 farebbe fallire il cron ogni notte per un motivo che non è un guasto. La
  soglia va abbassata, oppure resa proporzionale alle ore che restano nella finestra.
- **Controllo del doppio conteggio.** È un controllo diverso dal precedente e vive nel
  test sulla deduplica (§ Test): guarda il **rapporto** fra righe grezze e voli dedotti,
  non il totale. Il rapporto non dipende dall'ora, il totale sì.
  Nota: *una* fascia a zero è normale (alle 4 del mattino non atterra niente), e le fasce
  fuori dalla finestra sono vuote perché la fonte non le fornisce; è il raccolto intero a
  zero che è un guasto.
- **Cron fermo o in ritardo.** La pagina calcola l'età del dato da `generatoAlle`:
  oltre i 30 minuti mostra un avviso, oltre le 3 ore **smette di colorare** e
  dichiara i dati non affidabili. Il colore è una promessa; su dati vecchi non la
  manteniamo.
- **GitHub disattiva i workflow schedulati dopo 60 giorni di inattività del
  repo**, e il cron non è puntuale: nelle ore di punta può slittare. Da tenere
  presente, serve un commit vero ogni tanto.
- **adr.it non risponde.** Pochi tentativi con attesa crescente, poi rinuncia
  senza scrivere. Pagine scaricate **una alla volta con una pausa in mezzo**:
  è il sito pubblico di un aeroporto, non un'API che ci hanno venduto.
- **Telefono offline.** La pagina è statica e il browser la tiene in cache: mostra
  l'ultimo `data.json` che ha, con la sua età bene in vista.

---

## Test

Deciso con l'utente: **nucleo minimo subito, il resto rimandato.**

Subito, perché protegge i numeri:

1. **Controllo del rapporto di deduplica** su una fixture di raccolto vero: il
   rapporto fra righe grezze e voli dedotti deve cadere fra **2 e 4,5**. Misurato
   sul campo: 634 righe grezze → 224 voli fisici, rapporto **2,83**. È l'unica
   difesa contro il conteggio raddoppiato in silenzio: vicino a 1 la deduplica non
   sta funzionando, molto sopra sta fondendo voli distinti. La forchetta sta in
   configurazione, non nel test.
   Il controllo è sul rapporto e non sul totale perché la fonte è una board live a
   finestra mobile (§ Cosa può andare storto): il numero di voli dipende dall'ora
   in cui gira lo scarico, il rapporto no. La prima stesura chiedeva «fra 350 e 600
   voli dopo la deduplica», calibrata su una giornata di calendario che la fonte
   non fornisce e su un rapporto presunto di ~1,7 invece del 2,88 reale: sarebbe
   fallita sempre.
2. **Soglie ai bordi**: 2 contro 3 e 5 contro 6, dove i colori si scambiano.

Rimandato (→ backlog): fasce vuote, volo ritardato che cambia fascia, cancellati
esclusi, il verdetto che scavalca la mezzanotte, fixture catturate in giorni
diversi. Il cambio dell'ora non è più fra i test da scrivere: la scelta di non
convertire mai gli orari lo ha reso irrilevante.

Regole che restano valide comunque:

- Il parser si testa su **HTML vero salvato su file**, mai sulla rete. Un test che
  chiama adr.it fallisce quando manca la linea e non spiega perché. Le fixture sono
  pagine pubbliche di orari aerei: nessun dato personale.
- L'aggregatore è puro, quindi testabile davvero: quando si torna sui test, si
  torna qui.

**La prova vera, che nessun test sostituisce:** un pomeriggio si mette l'app
accanto al tabellone di adr.it e si confrontano tre fasce a occhio. E dopo una
settimana la risposta la dà il tassista — le fasce verdi gli hanno reso più delle
gialle? Se la risposta è no, il problema non è il codice, sono le soglie, ed è per
questo che stanno in un file da cambiare in dieci secondi.

---

## Backlog dei miglioramenti rimandati

Sezione viva: ogni cosa che rimandiamo finisce qui, non nei commenti del codice.

| # | Miglioramento | Nota |
| --- | --- | --- |
| 1 | Pesatura per provenienza (extra-Schengen > Schengen > nazionale) | Il codice IATA dell'origine è già estratto: costa poco |
| 2 | Pesatura per posti dell'aeromobile | Il tipo di aeromobile va verificato: è il campo che le fonti danno più spesso vuoto |
| 3 | Tempo di viaggio scegliibile (15/30/45) o da GPS | Il GPS senza dati di traffico sbaglia proprio nell'ora di punta |
| 4 | Versione serverless per dati freschi al minuto | I tre pezzi si riusano, si riscrive solo la colla |
| 5 | Colorazione confrontata con lo storico ("meglio del solito") | Abilitata gratis dallo storico accumulato in git |
| 6 | Distinzione Terminal 1 / Terminal 3 | Il campo è già estratto |
| 7 | Stima della concorrenza (taxi in fila) | Nessuna fonte nota. Vedi § Il limite che non risolviamo |
| 8 | Partenze e aeroporto di Ciampino | |
| 9 | Notifica quando una fascia diventa verde | Richiede service worker e permessi |
| 10 | Copertura di test completa dell'aggregatore | Vedi § Test |
| 11 | Service worker per funzionamento offline vero | |

---

## Appendice — cosa è stato verificato sulla fonte ADR

Verificato il 2026-08-10 con chiamate reali. **Non esiste un endpoint JSON**: la
pagina arrivi è un portlet Liferay che rende la tabella lato server.

Pagina: `https://www.adr.it/pax-fco-voli-in-tempo-reale`
Portlet: `3_WAR_realtimeflightsportlet` (prefisso parametri `_3_WAR_realtimeflightsportlet_`)

Parametri utili: `tab=arrival|departure`, `orario=HH:MM-HH:MM`, `date`, `delta`
(righe per pagina, default 20), `cur` (pagina), `orderByCol=comparationTime`,
`orderByType=asc`.

⚠️ **Trappola:** un set di parametri incompleto restituisce HTTP 200 con
*"Nessun elemento è stato trovato"*, non un errore. Serve il set completo che usa
la loro stessa paginazione (inclusi i parametri vuoti come `airport=`, `carrier=`,
`codNat=`, `codScaOpe=`, `codVet=`, `date=`, `dataNumVol=`, `numVol=`, `rouIata=`,
più `searchType=completeSmall`, `isParent=false`, `airportId=0`, `resetCur=false`).

Colonne della tabella: Orario · N° Volo · Partenza · Terminal · Stato del volo.

Righe reali estratte:

```
previsto 13:00  eff. 12:52 | WIZZAIR W6 4031        | BELGRADO (BEG)   | T3 | Arrivato
previsto 13:00             | EGYPTAIR MS 791        | CAIRO (CAI)      | T3 | Arrivato
previsto 13:05  eff. 12:55 | ROYAL JORDANIAN RJ 101 | AMMAN (AMM)      | T3 | Arrivato
previsto 13:05  eff. 17:00 | AEROITALIA XZ 2812     | COMISO (CIY)     | T1 | Schedulato
previsto 13:00  eff. 12:55 | VOLOTEA V7 2196                           | LOURDES (LDE) | T1 | Arrivato
previsto 13:00  eff. 12:55 | ITA AZ 7119 — Operato da: VOLOTEA V7 2196 | LOURDES (LDE) | T1 | Arrivato
```

Due scoperte che cambiano il design:

1. **Le ultime due righe sono lo stesso aereo.** Senza deduplica sul campo
   "Operato da" i conteggi si gonfiano, e si gonfiano di più sulle rotte più
   vendute in codeshare.
2. **Il campo "orario effettivo" mente sul suo nome.** La riga AEROITALIA ha
   previsto 13:05, effettivo 17:00 e stato `Schedulato`: l'aereo non è ancora
   atterrato, le 17:00 sono una *previsione*. È esattamente il dato che ci serve,
   ma va letto **insieme allo stato**, non da solo.

### Stati volo osservati (censiti il 2026-08-10)

Questa era l'unica incognita dichiarata aperta dalla spec: quali valori esatti usa
ADR nella colonna "Stato del volo". Chiusa con `npm run stati` su un raccolto vero
di 634 righe, catturato alle 17:02 (finestra 15:00-23:55).

| voli | stato | contato? |
|-----:|-------|----------|
| 448 | `Schedulato` | sì |
| 101 | `Arrivato` | sì |
| 51 | `Volo Cancellato` | **no, escluso** |
| 34 | `In Arrivo` | sì |

Quattro valori distinti, e `Schedulato` + `Arrivato` da soli fanno l'86,6%.

**Escluso solo `Volo Cancellato`**, con questa grafia esatta — non `Cancellato`
liscio, come la spec aveva ipotizzato. È l'unico dei quattro che significhi «questo
aereo non porta passeggeri a Fiumicino». `In Arrivo` si conta: è un volo in
avvicinamento, cioè il caso più certo che ci sia. Il confronto nel codice è
case-insensitive, ma il valore in configurazione è quello che ADR stampa davvero.

Due limiti di questo censimento, da tenere presenti invece di scoprirli dopo:

- **`Dirottato` non è mai comparso.** La spec lo dava come secondo stato da
  escludere; nel raccolto non esiste, quindi non è stato messo in `statiEsclusi`
  con una grafia inventata. Conseguenza: un volo dirottato oggi verrebbe contato
  come in arrivo. È la direzione d'errore che la regola di conteggio accetta
  esplicitamente («in dubbio si conta»), ma è un buco noto: al primo dirottamento
  osservato va aggiunta la grafia vera.
- **Il campione è una sola finestra pomeridiana.** La fonte è una board live e non
  dà le ore già passate, quindi mancano gli stati del mattino e le rarità. Un
  censimento ripetuto in una fascia diversa può far emergere valori nuovi.
