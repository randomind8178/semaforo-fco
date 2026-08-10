# semaforo-fco

Dice se conviene andare a prendere qualcuno a Fiumicino, adesso. Conta gli aerei che
atterrano nella mezz'ora in cui arriveresti tu e colora il risultato: verde vale il
viaggio, rosso meglio restare in città. I dati vengono dalla pagina pubblica degli
arrivi di ADR, letti ogni quindici minuti.

## Il limite, dichiarato

**Misura la domanda, non la concorrenza.** Sa quanti passeggeri stanno per uscire dal
terminale, non quanti taxi ci sono già in fila né com'è il traffico sull'autostrada.
Una fascia verde dice «in questa mezz'ora atterra poca gente», non «troverai
parcheggio».

Secondo limite: la fonte è una board live che fornisce circa due ore di passato e il
resto della giornata, non un giorno di calendario. Le fasce di cui non esiste il dato
non vengono mostrate, invece di apparire a zero voli.

## Tarare le soglie

È l'operazione che farai più spesso. In [`config.json`](config.json):

```json
"soglie": { "giallo": 3, "verde": 6 }
```

Meno di `giallo` voli nella mezz'ora è rosso, da `giallo` a `verde` è giallo, da
`verde` in su è verde. Alzale se il semaforo è verde troppo spesso per i tuoi gusti,
abbassale se è rosso quando invece l'aeroporto era vuoto. Cambia, committa, e il
prossimo giro del cron pubblica coi valori nuovi: la pagina non ha soglie proprie, le
legge da `data.json`.

Nello stesso file vivono tutti gli altri numeri, `minutiViaggio` compreso: cambialo se
da casa tua a Fiumicino non sono trenta minuti.

## Lanciarlo a mano

```bash
npm ci
npm run genera     # scarica, aggrega, riscrive data.json
npm test           # deduplica e soglie
npm run stati      # elenca gli stati volo distinti nel raccolto salvato
```

Per guardare la pagina in locale serve un server, perché legge `data.json` via
`fetch`: `python -m http.server 8080` e poi `http://localhost:8080`.

## Com'è fatto

Node senza framework e senza build, una sola dipendenza (`cheerio`) per leggere
l'HTML. Il cron è una GitHub Action che rigenera `data.json` e lo committa; la pagina
è servita da GitHub Pages e non ha backend.

Le decisioni di progetto, i limiti accettati e cosa può andare storto stanno nella
spec: [`docs/superpowers/specs/2026-08-10-semaforo-fco-design.md`](docs/superpowers/specs/2026-08-10-semaforo-fco-design.md).

Progetto personale, uso non commerciale. Le pagine si scaricano una alla volta con una
pausa in mezzo: è il sito pubblico di un aeroporto, non un'API che ci hanno venduto.
