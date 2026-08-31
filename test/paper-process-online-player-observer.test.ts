import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createServer } from 'minecraft-protocol'
import {
  createPaperProcessOnlinePlayerObserver,
  PaperProcessOnlinePlayerObservationError
} from '../src/paper-process-online-player-observer.js'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import { buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-online-player-fixture',
    provider: {
      kind: 'paper-process', id: 'paper-process-fixture',
      version: '1.0.0', instanceId: 'fixture-a'
    },
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
    },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config-main', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) }
    ]
  })
}

function provider(root: string, port: number) {
  return createPaperProcessProvider({
    schemaVersion: 1,
    id: 'paper-process-fixture', version: '1.0.0', instanceId: 'fixture-a',
    approvedRoot: root, logicalRoot: 'fixtures/paper-a', port,
    sessionLockLogicalPath: 'world/session.lock',
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
    },
    targetBinding: binding()
  })
}

test('online-player observer ghi exact reported count từ hai localhost status responses', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-player-status-'))
  await mkdir(path.join(root, 'world'))
  const server = createServer({
    host: '127.0.0.1',
    port: 0,
    version: '1.21.11',
    'online-mode': false,
    motd: 'bounded status fixture',
    maxPlayers: 20
  })
  try {
    await once(server, 'listening')
    const address = (server as unknown as {
      socketServer: { address(): { port: number } }
    }).socketServer.address()
    server.playerCount = 3

    const observation = await createPaperProcessOnlinePlayerObserver(
      provider(root, address.port)
    ).observe()

    assert.equal(observation.root, root)
    assert.equal(observation.port, address.port)
    assert.equal(observation.reportedOnlinePlayers, 3)
    assert.equal(observation.statusResponsesStableAcrossTwoReads, true)
    assert.equal(observation.observationSource, 'minecraft-server-list-status')
    assert.equal(observation.onlinePlayerFactsAuthoritative, false)
    assert.equal(observation.provesBukkitOnlinePlayers, false)
    assert.equal(observation.observationAtomic, false)
    assert.equal(observation.observationFreshness, 'not-established')
    assert.equal(Object.isFrozen(observation), true)
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('online-player observer reject status response không báo Minecraft 1.21.11', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-player-status-version-'))
  await mkdir(path.join(root, 'world'))
  const server = createServer({
    host: '127.0.0.1',
    port: 0,
    version: '1.21.11',
    'online-mode': false,
    maxPlayers: 20,
    beforePing(response: { version: unknown }) {
      response.version = { name: '1.21.10', protocol: 773 }
      return response
    }
  })
  try {
    await once(server, 'listening')
    const address = (server as unknown as {
      socketServer: { address(): { port: number } }
    }).socketServer.address()

    await assert.rejects(
      createPaperProcessOnlinePlayerObserver(provider(root, address.port)).observe(),
      PaperProcessOnlinePlayerObservationError
    )
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('online-player observer reject status response có protocol không khớp Minecraft 1.21.11', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-player-status-protocol-'))
  await mkdir(path.join(root, 'world'))
  const server = createServer({
    host: '127.0.0.1',
    port: 0,
    version: '1.21.11',
    'online-mode': false,
    maxPlayers: 20,
    beforePing(response: { version: unknown }) {
      response.version = { name: '1.21.11', protocol: 1 }
      return response
    }
  })
  try {
    await once(server, 'listening')
    const address = (server as unknown as {
      socketServer: { address(): { port: number } }
    }).socketServer.address()

    await assert.rejects(
      createPaperProcessOnlinePlayerObserver(provider(root, address.port)).observe(),
      PaperProcessOnlinePlayerObservationError
    )
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('online-player observer reject reported count đổi giữa hai status responses', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-player-status-race-'))
  await mkdir(path.join(root, 'world'))
  let responseCount = 0
  const server = createServer({
    host: '127.0.0.1',
    port: 0,
    version: '1.21.11',
    'online-mode': false,
    maxPlayers: 20,
    beforePing(response: { players: { online: number } }) {
      response.players.online = responseCount++
      return response
    }
  })
  try {
    await once(server, 'listening')
    const address = (server as unknown as {
      socketServer: { address(): { port: number } }
    }).socketServer.address()

    await assert.rejects(
      createPaperProcessOnlinePlayerObserver(provider(root, address.port)).observe(),
      PaperProcessOnlinePlayerObservationError
    )
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('online-player observer reject status response có key ngoài schema', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-player-status-extra-key-'))
  await mkdir(path.join(root, 'world'))
  const server = createServer({
    host: '127.0.0.1',
    port: 0,
    version: '1.21.11',
    'online-mode': false,
    maxPlayers: 20,
    beforePing(response: Record<string, unknown>) {
      response.unexpected = true
      return response
    }
  })
  try {
    await once(server, 'listening')
    const address = (server as unknown as {
      socketServer: { address(): { port: number } }
    }).socketServer.address()

    await assert.rejects(
      createPaperProcessOnlinePlayerObserver(provider(root, address.port)).observe(),
      PaperProcessOnlinePlayerObservationError
    )
  } finally {
    server.close()
    await rm(root, { recursive: true, force: true })
  }
})
