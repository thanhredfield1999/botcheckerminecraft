import { lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(root, 'java-src')
const outputRoot = path.join(root, 'dist', 'java')
const sources = []

function collect(directory) {
  const directoryStat = lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error(`Java source root must be a regular directory: ${directory}`)
  }
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
    const absolute = path.join(directory, entry.name)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Error(`Java source symlink is not allowed: ${absolute}`)
    if (stat.isDirectory()) {
      collect(absolute)
    } else if (entry.isFile() && entry.name.endsWith('.java')) {
      sources.push(absolute)
      if (sources.length > 64) throw new Error('Java source file count exceeds build bound')
    }
  }
}

collect(sourceRoot)
if (sources.length === 0) throw new Error('No Java production sources found')
rmSync(outputRoot, { recursive: true, force: true })
mkdirSync(outputRoot, { recursive: true })

const result = spawnSync('javac', [
  '--release', '21',
  '-encoding', 'UTF-8',
  '-d', outputRoot,
  ...sources
], {
  cwd: root,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 60_000,
  maxBuffer: 1024 * 1024
})
if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(`javac failed with status ${result.status}: ${(result.stderr || result.stdout).trim()}`)
}
