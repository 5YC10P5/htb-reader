// HTB Reader voice server.
// Runs the free Kokoro-82M voice model on this PC and turns text into speech
// for the HTB Reader Firefox extension. Nothing is sent to the internet
// (apart from the one-time model download from Hugging Face).

import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KokoroTTS } from "kokoro-js";
import { env, StyleTextToSpeech2Model, AutoTokenizer } from "@huggingface/transformers";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.HTB_READER_PORT || 5123);
const HOST = "127.0.0.1";
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
// fp16 was the fastest on a laptop CPU (about 2x real time); q8 was the slowest.
// Run `node server/benchmark.mjs fp16 8 fp32 4` to compare on another PC.
const DTYPE = process.env.HTB_READER_DTYPE || "fp16";
const THREADS = Number(process.env.HTB_READER_THREADS) || Math.max(2, Math.min(8, os.cpus().length - 2));
const SAMPLE_RATE = 24000;
const MAX_CHUNK_CHARS = 350; // Kokoro truncates long inputs, so long text is split into sentences
const MAX_TEXT_CHARS = 20000;
const MAX_EXPORT_CHARS = 400000;

env.cacheDir = path.join(ROOT, "models");
env.allowRemoteModels = true;

let tts = null;
let loadError = null;

// One generation at a time: the model is CPU heavy and requests are short.
let queue = Promise.resolve();
function enqueue(job) {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

async function loadModel() {
  console.log(`Loading Kokoro voice model (${DTYPE}, ${THREADS} threads)...`);
  console.log("The first start downloads about 160 MB. Later starts are offline.");
  let lastPct = -1;
  try {
    // Built by hand instead of KokoroTTS.from_pretrained so the CPU thread
    // count can be set; the default thread count was noticeably slower.
    const model = await StyleTextToSpeech2Model.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      device: "cpu",
      session_options: { intraOpNumThreads: THREADS, interOpNumThreads: 1 },
      progress_callback: (p) => {
        if (p.status === "progress" && p.file?.endsWith(".onnx")) {
          const pct = Math.floor(p.progress);
          if (pct % 10 === 0 && pct !== lastPct) {
            lastPct = pct;
            console.log(`  downloading model: ${pct}%`);
          }
        }
      },
    });
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
    tts = new KokoroTTS(model, tokenizer);
    // Warm up so the first real request is fast.
    await tts.generate("Ready.", { voice: "af_heart" });
    console.log(`Voice model ready. HTB Reader server is running at http://${HOST}:${PORT}`);
    console.log("Keep this window open while you listen. Close it to stop the server.");
  } catch (err) {
    loadError = err;
    console.error("Could not load the voice model:", err);
  }
}

// Split text into chunks Kokoro can handle, breaking at sentence ends,
// then at commas, then at spaces.
export function splitText(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?;:]+(?:[.!?;:]+["')\]]*|$)\s*/g) || [clean];
  const chunks = [];
  let current = "";
  const push = (s) => {
    s = s.trim();
    if (s) chunks.push(s);
  };
  for (const sentence of sentences) {
    for (const piece of breakLong(sentence)) {
      if ((current + " " + piece).length > MAX_CHUNK_CHARS) {
        push(current);
        current = piece;
      } else {
        current = current ? current + " " + piece.trim() : piece;
      }
    }
  }
  push(current);
  return chunks;
}

function breakLong(sentence) {
  if (sentence.length <= MAX_CHUNK_CHARS) return [sentence];
  const parts = [];
  let rest = sentence;
  while (rest.length > MAX_CHUNK_CHARS) {
    let cut = rest.lastIndexOf(", ", MAX_CHUNK_CHARS);
    if (cut < MAX_CHUNK_CHARS / 3) cut = rest.lastIndexOf(" ", MAX_CHUNK_CHARS);
    if (cut < 1) cut = MAX_CHUNK_CHARS;
    parts.push(rest.slice(0, cut + 1));
    rest = rest.slice(cut + 1);
  }
  parts.push(rest);
  return parts;
}

function silence(seconds) {
  return new Float32Array(Math.round(SAMPLE_RATE * seconds));
}

function concat(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function synthesize(text, voice, speed) {
  const parts = [];
  for (const chunk of splitText(text)) {
    const audio = await tts.generate(chunk, { voice, speed });
    parts.push(audio.audio, silence(0.12));
  }
  return concat(parts);
}

function toInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function toWav(samples) {
  const pcm = toInt16(samples);
  const header = Buffer.alloc(44);
  const dataBytes = pcm.length * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}

async function toMp3(samples) {
  const { Mp3Encoder } = await import("@breezystack/lamejs");
  const encoder = new Mp3Encoder(1, SAMPLE_RATE, 64);
  const pcm = toInt16(samples);
  const blocks = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const buf = encoder.encodeBuffer(pcm.subarray(i, i + 1152));
    if (buf.length) blocks.push(Buffer.from(buf));
  }
  const end = encoder.flush();
  if (end.length) blocks.push(Buffer.from(end));
  return Buffer.concat(blocks);
}

// Only the extension (and tools on this PC with no Origin header) may use the
// server. Web pages can't, so a random website can't drive your CPU.
function originAllowed(req) {
  const origin = req.headers.origin;
  return !origin || origin.startsWith("moz-extension://") || origin.startsWith("chrome-extension://");
}

function hostAllowed(req) {
  const host = (req.headers.host || "").toLowerCase();
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
}

function send(res, status, body, type = "application/json", origin) {
  const headers = { "Content-Type": type, "Cache-Control": "no-store" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("Request too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function voiceList() {
  return Object.entries(tts.voices).map(([id, v]) => ({
    id,
    name: v.name,
    language: v.language,
    gender: v.gender,
    grade: v.overallGrade,
  }));
}

function checkVoice(voice) {
  return tts.voices[voice] ? voice : "af_heart";
}

function checkSpeed(speed) {
  const s = Number(speed);
  return Number.isFinite(s) ? Math.min(2.5, Math.max(0.5, s)) : 1;
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!hostAllowed(req) || !originAllowed(req)) return send(res, 403, { error: "Forbidden" });

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, ready: !!tts, error: loadError ? String(loadError) : null, dtype: DTYPE }, "application/json", origin);
    }
    if (!tts) {
      return send(res, 503, { error: loadError ? "The voice model failed to load. Check the server window." : "The voice model is still loading." }, "application/json", origin);
    }
    if (req.method === "GET" && url.pathname === "/voices") {
      return send(res, 200, voiceList(), "application/json", origin);
    }
    if (req.method === "POST" && url.pathname === "/tts") {
      const body = await readJson(req, 200000);
      const text = String(body.text || "").slice(0, MAX_TEXT_CHARS);
      if (!text.trim()) return send(res, 400, { error: "No text" }, "application/json", origin);
      const voice = checkVoice(body.voice);
      const speed = checkSpeed(body.speed);
      // Skip work for requests the extension already cancelled.
      let closed = false;
      res.on("close", () => (closed = true));
      const samples = await enqueue(() => (closed ? null : synthesize(text, voice, speed)));
      if (closed || !samples) return;
      return send(res, 200, toWav(samples), "audio/wav", origin);
    }
    if (req.method === "POST" && url.pathname === "/export") {
      const body = await readJson(req, MAX_EXPORT_CHARS * 2);
      const texts = (Array.isArray(body.texts) ? body.texts : []).map(String).filter((t) => t.trim());
      if (!texts.length) return send(res, 400, { error: "No text" }, "application/json", origin);
      if (texts.join("").length > MAX_EXPORT_CHARS) return send(res, 413, { error: "Section is too long to export" }, "application/json", origin);
      const voice = checkVoice(body.voice);
      const speed = checkSpeed(body.speed);
      const format = body.format === "wav" ? "wav" : "mp3";
      console.log(`Exporting ${texts.length} paragraphs as ${format}...`);
      // Each paragraph is queued separately so live reading can slip in
      // between them instead of waiting for the whole export.
      const parts = [];
      for (const t of texts) parts.push(await enqueue(() => synthesize(t, voice, speed)), silence(0.35));
      const samples = concat(parts);
      const out = format === "wav" ? toWav(samples) : await toMp3(samples);
      console.log(`Export done (${Math.round(samples.length / SAMPLE_RATE)} seconds of audio).`);
      return send(res, 200, out, format === "wav" ? "audio/wav" : "audio/mpeg", origin);
    }
    send(res, 404, { error: "Not found" }, "application/json", origin);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: String(err.message || err) }, "application/json", origin);
  }
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Is HTB Reader already running in another window?`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`HTB Reader server listening on http://${HOST}:${PORT}`);
  loadModel();
});
