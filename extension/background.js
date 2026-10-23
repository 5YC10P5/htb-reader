// HTB Reader background page: owns the audio player, talks to the local voice
// server, and keeps the page panel and popup up to date.

const { DEFAULT_SETTINGS, getSettings, saveSettings, clampSpeed } = HTBSettings;

let settings = { ...DEFAULT_SETTINGS };
const ready = getSettings().then((s) => (settings = s));

const audio = new Audio();
audio.preservesPitch = true;

const player = {
  status: "idle", // idle | loading | playing | paused | finished | error
  tabId: null,
  pageKey: null,
  title: "",
  items: [], // paragraphs: [{ text }]
  // Paragraphs split into short sentence groups. Short pieces start playing
  // sooner, and the next ones are generated while the current one plays.
  segments: [], // [{ item, text }]
  seg: 0,
  source: null, // "page" | "selection" | "test"
  error: null,
};

let playToken = 0; // bumped whenever playback jumps, so stale async work is ignored
let loadedSeg = -1; // which segment audio.src currently holds
const cache = new Map(); // segment index -> { promise, controller, url, speed }

const SEGMENT_CHARS = 220;

function splitIntoSegments(items) {
  const segments = [];
  items.forEach((item, i) => {
    // Split at sentence ends followed by a capital/number, so "e.g. root" and
    // "10.129.2.49" stay whole.
    const sentences = item.text.split(/(?<=[.!?])\s+(?=["'(A-Z0-9])/);
    let current = "";
    for (const s of sentences) {
      if (current && (current + " " + s).length > SEGMENT_CHARS) {
        segments.push({ item: i, text: current });
        current = s;
      } else {
        current = current ? `${current} ${s}` : s;
      }
    }
    if (current.trim()) segments.push({ item: i, text: current });
  });
  return segments;
}

function firstSegmentOf(itemIndex) {
  const i = player.segments.findIndex((s) => s.item >= itemIndex);
  return i === -1 ? player.segments.length : i;
}

function currentItem() {
  return player.segments[player.seg]?.item ?? 0;
}

// ---------- state broadcasting ----------

function publicState() {
  const index = currentItem();
  return {
    status: player.status,
    tabId: player.tabId,
    pageKey: player.pageKey,
    title: player.title,
    index,
    total: player.items.length,
    source: player.source,
    error: player.error,
    speed: settings.speed,
    voice: settings.voice,
    text: player.items[index]?.text?.slice(0, 240) || "",
  };
}

function broadcast() {
  const state = publicState();
  if (player.tabId != null) {
    browser.tabs.sendMessage(player.tabId, { type: "state", state }).catch(() => {});
  }
  browser.runtime.sendMessage({ type: "state", state }).catch(() => {});
  updateBadge();
}

function updateBadge() {
  const text = player.status === "playing" ? "▶" : player.status === "paused" ? "II" : player.status === "loading" ? "…" : player.status === "error" ? "!" : "";
  browser.browserAction.setBadgeText({ text });
  browser.browserAction.setBadgeBackgroundColor({ color: player.status === "error" ? "#ff3e3e" : "#9fef00" });
  browser.browserAction.setBadgeTextColor?.({ color: "#141d2b" });
}

// ---------- talking to the voice server ----------

async function serverError(response) {
  try {
    const body = await response.json();
    return body.error || `Voice server error ${response.status}`;
  } catch {
    return `Voice server error ${response.status}`;
  }
}

function friendlyError(err) {
  if (err instanceof TypeError) {
    return "Can't reach the voice server. Start it with start.bat (Windows) or start.sh (Mac/Linux) in the HTB Reader folder.";
  }
  return String(err.message || err);
}

function requestAudio(seg) {
  const existing = cache.get(seg);
  if (existing) return existing.promise;
  const controller = new AbortController();
  const text = HTBSpeech.makeSpeakable(player.segments[seg].text, settings.pronunciations);
  const entry = { controller, url: null, speed: settings.speed };
  entry.promise = (async () => {
    if (!text.trim()) return null;
    const response = await fetch(`${settings.serverUrl}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: settings.voice, speed: settings.speed }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await serverError(response));
    entry.url = URL.createObjectURL(await response.blob());
    return entry.url;
  })();
  // A failed request shouldn't stay cached, so a retry asks again.
  entry.promise.catch(() => {
    if (cache.get(seg) === entry) cache.delete(seg);
  });
  cache.set(seg, entry);
  return entry.promise;
}

function dropEntry(seg) {
  const entry = cache.get(seg);
  if (!entry) return;
  entry.controller.abort();
  if (entry.url) URL.revokeObjectURL(entry.url);
  cache.delete(seg);
}

function clearCache() {
  for (const seg of [...cache.keys()]) dropEntry(seg);
}

function prefetch(seg) {
  for (let i = seg + 1; i <= seg + 3 && i < player.segments.length; i++) {
    requestAudio(i).catch(() => {});
  }
}

// ---------- playback ----------

function fail(err) {
  player.status = "error";
  player.error = friendlyError(err);
  broadcast();
}

async function playSegment(seg) {
  const token = ++playToken;
  seg = Math.max(0, seg);
  if (seg >= player.segments.length) return finish();
  const wasPaused = player.status === "paused";
  player.seg = seg;
  player.status = wasPaused ? "paused" : "loading";
  player.error = null;
  broadcast();
  // Keep the current paragraph's start (for "previous") and a few segments ahead.
  const keepFrom = firstSegmentOf(player.segments[seg].item);
  for (const k of [...cache.keys()]) if (k < keepFrom - 1 || k > seg + 4) dropEntry(k);

  let url;
  try {
    url = await requestAudio(seg);
  } catch (err) {
    if (token !== playToken || err.name === "AbortError") return;
    return fail(err);
  }
  if (token !== playToken) return;
  if (!url) return playSegment(seg + 1); // nothing speakable here

  audio.src = url;
  loadedSeg = seg;
  audio.volume = settings.volume;
  audio.playbackRate = settings.speed / (cache.get(seg)?.speed || settings.speed);
  prefetch(seg);
  if (player.status === "paused") return broadcast(); // paused while it was loading
  try {
    await audio.play();
  } catch (err) {
    if (token !== playToken) return;
    return fail(err);
  }
  if (token !== playToken) return;
  player.status = "playing";
  broadcast();
}

function playItem(itemIndex) {
  playSegment(firstSegmentOf(Math.max(0, itemIndex)));
}

function finish() {
  playToken++;
  audio.pause();
  player.status = "finished";
  clearCache();
  loadedSeg = -1;
  broadcast();
}

function startQueue({ tabId, pageKey, items, index = 0, title, source }) {
  playToken++;
  audio.pause();
  clearCache();
  loadedSeg = -1;
  const cleanItems = (items || []).filter((i) => i && i.text && i.text.trim());
  Object.assign(player, {
    tabId: tabId ?? null,
    pageKey: pageKey ?? null,
    title: title || "",
    items: cleanItems,
    segments: splitIntoSegments(cleanItems),
    seg: 0,
    source,
    status: "loading",
    error: null,
  });
  if (!player.segments.length) {
    player.status = "idle";
    return broadcast();
  }
  playItem(Math.min(index, player.items.length - 1));
}

function pause() {
  if (player.status === "playing") audio.pause();
  if (player.status === "playing" || player.status === "loading") {
    player.status = "paused";
    broadcast();
  }
}

function resume() {
  if (player.status !== "paused") return;
  if (loadedSeg === player.seg && audio.src) {
    player.status = "playing";
    audio.play().then(broadcast, fail);
  } else {
    player.status = "loading";
    playSegment(player.seg);
  }
}

function stop() {
  playToken++;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  clearCache();
  loadedSeg = -1;
  player.status = "idle";
  player.error = null;
  broadcast();
}

async function togglePlay() {
  if (player.status === "playing" || player.status === "loading") return pause();
  if (player.status === "paused") return resume();
  if (player.status === "error" && player.segments.length) {
    player.status = "loading";
    return playSegment(player.seg);
  }
  // Nothing queued: ask the active tab to start reading.
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab) browser.tabs.sendMessage(tab.id, { type: "startReading" }).catch(() => {});
}

function wakeFromPause() {
  if (player.status === "paused") player.status = "loading";
}

function next() {
  if (!player.segments.length) return;
  wakeFromPause();
  playItem(currentItem() + 1);
}

function prev() {
  if (!player.segments.length) return;
  wakeFromPause();
  // Like a music player: restart the paragraph unless we're right at its start.
  const item = currentItem();
  const atStart = player.seg === firstSegmentOf(item) && !(loadedSeg === player.seg && audio.currentTime > 3);
  playItem(atStart ? item - 1 : item);
}

function jump(itemIndex) {
  if (!player.segments.length) return;
  wakeFromPause();
  playItem(itemIndex);
}

audio.addEventListener("ended", () => {
  if (player.status === "playing") playSegment(player.seg + 1);
});

async function changeSpeed(delta) {
  await saveSettings({ speed: clampSpeed(settings.speed + delta) });
}

// ---------- settings ----------

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const old = settings;
  settings = { ...DEFAULT_SETTINGS, ...changes.settings.newValue };
  audio.volume = settings.volume;
  if (old.speed !== settings.speed && loadedSeg >= 0) {
    // Speed up the current sentence right away; later ones are generated at the new speed.
    audio.playbackRate = settings.speed / (cache.get(loadedSeg)?.speed || old.speed);
  }
  if (old.voice !== settings.voice || old.speed !== settings.speed || old.pronunciations !== settings.pronunciations) {
    for (const k of [...cache.keys()]) if (k !== loadedSeg) dropEntry(k);
    if (player.status === "playing") prefetch(player.seg);
  }
  broadcast();
});

// ---------- export ----------

function safeFileName(name) {
  return name.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "HTB section";
}

async function exportAudio({ items, title }) {
  const texts = items.map((i) => HTBSpeech.makeSpeakable(i.text, settings.pronunciations)).filter((t) => t.trim());
  if (!texts.length) throw new Error("Nothing to export on this page.");
  const format = settings.exportFormat === "wav" ? "wav" : "mp3";
  let response;
  try {
    response = await fetch(`${settings.serverUrl}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts, voice: settings.voice, speed: settings.speed, format }),
    });
  } catch (err) {
    throw new Error(friendlyError(err));
  }
  if (!response.ok) throw new Error(await serverError(response));
  const url = URL.createObjectURL(await response.blob());
  await browser.downloads.download({ url, filename: `${safeFileName(`HTB - ${title}`)}.${format}`, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
  return { ok: true };
}

// ---------- server info ----------

async function health() {
  try {
    const response = await fetch(`${settings.serverUrl}/health`, { cache: "no-store" });
    const body = await response.json();
    return { reachable: true, ready: body.ready, error: body.error };
  } catch {
    return { reachable: false, ready: false };
  }
}

async function voices() {
  const response = await fetch(`${settings.serverUrl}/voices`);
  if (!response.ok) throw new Error(await serverError(response));
  return response.json();
}

// ---------- messages ----------

browser.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id ?? msg.tabId;
  switch (msg.type) {
    case "start":
      startQueue({ tabId, pageKey: msg.pageKey, items: msg.items, index: msg.index, title: msg.title, source: msg.source || "page" });
      return Promise.resolve(publicState());
    case "control":
      if (msg.action === "toggle") togglePlay();
      else if (msg.action === "pause") pause();
      else if (msg.action === "resume") resume();
      else if (msg.action === "stop") stop();
      else if (msg.action === "next") next();
      else if (msg.action === "prev") prev();
      else if (msg.action === "jump") jump(msg.index);
      return Promise.resolve(publicState());
    case "speed":
      return changeSpeed(msg.delta).then(publicState);
    case "getState":
      return ready.then(() => ({ ...publicState(), forThisTab: sender.tab ? sender.tab.id === player.tabId : undefined }));
    case "openOptions":
      return browser.runtime.openOptionsPage();
    case "pageLeft":
      // The page navigated away (HTB is a single-page app), so the queue is stale.
      if (player.source === "page" && player.tabId === tabId && player.pageKey === msg.pageKey) stop();
      return Promise.resolve();
    case "export":
      return exportAudio(msg).catch((err) => ({ ok: false, error: String(err.message || err) }));
    case "health":
      return health();
    case "voices":
      return voices().catch((err) => ({ error: String(err.message || err) }));
    case "speakText":
      startQueue({ tabId: null, items: splitPlainText(msg.text), title: msg.title || "Test", source: msg.source || "test" });
      return Promise.resolve(publicState());
  }
});

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === player.tabId && player.source === "page") stop();
});

// ---------- keyboard shortcuts & media keys ----------

browser.commands.onCommand.addListener((command) => {
  if (command === "toggle-play" || command === "media-play-pause") togglePlay();
  else if (command === "next" || command === "media-next") next();
  else if (command === "prev" || command === "media-prev") prev();
  else if (command === "faster") changeSpeed(0.1);
  else if (command === "slower") changeSpeed(-0.1);
});

// ---------- right-click menu ----------

function splitPlainText(text) {
  return String(text || "")
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => ({ text: p }));
}

browser.menus.create({
  id: "htbr-read-from-here",
  title: "HTB Reader: read from here",
  contexts: ["page", "link", "selection", "image"],
  documentUrlPatterns: ["https://academy.hackthebox.com/*"],
});
browser.menus.create({
  id: "htbr-read-selection",
  title: "Read aloud with HTB Reader",
  contexts: ["selection"],
});

browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "htbr-read-from-here") {
    browser.tabs.sendMessage(tab.id, { type: "readFromHere" }).catch(() => {});
  } else if (info.menuItemId === "htbr-read-selection") {
    startQueue({ tabId: tab?.id, items: splitPlainText(info.selectionText), title: "Selected text", source: "selection" });
  }
});

updateBadge();
