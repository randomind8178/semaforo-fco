import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scaricaPagina, scaricaGiornata } from '../src/fonte-adr.js'

// Tutto cio' che appartiene al progetto si risolve dal modulo, non dalla cwd:
// lo strumento deve funzionare anche lanciato da un'altra cartella.
const radice = dirname(dirname(fileURLToPath(import.meta.url)))
const config = JSON.parse(await readFile(join(radice, 'config.json'), 'utf8'))
const modo = process.argv[2] ?? 'pagina'

if (modo === 'giornata') {
  const destinazione = join(radice, 'test', 'fixture', 'voli-giornata.json')
  const voli = await scaricaGiornata(config)
  await mkdir(dirname(destinazione), { recursive: true })
  await writeFile(destinazione, JSON.stringify(voli, null, 1), 'utf8')
  console.log(`Salvati ${voli.length} voli grezzi in ${destinazione}`)
} else {
  const destinazione = join(radice, 'test', 'fixture', 'pagina-arrivi.html')
  const pagina = Number(process.argv[3] ?? 1)
  const html = await scaricaPagina({ pagina, righePerPagina: config.righePerPagina }, config.rete)
  if (!html.includes('Orario previsto')) {
    console.error('ATTENZIONE: la pagina non contiene "Orario previsto". URL probabilmente incompleto.')
    process.exit(1)
  }
  await mkdir(dirname(destinazione), { recursive: true })
  await writeFile(destinazione, html, 'utf8')
  console.log(`Salvata pagina ${pagina} (${html.length} caratteri)`)
}
