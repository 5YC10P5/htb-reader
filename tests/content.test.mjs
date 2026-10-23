// Runs the content script against a mock HTB Academy lesson in jsdom and
// checks what it would read. Usage: node tests/content.test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

// The lesson text below is made up for the test; it only mimics HTB's page structure.
const html = `<!doctype html><html><head><title>Example Module | Hack The Box Academy</title></head><body>
<nav><a href="/">Dashboard</a><p>Sidebar text that should not be read.</p></nav>
<div class="walkthrough-content">
  <h1>Finding Live Hosts</h1>
  <p>Before scanning ports, it helps to find out which machines in a range actually <strong>respond</strong>.</p>
  <p>The <code>-sn</code> flag skips the port scan, and <code>nmap 10.10.10.0/24 -sn -oG hosts.txt | grep Up | cut -d" " -f2</code> lists live hosts.</p>
  <div class="window_top">Finding Live Hosts</div>
  <div class="window_content"><pre class="shiki language-shell-session"><code><span class="shell-symbol">user@htb[/htb]$</span>nmap 10.10.10.0/24 -sn -oG hosts.txt
10.10.10.5
10.10.10.20</code></pre></div>
  <h2>Useful Flags</h2>
  <table><thead><tr><th>Flag</th><th>Meaning</th></tr></thead>
    <tbody><tr><td>-sn</td><td>Host discovery only.</td></tr><tr><td>-oG hosts.txt</td><td>Greppable output file</td></tr></tbody></table>
  <ul>
    <li>Discovery methods
      <ul><li>ICMP echo</li><li>ARP on the local subnet</li></ul>
    </li>
    <li><p>A list item wrapped in a paragraph.</p></li>
  </ul>
  <pre><code>PS C:\\htb&gt; Get-Service | where Status -eq Running</code></pre>
  <img src="x.png" alt="diagram">
</div>
<button>Previous</button><button>Mark Complete &amp; Next</button><a href="/next">Next</a>
</body></html>`;

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) failures++;
}

async function run(codeMode) {
  const dom = new JSDOM(html, { url: "https://academy.hackthebox.com/app/module/1/section/1", runScripts: "outside-only" });
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
  const blocks = window.__htbReader.blocks();
  const texts = blocks.map((b) => b.text);
  console.log(`\n=== codeMode: ${codeMode} ===`);
  for (const b of blocks) console.log(`[${b.kind}] ${b.text}`);
  const status = window.document.querySelector("#htbr-root .htbr-status").textContent;
  window.close(); // stops the content script's timers so the test exits
  return { blocks, texts, status };
}

const announce = await run("announce");
check("skips text outside the lesson", !announce.texts.some((t) => t.includes("Sidebar")));
check("reads headings with a pause", announce.texts[0] === "Finding Live Hosts.");
check("replaces long inline commands", announce.texts.some((t) => t.includes("this command")));
check("announces terminal blocks", announce.texts.includes("Terminal example shown on screen."));
check("reads table rows without double periods", announce.texts.some((t) => t.includes("Host discovery only. -oG hosts.txt, Greppable output file.")));
check("splits nested list items", announce.texts.includes("Discovery methods") && announce.texts.includes("ICMP echo"));
check("panel shows paragraph count", announce.status === `Ready: ${announce.blocks.length} paragraphs.`);

const short = await run("short");
check("reads a prompt with no space after $", short.texts.includes("Command: nmap 10.10.10.0/24 -sn -oG hosts.txt. Output shown on screen."));
check("reads a PowerShell prompt", short.texts.includes("Command: Get-Service | where Status -eq Running."));

const skip = await run("skip");
check("skip mode drops code blocks", !skip.blocks.some((b) => b.kind === "code"));

process.exit(failures ? 1 : 0);
