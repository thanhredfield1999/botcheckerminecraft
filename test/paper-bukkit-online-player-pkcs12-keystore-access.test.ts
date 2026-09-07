import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

const adapterJavaRoot = path.resolve(
  'paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter'
)
const companionJavaRoot = path.resolve(
  'paper-bukkit-adapter/keystore-companion/src/main/java/vn/heomc/botchecker/keystorecompanion'
)

test('PKCS12 custody provider ký Ed25519, clone public bytes, xóa password và đóng fail-closed', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-pkcs12-access-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(adapterJavaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(companionJavaRoot, 'PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerPkcs12KeyStoreAccessFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'vn.heomc.botchecker.keystorecompanion.PaperBukkitOnlinePlayerPkcs12KeyStoreAccessFixture'], {
      cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true, stdio: 'pipe'
    }).trim()
    assert.equal(output, 'true:true:true:true:true:true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('PKCS12 custody provider reject metadata sai trước khi đọc JVM secret', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-pkcs12-options-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(adapterJavaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(companionJavaRoot, 'PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerPkcs12KeyStoreAccessOptionsFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'vn.heomc.botchecker.keystorecompanion.PaperBukkitOnlinePlayerPkcs12KeyStoreAccessOptionsFixture'], {
      cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true, stdio: 'pipe'
    }).trim()
    assert.equal(output, Array(3)
      .fill('PAPER_BUKKIT_KEYSTORE_ACCESS_OPTIONS_INVALID').join(':') + ':0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('PKCS12 custody provider reject private key và certificate không cùng Ed25519 keypair', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-pkcs12-mismatch-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(adapterJavaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(companionJavaRoot, 'PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerPkcs12KeyStoreAccessFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'vn.heomc.botchecker.keystorecompanion.PaperBukkitOnlinePlayerPkcs12KeyStoreAccessFixture',
      'mismatch'], {
      cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true, stdio: 'pipe'
    }).trim()
    assert.equal(output, 'PAPER_BUKKIT_KEYSTORE_ACCESS_OPEN_FAILED:true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('PKCS12 custody provider reject file missing/directory/oversized/symlink trước secret access', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-pkcs12-file-guard-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(adapterJavaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(companionJavaRoot, 'PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerPkcs12KeyStoreAccessFileGuardFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const output = execFileSync('java', ['-cp', classes,
      'vn.heomc.botchecker.keystorecompanion.PaperBukkitOnlinePlayerPkcs12KeyStoreAccessFileGuardFixture'], {
      cwd: path.resolve('.'), encoding: 'utf8', windowsHide: true, stdio: 'pipe'
    }).trim()
    const fields = output.split(':')
    assert.deepEqual(fields.slice(0, 3), Array(3).fill('PAPER_BUKKIT_KEYSTORE_ACCESS_OPEN_FAILED'))
    assert.ok(fields[3] === 'PAPER_BUKKIT_KEYSTORE_ACCESS_OPEN_FAILED' || fields[3] === 'UNSUPPORTED')
    assert.equal(fields[4], '0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
