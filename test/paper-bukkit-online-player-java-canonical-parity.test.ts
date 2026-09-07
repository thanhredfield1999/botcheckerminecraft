import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { canonicalPaperBukkitOnlinePlayerPayloadV1 } from '../src/paper-bukkit-online-player-claim.js'

const javaInteropAvailable = spawnSync('javac', ['--release', '21', '-version'], {
  encoding: 'utf8', windowsHide: true
}).status === 0

test('Java canonicalizer emits exact Node paper-bukkit-online-player-v1 payload bytes', {
  skip: !javaInteropAvailable
}, () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'botchecker-paper-bukkit-parity-'))
  try {
    const pair = generateKeyPairSync('ed25519')
    const spki = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' }))
    const keyId = createHash('sha256').update(spki).digest('hex')
    const fields = [
      'paper-bukkit-verifier', 'paper-bukkit-verifier-a', '1', 'a'.repeat(64),
      Buffer.alloc(32, 77).toString('base64url'), 'paper-bukkit-run', keyId,
      'paper-bukkit-online-player', 'b'.repeat(64), 'paper-bukkit-probe', '1.0.0', 'adapter-a',
      'paper-bukkit-trust', '2026.08.31-1', 'c'.repeat(64), '10000', '15000', '10010',
      'paper-server-a', 'paper-boot-a', '0'
    ]
    const inputPath = path.join(workspace, 'input.txt')
    const outputPath = path.join(workspace, 'payload.bin')
    const classesPath = path.join(workspace, 'classes')
    mkdirSync(classesPath)
    writeFileSync(inputPath, fields.join('\n') + '\n', 'utf8')

    const canonicalizer = path.resolve(
      'paper-bukkit-adapter/src/main/java/vn/heomc/botchecker/paperadapter/CanonicalPaperBukkitOnlinePlayerPayload.java'
    )
    const fixture = path.resolve('test/fixtures/java/PaperBukkitOnlinePlayerCanonicalFixture.java')
    execFileSync('javac', ['--release', '21', '-d', classesPath, canonicalizer, fixture], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })
    execFileSync('java', ['-cp', classesPath, 'PaperBukkitOnlinePlayerCanonicalFixture', inputPath, outputPath], {
      cwd: path.resolve('.'), windowsHide: true, stdio: 'pipe'
    })

    const payload = {
      schemaVersion: 1, domain: 'botcheckerminecraft.paper-bukkit-online-player.v1',
      profile: 'paper-bukkit-online-player-v1', audience: fields[0], verifierInstanceId: fields[1],
      sequence: 1, challengeId: fields[3], nonceBase64Url: fields[4], runId: fields[5], keyId,
      bindingId: fields[7], targetBindingSha256: fields[8],
      provider: { kind: 'server-probe', id: fields[9], version: fields[10], instanceId: fields[11] },
      trustStoreId: fields[12], trustStoreVersion: fields[13], trustStoreSha256: fields[14],
      issuedAtMs: 10_000, expiresAtMs: 15_000, observedAtMs: 10_010,
      claimedServerInstanceId: fields[18], claimedBootId: fields[19], onlinePlayers: 0,
      observation: { source: 'bukkit-getOnlinePlayers-size', primaryThreadSnapshot: true, atomicSnapshot: false, releaseEligible: false }
    }
    assert.deepEqual(readFileSync(outputPath), canonicalPaperBukkitOnlinePlayerPayloadV1(payload))


  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
