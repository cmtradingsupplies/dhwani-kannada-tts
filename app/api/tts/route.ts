import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { messages, validateText, type ErrorCode } from "../../../lib/tts";
import { splitText } from "../../../lib/speech-server";

export const runtime = "nodejs";
const WINDOW_MS = 60_000;
const CACHE_TTL = 60 * 60_000;
const MAX_BODY = 16_384;
const MAX_AUDIO = 8 * 1024 * 1024;
const CACHE_BUDGET = 24 * 1024 * 1024;
const JOB_TTL = 15 * 60_000;
const MAX_SYNTHESIS_MS = 12 * 60_000;
const python = process.platform === "win32"
  ? join(process.cwd(), ".venv", "Scripts", "python.exe")
  : join(process.cwd(), ".venv", "bin", "python");
const model = join(process.cwd(), "models", "kn_IN-syspin_male-medium.onnx");
const synthesizer = join(process.cwd(), "scripts", "synthesize.py");
const limits = new Map<string, { count: number; expires: number }>();
const cache = new Map<string, { bytes: Buffer; expires: number }>();
type SpeechJob = {
  token: string;
  total: number;
  completed: number;
  expires: number;
  failed: boolean;
  audio?: Buffer;
  result: Promise<Buffer>;
};
const active = new Map<string, SpeechJob>();
const jobs = new Map<string, SpeechJob>();
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

function synthesize(chunks: string[], rate: number, pitch: number, onProgress: (completed: number) => void) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = execFile(python, [synthesizer], {
      encoding: "buffer",
      maxBuffer: MAX_AUDIO,
      timeout: MAX_SYNTHESIS_MS,
      windowsHide: true,
    }, (error, audio) => {
      if (error) return reject(error);
      if (audio.length < 4) return reject(new Error("Empty MP3 response"));
      resolve(audio);
    });
    let remainder = "";
    child.stderr?.setEncoding("utf8").on("data", (data: string) => {
      const lines = (remainder + data).split("\n");
      remainder = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^progress:(\d+)\s*$/.exec(line);
        if (match) onProgress(Number(match[1]));
      }
    });
    child.stdin?.on("error", () => { /* execFile reports failures after the process exits. */ });
    child.stdin?.end(JSON.stringify({ chunks, rate, pitch }));
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

function jobStatus(job: SpeechJob) {
  return NextResponse.json(
    { jobId: job.token, completed: job.completed, total: job.total },
    { status: 202, headers: { "Cache-Control": "no-store" } },
  );
}

export function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("job");
  const job = token && jobs.get(token);
  if (!job || job.expires <= Date.now()) return fail("expired", 404, { "Cache-Control": "no-store" });
  if (job.failed) return fail("unavailable", 502, { "Cache-Control": "no-store" });
  if (job.audio) return audioResponse(job.audio);
  return jobStatus(job);
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

  let job = active.get(id);
  if (!job) {
    if (active.size >= 1) return fail("busy", 429, retryAfter(10));
    for (const [token, recent] of jobs) {
      if (recent.expires <= now || (jobs.size >= 8 && (recent.audio || recent.failed))) jobs.delete(token);
    }
    const chunks = splitText(text);
    const created: SpeechJob = {
      token: randomUUID(), total: chunks.length, completed: 0, expires: now + JOB_TTL, failed: false,
      result: synthesize(chunks, speed, semitones, (completed) => { created.completed = completed; })
        .then((bytes) => {
          saveAudio(id, bytes);
          created.audio = bytes;
          return bytes;
        })
        .catch((error) => {
          created.failed = true;
          console.warn("Speech synthesis failed", error instanceof Error ? error.name : "UnknownError");
          throw error;
        })
        .finally(() => {
          created.expires = Date.now() + 2 * 60_000;
          active.delete(id);
        }),
    };
    // Async clients learn about failure via GET.
    void created.result.catch(() => {});
    jobs.set(created.token, created);
    active.set(id, created);
    job = created;
  }
  if (req.headers.get("prefer") === "respond-async" || text.length > 350) return jobStatus(job);
  try {
    return audioResponse(await job.result);
  } catch (error) {
    return fail("unavailable", 502);
  }
}
