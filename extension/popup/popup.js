// Toolbar popup: a mini player for whatever HTB Reader is reading.

const $ = (id) => document.getElementById(id);
const PLAY = "M8 5v14l11-7z";
const PAUSE = "M6 5h4v14H6zM14 5h4v14h-4z";

let state = null;

function send(msg) {
  return browser.runtime.sendMessage(msg).catch(() => null);
}

function render() {
  const s = state || { status: "idle" };
  const active = ["playing", "loading", "paused"].includes(s.status);
  $("title").textContent = active || s.status === "finished" || s.status === "error" ? s.title || "HTB Reader" : "Nothing playing";
  const statusText = {
    idle: "Open an HTB Academy section and press play.",
    loading: "Preparing voice...",
    playing: "Reading",
    paused: "Paused",
    finished: "Finished.",
    error: s.error || "Something went wrong.",
  }[s.status];
  $("status").textContent = statusText;
  $("text").textContent = active ? s.text : "";
  $("progress").textContent = active && s.total ? `Paragraph ${s.index + 1} of ${s.total}` : "";
  const playing = s.status === "playing" || s.status === "loading";
  $("play-icon").firstElementChild.setAttribute("d", playing ? PAUSE : PLAY);
}

async function checkServer() {
  const h = await send({ type: "health" });
  const dot = $("server-dot");
  const msg = $("server-msg");
  if (h?.reachable && h.ready) {
    dot.className = "dot ok";
    dot.title = "Voice server running";
    msg.hidden = true;
  } else if (h?.reachable) {
    dot.className = "dot";
    dot.title = "Voice model loading";
    msg.hidden = false;
    msg.textContent = h.error ? "The voice model failed to load. Check the server window." : "The voice model is still loading...";
  } else {
    dot.className = "dot bad";
    dot.title = "Voice server not running";
    msg.hidden = false;
    msg.textContent = "The voice server is off. Run start.bat (Windows) or start.sh (Mac/Linux) in the HTB Reader folder to turn it on.";
  }
  return h;
}

async function loadVoices(current) {
  const select = $("voice");
  const fromServer = await send({ type: "voices" });
  const available = Array.isArray(fromServer) ? new Set(fromServer.map((v) => v.id)) : null;
  select.replaceChildren();
  for (const [id, label] of HTBSettings.RECOMMENDED_VOICES) {
    if (available && !available.has(id)) continue;
    select.appendChild(new Option(label, id, false, id === current));
  }
}

async function init() {
  const settings = await HTBSettings.getSettings();
  $("speed").value = settings.speed;
  $("speed-value").textContent = `${Number(settings.speed).toFixed(1)}×`;
  state = await send({ type: "getState" });
  render();
  await checkServer();
  await loadVoices(settings.voice);
}

$("play").addEventListener("click", () => send({ type: "control", action: "toggle" }));
$("prev").addEventListener("click", () => send({ type: "control", action: "prev" }));
$("next").addEventListener("click", () => send({ type: "control", action: "next" }));
$("stop").addEventListener("click", () => send({ type: "control", action: "stop" }));
$("options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});
$("speed").addEventListener("input", (e) => {
  $("speed-value").textContent = `${Number(e.target.value).toFixed(1)}×`;
});
$("speed").addEventListener("change", (e) => HTBSettings.saveSettings({ speed: HTBSettings.clampSpeed(e.target.value) }));
$("voice").addEventListener("change", (e) => HTBSettings.saveSettings({ voice: e.target.value }));

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "state") {
    state = msg.state;
    render();
    $("speed").value = msg.state.speed;
    $("speed-value").textContent = `${Number(msg.state.speed).toFixed(1)}×`;
  }
});

init();
