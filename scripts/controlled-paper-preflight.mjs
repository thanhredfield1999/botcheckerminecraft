#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { preflightControlledPaperHarness } from '../src/e2e/controlled-paper-harness.ts'

function configPath(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== '--config') {
    throw new Error('Usage: controlled-paper-preflight --config <non-secret-json-path>')
  }
  return argumentsList[1]
}

try {
  const file = configPath(process.argv.slice(2))
  const input = JSON.parse(readFileSync(file, 'utf8'))
  const preflight = preflightControlledPaperHarness(input, { repositoryRoot: process.cwd() })
  process.stdout.write(`${JSON.stringify(preflight)}\n`)
  process.exitCode = preflight.ready ? 0 : 2
} catch {
  process.stderr.write('Controlled Paper harness preflight rejected\n')
  process.exitCode = 2
}
