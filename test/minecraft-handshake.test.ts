import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { createSerializer } = require('minecraft-protocol/src/transforms/serializer') as {
  createSerializer(options: { isServer: boolean; version: string; state: string; packetsToParse: Record<string, unknown> }): NodeJS.WritableStream
}

function serializeLoginStart(username: string, playerUUID: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const serializer = createSerializer({ isServer: false, version: '1.21.11', state: 'login', packetsToParse: {} })
    const chunks: Buffer[] = []
    serializer.on('data', chunk => chunks.push(Buffer.from(chunk)))
    serializer.on('error', reject)
    serializer.on('finish', () => resolve(Buffer.concat(chunks)))
    ;(serializer as any).end({ name: 'login_start', params: { username, playerUUID } })
  })
}

test('1.21.11 offline login_start encodes hello as username plus 16-byte UUID', async () => {
  const frame = await serializeLoginStart('HeoMC_Tester', '355217b5-cbf6-30ef-9181-4353784ec511')

  // Packet body: VarInt packet id 0, String length 12 + username, UUID 16 bytes.
  assert.equal(frame.subarray(0, 2).toString('hex'), '000c')
  assert.equal(frame.subarray(2, 14).toString(), 'HeoMC_Tester')
  assert.equal(frame.length, 30)
  assert.equal(frame.subarray(14).toString('hex'), '355217b5cbf630ef91814353784ec511')
})

test('1.21.11 protocol data maps login hello to packet id 0', () => {
  const data = require('minecraft-data')('1.21.11')
  const packet = data.protocol.login.toServer.types.packet
  const mappings = packet[1][0].type[1].mappings as Record<string, string>
  assert.equal(data.version.version, 774)
  assert.equal(mappings['0x00'], 'login_start')
})
