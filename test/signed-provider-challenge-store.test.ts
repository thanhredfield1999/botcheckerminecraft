import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  SqliteSignedProviderChallengeStore,
  type StoredSignedProviderChallengeInput
} from '../src/signed-provider-challenge-store.js'
import type { SignedProviderClaimChallenge } from '../src/signed-provider-claim.js'
import { artifactTargetBindingSha256, buildArtifactTargetBinding } from '../src/target-binding.js'

function binding() {
  return buildArtifactTargetBinding({
    schemaVersion: 1,
    bindingId: 'shared-store-binding',
    provider: { kind: 'filesystem-snapshot', id: 'fixture-resolver', version: '1.0.0' },
    authorization: { id: 'approval-20260828', scope: ['artifact-bind'] },
    artifacts: [
      { logicalId: 'candidate', role: 'candidate', logicalPath: 'plugins/Plugin.jar', sha256: '1'.repeat(64) },
      { logicalId: 'config', role: 'config', logicalPath: 'plugins/Plugin/config.yml', sha256: '2'.repeat(64) },
      { logicalId: 'paper', role: 'paper', logicalPath: 'server/paper.jar', sha256: '3'.repeat(64) },
      { logicalId: 'probe', role: 'probe', logicalPath: 'plugins/Probe.jar', sha256: '4'.repeat(64) }
    ]
  })
}

function stored(
  sequence: number,
  runId: string,
  issuedAtMs = 10_000,
  verifierInstanceId = 'shared-store-instance',
  keyId = '5'.repeat(64)
): StoredSignedProviderChallengeInput {
  const expectedBinding = binding()
  const withoutId = {
    schemaVersion: 1 as const,
    domain: 'botcheckerminecraft.signed-provider-claim.v1' as const,
    audience: 'shared-store-audience',
    verifierInstanceId,
    sequence,
    nonceBase64Url: Buffer.alloc(32, sequence).toString('base64url'),
    runId,
    keyId,
    bindingId: expectedBinding.bindingId,
    targetBindingSha256: artifactTargetBindingSha256(expectedBinding),
    provider: { kind: 'server-probe' as const, id: 'probe', version: '1.0.0' },
    trustStoreId: 'shared-store-trust',
    trustStoreVersion: 'v1',
    trustStoreSha256: '6'.repeat(64),
    issuedAtMs,
    expiresAtMs: issuedAtMs + 5_000
  }
  const challenge: SignedProviderClaimChallenge = Object.freeze({
    ...withoutId,
    challengeId: createHash('sha256').update(JSON.stringify(withoutId)).digest('hex'),
    provider: Object.freeze({ ...withoutId.provider })
  })
  return { challenge, expectedBinding }
}

function runChild(scriptPath: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, ...args], {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', code => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`Child consume failed (${code}): ${stderr}`))
    })
  })
}

const wall = (value: number): (() => number) => () => value

test('SQLite challenge database dùng restrictive file permissions trên POSIX', {
  skip: process.platform === 'win32' ? 'POSIX ownership/mode không áp dụng trên Windows' : false
}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-permissions-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  let store: SqliteSignedProviderChallengeStore | undefined
  try {
    store = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    })
    assert.equal(lstatSync(databasePath).mode & 0o777, 0o600)
    store.close()
    store = undefined
    chmodSync(databasePath, 0o644)
    assert.throws(() => new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    }), /permission|mode|owner|private/i)
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store share durable challenge và sequence qua hai connection', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-challenge-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    })
    const issued = first.issue({
      wallNowMs: wall(10_000),
      maxPending: 2,
      build: (sequence, wallNow) => stored(sequence, 'run-a', wallNow)
    })
    assert.equal(issued.challenge.sequence, 1)

    second = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    })
    assert.deepEqual(second.load(issued.challenge.challengeId, wall(10_001)), {
      challenge: issued.challenge,
      expectedBinding: binding(),
      invalidAttempts: 0
    })
    const next = second.issue({
      wallNowMs: wall(10_001),
      maxPending: 2,
      build: (sequence, wallNow) => stored(sequence, 'run-b', wallNow)
    })
    assert.equal(next.challenge.sequence, 2)
  } finally {
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store rate-limit issue dùng chung theo key/provider và không làm nhảy sequence', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-rate-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const options = {
    databasePath,
    trustedWallNowMs: wall(10_000),
    audience: 'shared-store-audience',
    verifierInstanceId: 'shared-store-instance',
    rateLimitWindowMs: 1_000,
    maxIssuesPerKeyProviderPerWindow: 2,
    maxInvalidAttemptsPerKeyProviderPerWindow: 2
  }
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore(options)
    second = new SqliteSignedProviderChallengeStore(options)
    assert.equal(first.issue({
      wallNowMs: wall(10_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'rate-a', wallNow)
    }).challenge.sequence, 1)
    assert.equal(second.issue({
      wallNowMs: wall(10_001), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'rate-b', wallNow)
    }).challenge.sequence, 2)
    assert.throws(() => first!.issue({
      wallNowMs: wall(10_002), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'rate-c', wallNow)
    }), /rate.?limit/i)
    assert.equal(second.issue({
      wallNowMs: wall(11_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'rate-next', wallNow)
    }).challenge.sequence, 3)
  } finally {
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store rate-limit invalid attempt dùng chung qua hai connection', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-invalid-rate-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const options = {
    databasePath,
    trustedWallNowMs: wall(10_000),
    audience: 'shared-store-audience',
    verifierInstanceId: 'shared-store-instance',
    rateLimitWindowMs: 1_000,
    maxIssuesPerKeyProviderPerWindow: 10,
    maxInvalidAttemptsPerKeyProviderPerWindow: 2
  }
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore(options)
    second = new SqliteSignedProviderChallengeStore(options)
    const issued = first.issue({
      wallNowMs: wall(10_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'invalid-rate', wallNow)
    })
    assert.equal(first.recordInvalidAttempt(issued.challenge.challengeId, wall(10_001), 8), 'retained')
    assert.equal(second.recordInvalidAttempt(issued.challenge.challengeId, wall(10_002), 8), 'retained')
    assert.throws(
      () => first!.recordInvalidAttempt(issued.challenge.challengeId, wall(10_003), 8),
      /rate.?limit/i
    )
    assert.equal(second.recordInvalidAttempt(issued.challenge.challengeId, wall(11_000), 8), 'retained')
  } finally {
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store bound rate-limit subjects trong một scope', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-rate-subjects-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  let store: SqliteSignedProviderChallengeStore | undefined
  try {
    store = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance',
      maxRateLimitSubjectsPerScope: 1,
      maxIssuesPerKeyProviderPerWindow: 10
    })
    store.issue({
      wallNowMs: wall(10_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'rate-subject-first', wallNow)
    })
    assert.throws(() => store!.issue({
      wallNowMs: wall(10_001), maxPending: 10,
      build: (sequence, wallNow) => stored(
        sequence,
        'rate-subject-second',
        wallNow,
        'shared-store-instance',
        '7'.repeat(64)
      )
    }), /rate.*subject.*capacity|subject.*capacity/i)
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store reject worker nới rate policy trên cùng scope', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-rate-policy-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance',
      rateLimitWindowMs: 1_000,
      maxIssuesPerKeyProviderPerWindow: 2,
      maxInvalidAttemptsPerKeyProviderPerWindow: 3
    })
    first.issue({
      wallNowMs: wall(10_000),
      maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'rate-policy', wallNow)
    })
    assert.throws(() => {
      second = new SqliteSignedProviderChallengeStore({
        databasePath,
        audience: 'shared-store-audience',
        verifierInstanceId: 'shared-store-instance',
        rateLimitWindowMs: 1_000,
        maxIssuesPerKeyProviderPerWindow: 3,
        maxInvalidAttemptsPerKeyProviderPerWindow: 3
      })
    }, /rate|policy|config|scope/i)
  } finally {
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store bound global scopes và reclaim scope hết hạn', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-scope-bound-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const options = {
    databasePath,
    trustedWallNowMs: wall(10_000),
    audience: 'shared-store-audience',
    maxScopes: 1,
    scopeRetentionMs: 100,
    maxIssuesPerKeyProviderPerWindow: 10
  }
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore({
      ...options,
      verifierInstanceId: 'shared-store-first'
    })
    second = new SqliteSignedProviderChallengeStore({
      ...options,
      verifierInstanceId: 'shared-store-second'
    })
    first.issue({
      wallNowMs: wall(10_000),
      maxPending: 2,
      build: (sequence, wallNow) => stored(sequence, 'scope-bound-first', wallNow, 'shared-store-first')
    })
    assert.throws(() => second!.issue({
      wallNowMs: wall(10_001),
      maxPending: 2,
      build: (sequence, wallNow) => stored(sequence, 'scope-bound-rejected', wallNow, 'shared-store-second')
    }), /scope.*capacity|capacity.*scope/i)
    assert.equal(second.issue({
      wallNowMs: wall(15_101),
      maxPending: 2,
      build: (sequence, wallNow) => stored(sequence, 'scope-bound-reclaimed', wallNow, 'shared-store-second')
    }).challenge.sequence, 1)
  } finally {
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store không hồi sinh verifier scope đã bị retention reclaim', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-retired-scope-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const common = {
    databasePath,
    trustedWallNowMs: wall(10_000),
    maxScopes: 2,
    scopeRetentionMs: 100,
    maxClockSkewMs: 10_000
  }
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  let restarted: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore({
      ...common,
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-first'
    })
    first.configureVerifierPolicy(10, 8, 'a'.repeat(64), wall(10_000))
    second = new SqliteSignedProviderChallengeStore({
      ...common,
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-second'
    })
    second.issue({
      wallNowMs: wall(12_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'retired-scope-pruner', wallNow, 'shared-store-second')
    })
    assert.throws(() => first!.issue({
      wallNowMs: wall(12_001), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'retired-scope-revival', wallNow, 'shared-store-first')
    }), /retired|reclaimed|unavailable/i)
    assert.throws(
      () => first!.configureVerifierPolicy(10, 8, 'b'.repeat(64), wall(12_001)),
      /retired|reclaimed|unavailable/i
    )
    restarted = new SqliteSignedProviderChallengeStore({
      ...common,
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-first'
    })
    assert.throws(
      () => restarted!.configureVerifierPolicy(10, 8, 'a'.repeat(64), wall(12_001)),
      /retired|reclaimed|unavailable/i
    )
  } finally {
    restarted?.close()
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store reject forward clock skew mà không poison high-water', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-forward-clock-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const options = {
    databasePath,
    trustedWallNowMs: wall(10_000),
    audience: 'shared-store-audience',
    verifierInstanceId: 'shared-store-instance',
    maxClockSkewMs: 100,
    maxIssuesPerKeyProviderPerWindow: 10
  }
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore(options)
    second = new SqliteSignedProviderChallengeStore(options)
    first.issue({
      wallNowMs: wall(10_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-forward-before', wallNow)
    })
    assert.throws(() => second!.issue({
      wallNowMs: wall(20_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-forward-rejected', wallNow)
    }), /clock.*skew|skew.*clock/i)
    assert.doesNotThrow(() => first!.issue({
      wallNowMs: wall(10_001), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-forward-after', wallNow)
    }))
  } finally {
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store reject stale process nhưng không poison process có clock mới hơn', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-clock-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const options = {
    databasePath,
    trustedWallNowMs: wall(10_000),
    audience: 'shared-store-audience',
    verifierInstanceId: 'shared-store-instance',
    maxIssuesPerKeyProviderPerWindow: 10
  }
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore(options)
    second = new SqliteSignedProviderChallengeStore(options)
    first.issue({
      wallNowMs: wall(10_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-before', wallNow)
    })
    assert.throws(() => second!.issue({
      wallNowMs: wall(9_999), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-rollback', wallNow)
    }), /wall.?clock|stale/i)
    assert.doesNotThrow(() => first!.issue({
      wallNowMs: wall(10_001), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-after', wallNow)
    }))
  } finally {
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store giữ wall-clock high-water dù operation rollback', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-clock-rollback-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  let store: SqliteSignedProviderChallengeStore | undefined
  try {
    store = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance',
      maxIssuesPerKeyProviderPerWindow: 10
    })
    store.issue({
      wallNowMs: wall(10_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-baseline', wallNow)
    })
    assert.throws(() => store!.issue({
      wallNowMs: wall(12_000),
      maxPending: 10,
      build: () => { throw new Error('fixture build rollback') }
    }), /fixture build rollback/i)
    assert.throws(() => store!.issue({
      wallNowMs: wall(11_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-lower', wallNow)
    }), /wall.?clock|backwards|rollback/i)
    assert.equal(store.issue({
      wallNowMs: wall(13_000), maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'clock-recovered', wallNow)
    }).challenge.sequence, 2)
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store rollback build không làm nhảy shared sequence', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-sequence-rollback-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  let store: SqliteSignedProviderChallengeStore | undefined
  try {
    store = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    })
    assert.throws(() => store!.issue({
      wallNowMs: wall(10_000),
      maxPending: 10,
      build: () => { throw new Error('fixture issue failure') }
    }), /fixture issue failure/i)
    assert.equal(store.issue({
      wallNowMs: wall(10_001),
      maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'after-failure', wallNow)
    }).challenge.sequence, 1)
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store reject future schema và stored JSON corruption', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-corrupt-'))
  const futurePath = path.join(directory, 'future.sqlite')
  const corruptPath = path.join(directory, 'corrupt.sqlite')
  let store: SqliteSignedProviderChallengeStore | undefined
  try {
    const future = new DatabaseSync(futurePath)
    future.exec('PRAGMA user_version = 2')
    future.close()
    if (process.platform !== 'win32') chmodSync(futurePath, 0o600)
    assert.throws(() => new SqliteSignedProviderChallengeStore({
      databasePath: futurePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    }), /schema|unsupported|version/i)

    store = new SqliteSignedProviderChallengeStore({
      databasePath: corruptPath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    })
    const issued = store.issue({
      wallNowMs: wall(10_000),
      maxPending: 10,
      build: (sequence, wallNow) => stored(sequence, 'corrupt-json', wallNow)
    })
    store.close()
    store = undefined
    const corrupt = new DatabaseSync(corruptPath)
    corrupt.prepare(`UPDATE signed_provider_challenges
      SET challenge_json = ? WHERE challenge_id = ?`)
      .run('{', issued.challenge.challengeId)
    corrupt.close()
    store = new SqliteSignedProviderChallengeStore({
      databasePath: corruptPath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    })
    assert.throws(
      () => store!.load(issued.challenge.challengeId, wall(10_001)),
      /corrupt|json|parse/i
    )
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store atomic consume chỉ cho một connection thắng', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-consume-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const options = {
    databasePath,
    trustedWallNowMs: wall(10_000),
    audience: 'shared-store-audience',
    verifierInstanceId: 'shared-store-instance'
  }
  let first: SqliteSignedProviderChallengeStore | undefined
  let second: SqliteSignedProviderChallengeStore | undefined
  try {
    first = new SqliteSignedProviderChallengeStore(options)
    second = new SqliteSignedProviderChallengeStore(options)
    const issued = first.issue({
      wallNowMs: wall(10_000),
      maxPending: 2,
      build: (sequence, wallNow) => stored(sequence, 'consume-run', wallNow)
    })
    assert.ok(first.load(issued.challenge.challengeId, wall(10_001)))
    assert.ok(second.load(issued.challenge.challengeId, wall(10_001)))

    assert.deepEqual(second.consume(issued.challenge.challengeId, wall(10_001)), issued)
    assert.equal(first.consume(issued.challenge.challengeId, wall(10_001)), undefined)
    assert.equal(first.load(issued.challenge.challengeId, wall(10_001)), undefined)
  } finally {
    second?.close()
    first?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('SQLite challenge store atomic consume đúng một lần giữa hai Node process', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'botchecker-shared-process-consume-'))
  const databasePath = path.join(directory, 'challenges.sqlite')
  const childScript = path.join(directory, 'consume-child.ts')
  const moduleUrl = new URL('../src/signed-provider-challenge-store.js', import.meta.url).href
  let store: SqliteSignedProviderChallengeStore | undefined
  try {
    store = new SqliteSignedProviderChallengeStore({
      databasePath,
      trustedWallNowMs: wall(10_000),
      audience: 'shared-store-audience',
      verifierInstanceId: 'shared-store-instance'
    })
    const issued = store.issue({
      wallNowMs: wall(10_000), maxPending: 2,
      build: (sequence, wallNow) => stored(sequence, 'process-consume', wallNow)
    })
    store.close()
    store = undefined
    writeFileSync(childScript, `
void (async () => {
  const { SqliteSignedProviderChallengeStore } = await import(process.argv[2])
  const store = new SqliteSignedProviderChallengeStore({
    databasePath: process.argv[3],
    trustedWallNowMs: () => 10001,
    audience: 'shared-store-audience',
    verifierInstanceId: 'shared-store-instance'
  })
  try {
    const result = store.consume(process.argv[4], () => 10001)
    process.stdout.write(result ? 'consumed' : 'unavailable')
  } finally {
    store.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
`, 'utf8')
    const results = await Promise.all([
      runChild(childScript, moduleUrl, databasePath, issued.challenge.challengeId),
      runChild(childScript, moduleUrl, databasePath, issued.challenge.challengeId)
    ])
    assert.deepEqual(results.sort(), ['consumed', 'unavailable'])
  } finally {
    store?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
