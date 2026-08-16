import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TestRun } from '../src/runner.js'
import { scenarioSchema } from '../src/scenario.js'

class ObserverBot extends EventEmitter {
  currentWindow: object | null = null
  entity = { position: { x: 0, y: 64, z: 0 } }
  gateBlock = {
    name: 'oak_door',
    getProperties: () => ({ facing: 'east', half: 'lower', open: true })
  }
  health = 20
  food = 20
  version = '1.21.11'
  protocolVersion = '774'
  game = { dimension: 'minecraft:overworld' }
  _getDimensionName = () => 'StillCliff'
  entities: Record<number, object> = {
    7: {
      id: 7,
      uuid: '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d',
      name: 'player',
      username: 'Alex',
      displayName: 'Alex',
      position: { x: 0, y: 64, z: 0 }
    },
    8: {
      id: 8,
      uuid: '46a5553d-cedc-428f-b51a-4f5ddec03c9b',
      name: 'player',
      username: 'Alex',
      displayName: 'Alex',
      position: { x: 0.5, y: 64, z: 0 }
    }
  }
  pathfinder = {
    stop: () => {},
    setMovements: () => {}
  }

  loadPlugin(): void {}
  blockAt(): typeof this.gateBlock { return this.gateBlock }
  closeWindow(): void {}
  quit(): void { queueMicrotask(() => this.emit('end', 'quit')) }
}

test('crossing timeout giữ identity và raw observations dưới verdict INCONCLUSIVE', async () => {
  const reportDir = await mkdtemp(path.join(tmpdir(), 'botchecker-crossing-timeout-'))
  const bot = new ObserverBot()
  const scenario = scenarioSchema.parse({
    name: 'crossing timeout',
    maxDurationMs: 1_000,
    steps: [{
      id: 'cross',
      action: 'observe_crossing',
      nameIncludes: 'Alex',
      targetUuid: '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d',
      serverWorld: 'StillCliff',
      dimension: 'overworld',
      gateBlock: { x: 1, y: 64, z: 0 },
      approach: { x: 0.5, y: 64, z: 0.5 },
      exit: { x: 2.5, y: 64, z: 0.5 },
      sampleMs: 50,
      timeoutMs: 180
    }]
  })
  const run = new TestRun(
    scenario,
    { host: 'localhost', port: 25565, username: 'tester', auth: 'offline' },
    reportDir,
    {
      createBot: () => bot as never,
      prepareNavigation: () => {},
      connectTimeoutMs: 100,
      disconnectTimeoutMs: 100
    }
  )

  try {
    const started = run.start()
    bot.emit('spawn')
    await started

    assert.equal(run.status, 'failed')
    const report = run.report()
    assert.equal(report.steps[0]?.verdict, 'INCONCLUSIVE')
    assert.equal(report.verdict, 'INCONCLUSIVE')
    assert.equal(report.issues[0]?.severity, 'low')
    assert.match(run.steps[0].message, /^INCONCLUSIVE_TRACKING:/)
    const evidence = run.steps[0].evidence as {
      verdict?: string
      identity?: { id?: number; uuid?: string; label?: string }
      observations?: unknown[]
    }
    assert.equal(evidence.verdict, 'INCONCLUSIVE')
    assert.deepEqual(evidence.identity, {
      id: 7,
      uuid: '3d1d6e6d-6f19-4214-b794-f3ba0c202a1d',
      label: 'Alex'
    })
    assert.ok((evidence.observations?.length ?? 0) >= 2)
  } finally {
    await rm(reportDir, { recursive: true, force: true })
  }
})
