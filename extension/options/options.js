// Settings page. Every change saves straight away.

const $ = (id) => document.getElementById(id);

function send(msg) {
  return browser.runtime.sendMessage(msg).catch(() => null);
}

let savedTimer = null;
async function save(changes) {
  await HTBSettings.saveSettings(changes);
  $("saved").textContent = "Saved";
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($("saved").textContent = ""), 1500);
}

async function checkServer() {
  const h = await send({ type: "health" });
  const dot = $("server-dot");
  const status = $("server-status");
  if (h?.reachable && h.ready) {
    dot.className = "dot ok";
    status.textContent = "Running";
  } else if (h?.reachable) {
    dot.className = "dot";
    status.textContent = h.error ? "Running, but the voice model failed to load. Check the server window." : "Starting up (loading the voice model)...";
  } else {
    dot.className = "dot bad";
    status.textContent = "Not running. Run start.bat (Windows) or start.sh (Mac/Linux) in the HTB Reader folder.";
  }
}

async function loadVoices(current) {
  const fromServer = await send({ type: "voices" });
  const available = Array.isArray(fromServer) ? new Set(fromServer.map((v) => v.id)) : null;
  const select = $("voice");
  select.replaceChildren();
  for (const [id, label] of HTBSettings.RECOMMENDED_VOICES) {
    if (available && !available.has(id)) continue;
    select.appendChild(new Option(label, id, false, id === current));
  }
}

function updatePreview() {
  $("preview-out").textContent = HTBSpeech.makeSpeakable($("preview-input").value, $("pronunciations").value);
}

async function countPositions() {
  const { positions = {} } = await browser.storage.local.get("positions");
  $("positions-count").textContent = Object.keys(positions).length;
}

async function init() {
  const s = await HTBSettings.getSettings();
  $("serverUrl").value = s.serverUrl;
  $("speed").value = s.speed;
  $("speed-value").textContent = `${Number(s.speed).toFixed(1)}×`;
  $("volume").value = s.volume;
  $("volume-value").textContent = `${Math.round(s.volume * 100)}%`;
  $("pronunciations").value = s.pronunciations;
  for (const id of ["autoScroll", "resume", "autoAdvance", "showPanel"]) $(id).checked = !!s[id];
  for (const name of ["codeMode", "tableMode", "exportFormat"]) {
    const radio = document.querySelector(`input[name="${name}"][value="${s[name]}"]`);
    if (radio) radio.checked = true;
  }
  $("defaults").textContent = HTBSpeech.DEFAULT_PRONUNCIATIONS.trim();
  updatePreview();
  countPositions();
  await checkServer();
  await loadVoices(s.voice);
}

$("voice").addEventListener("change", (e) => save({ voice: e.target.value }));
$("speed").addEventListener("input", (e) => ($("speed-value").textContent = `${Number(e.target.value).toFixed(1)}×`));
$("speed").addEventListener("change", (e) => save({ speed: HTBSettings.clampSpeed(e.target.value) }));
$("volume").addEventListener("input", (e) => {
  $("volume-value").textContent = `${Math.round(e.target.value * 100)}%`;
  save({ volume: Number(e.target.value) });
});
$("serverUrl").addEventListener("change", async (e) => {
  const url = e.target.value.trim().replace(/\/+$/, "") || HTBSettings.DEFAULT_SETTINGS.serverUrl;
  e.target.value = url;
  await save({ serverUrl: url });
  checkServer();
});
for (const id of ["autoScroll", "resume", "autoAdvance", "showPanel"]) {
  $(id).addEventListener("change", (e) => save({ [id]: e.target.checked }));
}
for (const name of ["codeMode", "tableMode", "exportFormat"]) {
  for (const radio of document.querySelectorAll(`input[name="${name}"]`)) {
    radio.addEventListener("change", (e) => e.target.checked && save({ [name]: e.target.value }));
  }
}

let pronTimer = null;
$("pronunciations").addEventListener("input", () => {
  updatePreview();
  clearTimeout(pronTimer);
  pronTimer = setTimeout(() => save({ pronunciations: $("pronunciations").value }), 500);
});
$("preview-input").addEventListener("input", updatePreview);
$("preview").addEventListener("click", () => {
  updatePreview();
  send({ type: "speakText", text: $("preview-input").value, title: "Pronunciation preview" });
});
$("test").addEventListener("click", () => send({ type: "speakText", text: $("test-text").value, title: "Voice test" }));
$("test-stop").addEventListener("click", () => send({ type: "control", action: "stop" }));
$("clear-positions").addEventListener("click", async () => {
  await browser.storage.local.remove("positions");
  countPositions();
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === "state" && msg.state.status === "error") $("server-status").textContent = msg.state.error;
});

init();
setInterval(checkServer, 10000);
