// Turns written pentest text into something that sounds right when spoken:
// "nmap -sV 10.129.2.3" -> "en-map dash s V 10 dot 129 dot 2 dot 3".
// Shared by the content script, background page and options page.

(function (root) {
  // "word = how to say it". Matching ignores case and only hits whole words.
  // Users can add or override entries on the options page.
  const DEFAULT_PRONUNCIATIONS = `
nmap = en-map
Nmap = en-map
sudo = soo-doo
sudoers = soo-doo-ers
passwd = password
/etc/passwd = slash etc slash password
/etc/shadow = slash etc slash shadow
chmod = change mod
chown = change own
grep = grep
wget = w-get
curl = curl
ssh = S S H
SSH = S S H
SMB = S M B
smbclient = S M B client
FTP = F T P
SFTP = S F T P
TFTP = T F T P
HTTP = H T T P
HTTPS = H T T P S
DNS = D N S
TCP = T C P
UDP = U D P
ICMP = I C M P
SNMP = S N M P
SMTP = S M T P
IMAP = eye-map
POP3 = pop 3
LDAP = el-dap
NTLM = N T L M
RDP = R D P
WinRM = win R M
IIS = I I S
SQL = sequel
MySQL = my sequel
MSSQL = M S sequel
PostgreSQL = postgres sequel
SQLi = sequel injection
NoSQL = no sequel
XSS = cross site scripting
CSRF = C surf
SSRF = S S R F
IDOR = eye-door
LFI = L F I
RFI = R F I
RCE = R C E
XXE = X X E
CVE = C V E
OSINT = oh-sint
nginx = engine X
Kali = kah-lee
msfconsole = M S F console
msfvenom = M S F venom
hashcat = hash cat
enum4linux = enum for linux
gobuster = go buster
ffuf = fuff
nc = netcat
ncat = en-cat
tcpdump = T C P dump
pwd = P W D
ls = L S
UID = U I D
GID = G I D
SUID = S U I D
JSON = jason
YAML = yamel
API = A P I
URL = U R L
URLs = U R Ls
IP = I P
IPs = I Ps
IPv4 = I P v 4
IPv6 = I P v 6
TTL = T T L
VPN = V P N
HTB = Hack The Box
htb = H T B
PwnBox = pwn box
Pwnbox = pwn box
pwn = pone
pwned = poned
e.g. = for example
i.e. = that is
etc. = et cetera
vs. = versus
`;

  function parsePronunciations(text) {
    const entries = [];
    for (const raw of String(text || "").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const word = line.slice(0, eq).trim();
      const say = line.slice(eq + 1).trim();
      if (word && say) entries.push([word, say]);
    }
    return entries;
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Later entries win, so user entries override the defaults.
  function buildDictionary(userText) {
    const map = new Map();
    for (const [w, s] of parsePronunciations(DEFAULT_PRONUNCIATIONS)) map.set(w, s);
    for (const [w, s] of parsePronunciations(userText)) map.set(w, s);
    const special = [];
    const plain = [];
    // Case-sensitive keys first (e.g. "SSH" vs "ssh"), longest first so
    // "/etc/passwd" beats "passwd".
    const keys = [...map.keys()].sort((a, b) => b.length - a.length);
    for (const word of keys) {
      const say = map.get(word);
      const isPlain = /^[\w]+$/.test(word);
      const re = new RegExp(`(?<![\\w/.-])${escapeRegex(word)}(?![\\w/-])`, "g");
      (isPlain ? plain : special).push([re, say, word]);
    }
    return { special, plain };
  }

  function applyDictionary(text, rules) {
    for (const [re, say, word] of rules) {
      // Exact-case match first, then any case unless a different-case key exists.
      text = text.replace(re, say);
      const ci = new RegExp(re.source, "gi");
      text = text.replace(ci, (m) => (rules.some(([, , w]) => w === m) ? m : say));
    }
    return text;
  }

  function spellLetters(s) {
    return s.split("").join(" ");
  }

  function speakUrl(rest) {
    const [hostPort, ...pathParts] = rest.replace(/[.,;:]+$/, "").split("/");
    const [host, port] = hostPort.split(":");
    let out = host.split(".").join(" dot ");
    if (port) out += ` port ${port}`;
    for (const part of pathParts) if (part) out += ` slash ${part.replace(/\./g, " dot ")}`;
    return out;
  }

  function genericRules(text) {
    // URLs: "http://academy.htb:8080/admin" -> "academy dot htb port 8080 slash admin".
    text = text.replace(/\bhttps?:\/\/([^\s<>"')\]]+)/gi, (m, rest) => speakUrl(rest));
    // IPv4 addresses with optional CIDR and port.
    text = text.replace(/\b(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?(?::(\d{1,5}))?\b/g, (m, ip, cidr, port) => {
      let out = ip.split(".").join(" dot ");
      if (cidr) out += ` slash ${cidr}`;
      if (port) out += ` port ${port}`;
      return out;
    });
    // Command flags: "--script" -> "dash dash script", "-sV" -> "dash s V".
    text = text.replace(/(^|[\s("'`])(--?)([A-Za-z][\w-]*)/g, (m, pre, dashes, name) => {
      const d = dashes === "--" ? "dash dash " : "dash ";
      // "-p-" (all ports) ends in a dash of its own.
      const trail = name.endsWith("-") ? " dash" : "";
      name = name.replace(/-+$/, "");
      const spoken = dashes === "-" && name.length <= 4 ? spellLetters(name) : name.replace(/-/g, " ");
      return `${pre}${d}${spoken}${trail}`;
    });
    // File paths: "/usr/share/wordlists" -> "slash usr slash share slash wordlists".
    text = text.replace(/(^|[\s("'`])((?:~|\.{1,2})?(?:\/[\w.@+-]+)+\/?)/g, (m, pre, p) => {
      const parts = p.split("/");
      let out = parts[0] === "~" ? "home" : parts[0] === "." ? "dot" : parts[0] === ".." ? "dot dot" : "";
      for (const part of parts.slice(1)) if (part) out += ` slash ${part.replace(/\./g, " dot ")}`;
      return pre + out.trim();
    });
    // Domains and file names: "inlanefreight.htb" -> "inlanefreight dot htb".
    text = text.replace(/\b([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)\b/g, (m) => {
      if (/^[\d.]+$/.test(m)) return m; // numbers like 3.14 or versions
      if (!/[A-Za-z]/.test(m.split(".").pop())) return m;
      return m.split(".").join(" dot ");
    });
    // Ports and ranges.
    text = text.replace(/\b(\d+)-(\d+)\b/g, "$1 to $2");
    // Symbols that read badly.
    text = text
      .replace(/\s&&\s/g, " and then ")
      .replace(/\s\|\|\s/g, " or else ")
      .replace(/\s\|\s/g, " piped to ")
      .replace(/[`*_#<>{}\[\]\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text;
  }

  let cachedKey = null;
  let cachedDict = null;

  function makeSpeakable(text, userPronunciations) {
    if (cachedKey !== userPronunciations) {
      cachedDict = buildDictionary(userPronunciations);
      cachedKey = userPronunciations;
    }
    const dict = cachedDict;
    let out = String(text || "");
    out = applyDictionary(out, dict.special);
    out = genericRules(out);
    out = applyDictionary(out, dict.plain);
    return out;
  }

  root.HTBSpeech = { DEFAULT_PRONUNCIATIONS, makeSpeakable, parsePronunciations };
  if (typeof module !== "undefined") module.exports = root.HTBSpeech;
})(typeof globalThis !== "undefined" ? globalThis : this);
