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
