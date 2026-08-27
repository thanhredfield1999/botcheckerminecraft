import { stat } from 'node:fs/promises'
import { writeLivingNpcPixelMapHtmlFromFile } from '../src/livingnpc-pixel-map.ts'

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) throw new Error('usage: node watch-livingnpc-live.mjs INPUT OUTPUT')

let last = ''
for (;;) {
  try {
    const info = await stat(input)
    const signature = `${info.mtimeMs}:${info.size}`
    if (signature !== last) {
      await writeLivingNpcPixelMapHtmlFromFile(input, output)
      last = signature
      process.stdout.write(`updated ${info.size} bytes\n`)
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  }
  await new Promise(resolve => setTimeout(resolve, 2000))
}
