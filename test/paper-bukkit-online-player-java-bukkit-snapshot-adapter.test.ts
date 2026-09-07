import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

test('Fake-API wiring: Bukkit snapshot adapter schedule đúng plugin và ghi nhận primary-thread read', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-concrete-snapshot-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'org/bukkit/plugin/Plugin.java'),
      path.join(fakeApiRoot, 'org/bukkit/entity/Player.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitTask.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitScheduler.java'),
      path.join(fakeApiRoot, 'org/bukkit/Bukkit.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerBukkitSnapshotAdapter.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerBukkitSnapshotAdapterFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const result = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerBukkitSnapshotAdapterFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(result, '3 1 true 1 0 true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Fake-API wiring: Bukkit snapshot adapter reject primary caller và cancel timeout không cho late read', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-concrete-snapshot-guards-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'org/bukkit/plugin/Plugin.java'),
      path.join(fakeApiRoot, 'org/bukkit/entity/Player.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitTask.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitScheduler.java'),
      path.join(fakeApiRoot, 'org/bukkit/Bukkit.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerBukkitSnapshotAdapter.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerBukkitSnapshotAdapterGuardFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const run = (mode: string) => execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerBukkitSnapshotAdapterGuardFixture', mode], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(run('primary-caller'),
      'PAPER_BUKKIT_SNAPSHOT_WAIT_ON_PRIMARY_THREAD 0 0 0')
    assert.equal(run('queued-timeout'),
      'PAPER_BUKKIT_SNAPSHOT_TIMED_OUT 1 1 0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Fake-API wiring: close trước queued tick cancel task và không đọc onlinePlayers', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-close-before-tick-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'org/bukkit/plugin/Plugin.java'),
      path.join(fakeApiRoot, 'org/bukkit/entity/Player.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitTask.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitScheduler.java'),
      path.join(fakeApiRoot, 'org/bukkit/Bukkit.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerBukkitSnapshotAdapter.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerBukkitSnapshotAdapterCloseBeforeTickFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const result = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerBukkitSnapshotAdapterCloseBeforeTickFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(result, 'PAPER_BUKKIT_SNAPSHOT_BRIDGE_CLOSED 1 0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Fake-API wiring: scheduler từ chối owner được sanitize và không kẹt bridge busy', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-schedule-failure-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    const fakeApiRoot = path.resolve('test/fixtures/java/paperapi')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(fakeApiRoot, 'org/bukkit/plugin/Plugin.java'),
      path.join(fakeApiRoot, 'org/bukkit/entity/Player.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitTask.java'),
      path.join(fakeApiRoot, 'org/bukkit/scheduler/BukkitScheduler.java'),
      path.join(fakeApiRoot, 'org/bukkit/Bukkit.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerMainThreadSnapshotBridge.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerBukkitSnapshotAdapter.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerBukkitSnapshotAdapterScheduleFailureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const result = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerBukkitSnapshotAdapterScheduleFailureFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(result,
      'PAPER_BUKKIT_SNAPSHOT_SCHEDULE_FAILED:true|PAPER_BUKKIT_SNAPSHOT_SCHEDULE_FAILED:true|2|0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Concrete Bukkit snapshot adapter chưa được plugin main runtime-wire', () => {
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  const fakeBukkit = readFileSync(
    path.resolve('test/fixtures/java/paperapi/org/bukkit/Bukkit.java'), 'utf8')
  const adapter = readFileSync(
    path.join(javaRoot, 'PaperBukkitOnlinePlayerBukkitSnapshotAdapter.java'), 'utf8')
  const plugin = readFileSync(
    path.join(javaRoot, 'PaperBukkitOnlinePlayerPlugin.java'), 'utf8')
  assert.match(adapter, /Bukkit\.getScheduler\(\)\.runTask\(owner, task\)/)
  assert.match(adapter, /Bukkit\.isPrimaryThread\(\)/)
  assert.match(adapter, /Bukkit\.getOnlinePlayers\(\)\.size\(\)/)
  assert.doesNotMatch(adapter, /runTaskAsynchronously|CompletableFuture|Thread\.(?:ofPlatform|ofVirtual)|java\.net|java\.security/)
  assert.doesNotMatch(fakeBukkit, /throw new IllegalStateException\("online players read off primary thread"\)/)
  assert.match(fakeBukkit, /readWasPrimary\.set\(isPrimaryThread\(\)\)/)
  assert.doesNotMatch(plugin, /PaperBukkitOnlinePlayerBukkitSnapshotAdapter|PaperBukkitOnlinePlayerLoopbackListener|PaperBukkitOnlinePlayerOpaqueEd25519Signer/)
  // 2026-09-07 (BC-001): plugin main nay compose runtime qua RuntimeFactory/Composition,
  // nhưng vẫn KHÔNG tự chạm snapshot adapter, listener hay signer — đó mới là điều
  // assertion trên bảo vệ.
  assert.match(plugin, /PaperBukkitOnlinePlayerAdapterRuntimeFactory/)
})
