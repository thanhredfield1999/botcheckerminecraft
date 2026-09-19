import { deflateSync } from 'node:zlib'

/** Thông tin một ô trong window GUI mà BotChecker quan sát được. */
export interface WindowFrameSlot {
  readonly slot: number
  readonly name: string
  readonly count: number
  readonly lore: readonly string[]
}

export interface WindowFrame {
  readonly title: string
  readonly slots: readonly WindowFrameSlot[]
}

const MAX_TITLE_CHARS = 120
const MAX_SLOTS = 128
const MAX_NAME_CHARS = 40
const MAX_LORE_LINES = 6
const MAX_LORE_CHARS = 48

const VIETNAMESE_MAP: Record<string, string> = {
  'à': 'a', 'á': 'a', 'ả': 'a', 'ã': 'a', 'ạ': 'a',
  'ă': 'a', 'ắ': 'a', 'ằ': 'a', 'ẳ': 'a', 'ẵ': 'a', 'ặ': 'a',
  'â': 'a', 'ấ': 'a', 'ầ': 'a', 'ẩ': 'a', 'ẫ': 'a', 'ậ': 'a',
  'đ': 'd', 'è': 'e', 'é': 'e', 'ẻ': 'e', 'ẽ': 'e', 'ẹ': 'e',
  'ê': 'e', 'ế': 'e', 'ề': 'e', 'ể': 'e', 'ễ': 'e', 'ệ': 'e',
  'ì': 'i', 'í': 'i', 'ỉ': 'i', 'ĩ': 'i', 'ị': 'i',
  'ò': 'o', 'ó': 'o', 'ỏ': 'o', 'õ': 'o', 'ọ': 'o',
  'ô': 'o', 'ố': 'o', 'ồ': 'o', 'ổ': 'o', 'ỗ': 'o', 'ộ': 'o',
  'ơ': 'o', 'ớ': 'o', 'ờ': 'o', 'ở': 'o', 'ỡ': 'o', 'ợ': 'o',
  'ù': 'u', 'ú': 'u', 'ủ': 'u', 'ũ': 'u', 'ụ': 'u',
  'ư': 'u', 'ứ': 'u', 'ừ': 'u', 'ử': 'u', 'ữ': 'u', 'ự': 'u',
  'ỳ': 'y', 'ý': 'y', 'ỷ': 'y', 'ỹ': 'y', 'ỵ': 'y'
}
const UPPER = Object.entries(VIETNAMESE_MAP).map(([lower, plain]) => [lower.toUpperCase(), plain.toUpperCase()] as const)

/**
 * Gấp chuỗi về ASCII an toàn cho việc render bitmap: bỏ dấu tiếng Việt, bỏ
 * ký tự điều khiển/ngoài bảng, thay ký tự lạ bằng '?'. Không bao giờ thêm dữ
 * liệu — chỉ normalise để font 5x7 render được.
 */
export function asciiFold(input: string): string {
  let out = ''
  let skipNext = false
  for (const char of input.normalize('NFC')) {
    // Bỏ màu-code Minecraft (§x) hoàn toàn — không phải nội dung quan sát được.
    if (skipNext) {
      skipNext = false
      continue
    }
    if (char === '\u00A7') {
      skipNext = true
      continue
    }
    const plain = VIETNAMESE_MAP[char] ?? UPPER.find(([v]) => v === char)?.[1]
    if (plain) {
      out += plain
      continue
    }
    const code = char.codePointAt(0) ?? 0
    if (code < 32 || code > 126) {
      out += '?'
      continue
    }
    out += char
  }
  return out
}

/** Font bitmap 5x7 cho các ký tự ASCII in được (từ 32 tới 126). */
const FONT5X7: Record<number, readonly number[]> = (() => {
  const glyphs: Record<string, readonly number[]> = {
    ' ': [0, 0, 0, 0, 0, 0, 0],
    '!': [4, 4, 4, 4, 0, 0, 4],
    '"': [10, 10, 10, 0, 0, 0, 0],
    '#': [10, 10, 31, 10, 31, 10, 10],
    '$': [4, 30, 5, 14, 20, 15, 4],
    '%': [24, 25, 2, 4, 8, 19, 3],
    '&': [12, 18, 18, 12, 26, 18, 13],
    "'": [4, 4, 4, 0, 0, 0, 0],
    '(': [4, 8, 8, 8, 8, 8, 4],
    ')': [4, 2, 2, 2, 2, 2, 4],
    '*': [0, 4, 21, 14, 21, 4, 0],
    '+': [0, 4, 4, 31, 4, 4, 0],
    ',': [0, 0, 0, 0, 0, 6, 6, 4],
    '-': [0, 0, 0, 31, 0, 0, 0],
    '.': [0, 0, 0, 0, 0, 6, 6],
    '/': [16, 16, 8, 4, 2, 1, 1],
    '0': [14, 17, 19, 21, 25, 17, 14],
    '1': [4, 6, 4, 4, 4, 4, 14],
    '2': [14, 17, 16, 8, 4, 2, 31],
    '3': [30, 17, 16, 12, 16, 17, 30],
    '4': [8, 12, 10, 9, 31, 8, 8],
    '5': [31, 1, 15, 16, 16, 17, 30],
    '6': [12, 2, 1, 15, 17, 17, 14],
    '7': [31, 16, 8, 4, 2, 2, 2],
    '8': [14, 17, 17, 14, 17, 17, 14],
    '9': [14, 17, 17, 30, 16, 8, 14],
    ':': [0, 6, 6, 0, 6, 6, 0],
    ';': [0, 6, 6, 0, 6, 6, 4],
    '<': [8, 4, 2, 1, 2, 4, 8],
    '=': [0, 0, 31, 0, 31, 0, 0],
    '>': [2, 4, 8, 16, 8, 4, 2],
    '?': [14, 17, 16, 8, 4, 0, 4],
    '@': [14, 17, 29, 21, 29, 1, 14],
    'A': [14, 17, 17, 31, 17, 17, 17],
    'B': [15, 17, 17, 15, 17, 17, 15],
    'C': [14, 17, 1, 1, 1, 17, 14],
    'D': [15, 17, 17, 17, 17, 17, 15],
    'E': [31, 1, 1, 15, 1, 1, 31],
    'F': [31, 1, 1, 15, 1, 1, 1],
    'G': [14, 17, 1, 1, 29, 17, 14],
    'H': [17, 17, 17, 31, 17, 17, 17],
    'I': [14, 4, 4, 4, 4, 4, 14],
    'J': [28, 8, 8, 8, 8, 9, 6],
    'K': [17, 9, 5, 3, 5, 9, 17],
    'L': [1, 1, 1, 1, 1, 1, 31],
    'M': [17, 27, 21, 21, 17, 17, 17],
    'N': [17, 19, 21, 21, 25, 17, 17],
    'O': [14, 17, 17, 17, 17, 17, 14],
    'P': [15, 17, 17, 15, 1, 1, 1],
    'Q': [14, 17, 17, 17, 21, 9, 22],
    'R': [15, 17, 17, 15, 5, 9, 17],
    'S': [30, 1, 1, 14, 16, 16, 15],
    'T': [31, 4, 4, 4, 4, 4, 4],
    'U': [17, 17, 17, 17, 17, 17, 14],
    'V': [17, 17, 17, 17, 17, 10, 4],
    'W': [17, 17, 17, 21, 21, 21, 10],
    'X': [17, 17, 10, 4, 10, 17, 17],
    'Y': [17, 17, 10, 4, 4, 4, 4],
    'Z': [31, 16, 8, 4, 2, 1, 31],
    '[': [14, 2, 2, 2, 2, 2, 14],
    '\\': [1, 1, 2, 4, 8, 16, 16],
    ']': [14, 8, 8, 8, 8, 8, 14],
    '^': [4, 10, 17, 0, 0, 0, 0],
    '_': [0, 0, 0, 0, 0, 0, 31],
    '`': [4, 2, 0, 0, 0, 0, 0],
    'a': [0, 0, 14, 16, 30, 17, 30],
    'b': [1, 1, 15, 17, 17, 17, 15],
    'c': [0, 0, 14, 1, 1, 1, 14],
    'd': [16, 16, 30, 17, 17, 17, 30],
    'e': [0, 0, 14, 17, 31, 1, 14],
    'f': [12, 18, 2, 7, 2, 2, 2],
    'g': [0, 0, 30, 17, 17, 30, 16, 14],
    'h': [1, 1, 15, 17, 17, 17, 17],
    'i': [4, 0, 4, 4, 4, 4, 4],
    'j': [8, 0, 8, 8, 8, 9, 6],
    'k': [1, 1, 9, 5, 3, 5, 9],
    'l': [4, 4, 4, 4, 4, 4, 4],
    'm': [0, 0, 27, 21, 21, 21, 21],
    'n': [0, 0, 15, 17, 17, 17, 17],
    'o': [0, 0, 14, 17, 17, 17, 14],
    'p': [0, 0, 15, 17, 17, 15, 1],
    'q': [0, 0, 30, 17, 17, 30, 16],
    'r': [0, 0, 13, 19, 1, 1, 1],
    's': [0, 0, 30, 1, 14, 16, 15],
    't': [2, 2, 7, 2, 2, 2, 12],
    'u': [0, 0, 17, 17, 17, 19, 13],
    'v': [0, 0, 17, 17, 17, 10, 4],
    'w': [0, 0, 17, 17, 21, 21, 10],
    'x': [0, 0, 17, 10, 4, 10, 17],
    'y': [0, 0, 17, 17, 30, 16, 14],
    'z': [0, 0, 31, 8, 4, 2, 31],
    '{': [8, 4, 4, 2, 4, 4, 8],
    '|': [4, 4, 4, 4, 4, 4, 4],
    '}': [2, 4, 4, 8, 4, 4, 2],
    '~': [0, 13, 6, 0, 0, 0, 0]
  }
  const table: Record<number, readonly number[]> = {}
  for (const [char, rows] of Object.entries(glyphs)) {
    table[char.charCodeAt(0)] = rows
  }
  return table
})()

const GLYPH_WIDTH = 5
const GLYPH_HEIGHT = 7
const GLYPH_SPACING = 1
const LINE_HEIGHT = GLYPH_HEIGHT + 2
const MARGIN = 4
const PAD_X = 2

function textWidth(text: string): number {
  return text.length * (GLYPH_WIDTH + GLYPH_SPACING) - GLYPH_SPACING
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, 'latin1')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.byteLength, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([length, typeBytes, data, crc])
}

/** Vẽ một dòng text bằng font 5x7 lên canvas RGBA (nền đen, chữ trắng). */
function drawText(canvas: Uint8Array, width: number, height: number, text: string, x0: number, y0: number): void {
  let cursor = x0
  for (const char of text) {
    const rows = FONT5X7[char.charCodeAt(0)] ?? FONT5X7['?'.charCodeAt(0)]!
    for (let row = 0; row < GLYPH_HEIGHT; row++) {
      const bits = rows[row] ?? 0
      for (let col = 0; col < GLYPH_WIDTH; col++) {
        if (((bits >> (GLYPH_WIDTH - 1 - col)) & 1) === 1) {
          const px = cursor + col
          const py = y0 + row
          if (px >= 0 && py >= 0 && px < width && py < height) {
            const offset = (py * width + px) * 4
            canvas[offset] = 255
            canvas[offset + 1] = 255
            canvas[offset + 2] = 255
            canvas[offset + 3] = 255
          }
        }
      }
    }
    cursor += GLYPH_WIDTH + GLYPH_SPACING
  }
}

/**
 * Render một snapshot window GUI thành PNG RGBA deterministic (không timestamp,
 * không random). Text được ASCII-fold để vừa font 5x7. Kích thước giới hạn bởi
 * số slot và độ dài title/lore — luôn bounded.
 */
export function renderWindowFramePng(frame: WindowFrame): Buffer {
  const title = asciiFold(frame.title).slice(0, MAX_TITLE_CHARS)
  const slots = frame.slots.slice(0, MAX_SLOTS)
  let lines = 1
  const textLines: string[] = [title]
  for (const slot of slots) {
    const name = asciiFold(slot.name).slice(0, MAX_NAME_CHARS) || '?'
    const countText = Number.isSafeInteger(slot.count) && slot.count > 1 ? ` x${slot.count}` : ''
    textLines.push(`[${String(slot.slot).padStart(2, '0')}] ${name}${countText}`)
    for (const lore of slot.lore.slice(0, MAX_LORE_LINES)) {
      textLines.push(`    ${asciiFold(lore).slice(0, MAX_LORE_CHARS)}`)
    }
  }
  lines += textLines.length

  const width = textLines.reduce((w, line) => Math.max(w, textWidth(line)), 40) + MARGIN * 2 + PAD_X * 2
  const height = lines * LINE_HEIGHT + MARGIN * 2

  const canvas = new Uint8Array(width * height * 4)
  // Nền đen đã là 0; chỉ cần vẽ chữ.

  let y = MARGIN
  for (const line of textLines) {
    drawText(canvas, width, height, line, MARGIN + PAD_X, y)
    y += LINE_HEIGHT
  }

  // PNG encoding: rows (filter 0 + RGBA rows), nén zlib.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let row = 0; row < height; row++) {
    raw[row * (stride + 1)] = 0
    Buffer.from(canvas.buffer, canvas.byteOffset + row * stride, stride).copy(raw, row * (stride + 1) + 1)
  }
  const idat = deflateSync(raw)

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}