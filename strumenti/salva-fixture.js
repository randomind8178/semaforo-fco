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
