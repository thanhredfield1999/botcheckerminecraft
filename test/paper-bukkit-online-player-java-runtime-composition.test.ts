import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

const fakeApiFiles = [
  'org/bukkit/plugin/Plugin.java',
  'org/bukkit/plugin/ServicePriority.java',
  'org/bukkit/plugin/RegisteredServiceProvider.java',
  'org/bukkit/plugin/ServicesManager.java',
  'org/bukkit/plugin/PluginManager.java',
  'org/bukkit/event/Listener.java',
  'org/bukkit/event/EventPriority.java',
  'org/bukkit/event/EventHandler.java',
  'org/bukkit/event/HandlerList.java',
  'org/bukkit/event/server/ServiceRegisterEvent.java',
  'org/bukkit/event/server/ServiceUnregisterEvent.java'
]
const productionFiles = [
  'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.java',
  'PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.java'
]

test('runtime composition owns coordinator, service event bridge và teardown', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-runtime-composition-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      ...fakeApiFiles.map(file => path.join(fakeApiRoot, file)),
      ...productionFiles.map(file => path.join(javaRoot, file)),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, 'true|0:0|true|1:0|true|1:1|true|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('runtime composition reject null dependencies bằng fixed diagnostic trước side effect', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-runtime-composition-options-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      ...fakeApiFiles.map(file => path.join(fakeApiRoot, file)),
      ...productionFiles.map(file => path.join(javaRoot, file)),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionOptionsFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionOptionsFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, Array(6)
      .fill('PAPER_BUKKIT_RUNTIME_COMPOSITION_OPTIONS_INVALID:true').join('|'))
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('runtime composition rollback listener/coordinator khi registration publish rồi ném', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-runtime-composition-failure-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      ...fakeApiFiles.map(file => path.join(fakeApiRoot, file)),
      ...productionFiles.map(file => path.join(javaRoot, file)),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionFailureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionFailureFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_REGISTER_FAILED:true:0|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('runtime composition đóng active runtime dù listener unregister lỗi và vẫn retry cleanup', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-runtime-composition-close-failure-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      ...fakeApiFiles.map(file => path.join(fakeApiRoot, file)),
      ...productionFiles.map(file => path.join(javaRoot, file)),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionCloseFailureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionCloseFailureFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_UNREGISTER_FAILED:true:0|true|true|true|SUCCESS|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
