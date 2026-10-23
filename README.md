# HTB Reader

**Listen to Hack The Box Academy lessons instead of reading them.**

HTB Reader is a free Firefox extension that reads HTB Academy sections aloud in
a natural voice. The voice is generated on your own computer by
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), a small open-source
text-to-speech model. There are no accounts, subscriptions or cloud services,
and the lesson text never leaves your machine.

It's built for pentest content: it knows that `nmap -sV -p- 10.129.2.49` should
be read as "en-map dash s V dash p dash 10 dot 129 dot 2 dot 49", and it
announces code blocks instead of reading every symbol in them.

> **Not affiliated with or endorsed by Hack The Box.** HTB Reader only reads
> pages you already have open in your own browser. Lesson content belongs to
> Hack The Box, so keep any audio you save for your own use and don't share it.

---

## Features

- 🎧 **Natural voice** that runs offline after the first start (13 voices, US and British, male and female)
- ⚡ **Starts speaking within a couple of seconds** and prepares the next sentences while you listen
- 🖍️ **Highlights the paragraph being read** and scrolls the page along with it
- ▶️ **Read from anywhere**: hover a paragraph and press its ▶, or right-click and choose "read from here"
- 💻 **Code-aware**: code blocks are announced ("terminal example shown on screen"), or short commands are read aloud. You choose.
- 📊 **Tables** are read row by row
- 🗣️ **Hacking-term pronunciation** for tools, flags, IPs, ports, paths and acronyms (SMB, LDAP, SQLi, `/etc/passwd`...), plus your own custom words
- 🔖 **Resumes** where you stopped in each section
- ⏭️ **Auto-advance** to the next section (optional)
- ⌨️ **Keyboard shortcuts, media keys and headphone buttons**
- 💾 **Save audio**: turn a whole section into an MP3 for your phone
- 🌐 **Read any selected text** on any website from the right-click menu

## Requirements

- **Firefox** 142 or newer
- **Node.js** 20 or newer, free from <https://nodejs.org> (choose the LTS version)
- About **600 MB** of disk space (the voice engine plus the 160 MB voice model)
- A reasonably modern CPU. No graphics card is needed; a laptop with an Intel Core i5 (12th gen) is fast enough.

Windows, macOS and Linux are supported.

---

## Installation

### 1. Download HTB Reader

Click **Code → Download ZIP** on this page and unzip it anywhere, or clone it:

```bash
git clone https://github.com/5YC10P5/htb-reader.git
```

### 2. Start the voice server

- **Windows:** double-click `start.bat`
- **macOS / Linux:** run `./start.sh` in a terminal

The first start installs the voice engine and downloads the voice model
(about 160 MB). Wait until you see:

```
Voice model ready. HTB Reader server is running at http://127.0.0.1:5123
```

Keep this window open while you listen. Later starts take a few seconds and
work offline.

> **Windows tip:** run `autostart-on.bat` once to start the server
> automatically (minimized) when you log in. `autostart-off.bat` undoes it,
> and `stop-server.bat` stops a server that's running in the background.

### 3. Load the extension in Firefox

HTB Reader isn't on the Firefox Add-ons store. You load it straight from the
folder you downloaded, so you can read every line of code you're running.

1. Open Firefox and type `about:debugging#/runtime/this-firefox` in the address bar.
2. Click **Load Temporary Add-on...**
3. Open the `extension` folder and select **`manifest.json`**.

HTB Reader now appears in your toolbar.

> **Firefox removes temporary add-ons when it closes**, so repeat these three
> steps after each Firefox restart (it takes about 10 seconds). Your settings
> may also reset when that happens.

<details>
<summary><b>Optional: keep it installed permanently (Firefox Developer Edition or Nightly)</b></summary>

Regular Firefox only keeps add-ons signed by Mozilla. Firefox
[Developer Edition](https://www.mozilla.org/firefox/developer/) and
[Nightly](https://www.mozilla.org/firefox/channel/desktop/#nightly) can keep
unsigned ones:

1. Type `about:config` in the address bar, search for
   `xpinstall.signatures.required`, and set it to **false**.
2. Build the add-on file in the HTB Reader folder:
   ```bash
   npm install
   npm run build
   ```
3. Open `about:addons`, click the gear icon → **Install Add-on From File...**, and
   pick the `.xpi` file in the `dist` folder.

Turning off signature checks applies to every add-on in that browser, so only
install add-ons you trust there.
</details>

### 4. Listen

Open any HTB Academy section. The HTB Reader player appears in the bottom-right
corner. Press the green ▶ button.

---

## Using it

| Do this | To |
| --- | --- |
| Press ▶ in the player | Start reading (or resume where you stopped) |
| Hover a paragraph and press its small ▶ | Read from that paragraph |
| Right-click a lesson, then **HTB Reader: read from here** | Same thing, from the menu |
| Select text on any site, right-click, **Read aloud with HTB Reader** | Read just that text |
| **Save audio** | Save the section as an MP3 |
| Drag the player's title bar | Move the player |
| **–** in the player | Shrink it to a small round button |

### Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Alt+Shift+P` | Play / pause |
| `Alt+Shift+→` / `Alt+Shift+←` | Next / previous paragraph |
| `Alt+Shift+↑` / `Alt+Shift+↓` | Faster / slower |
| Media keys / headphone buttons | Play / pause, next, previous |

You can change them in `about:addons` → gear icon → **Manage Extension Shortcuts**.

### Settings

Open them from the gear in the player, or from the toolbar button → **Settings**.

- **Voice, speed and volume.** *Heart* is the best voice. *Michael* and *Fenrir* are good male voices.
- **Code blocks:** announce them (default), read short commands aloud, or skip them.
- **Tables:** read row by row, just announce them, or skip them.
- **Follow along, resume, auto-advance**, and whether to show the floating player at all.
- **Pronunciation:** one rule per line, written as `word = how to say it`, for example `kerbrute = curb brute`.
  A preview box shows exactly what will be spoken.

---

## Troubleshooting

**"Voice server is off"**: start it with `start.bat` / `start.sh` and wait for
"Voice model ready".

**Short pauses between sentences**: your CPU can't keep up at that moment.
Close heavy programs, plug in your laptop, or lower the speed. You can compare
model builds on your machine with:

```bash
npm run benchmark
```

Then pick a different build or thread count before starting the server:

```bash
HTB_READER_DTYPE=fp32 HTB_READER_THREADS=4 node server/server.mjs
```

On Windows: `set HTB_READER_DTYPE=fp32` then `node server\server.mjs`.

**The player doesn't appear, or it reads the wrong parts of a page**: HTB may
have changed their page layout. Please
[open an issue](https://github.com/5YC10P5/htb-reader/issues/new/choose) with
the section's URL and what went wrong.

**A word is pronounced wrong**: add a fix under **Settings → Pronunciation**,
and consider [suggesting it](https://github.com/5YC10P5/htb-reader/issues/new/choose)
so everyone gets it.

---

## How it works

```
Firefox (HTB Academy page)                 Your computer
┌──────────────────────────┐   text    ┌─────────────────────────┐
│ HTB Reader extension     │ ────────▶ │ Voice server (Node.js)  │
│  - finds the lesson text │           │  127.0.0.1:5123         │
│  - fixes pronunciation   │ ◀──────── │  Kokoro-82M voice model │
│  - plays & highlights    │   audio   └─────────────────────────┘
└──────────────────────────┘
```

### Privacy & security

- **Lesson text stays on your computer.** The extension only sends it to the
  voice server on your own machine. No analytics, no tracking, no accounts.
- **The server only listens on `127.0.0.1`.** Other devices on your network can't reach it.
- **Websites can't use the server.** It only answers requests from browser extensions,
  and it checks the address it was reached at, which blocks DNS-rebinding tricks.
- **The only downloads** are the npm packages on first start and the one-time
  voice model download from Hugging Face.
- **HTB Reader never logs in, clicks, submits or scrapes anything on its own.**
  It only reads the page you have open. The one exception is the optional
  auto-advance setting, which clicks the section's plain "Next" button. It never
  presses "Mark Complete" or any other button that changes your progress.
- **About `npm audit` warnings:** `npm audit` reports issues in `sharp`, an image
  library the voice engine installs. HTB Reader never processes images, so that
  code never runs.

### Project layout

| Path | What it is |
| --- | --- |
| `extension/` | The Firefox extension (manifest v2) |
| `extension/lib/speech-text.js` | Pronunciation rules and the built-in word list |
| `extension/content/content.js` | Finds lesson text on HTB pages, runs the floating player |
| `extension/background.js` | Audio playback, queueing and talking to the server |
| `server/server.mjs` | The local voice server |
| `server/benchmark.mjs` | Speed test for the model builds |
| `tests/` | Automated tests |

---

## Contributing

Pull requests are welcome, especially new pronunciation entries in
`extension/lib/speech-text.js` and fixes for HTB layout changes.

```bash
npm install          # install everything, including dev tools
npm test             # page-reading test (no server needed)
npm run test:player  # playback test (start the server first)
npm run lint         # Mozilla's extension validator
npm run build        # package the extension as dist/htb-reader-<version>.xpi
```

After changing the extension, reload it from `about:debugging` with the
**Reload** button next to HTB Reader.

On Windows, stop the voice server before running `npm install`; Windows locks the
voice engine's files while the server is running.

---

## Credits & license

- Voice model: [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad (Apache 2.0),
  run through [kokoro-js](https://www.npmjs.com/package/kokoro-js) and
  [Transformers.js](https://github.com/huggingface/transformers.js).
- MP3 encoding: [lamejs](https://github.com/shijinyu/lamejs) (LGPL 3.0).

HTB Reader is released under the [MIT License](LICENSE).

"Hack The Box" and "HTB" are trademarks of Hack The Box Ltd. This project is an
independent, community-made tool and is not affiliated with or endorsed by
Hack The Box.
