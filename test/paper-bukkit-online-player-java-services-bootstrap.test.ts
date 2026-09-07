import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

test('ServicesManager bootstrap pin exact companion và bỏ qua highest provider plugin khác', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-services-'))
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
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServicesFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServicesFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'true|PAPER_BUKKIT_KEYSTORE_SERVICE_CONFLICT|true|PAPER_BUKKIT_KEYSTORE_SERVICE_UNAVAILABLE|true|PAPER_BUKKIT_KEYSTORE_SERVICE_CLOSED|1|PAPER_BUKKIT_KEYSTORE_SERVICE_CONFLICT|true|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('ServicesManager bootstrap rollback provider nếu register publish rồi event ném', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-services-register-failure-'))
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
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceRegisterFailureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegisterFailureFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, 'PAPER_BUKKIT_KEYSTORE_SERVICE_REGISTER_FAILED|0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('ServicesManager lease close không chờ signer và suppress kết quả trả muộn', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-services-close-sign-'))
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
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceCloseDuringSignFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceCloseDuringSignFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    const [outcome, closeMs, workerAlive, registrations] = output.split('|')
    assert.equal(outcome, 'PAPER_BUKKIT_KEYSTORE_SERVICE_CLOSED')
    assert.ok(Number(closeMs) < 2_000, `service close took ${closeMs} ms`)
    assert.equal(workerAlive, 'false')
    assert.equal(registrations, '0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('ServicesManager registration close retry unregister sau lỗi tạm thời', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-services-unregister-retry-'))
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
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceUnregisterRetryFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceUnregisterRetryFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'PAPER_BUKKIT_KEYSTORE_SERVICE_UNREGISTER_FAILED|1|PAPER_BUKKIT_KEYSTORE_SERVICE_CLOSED|SUCCESS|0|2')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('ServicesManager registration concurrent close chia sẻ một unregister attempt', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-services-concurrent-close-'))
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
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceConcurrentCloseFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceConcurrentCloseFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      '1:SUCCESS:SUCCESS:0|1:PAPER_BUKKIT_KEYSTORE_SERVICE_UNREGISTER_FAILED:PAPER_BUKKIT_KEYSTORE_SERVICE_UNREGISTER_FAILED:SUCCESS:2:0|1:SUCCESS:SUCCESS:true:0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('ServicesManager unregister event reentrant close không tự deadlock owner thread', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-services-reentrant-close-'))
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
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceReentrantCloseFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceReentrantCloseFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output, 'false|SUCCESS|true|1|0|false')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('ServicesManager lease sanitize exception từ external access', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-services-sanitize-'))
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
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceExceptionSanitizationFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceExceptionSanitizationFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'PAPER_BUKKIT_KEYSTORE_ACCESS_FAILED:true:0|PAPER_BUKKIT_KEYSTORE_ACCESS_FAILED:true:0|PAPER_BUKKIT_KEYSTORE_ACCESS_FAILED:true:0|PAPER_BUKKIT_KEYSTORE_ACCESS_FAILED:true:0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('ServicesManager synchronous raw injection giữ fail-closed và không xóa provider lạ', {
  skip: !javaAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-services-injection-'))
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
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerExternalKeyStoreServiceSynchronousInjectionFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerExternalKeyStoreServiceSynchronousInjectionFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(output,
      'PAPER_BUKKIT_KEYSTORE_SERVICE_CONFLICT|PAPER_BUKKIT_KEYSTORE_SERVICE_CONFLICT|1|false|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('ServicesManager bootstrap source không dùng highest-wins lookup hoặc chạm key material', () => {
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  const registration = readFileSync(path.join(javaRoot,
    'PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.java'), 'utf8')
  const resolver = readFileSync(path.join(javaRoot,
    'PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.java'), 'utf8')
  const plugin = readFileSync(path.join(javaRoot, 'PaperBukkitOnlinePlayerPlugin.java'), 'utf8')
  assert.match(registration, /ServicePriority\.Normal/)
  assert.match(resolver,
    /getRegistrations\(\s*PaperBukkitOnlinePlayerExternalKeyStoreAccess\.class\s*\)/)
  assert.doesNotMatch(resolver, /\.load\(|getRegistration\(/)
  assert.doesNotMatch(registration + resolver,
    /java\.security|KeyStore\.getInstance|PrivateKey|Signature\.getInstance|System\.(?:getenv|getProperty)|password|credential|alias|(?:Path|Files)\./i)
  assert.doesNotMatch(plugin,
    /PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver|PaperBukkitOnlinePlayerAdapterLifecycle/)
  // 2026-09-07 (BC-001): plugin main không tự resolve service (coordinator lo việc đó
  // theo event), nhưng nay phải đăng ký composition thay vì chỉ log.
  assert.match(plugin, /PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition\.register\(/)
})
