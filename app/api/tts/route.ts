import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { messages, validateText, type ErrorCode } from "../../../lib/tts";
import { splitText } from "../../../lib/speech-server";

export const runtime = "nodejs";
export const maxDuration = 90;

const WINDOW_MS = 60_000;
const CACHE_TTL = 60 * 60_000;
const MAX_BODY = 16_384;
const MAX_AUDIO = 4 * 1024 * 1024;
const CACHE_BUDGET = 24 * 1024 * 1024;
const python = process.platform === "win32"
  ? join(process.cwd(), ".venv", "Scripts", "python.exe")
  : join(process.cwd(), ".venv", "bin", "python");
const model = join(process.cwd(), "models", "kn_IN-syspin_male-medium.onnx");
const synthesizer = join(process.cwd(), "scripts", "synthesize.py");
const limits = new Map<string, { count: number; expires: number }>();
const cache = new Map<string, { bytes: Buffer; expires: number }>();
const pending = new Map<string, Promise<Buffer>>();
let cacheSize = 0;
let nextSweep = 0;

function fail(code: ErrorCode, status: number, headers?: HeadersInit) {
  const [kn, en] = messages[code];
  return NextResponse.json({ code, error: { kn, en } }, { status, headers });
}

function retryAfter(seconds: number) {
  return { "Retry-After": String(seconds) };
}

function clientIp(req: Request) {
  const header = process.env.VERCEL === "1"
    ? "x-vercel-forwarded-for"
    : process.env.TRUSTED_CLIENT_IP_HEADER;
  const ip = header && req.headers.get(header)?.trim();
  return ip && isIP(ip) ? ip : "unknown";
}

function checkLimit(req: Request, now: number) {
  if (now >= nextSweep) {
    for (const [ip, entry] of limits) if (entry.expires <= now) limits.delete(ip);
    nextSweep = now + WINDOW_MS;
  }
  const ip = clientIp(req);
  const previous = limits.get(ip);
  if (previous && previous.expires > now) {
    if (previous.count >= 10) return Math.ceil((previous.expires - now) / 1000);
    previous.count++;
    return 0;
  }
  if (limits.size >= 10_000 && !previous) return 60;
  limits.set(ip, { count: 1, expires: now + WINDOW_MS });
  return 0;
}

async function readBytes(body: ReadableStream<Uint8Array> | null, maxBytes: number) {
  if (!body) throw new Error("Missing body");
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxBytes) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts, length);
}

function synthesize(text: string, rate: number, pitch: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile(python, [synthesizer], {
      encoding: "buffer",
      maxBuffer: MAX_AUDIO,
      timeout: 85_000,
      windowsHide: true,
    }, (error, audio) => {
      if (error) return reject(error);
      if (audio.length < 4) return reject(new Error("Empty MP3 response"));
      resolve(audio);
    });
    child.stdin?.on("error", reject);
    child.stdin?.end(JSON.stringify({ chunks: splitText(text), rate, pitch }));
  });
}

function saveAudio(id: string, bytes: Buffer) {
  if (bytes.length > CACHE_BUDGET) return;
  const now = Date.now();
  for (const [oldId, entry] of cache) {
    if (entry.expires > now && cacheSize + bytes.length <= CACHE_BUDGET && cache.size < 128) break;
    cache.delete(oldId);
    cacheSize -= entry.bytes.length;
  }
  cache.set(id, { bytes, expires: now + CACHE_TTL });
  cacheSize += bytes.length;
}

function audioResponse(bytes: Buffer) {
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(bytes.length),
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(req: Request) {
  const now = Date.now();
  const retry = checkLimit(req, now);
  if (retry) return fail("busy", 429, retryAfter(retry));

  let input: unknown;
  try {
    if (req.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return fail("invalid", 415);
    }
    input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBytes(req.body, MAX_BODY)));
  } catch {
    return fail("invalid", 400);
  }
  if (!input || typeof input !== "object" || !("text" in input) || typeof input.text !== "string") {
    return fail("invalid", 400);
  }
  const error = validateText(input.text);
  if (error) return fail(error, 400);
  const rate = "rate" in input ? input.rate : "-5%";
  const pitch = "pitch" in input ? input.pitch : "-2st";
  if (typeof rate !== "string" || !/^[+-]?\d{1,2}%$/.test(rate) ||
      typeof pitch !== "string" || !/^[+-]?\d{1,2}st$/.test(pitch)) {
    return fail("invalid", 400);
  }
  const speed = Number(rate.slice(0, -1));
  const semitones = Number(pitch.slice(0, -2));
  if (Math.abs(speed) > 20 || Math.abs(semitones) > 4) return fail("invalid", 400);

  const text = input.text.trim();
  const id = createHash("sha256").update(JSON.stringify([text, speed, semitones])).digest("hex");
  const cached = cache.get(id);
  if (cached && cached.expires > now) return audioResponse(cached.bytes);

  if (!existsSync(python) || !existsSync(model) || !existsSync(`${model}.json`)) {
    return fail("setup", 503);
  }

  try {
    let job = pending.get(id);
    if (!job) {
      if (pending.size >= 2) return fail("busy", 429, retryAfter(5));
      job = synthesize(text, speed, semitones)
        .then((bytes) => {
          saveAudio(id, bytes);
          return bytes;
        })
        .finally(() => pending.delete(id));
      pending.set(id, job);
    }
    return audioResponse(await job);
  } catch (error) {
    console.warn("Speech synthesis failed", error instanceof Error ? error.name : "UnknownError");
    return fail("unavailable", 502);
  }
}
