// Runs the background player against the real local voice server with a fake
// <audio> element, and checks play / pause / next / prev / finish behaviour.
// Start the server first, then: node tests/background.test.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const states = [];
let listener = null;
const store = {};

class FakeAudio extends EventTarget {
  constructor() {
    super();
    this.src = "";
    this.currentTime = 0;
    this.playbackRate = 1;
    this.volume = 1;
    this.timer = null;
  }
  play() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dispatchEvent(new Event("ended")), 300); // each clip "plays" for 0.3s
    return Promise.resolve();
  }
  pause() {
    clearTimeout(this.timer);
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
}

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  fetch,
  AbortController,
  URL: { createObjectURL: () => `blob:${Math.random()}`, revokeObjectURL() {} },
  Audio: FakeAudio,
  browser: {
    storage: {
      local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o) },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage: async (m) => m.type === "state" && states.push(m.state), onMessage: { addListener: (f) => (listener = f) }, openOptionsPage() {} },
    tabs: { sendMessage: async () => {}, query: async () => [], onRemoved: { addListener() {} } },
    browserAction: { setBadgeText() {}, setBadgeBackgroundColor() {}, setBadgeTextColor() {} },
    commands: { onCommand: { addListener() {} } },
    menus: { create() {}, onClicked: { addListener() {} } },
    downloads: { download: async () => {} },
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const f of ["extension/lib/speech-text.js", "extension/lib/settings.js", "extension/background.js"]) vm.runInContext(read(f), sandbox, { filename: f });

const msg = (m) => listener(m, { tab: { id: 1 } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred, ms = 30000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await wait(50);
  }
};
const last = () => states[states.length - 1];
let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
};

const items = [
  { text: "First paragraph. It has two sentences." },
  { text: "Second paragraph with nmap -sV 10.129.2.49." },
  { text: "Third paragraph." },
];

console.log("health:", await msg({ type: "health" }));
const t0 = Date.now();
await msg({ type: "start", pageKey: "/x", items, index: 0, title: "Test" });
await waitFor(() => last()?.status === "playing");
check(`starts playing (first audio after ${((Date.now() - t0) / 1000).toFixed(1)}s)`, last().index === 0);

await msg({ type: "control", action: "pause" });
check("pause", last().status === "paused");
await msg({ type: "control", action: "resume" });
check("resume", last().status === "playing");

await msg({ type: "control", action: "next" });
await waitFor(() => last()?.status === "playing" && last().index === 1);
check("next goes to paragraph 2", last().index === 1);

await msg({ type: "control", action: "prev" });
await waitFor(() => last()?.status === "playing");
check("prev at start of paragraph goes back to paragraph 1", last().index === 0);

await msg({ type: "control", action: "jump", index: 2 });
await waitFor(() => last()?.status === "finished", 30000);
check("plays to the end and finishes", last().status === "finished");

await msg({ type: "control", action: "stop" });
check("stop", last().status === "idle");

process.exit(failures ? 1 : 0);
