import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { writeImmutableArtifact } from '../src/evidence-writer.js'

test('writeImmutableArtifact tạo artifact create-new, đọc lại đúng bytes và SHA-256', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-evidence-writer-'))
  try {
    const content = '{"verdict":"PASS"}\n'
    const result = await writeImmutableArtifact(directory, 'run-1.json', content)

    assert.equal(await readFile(path.join(directory, 'run-1.json'), 'utf8'), content)
    assert.equal(result.fileName, 'run-1.json')
    assert.equal(result.bytes, Buffer.byteLength(content))
    assert.match(result.sha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(await readdir(directory), ['run-1.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('writeImmutableArtifact từ chối collision và giữ nguyên artifact đầu tiên', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-evidence-collision-'))
  try {
    await writeImmutableArtifact(directory, 'same.json', 'first')

    await assert.rejects(
      writeImmutableArtifact(directory, 'same.json', 'second'),
      /already exists/i
    )
    assert.equal(await readFile(path.join(directory, 'same.json'), 'utf8'), 'first')
    assert.deepEqual(await readdir(directory), ['same.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('writeImmutableArtifact chỉ cho một concurrent writer thắng cùng destination', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-evidence-race-'))
  try {
    const results = await Promise.allSettled([
      writeImmutableArtifact(directory, 'race.json', 'alpha'),
      writeImmutableArtifact(directory, 'race.json', 'beta')
    ])

    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
    assert.ok(['alpha', 'beta'].includes(await readFile(path.join(directory, 'race.json'), 'utf8')))
    assert.deepEqual(await readdir(directory), ['race.json'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('writeImmutableArtifact snapshot Uint8Array trước await để caller không đổi artifact', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-evidence-bytes-'))
  try {
    const source = new Uint8Array([1, 2, 3])
    const writing = writeImmutableArtifact(directory, 'bytes.bin', source)
    source.fill(9)

    await writing
    assert.deepEqual(await readFile(path.join(directory, 'bytes.bin')), Buffer.from([1, 2, 3]))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('writeImmutableArtifact từ chối path traversal và artifact vượt giới hạn', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botchecker-evidence-bounds-'))
  try {
    await assert.rejects(writeImmutableArtifact(directory, '../escape.json', 'x'), /file name/i)
    await assert.rejects(writeImmutableArtifact(directory, 'large.json', '12345', { maxBytes: 4 }), /exceeds/i)
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
