import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import {
  link, mkdtemp, mkdir, rm, symlink, truncate, writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createPaperProcessConfigurationFilesystemObserver,
  createPaperProcessFilesystemObserver,
  preflightPaperProcessWithDeclaredArtifactFileObservations
} from '../src/paper-process-filesystem-observer.js'
import { createPaperProcessProvider } from '../src/paper-process-provider.js'
import {
  artifactTargetBindingSha256,
  buildArtifactTargetBinding
} from '../src/target-binding.js'

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex')

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'botchecker-paper-config-fs-'))
  await mkdir(path.join(root, 'server'), { recursive: true })
  await mkdir(path.join(root, 'plugins', 'Plugin'), { recursive: true })
  const paper = 'paper-bytes'
  const candidate = 'candidate-bytes'
  const configMain = 'enabled: true\n'
  const configMessages = 'ready: Xin chao\n'
  await writeFile(path.join(root, 'server', 'paper.jar'), paper)
  await writeFile(path.join(root, 'plugins', 'Plugin.jar'), candidate)
  await writeFile(path.join(root, 'plugins', 'Plugin', 'config.yml'), configMain)
  await writeFile(path.join(root, 'plugins', 'Plugin', 'messages.yml'), configMessages)
  const binding = buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'paper-process-complete-filesystem-fixture',
    provider: {
      kind: 'paper-process', id: 'paper-process-fixture',
      version: '1.0.0', instanceId: 'fixture-a'
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
        logicalPath: 'plugins/Plugin/config.yml', sha256: sha256(configMain)
      },
      {
        logicalId: 'config-messages', role: 'config',
        logicalPath: 'plugins/Plugin/messages.yml', sha256: sha256(configMessages)
      }
    ]
  })
  return { root, binding, configMain, configMessages }
}

function provider(root: string, binding: ReturnType<typeof buildArtifactTargetBinding>) {
  return createPaperProcessProvider({
    schemaVersion: 1,
    id: 'paper-process-fixture', version: '1.0.0', instanceId: 'fixture-a',
    approvedRoot: root, logicalRoot: 'fixtures/paper-a', port: 25580,
    authorization: {
      id: 'approval-fixture-a', scope: ['isolated-fixture', 'process-preflight']
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

test('config observer đọc toàn bộ declared config files và compose declared-artifact file-byte preview', async () => {
  const current = await fixture()
  try {
    const configObserver = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      targetBinding: current.binding
    })
    const configuration = configObserver.observe()
    assert.deepEqual(configuration, {
      schemaVersion: 1,
      root: current.root,
      targetBindingSha256: artifactTargetBindingSha256(current.binding),
      configurationArtifactFileBytesObserved: true,
      observedConfigurationArtifactCount: 2,
      filesystemObservationAtomic: false,
      filesystemObservationFreshness: 'not-established',
      provesPaperLoadedConfiguration: false,
      artifacts: [
        {
          logicalId: 'config-main', logicalPath: 'plugins/Plugin/config.yml',
          sha256: sha256(current.configMain)
        },
        {
          logicalId: 'config-messages', logicalPath: 'plugins/Plugin/messages.yml',
          sha256: sha256(current.configMessages)
        }
      ]
    })
    assert.equal(Object.isFrozen(configObserver), true)
    assert.equal(Object.isFrozen(configuration), true)
    assert.equal(Object.isFrozen(configuration.artifacts), true)
    assert.equal(configuration.artifacts.every(Object.isFrozen), true)

    const executable = createPaperProcessFilesystemObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      targetBinding: current.binding
    }).observe()
    const preview = preflightPaperProcessWithDeclaredArtifactFileObservations(
      provider(current.root, current.binding), executable, configuration, processFacts()
    )
    assert.equal(preview.executableArtifactFileBytesObserved, true)
    assert.equal(preview.configurationArtifactFileBytesObserved, true)
    assert.equal('configurationArtifactsObserved' in preview, false)
    assert.equal(preview.allDeclaredArtifactFileBytesIndividuallyObserved, true)
    assert.deepEqual(preview.observedArtifactRoles, ['candidate', 'config', 'paper'])
    assert.deepEqual(preview.configurationArtifacts, configuration.artifacts)
    assert.equal(Object.isFrozen(preview.configurationArtifacts), true)
    assert.equal(preview.filesystemObservationAtomic, false)
    assert.equal(preview.filesystemObservationFreshness, 'not-established')
    assert.equal(preview.provesJvmLoadedBytes, false)
    assert.equal(preview.provesPaperLoadedConfiguration, false)
    assert.equal(preview.factsAuthoritative, false)
    assert.equal(preview.approvalAuthoritative, false)
    assert.equal(preview.mutationAllowed, false)
    assert.equal(Object.isFrozen(preview), true)
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('config observer chấp nhận declared config file rỗng và hash exact zero bytes', async () => {
  const current = await fixture()
  try {
    const config = path.join(current.root, 'plugins', 'Plugin', 'config.yml')
    await writeFile(config, '')
    const binding = buildArtifactTargetBinding({
      schemaVersion: 1,
      bindingId: 'paper-process-empty-config-fixture',
      provider: current.binding.provider,
      authorization: current.binding.authorization,
      artifacts: current.binding.artifacts.map(artifact => artifact.logicalId === 'config-main'
        ? { ...artifact, sha256: sha256('') }
        : artifact)
    })
    const observation = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: binding
    }).observe()
    assert.deepEqual(
      observation.artifacts.find(artifact => artifact.logicalId === 'config-main'),
      { logicalId: 'config-main', logicalPath: 'plugins/Plugin/config.yml', sha256: sha256('') }
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('config observer fail closed khi một declared config mismatch, missing hoặc non-regular', async () => {
  const current = await fixture()
  try {
    const observer = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1,
      approvedRoot: current.root,
      targetBinding: current.binding
    })
    const main = path.join(current.root, 'plugins', 'Plugin', 'config.yml')
    await writeFile(main, 'tampered: true\n')
    assert.throws(
      () => observer.observe(),
      error => {
        assert.equal(String(error), 'PaperProcessConfigurationFilesystemObservationError: Paper process configuration filesystem observation rejected')
        assert.equal(String(error).includes(current.root), false)
        return true
      }
    )
    await rm(main)
    assert.throws(
      () => observer.observe(),
      /^PaperProcessConfigurationFilesystemObservationError: Paper process configuration filesystem observation rejected$/
    )
    await mkdir(main)
    assert.throws(
      () => observer.observe(),
      /^PaperProcessConfigurationFilesystemObservationError: Paper process configuration filesystem observation rejected$/
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('config observer reject config symlink khi host cho phép tạo', async t => {
  const current = await fixture()
  try {
    const config = path.join(current.root, 'plugins', 'Plugin', 'config.yml')
    const target = path.join(current.root, 'plugins', 'Plugin', 'config-real.yml')
    await writeFile(target, current.configMain)
    await rm(config)
    try {
      await symlink(target, config, 'file')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
        t.skip(`Host không cho tạo symlink: ${code}`)
        return
      }
      throw error
    }
    assert.throws(
      () => createPaperProcessConfigurationFilesystemObserver({
        schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
      }).observe(),
      /^PaperProcessConfigurationFilesystemObservationError: Paper process configuration filesystem observation rejected$/
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('config observer reject config hardlink ra ngoài approved root', async t => {
  const current = await fixture()
  const external = `${current.root}-external.yml`
  try {
    const config = path.join(current.root, 'plugins', 'Plugin', 'config.yml')
    await writeFile(external, current.configMain)
    await rm(config)
    try {
      await link(external, config)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EPERM' || code === 'EACCES' || code === 'EXDEV' || code === 'UNKNOWN') {
        t.skip(`Host không cho tạo hardlink: ${code}`)
        return
      }
      throw error
    }
    assert.throws(
      () => createPaperProcessConfigurationFilesystemObserver({
        schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
      }).observe(),
      /^PaperProcessConfigurationFilesystemObservationError: Paper process configuration filesystem observation rejected$/
    )
  } finally {
    await rm(external, { force: true })
    await rm(current.root, { recursive: true, force: true })
  }
})

test('config observer chấp nhận exact 16 MiB boundary', async () => {
  const current = await fixture()
  try {
    const config = path.join(current.root, 'plugins', 'Plugin', 'config.yml')
    const content = Buffer.alloc(16 * 1024 * 1024)
    await writeFile(config, content)
    const binding = buildArtifactTargetBinding({
      schemaVersion: 1,
      bindingId: 'paper-process-config-exact-limit-fixture',
      provider: current.binding.provider,
      authorization: current.binding.authorization,
      artifacts: current.binding.artifacts.map(artifact => artifact.logicalId === 'config-main'
        ? { ...artifact, sha256: createHash('sha256').update(content).digest('hex') }
        : artifact)
    })
    const observation = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: binding
    }).observe()
    assert.equal(
      observation.artifacts.find(artifact => artifact.logicalId === 'config-main')?.sha256,
      createHash('sha256').update(content).digest('hex')
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('config observer reject oversized config trước khi đọc bytes', async () => {
  const current = await fixture()
  try {
    await truncate(path.join(current.root, 'plugins', 'Plugin', 'config.yml'), 16 * 1024 * 1024 + 1)
    assert.throws(
      () => createPaperProcessConfigurationFilesystemObserver({
        schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
      }).observe(),
      /^PaperProcessConfigurationFilesystemObservationError: Paper process configuration filesystem observation rejected$/
    )
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})

test('config observer reject aggregate vượt 64 MiB trước khi đọc bytes', async () => {
  const current = await fixture()
  const originalReadSync = fs.readSync
  let readCalls = 0
  try {
    const configArtifacts = []
    for (let index = 0; index < 5; index += 1) {
      const logicalPath = `plugins/Plugin/config-${index}.yml`
      const file = path.join(current.root, ...logicalPath.split('/'))
      await writeFile(file, '')
      await truncate(file, 14 * 1024 * 1024)
      configArtifacts.push({
        logicalId: `config-${index}`,
        role: 'config' as const,
        logicalPath,
        sha256: '0'.repeat(64)
      })
    }
    const binding = buildArtifactTargetBinding({
      schemaVersion: 1,
      bindingId: 'paper-process-config-aggregate-fixture',
      provider: current.binding.provider,
      authorization: current.binding.authorization,
      artifacts: [
        ...current.binding.artifacts.filter(artifact => artifact.role !== 'config'),
        ...configArtifacts
      ]
    })
    Object.defineProperty(fs, 'readSync', {
      configurable: true,
      value(...args: Parameters<typeof fs.readSync>) {
        readCalls += 1
        return originalReadSync(...args)
      }
    })
    assert.throws(
      () => createPaperProcessConfigurationFilesystemObserver({
        schemaVersion: 1, approvedRoot: current.root, targetBinding: binding
      }).observe(),
      /^PaperProcessConfigurationFilesystemObservationError: Paper process configuration filesystem observation rejected$/
    )
    assert.equal(readCalls, 0)
  } finally {
    Object.defineProperty(fs, 'readSync', { configurable: true, value: originalReadSync })
    await rm(current.root, { recursive: true, force: true })
  }
})

test('config observer phát hiện path bị thay thế trong lúc descriptor đang đọc', async () => {
  const current = await fixture()
  const config = path.join(current.root, 'plugins', 'Plugin', 'config.yml')
  const moved = path.join(current.root, 'plugins', 'Plugin', 'config-moved.yml')
  const originalReadSync = fs.readSync
  let replaced = false
  try {
    Object.defineProperty(fs, 'readSync', {
      configurable: true,
      value(...args: Parameters<typeof fs.readSync>) {
        if (!replaced) {
          replaced = true
          fs.renameSync(config, moved)
          fs.writeFileSync(config, current.configMain)
        }
        return originalReadSync(...args)
      }
    })
    assert.throws(
      () => createPaperProcessConfigurationFilesystemObserver({
        schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
      }).observe(),
      /^PaperProcessConfigurationFilesystemObservationError: Paper process configuration filesystem observation rejected$/
    )
    assert.equal(replaced, true)
  } finally {
    Object.defineProperty(fs, 'readSync', { configurable: true, value: originalReadSync })
    await rm(current.root, { recursive: true, force: true })
  }
})

test('declared-artifact preflight reject forged config observation, binding mismatch và custom provider trước invocation', async () => {
  const current = await fixture()
  try {
    const executable = createPaperProcessFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    const configuration = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: current.binding
    }).observe()
    assert.throws(
      () => preflightPaperProcessWithDeclaredArtifactFileObservations(
        provider(current.root, current.binding), executable,
        { ...configuration }, processFacts()
      ),
      /^PaperProcessDeclaredArtifactFilesPreflightError: Paper process declared artifact files preflight rejected$/
    )

    const otherBinding = buildArtifactTargetBinding({
      schemaVersion: 1,
      bindingId: 'other-complete-binding',
      provider: current.binding.provider,
      authorization: current.binding.authorization,
      artifacts: current.binding.artifacts
    })
    const otherConfiguration = createPaperProcessConfigurationFilesystemObserver({
      schemaVersion: 1, approvedRoot: current.root, targetBinding: otherBinding
    }).observe()
    assert.throws(
      () => preflightPaperProcessWithDeclaredArtifactFileObservations(
        provider(current.root, current.binding), executable, otherConfiguration, processFacts()
      ),
      /^PaperProcessDeclaredArtifactFilesPreflightError: Paper process declared artifact files preflight rejected$/
    )

    let calls = 0
    const customProvider = { declaration: {}, preflight() { calls += 1; return {} } }
    assert.throws(
      () => preflightPaperProcessWithDeclaredArtifactFileObservations(
        customProvider, executable, configuration, processFacts()
      ),
      /^PaperProcessDeclaredArtifactFilesPreflightError: Paper process declared artifact files preflight rejected$/
    )
    assert.equal(calls, 0)
  } finally {
    await rm(current.root, { recursive: true, force: true })
  }
})
