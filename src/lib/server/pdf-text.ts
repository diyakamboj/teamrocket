import { inflateRawSync, inflateSync } from "node:zlib";

/**
 * Minimal embedded-text extractor for born-digital PDFs.
 *
 * This is deliberately not a full PDF implementation — it exists so the app can
 * ingest ordinary text-layer resumes without an Azure key, and so we can tell
 * "scanned, needs OCR" apart from "has a text layer" before spending a
 * Document Intelligence call. Scanned files produce (almost) no text here and
 * get routed to OCR.
 */
export function extractPdfText(bytes: Uint8Array): { text: string; pageCount: number } {
  const buffer = Buffer.from(bytes);
  const latin1 = buffer.toString("latin1");
  const pageCount = countPages(latin1);
  const pieces: string[] = [];

  for (const stream of contentStreams(buffer, latin1)) {
    const text = textFromContentStream(stream);
    if (text.trim()) pieces.push(text);
  }

  return { text: normalize(pieces.join("\n")), pageCount };
}

/** A document is "scanned" when there is no meaningful text layer to read. */
export function looksLikeUsableText(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "").length;
  return text.trim().length >= 200 && letters >= 120 && letters / text.length > 0.35;
}

function countPages(latin1: string): number {
  const matches = latin1.match(/\/Type\s*\/Page(?![sA-Za-z])/g);
  return matches?.length ?? 0;
}

function* contentStreams(buffer: Buffer, latin1: string): Generator<string> {
  let cursor = 0;

  while (cursor < latin1.length) {
    const open = latin1.indexOf("stream", cursor);
    if (open === -1) return;

    let start = open + "stream".length;
    if (latin1[start] === "\r") start++;
    if (latin1[start] === "\n") start++;

    const close = latin1.indexOf("endstream", start);
    if (close === -1) return;
    cursor = close + "endstream".length;

    const raw = buffer.subarray(start, close);
    if (raw.length === 0) continue;
    yield decodeStream(raw);
  }
}

function decodeStream(raw: Buffer): string {
  for (const inflate of [inflateSync, inflateRawSync]) {
    try {
      return inflate(raw).toString("latin1");
    } catch {
      // Not flate-compressed with this variant — fall through.
    }
  }
  return raw.toString("latin1");
}

/**
 * Pulls the operands of the text-showing operators (Tj, TJ, ' and ") out of a
 * content stream, inserting line breaks where the text cursor moves.
 */
function textFromContentStream(stream: string): string {
  if (!/\b(Tj|TJ)\b/.test(stream)) return "";

  const out: string[] = [];
  let pending: string[] = [];
  let i = 0;

  const flush = () => {
    if (pending.length) {
      out.push(pending.join(""));
      pending = [];
    }
  };

  while (i < stream.length) {
    const char = stream[i]!;

    if (char === "(") {
      const [value, next] = readLiteralString(stream, i);
      pending.push(value);
      i = next;
      continue;
    }

    if (char === "<" && stream[i + 1] !== "<") {
      const end = stream.indexOf(">", i);
      if (end === -1) break;
      pending.push(readHexString(stream.slice(i + 1, end)));
      i = end + 1;
      continue;
    }

    if (/[A-Za-z'"*]/.test(char)) {
      let j = i;
      while (j < stream.length && /[A-Za-z0-9*'"]/.test(stream[j]!)) j++;
      const op = stream.slice(i, j);
      i = j;

      if (op === "Tj" || op === "TJ") {
        flush();
      } else if (op === "'" || op === '"') {
        flush();
        out.push("\n");
      } else if (op === "Td" || op === "TD" || op === "T*" || op === "TL") {
        flush();
        out.push("\n");
      } else if (op === "ET" || op === "BT") {
        flush();
        out.push("\n");
      }
      continue;
    }

    i++;
  }

  flush();
  return out.join("");
}

function readLiteralString(stream: string, start: number): [string, number] {
  let depth = 1;
  let i = start + 1;
  let value = "";

  while (i < stream.length && depth > 0) {
    const char = stream[i]!;

    if (char === "\\") {
      const next = stream[i + 1];
      if (next === undefined) break;
      if (next >= "0" && next <= "7") {
        const octal = stream.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)?.[0] ?? "";
        value += String.fromCharCode(parseInt(octal, 8));
        i += 1 + octal.length;
        continue;
      }
      const escapes: Record<string, string> = { n: "\n", r: "\n", t: "\t", b: "", f: "" };
      value += escapes[next] ?? (next === "\n" ? "" : next);
      i += 2;
      continue;
    }

    if (char === "(") depth++;
    if (char === ")") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
    if (depth > 0) value += char;
    i++;
  }

  return [value, i];
}

function readHexString(hex: string): string {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, "");
  let value = "";
  // Two-byte codes are almost always UTF-16BE identity encodings.
  const stride = clean.length % 4 === 0 && clean.length > 4 ? 4 : 2;
  for (let i = 0; i < clean.length; i += stride) {
    const code = parseInt(clean.slice(i, i + stride), 16);
    if (Number.isFinite(code) && code > 8) value += String.fromCharCode(code);
  }
  return value;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
