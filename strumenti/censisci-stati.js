import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Come salva-fixture.js: il raccolto appartiene al progetto, quindi si risolve
// dal modulo e non dalla cwd.
const radice = dirname(dirname(fileURLToPath(import.meta.url)))

const voli = JSON.parse(await readFile(join(radice, 'test', 'fixture', 'voli-giornata.json'), 'utf8'))
const conteggio = new Map()
for (const volo of voli) {
  conteggio.set(volo.stato, (conteggio.get(volo.stato) ?? 0) + 1)
}

console.log(`${voli.length} voli, ${conteggio.size} stati distinti:\n`)
for (const [stato, n] of [...conteggio].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(n).padStart(5)}  ${stato}`)
}
