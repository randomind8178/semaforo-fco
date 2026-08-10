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

// Si disegnano solo le fasce di cui la fonte ha davvero il dato, intersecate con un
// intorno dell'orario di arrivo: una fascia di passato recente per contesto, e
// oreAvantiInLista in avanti. Fuori dalla copertura uno zero non sarebbe un conteggio
// ma un'assenza travestita da fatto, ed e' il modo piu' facile di mentire con un
// numero: la mattina di Fiumicino apparirebbe deserta solo perche' la board live non
// fornisce le ore gia' passate.
function disegnaFasce (dati, affidabile) {
  const arrivo = dati.verdetto.arrivoMinuti
  const ampiezza = dati.config.ampiezzaFasciaMinuti
  const fasciaArrivo = Math.floor(arrivo / ampiezza) * ampiezza
  const primaMostrabile = fasciaArrivo - ampiezza
  const oltreLaLista = arrivo + dati.config.oreAvantiInLista * 60

  const mostrate = dati.fasce.filter((f) => {
    const coperta = f.inizioMinuti + ampiezza > dati.copertura.daMinuti &&
                    f.inizioMinuti < dati.copertura.aMinuti
    const vicina = f.inizioMinuti >= primaMostrabile && f.inizioMinuti < oltreLaLista
    return coperta && vicina
  })

  elemento('prossime').innerHTML = mostrate
    .map((f) => riga(f, affidabile, f.inizioMinuti + ampiezza <= arrivo))
    .join('')

  // Succede fra le 23:30 e la mezzanotte: l'arrivo stimato cade domani, e dei voli di
  // domani la fonte non sa ancora nulla. Meglio dirlo che disegnare fasce vuote.
  const senzaDati = elemento('senzaDati')
  senzaDati.hidden = mostrate.length > 0
  if (!mostrate.length) {
    senzaDati.textContent = 'Il tuo arrivo cade dopo la mezzanotte, e i voli di domani non sono ancora pubblicati. Il verdetto qui sopra conta solo gli eventuali voli di oggi molto in ritardo.'
  }
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
}

avvia()
