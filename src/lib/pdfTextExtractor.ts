import { inflate, inflateRaw } from 'pako';

/**
 * Lightweight PDF text extractor.
 * Attempts real text extraction from PDF streams (including FlateDecode compressed streams).
 * Uses robust pako decompression to avoid browser-specific DecompressionStream decode errors.
 * Operates on exact byte offsets to prevent UTF-8 string decoding corruption on binary streams.
 * If the PDF is scanned (image-only), encrypted, or contains no extractable text,
 * honestly returns success: false so the app can mark content as "unavailable".
 */

function decompressFlate(data: Uint8Array): Uint8Array | null {
  if (!data || data.length === 0) return null;
  try {
    return inflate(data);
  } catch {
    try {
      return inflateRaw(data);
    } catch {
      return null;
    }
  }
}

function safeDecode(bytes: Uint8Array): string {
  if (!bytes || bytes.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    try {
      return new TextDecoder('iso-8859-1', { fatal: false }).decode(bytes);
    } catch {
      let str = '';
      const limit = Math.min(bytes.length, 500000);
      for (let i = 0; i < limit; i++) {
        str += String.fromCharCode(bytes[i]);
      }
      return str;
    }
  }
}

function unescapePdfString(str: string): string {
  return str
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\b/g, '')
    .replace(/\\f/g, '')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

/**
 * Decodes PDF hex-encoded strings e.g. <48656c6c6f> or <00480065006c006c006f>.
 */
function decodePdfHexString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (!clean || clean.length < 2) return '';
  const evenHex = clean.length % 2 === 1 ? clean + '0' : clean;

  // UTF-16BE BOM: FEFF
  if (evenHex.toLowerCase().startsWith('feff')) {
    let res = '';
    for (let i = 4; i < evenHex.length; i += 4) {
      if (i + 4 <= evenHex.length) {
        const code = parseInt(evenHex.slice(i, i + 4), 16);
        if (!isNaN(code) && code > 0) res += String.fromCharCode(code);
      }
    }
    return res;
  }

  // UTF-16BE without BOM: alternating 00xx bytes
  let isUtf16 = false;
  if (evenHex.length >= 8 && evenHex.length % 4 === 0 && evenHex.startsWith('00') && evenHex.slice(4, 6) === '00') {
    isUtf16 = true;
  }
  if (isUtf16) {
    let res = '';
    for (let i = 0; i < evenHex.length; i += 4) {
      const code = parseInt(evenHex.slice(i, i + 4), 16);
      if (!isNaN(code) && code > 0) res += String.fromCharCode(code);
    }
    return res;
  }

  // Standard ASCII / Latin-1 hex
  let res = '';
  for (let i = 0; i < evenHex.length; i += 2) {
    const code = parseInt(evenHex.slice(i, i + 2), 16);
    if (!isNaN(code) && code >= 32 && code <= 255) {
      res += String.fromCharCode(code);
    } else if (code === 10 || code === 13 || code === 9) {
      res += ' ';
    }
  }
  return res;
}

/**
 * Extracts words from decompressed or plain PDF content streams.
 * Understands TJ arrays, Tj, ', " operators with parenthesized strings and hex strings.
 */
function extractTextFromStreamContent(content: string): string[] {
  const words: string[] = [];

  // Match text objects BT ... ET
  const btEtRegex = /BT[\s\S]*?ET/gi;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = btEtRegex.exec(content)) !== null) {
    const block = blockMatch[0];

    // 1. Array TJ operator: [ ... ] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/gi;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjArrayRegex.exec(block)) !== null) {
      const arrayBody = tjMatch[1];
      let i = 0;
      while (i < arrayBody.length) {
        if (arrayBody[i] === '(') {
          let str = '';
          let depth = 1;
          let escaped = false;
          i++;
          while (i < arrayBody.length && depth > 0) {
            const ch = arrayBody[i];
            if (escaped) {
              str += ch;
              escaped = false;
            } else if (ch === '\\') {
              escaped = true;
            } else if (ch === '(') {
              depth++;
              str += ch;
            } else if (ch === ')') {
              depth--;
              if (depth > 0) str += ch;
            } else {
              str += ch;
            }
            i++;
          }
          const unescaped = unescapePdfString(str).trim();
          if (unescaped.length > 0) words.push(unescaped);
        } else if (arrayBody[i] === '<' && arrayBody[i + 1] !== '<') {
          let hex = '';
          i++;
          while (i < arrayBody.length && arrayBody[i] !== '>') {
            hex += arrayBody[i];
            i++;
          }
          i++; // skip '>'
          const decoded = decodePdfHexString(hex).trim();
          if (decoded.length > 0) words.push(decoded);
        } else {
          i++;
        }
      }
    }

    // 2. Simple parenthesized string Tj / ' / " operator
    const singleTjRegex = /\(([^)]*(?:\\.[^)]*)*)\)\s*(?:Tj|'|")/gi;
    let sTjMatch: RegExpExecArray | null;
    while ((sTjMatch = singleTjRegex.exec(block)) !== null) {
      const unescaped = unescapePdfString(sTjMatch[1]).trim();
      if (unescaped.length > 0) {
        words.push(unescaped);
      }
    }

    // 3. Simple hex string Tj / ' / " operator: <48656c6c6f> Tj
    const singleHexRegex = /<([0-9a-fA-F\s]+)>\s*(?:Tj|'|")/gi;
    let hMatch: RegExpExecArray | null;
    while ((hMatch = singleHexRegex.exec(block)) !== null) {
      const decoded = decodePdfHexString(hMatch[1]).trim();
      if (decoded.length > 0) {
        words.push(decoded);
      }
    }
  }

  // Fallback: If no BT...ET blocks were captured or stream was simple text, extract literal parenthesized strings
  if (words.length === 0) {
    const rawLiteralRegex = /\(([^()]{3,})\)/g;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = rawLiteralRegex.exec(content)) !== null) {
      const unescaped = unescapePdfString(rMatch[1]).trim();
      if (unescaped.length >= 3 && /[a-zA-Z]{2,}/.test(unescaped)) {
        words.push(unescaped);
      }
    }
  }

  return words;
}

/**
 * Searches the byte array directly for stream ... endstream byte boundaries.
 * Guarantees exact byte slicing so Flate decompression receives valid zlib headers.
 */
function findStreamByteBoundaries(bytes: Uint8Array): Array<{ start: number; end: number; isFlate: boolean }> {
  const results: Array<{ start: number; end: number; isFlate: boolean }> = [];
  const len = bytes.length;
  let pos = 0;

  while (pos < len - 10) {
    // 's'=115, 't'=116, 'r'=114, 'e'=101, 'a'=97, 'm'=109
    if (
      bytes[pos] === 115 &&
      bytes[pos + 1] === 116 &&
      bytes[pos + 2] === 114 &&
      bytes[pos + 3] === 101 &&
      bytes[pos + 4] === 97 &&
      bytes[pos + 5] === 109
    ) {
      const prevChar = pos > 0 ? bytes[pos - 1] : 32;
      // Preceding character must be whitespace, newline, or '>'
      if (prevChar <= 32 || prevChar === 62) {
        let streamStart = pos + 6;
        // Skip whitespace and newlines after 'stream' (\r\n or \n)
        while (streamStart < len && (bytes[streamStart] === 10 || bytes[streamStart] === 13 || bytes[streamStart] === 32)) {
          streamStart++;
        }

        // Search for 'endstream'
        // 'e'=101, 'n'=110, 'd'=100, 's'=115, 't'=116, 'r'=114, 'e'=101, 'a'=97, 'm'=109
        let endstreamPos = -1;
        for (let i = streamStart; i < len - 8; i++) {
          if (
            bytes[i] === 101 &&
            bytes[i + 1] === 110 &&
            bytes[i + 2] === 100 &&
            bytes[i + 3] === 115 &&
            bytes[i + 4] === 116 &&
            bytes[i + 5] === 114 &&
            bytes[i + 6] === 101 &&
            bytes[i + 7] === 97 &&
            bytes[i + 8] === 109
          ) {
            endstreamPos = i;
            break;
          }
        }

        if (endstreamPos !== -1) {
          let streamEnd = endstreamPos;
          // Trim trailing whitespace / newlines before 'endstream'
          while (streamEnd > streamStart && (bytes[streamEnd - 1] === 10 || bytes[streamEnd - 1] === 13 || bytes[streamEnd - 1] === 32)) {
            streamEnd--;
          }

          // Check if dictionary before 'stream' contains /FlateDecode
          const dictStart = Math.max(0, pos - 800);
          const dictBytes = bytes.slice(dictStart, pos);
          const dictStr = safeDecode(dictBytes);
          const isFlate = dictStr.includes('/FlateDecode');

          results.push({ start: streamStart, end: streamEnd, isFlate });
          pos = endstreamPos + 9;
          continue;
        }
      }
    }
    pos++;
  }

  return results;
}

/**
 * Extracts substantive readable text from a PDF ArrayBuffer.
 * Returns success: true and extracted text if real readable text is found.
 * Returns success: false if no text streams exist (e.g. scanned image PDF).
 */
export async function extractTextFromPdf(
  buffer: ArrayBuffer
): Promise<{ text: string; success: boolean }> {
  try {
    const uint8 = new Uint8Array(buffer);
    if (uint8.length < 10) {
      return { text: '', success: false };
    }

    // Check %PDF- header safely
    const headerStr = safeDecode(uint8.slice(0, 16));
    if (!headerStr.includes('%PDF-')) {
      return { text: '', success: false };
    }

    // Scan for streams in the PDF (capped to first 8MB to protect mobile memory)
    const scanBytes = uint8.length > 8 * 1024 * 1024 ? uint8.slice(0, 8 * 1024 * 1024) : uint8;
    const collectedWords: string[] = [];

    // Find stream boundaries with exact byte offsets
    const streams = findStreamByteBoundaries(scanBytes);

    for (const stream of streams) {
      const rawStreamBytes = scanBytes.slice(stream.start, stream.end);
      if (rawStreamBytes.length === 0) continue;

      let streamText = '';
      if (stream.isFlate) {
        const decompressed = decompressFlate(rawStreamBytes);
        if (decompressed) {
          streamText = safeDecode(decompressed);
        }
      } else {
        streamText = safeDecode(rawStreamBytes);
      }

      if (streamText) {
        const extracted = extractTextFromStreamContent(streamText);
        if (extracted.length > 0) {
          collectedWords.push(...extracted);
        }
      }
    }

    // Fallback: Check uncompressed text in the entire document if no streams yielded words
    if (collectedWords.length === 0) {
      const documentText = safeDecode(scanBytes);
      const extracted = extractTextFromStreamContent(documentText);
      if (extracted.length > 0) {
        collectedWords.push(...extracted);
      }
    }

    const combinedText = collectedWords.join(' ').replace(/\s+/g, ' ').trim();

    // Verify whether substantive readable text was extracted
    // Must be at least 20 characters and contain at least 3 word tokens with letters
    const wordTokens = combinedText.split(' ').filter((w) => /[a-zA-Z]{2,}/.test(w));
    if (combinedText.length >= 20 && wordTokens.length >= 3) {
      return { text: combinedText, success: true };
    }

    // No substantive text found (e.g. scanned image PDF or graphics-only)
    return { text: '', success: false };
  } catch (err) {
    console.warn('PDF text extraction error:', err);
    return { text: '', success: false };
  }
}


