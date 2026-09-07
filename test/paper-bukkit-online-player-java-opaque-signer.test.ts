import assert from 'node:assert/strict'
import { createHash, createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

test('Java opaque signer ký Ed25519 qua external KeyStore access mà không nhận private key bytes', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-opaque-signer-'))
  try {
    const payload = Buffer.from('botchecker-paper-bukkit-canonical-payload-fixture', 'utf8')
    const payloadPath = path.join(workspace, 'payload.bin')
    const publicKeyPath = path.join(workspace, 'public-key.spki')
    const signaturePath = path.join(workspace, 'signature.bin')
    const countersPath = path.join(workspace, 'counters.txt')
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    writeFileSync(payloadPath, payload)

    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerOpaqueEd25519SignerFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerOpaqueEd25519SignerFixture',
      payloadPath, publicKeyPath, signaturePath, countersPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe', timeout: 10_000
    })

    const publicKey = createPublicKey({
      key: readFileSync(publicKeyPath), format: 'der', type: 'spki'
    })
    const signature = readFileSync(signaturePath)
    assert.equal(signature.byteLength, 64)
    assert.equal(verify(null, payload, publicKey, signature), true)
    assert.equal(readFileSync(countersPath, 'utf8'), '1 1')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java opaque signer sanitize lỗi khởi tạo từ external KeyStore access', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-signer-init-failure-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerOpaqueEd25519SignerInitializationFailureFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const result = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerOpaqueEd25519SignerInitializationFailureFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(result, 'PAPER_BUKKIT_SIGNER_INITIALIZATION_FAILED|true')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java opaque signer fail closed với key mismatch, callback failure và chữ ký sai', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-signer-guards-'))
  try {
    const pair = generateKeyPairSync('ed25519')
    const publicKey = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
    const keyId = createHash('sha256').update(publicKey).digest('hex')
    const publicKeyPath = path.join(workspace, 'public-key.spki')
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    writeFileSync(publicKeyPath, publicKey)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerOpaqueEd25519SignerGuardFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const run = (mode: string) => execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerOpaqueEd25519SignerGuardFixture', mode, publicKeyPath, keyId], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(run('key-mismatch'), 'PAPER_BUKKIT_SIGNER_KEY_MISMATCH|true|0')
    assert.equal(run('callback-failure'), 'PAPER_BUKKIT_SIGNING_FAILED|true|1')
    assert.equal(run('wrong-signature'), 'PAPER_BUKKIT_SIGNATURE_INVALID|true|1')
    assert.equal(run('key-substitution'), 'PAPER_BUKKIT_SIGNATURE_INVALID|true|1')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java opaque signer reject keyId không canonical trước khi đọc public key', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-signer-key-id-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerOpaqueEd25519SignerKeyIdValidationFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const result = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerOpaqueEd25519SignerKeyIdValidationFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    assert.equal(result,
      'PAPER_BUKKIT_SIGNER_KEY_ID_INVALID:true|PAPER_BUKKIT_SIGNER_KEY_ID_INVALID:true|0')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('Java opaque signer source giữ concrete KeyStore và private key ngoài production boundary', () => {
  const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
  const access = readFileSync(path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'), 'utf8')
  const signer = readFileSync(path.join(javaRoot, 'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java'), 'utf8')
  const fixture = readFileSync(
    path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerOpaqueEd25519SignerFixture.java'),
    'utf8'
  )
  const production = `${access}\n${signer}`
  assert.doesNotMatch(production, /import\s+java\.security\.(?:KeyStore|PrivateKey)|\b(?:PKCS8EncodedKeySpec|KeyStore\.getInstance)\b/)
  assert.doesNotMatch(production, /import\s+java\.nio\.file|\b(?:Files|Path)\.|System\.(?:getenv|getProperty)\s*\(/)
  assert.doesNotMatch(production, /System\.(?:out|err)|printStackTrace|\.getMessage\s*\(/)
  assert.doesNotMatch(signer, /String\.format\s*\(/)
  assert.doesNotMatch(fixture, /PKCS8EncodedKeySpec|private[- ]key|args\[2\].*private/i)
})

test('Java opaque signer close không chờ callback và suppress kết quả ký muộn', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-signer-lifecycle-'))
  try {
    const classes = path.join(workspace, 'classes')
    mkdirSync(classes)
    const javaRoot = path.resolve('paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter')
    execFileSync('javac', ['--release', '21', '-d', classes,
      path.join(javaRoot, 'PaperBukkitOnlinePlayerRequestProcessor.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerTransportCodec.java'),
      path.join(javaRoot, 'CanonicalPaperBukkitOnlinePlayerPayload.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerExternalKeyStoreAccess.java'),
      path.join(javaRoot, 'PaperBukkitOnlinePlayerOpaqueEd25519Signer.java'),
      path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerOpaqueEd25519SignerLifecycleFixture.java')], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    const result = execFileSync('java', ['-cp', classes,
      'PaperBukkitOnlinePlayerOpaqueEd25519SignerLifecycleFixture'], {
      cwd: path.resolve('.'), windowsHide: true, encoding: 'utf8', timeout: 10_000
    })
    const [late, busy, closed, signatures, closeElapsedMs] = result.split('|')
    assert.equal(late, 'PAPER_BUKKIT_SIGNER_CLOSED')
    assert.equal(busy, 'PAPER_BUKKIT_SIGNER_BUSY')
    assert.equal(closed, 'PAPER_BUKKIT_SIGNER_CLOSED')
    assert.equal(signatures, '1')
    assert.ok(Number(closeElapsedMs) < 500, `close took ${closeElapsedMs} ms`)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
