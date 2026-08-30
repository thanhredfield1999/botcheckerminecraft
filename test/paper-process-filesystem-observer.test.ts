import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  link, mkdtemp, mkdir, rm, symlink, truncate, writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createPaperProcessFilesystemObserver,
  preflightPaperProcessWithFilesystemObservation
} from '../src/paper-process-filesystem-observer.js'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import {
  artifactTargetBindingSha256,
  buildArtifactTargetBinding
} from '../src/target-binding.js'

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

async function fixture(options: { probe?: boolean } = { probe: true }) {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-fs-'))
  await mkdir(path.join(root, 'server'), { recursive: true })
  await mkdir(path.join(root, 'plugins', 'Plugin'), { recursive: true })
  const paper = 'paper-bytes'
  const candidate = 'candidate-bytes'
  const probe = 'probe-bytes'
  await writeFile(path.join(root, 'server', 'paper.jar'), paper)
  await writeFile(path.join(root, 'plugins', 'Plugin.jar'), candidate)
  await writeFile(path.join(root, 'plugins', 'Plugin', 'config.yml'), 'enabled: true\n')
  if (options.probe) await writeFile(path.join(root, 'plugins', 'BotCheckerProbe.jar'), probe)
  const binding = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-filesystem-fixture',
    provider: {
      kind: 'paper-process',
      id: 'paper-process-fixture',
      version: '1.0.0',
      instanceId: 'fixture-a'
    },
    authorization: {
      id: 'approval-fixture-a',
      scope: ['isolated-fixture', 'process-preflight']
    },
    artifacts: [
      {
        logicalId: 'candidate', role: 'candidate',
        logicalPath: 'plugins/Plugin.jar', sha256: sha256(candidate)
      },
      {
        logicalId: 'paper', role: 'paper',
        logicalPath: 'server/paper.jar', sha256: sha256(paper)
      },
      {
        logicalId: 'config-main', role: 'config',
        logicalPath: 'plugins/Plugin/config.yml', sha256: sha256('enabled: true\n')
      },
      ...(options.probe ? [{
        logicalId: 'probe', role: 'probe' as const,
        logicalPath: 'plugins/BotCheckerProbe.jar', sha256: sha256(probe)
      }] : [])
    ]
  })
  return { root, binding, paper, candidate, probe }
}

function provider(root: string, binding: ReturnType<typeof buildArtifactTargetBinding>) {
  return createPaperProcessProvider({
    schemaVersion: 1,
    id: 'paper-process-fixture',
    version: '1.0.0',
    instanceId: 'fixture-a',
    approvedRoot: root,
    logicalRoot: 'fixtures/paper-a',
    port: 25580,
    authorization: {
      id: 'approval-fixture-a',
      scope: ['isolated-fixture', 'process-preflight']
    },
    targetBinding: binding
  })
}

function processFacts() {
  return {
    schemaVersion: 1,
    port: 25580,
    portListening: false,
    pid: null,
    sessionLockPresent: false,
    onlinePlayers: 0,
    authorizationId: 'approval-fixture-a',
    requiredScope: ['isolated-fixture', 'process-preflight']
  }
}

test('filesystem observer đọc exact bytes thành immutable observation và compose dry-run preflight', async () => {
  const current = await fixture()
  try {
    const observer = createPaperProcessFilesystemObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      targetBinding: current.binding
    })
    const observation = observer.observe()
    assert.deepEqual(observation, {
      schemaVersion: 1,
      root: current.root,
      targetBindingSha256: artifactTargetBindingSha256(current.binding),
      executableArtifactFileBytesObserved: true,
      configurationArtifactsObserved: false,
      observedArtifactRoles: ['candidate', 'paper', 'probe'],
      filesystemObservationAtomic: false,
      filesystemObservationFreshness: 'not-established',
      provesJvmLoadedBytes: false,
      artifactSha256: {
        paper: sha256(current.paper),
        candidate: sha256(current.candidate),
        probe: sha256(current.probe)
      }
    })
    assert.equal(Object.isFrozen(observer), true)
    assert.equal(Object.isFrozen(observation), true)
    assert.equal(Object.isFrozen(observation.artifactSha256), true)

    const preview = preflightPaperProcessWithFilesystemObservation(
      provider(current.root, current.binding),
      observation,
      processFacts()
    )
    assert.equal(preview.executableArtifactFileBytesObserved, true)
    assert.equal(preview.configurationArtifactsObserved, false)
    assert.deepEqual(preview.observedArtifactRoles, ['candidate', 'paper', 'probe'])
    assert.equal(Object.isFrozen(preview.observedArtifactRoles), true)
    assert.equal(preview.filesystemObservationAtomic, false)
    assert.equal(preview.filesystemObservationFreshness, 'not-established')
    assert.equal(preview.provesJvmLoadedBytes, false)
    assert.equal(preview.factsAuthoritative, false)
    assert.equal(preview.approvalAuthoritative, false)
    assert.equal(preview.mutationAllowed, false)
    assert.equal(Object.isFrozen(preview), true)
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('filesystem observer hỗ trợ binding không có optional probe', async () => {
  const current = await fixture({ probe: false })
  try {
    const observation = createPaperProcessFilesystemObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      targetBinding: current.binding
    }).observe()
    assert.deepEqual(observation.artifactSha256, {
      paper: sha256(current.paper),
      candidate: sha256(current.candidate)
    })
    assert.deepEqual(observation.observedArtifactRoles, ['candidate', 'paper'])
    assert.doesNotThrow(() => preflightPaperProcessWithFilesystemObservation(
      provider(current.root, current.binding), observation, processFacts()
    ))
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('filesystem observer ghi rõ config artifacts ngoài scope khi config bytes thay đổi', async () => {
  const current = await fixture()
  try {
    await writeFile(path.join(current.root, 'plugins', 'Plugin', 'config.yml'), 'tampered: true\n')
    const observation = createPaperProcessFilesystemObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      targetBinding: current.binding
    }).observe()
    assert.equal('filesystemFactsObserved' in observation, false)
    assert.equal(observation.executableArtifactFileBytesObserved, true)
    assert.equal(observation.configurationArtifactsObserved, false)
    assert.deepEqual(observation.observedArtifactRoles, ['candidate', 'paper', 'probe'])
    assert.equal(Object.isFrozen(observation.observedArtifactRoles), true)
    const preview = preflightPaperProcessWithFilesystemObservation(
      provider(current.root, current.binding), observation, processFacts()
    )
    assert.equal('filesystemFactsObserved' in preview, false)
    assert.equal(preview.executableArtifactFileBytesObserved, true)
    assert.equal(preview.configurationArtifactsObserved, false)
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('filesystem observer fail closed với hash mismatch, missing và non-regular artifact', async () => {
  const current = await fixture()
  try {
    const observer = createPaperProcessFilesystemObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      targetBinding: current.binding
    })
    await writeFile(path.join(current.root, 'plugins', 'Plugin.jar'), 'tampered')
    assert.throws(
      () => observer.observe(),
      error => {
        assert.equal(String(error), 'PaperProcessFilesystemObservationError: Paper process filesystem observation rejected')
        assert.equal(String(error).includes(current.root), false)
        return true
      }
    )

    await rm(path.join(current.root, 'plugins', 'Plugin.jar'))
    assert.throws(
      () => observer.observe(),
      /^PaperProcessFilesystemObservationError: Paper process filesystem observation rejected$/
    )
    await mkdir(path.join(current.root, 'plugins', 'Plugin.jar'))
    assert.throws(
      () => observer.observe(),
      /^PaperProcessFilesystemObservationError: Paper process filesystem observation rejected$/
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('filesystem observer reject artifact symlink hoặc junction khi host cho phép tạo', async t => {
  const current = await fixture()
  try {
    const candidate = path.join(current.root, 'plugins', 'Plugin.jar')
    const target = path.join(current.root, 'plugins', 'Plugin-real.jar')
    await writeFile(target, current.candidate)
    await rm(candidate)
    try {
      await symlink(target, candidate, 'file')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
        t.skip(`Host không cho tạo symlink: ${code}`)
        return
      }
      throw error
    }
    assert.throws(
      () => createPaperProcessFilesystemObserver({
        schemaVersion: 1,
        approvedRoot: current.root,
        targetBinding: current.binding
      }).observe(),
      /^PaperProcessFilesystemObservationError: Paper process filesystem observation rejected$/
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('filesystem observer reject artifact hardlink ra ngoài approved root', async t => {
  const current = await fixture()
  const external = `${current.root}-external.jar`
  try {
    const candidate = path.join(current.root, 'plugins', 'Plugin.jar')
    await writeFile(external, current.candidate)
    await rm(candidate)
    try {
      await link(external, candidate)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'EXDEV' || code === 'UNKNOWN') {
        t.skip(`Host không cho tạo hardlink: ${code}`)
        return
      }
      throw error
    }
    assert.throws(
      () => createPaperProcessFilesystemObserver({
        schemaVersion: 1,
        approvedRoot: current.root,
        targetBinding: current.binding
      }).observe(),
      /^PaperProcessFilesystemObservationError: Paper process filesystem observation rejected$/
    )
  } finally {
    await rm(external, { force: true })
    await rm(current.root, { recursive: true, force: true })
  }
})

test('filesystem observer reject oversized artifact trước khi đọc bytes', async () => {
  const current = await fixture()
  try {
    await truncate(path.join(current.root, 'server', 'paper.jar'), 128 * 1024 * 1024 + 1)
    assert.throws(
      () => createPaperProcessFilesystemObserver({
        schemaVersion: 1,
        approvedRoot: current.root,
        targetBinding: current.binding
      }).observe(),
      /^PaperProcessFilesystemObservationError: Paper process filesystem observation rejected$/
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('filesystem preflight reject forged observation và custom provider trước invocation', async () => {
  const current = await fixture()
  try {
    const observation = createPaperProcessFilesystemObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      targetBinding: current.binding
    }).observe()
    assert.throws(
      () => preflightPaperProcessWithFilesystemObservation(
        provider(current.root, current.binding),
        { ...observation },
        processFacts()
      ),
      /^PaperProcessFilesystemPreflightError: Paper process filesystem preflight rejected$/
    )

    let calls = 0
    const customProvider = {
      declaration: {},
      preflight() { calls += 1; return {} }
    }
    assert.throws(
      () => preflightPaperProcessWithFilesystemObservation(customProvider, observation, processFacts()),
      /^PaperProcessFilesystemPreflightError: Paper process filesystem preflight rejected$/
    )
    assert.equal(calls, 0)
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})
