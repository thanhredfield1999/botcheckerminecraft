import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

test('Bukkit service event bridge lọc exact service/companion và sở hữu teardown', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-event-bridge-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'plugin/Plugin.java'),
      path.join(fakeApiRoot, 'plugin/PluginManager.java'),
      path.join(fakeApiRoot, 'plugin/ServicePriority.java'),
      path.join(fakeApiRoot, 'plugin/RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'plugin/ServicesManager.java'),
      path.join(fakeApiRoot, 'event/Listener.java'),
      path.join(fakeApiRoot, 'event/EventPriority.java'),
      path.join(fakeApiRoot, 'event/EventHandler.java'),
      path.join(fakeApiRoot, 'event/HandlerList.java'),
      path.join(fakeApiRoot, 'event/server/ServiceRegisterEvent.java'),
      path.join(fakeApiRoot, 'event/server/ServiceUnregisterEvent.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'true|WAITING:0|true|true|true|ACTIVE:1:0|ACTIVE:1:0|true|WAITING:1:1|true|true|PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_UNREGISTER_FAILED:true:0|true|true|true|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Bukkit service event bridge rollback listener/coordinator khi register publish rồi ném', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-event-bridge-failure-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'plugin/Plugin.java'),
      path.join(fakeApiRoot, 'plugin/PluginManager.java'),
      path.join(fakeApiRoot, 'plugin/ServicePriority.java'),
      path.join(fakeApiRoot, 'plugin/RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'plugin/ServicesManager.java'),
      path.join(fakeApiRoot, 'event/Listener.java'),
      path.join(fakeApiRoot, 'event/EventPriority.java'),
      path.join(fakeApiRoot, 'event/EventHandler.java'),
      path.join(fakeApiRoot, 'event/HandlerList.java'),
      path.join(fakeApiRoot, 'event/server/ServiceRegisterEvent.java'),
      path.join(fakeApiRoot, 'event/server/ServiceUnregisterEvent.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFailureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFailureFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_REGISTER_FAILED:true:0|CLOSED|0|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Bukkit service event bridge close timeout vẫn retry được và không báo success giả', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-event-bridge-close-retry-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'plugin/Plugin.java'),
      path.join(fakeApiRoot, 'plugin/PluginManager.java'),
      path.join(fakeApiRoot, 'plugin/ServicePriority.java'),
      path.join(fakeApiRoot, 'plugin/RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'plugin/ServicesManager.java'),
      path.join(fakeApiRoot, 'event/Listener.java'),
      path.join(fakeApiRoot, 'event/EventPriority.java'),
      path.join(fakeApiRoot, 'event/EventHandler.java'),
      path.join(fakeApiRoot, 'event/HandlerList.java'),
      path.join(fakeApiRoot, 'event/server/ServiceRegisterEvent.java'),
      path.join(fakeApiRoot, 'event/server/ServiceUnregisterEvent.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeCloseRetryFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeCloseRetryFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'PAPER_BUKKIT_SERVICE_COORDINATOR_CLOSE_TIMEOUT|true|PAPER_BUKKIT_SERVICE_COORDINATOR_CLOSE_TIMEOUT|true|SUCCESS|false')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Bukkit service event bridge concurrent close idempotent và chặn late event', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-event-bridge-concurrent-close-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'plugin/Plugin.java'),
      path.join(fakeApiRoot, 'plugin/PluginManager.java'),
      path.join(fakeApiRoot, 'plugin/ServicePriority.java'),
      path.join(fakeApiRoot, 'plugin/RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'plugin/ServicesManager.java'),
      path.join(fakeApiRoot, 'event/Listener.java'),
      path.join(fakeApiRoot, 'event/EventPriority.java'),
      path.join(fakeApiRoot, 'event/EventHandler.java'),
      path.join(fakeApiRoot, 'event/HandlerList.java'),
      path.join(fakeApiRoot, 'event/server/ServiceRegisterEvent.java'),
      path.join(fakeApiRoot, 'event/server/ServiceUnregisterEvent.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeConcurrentCloseFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeConcurrentCloseFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, 'SUCCESS:SUCCESS:true:1:0:CLOSED:false:false')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Bukkit service event bridge cleanup listener nếu initial reconcile ném fatal Error', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-event-bridge-fatal-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'plugin/Plugin.java'),
      path.join(fakeApiRoot, 'plugin/PluginManager.java'),
      path.join(fakeApiRoot, 'plugin/ServicePriority.java'),
      path.join(fakeApiRoot, 'plugin/RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'plugin/ServicesManager.java'),
      path.join(fakeApiRoot, 'event/Listener.java'),
      path.join(fakeApiRoot, 'event/EventPriority.java'),
      path.join(fakeApiRoot, 'event/EventHandler.java'),
      path.join(fakeApiRoot, 'event/HandlerList.java'),
      path.join(fakeApiRoot, 'event/server/ServiceRegisterEvent.java'),
      path.join(fakeApiRoot, 'event/server/ServiceUnregisterEvent.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFatalInitializationFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFatalInitializationFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, 'ASSERTION:fatal factory marker|CLOSED|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Bukkit service event bridge reject null dependencies bằng fixed diagnostic trước side effect', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-event-bridge-options-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'plugin/Plugin.java'),
      path.join(fakeApiRoot, 'plugin/PluginManager.java'),
      path.join(fakeApiRoot, 'plugin/ServicePriority.java'),
      path.join(fakeApiRoot, 'plugin/RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'plugin/ServicesManager.java'),
      path.join(fakeApiRoot, 'event/Listener.java'),
      path.join(fakeApiRoot, 'event/EventPriority.java'),
      path.join(fakeApiRoot, 'event/EventHandler.java'),
      path.join(fakeApiRoot, 'event/HandlerList.java'),
      path.join(fakeApiRoot, 'event/server/ServiceRegisterEvent.java'),
      path.join(fakeApiRoot, 'event/server/ServiceUnregisterEvent.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeOptionsFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeOptionsFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, Array(4)
      .fill('PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_OPTIONS_INVALID:true').join('|'))
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
