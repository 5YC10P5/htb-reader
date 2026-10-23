// Measures how fast each Kokoro model version runs on this PC.
// Usage: node server/benchmark.mjs <dtype> <threads> [<dtype> <threads> ...]
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { KokoroTTS } from "kokoro-js";
import { env, StyleTextToSpeech2Model, AutoTokenizer } from "@huggingface/transformers";

env.cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "models");
const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const text = "Network Mapper is an open source tool for network analysis and security auditing. It uses raw packets to determine which hosts are available on the network, which services they offer, and which operating systems they run.";
console.log(`CPU threads: ${os.cpus().length}`);
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const dtype = args[i];
  const threads = Number(args[i + 1]);
  const session_options = threads ? { intraOpNumThreads: threads, interOpNumThreads: 1 } : undefined;
  const model = await StyleTextToSpeech2Model.from_pretrained(MODEL_ID, { dtype, device: "cpu", session_options });
  const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID);
  const tts = new KokoroTTS(model, tokenizer);
  await tts.generate("Warm up.", { voice: "af_heart" });
  const t0 = performance.now();
  const audio = await tts.generate(text, { voice: "af_heart" });
  const secs = (performance.now() - t0) / 1000;
  const len = audio.audio.length / audio.sampling_rate;
  console.log(`${dtype} threads=${threads || "default"}: ${(len / secs).toFixed(2)}x realtime`);
}
