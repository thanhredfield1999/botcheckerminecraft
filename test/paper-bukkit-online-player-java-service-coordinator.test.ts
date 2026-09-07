import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

test('service coordinator activate đúng helper lease và teardown khi service biến mất', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-coordinator-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit/plugin')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'Plugin.java'),
      path.join(fakeApiRoot, 'ServicePriority.java'),
      path.join(fakeApiRoot, 'RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'ServicesManager.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'ACTIVATING:1|WAITING:0|ACTIVE:1:0|ACTIVE:1:0|WAITING:1:1|CLOSED:0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('service coordinator không làm mất reconcile khi service bị gỡ sau lookup', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-coordinator-race-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit/plugin')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'Plugin.java'),
      path.join(fakeApiRoot, 'ServicePriority.java'),
      path.join(fakeApiRoot, 'RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'ServicesManager.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorRemovalRaceFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorRemovalRaceFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, '0|WAITING|1|1|false')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('service coordinator fail closed qua schedule/factory/remove/close races', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-coordinator-guards-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit/plugin')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'Plugin.java'),
      path.join(fakeApiRoot, 'ServicePriority.java'),
      path.join(fakeApiRoot, 'RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'ServicesManager.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorGuardFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorGuardFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'RETURNED:WAITING:ACTIVE:1:1|WAITING:1:ACTIVE:2:1|0:WAITING:1:false|CLOSED:0:0:false:true:true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('service coordinator chặn self-reconcile churn trong ngân sách hữu hạn', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-coordinator-churn-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit/plugin')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'Plugin.java'),
      path.join(fakeApiRoot, 'ServicePriority.java'),
      path.join(fakeApiRoot, 'RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'ServicesManager.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorChurnFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorChurnFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, 'false|true|true|WAITING|false|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('service coordinator hỗ trợ inline/Error/concurrent-close và báo timeout rõ', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-coordinator-concurrency-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit/plugin')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'Plugin.java'),
      path.join(fakeApiRoot, 'ServicePriority.java'),
      path.join(fakeApiRoot, 'RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'ServicesManager.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorConcurrencyFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorConcurrencyFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'ASSERTION:WAITING:1:ACTIVE:2:WAITING:1|CLOSED:1:1|PAPER_BUKKIT_SERVICE_COORDINATOR_CLOSE_TIMEOUT:true:true:false|PAPER_BUKKIT_SERVICE_COORDINATOR_CLOSE_REENTRANT:CLOSED:false')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('service coordinator khôi phục interrupt flag khi runtime factory ném InterruptedException', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-service-coordinator-interrupt-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi/org/bukkit/plugin')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'Plugin.java'),
      path.join(fakeApiRoot, 'ServicePriority.java'),
      path.join(fakeApiRoot, 'RegisteredServiceProvider.java'),
      path.join(fakeApiRoot, 'ServicesManager.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorInterruptFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorInterruptFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, 'true:WAITING:true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
