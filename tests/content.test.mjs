// Runs the content script against a mock HTB Academy lesson in jsdom and
// prints what it would read. Usage: node tests/content.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const html = `<!doctype html><html><head><title>Network Enumeration with Nmap | Hack The Box Academy</title></head><body>
<nav><a href="/">Dashboard</a><p>Sidebar text that should not be read.</p></nav>
<div class="walkthrough-content">
  <h1>Host Discovery</h1>
  <p>When we need to conduct an internal penetration test, we first need to know which systems are <strong>online</strong>.</p>
  <p>Use <code>-sn</code> to disable port scanning and run <code>sudo nmap 10.129.2.0/24 -sn -oA tnet | grep for | cut -d" " -f5</code> later.</p>
  <div class="window_top">Host Discovery</div>
  <div class="window_content"><pre class="shiki language-shell-session"><code><span class="shell-symbol">user@htb[/htb]$</span>sudo nmap 10.129.2.0/24 -sn -oA tnet
10.129.2.4
10.129.2.10</code></pre></div>
  <h2>Scan Options</h2>
  <table><thead><tr><th>Option</th><th>Description</th></tr></thead>
    <tbody><tr><td>-sn</td><td>Disables port scanning.</td></tr><tr><td>-oA tnet</td><td>Stores the results in all formats.</td></tr></tbody></table>
  <ul>
    <li>Ping sweeps
      <ul><li>ICMP echo requests</li><li>ARP requests on local networks</li></ul>
    </li>
    <li><p>Wrapped item in a paragraph.</p></li>
  </ul>
  <pre><code>PS C:\\htb&gt; Get-Service | where Status -eq Running</code></pre>
  <img src="x.png" alt="diagram">
</div>
<button>Previous</button><a href="/next">Next</a>
</body></html>`;

async function run(codeMode) {
  const dom = new JSDOM(html, { url: "https://academy.hackthebox.com/app/module/19/section/184", runScripts: "outside-only" });
  const { window } = dom;
  window.Element.prototype.checkVisibility = function () {
    return !this.closest(".window_top");
  };
  const store = { settings: { codeMode } };
  window.browser = {
    storage: {
      local: {
        get: async (k) => (typeof k === "string" ? { [k]: store[k] } : { ...store }),
        set: async (o) => Object.assign(store, o),
        remove: async (k) => delete store[k],
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      sendMessage: async (m) => (m.type === "health" ? { reachable: true, ready: true } : null),
      onMessage: { addListener() {} },
    },
  };
  window.eval(read("extension/lib/settings.js"));
  window.eval(read("extension/content/content.js"));
  await new Promise((r) => setTimeout(r, 50));
  console.log(`\n=== codeMode: ${codeMode} ===`);
  for (const b of window.__htbReader.blocks()) console.log(`[${b.kind}] ${b.text}`);
  console.log("panel status:", window.document.querySelector("#htbr-root .htbr-status").textContent);
  window.close(); // stops the content script's timers so the test exits
}

await run("announce");
await run("short");
