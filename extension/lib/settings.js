// Default settings and helpers shared by the background page, popup and options page.

(function (root) {
  const DEFAULT_SETTINGS = {
    serverUrl: "http://127.0.0.1:5123",
    voice: "af_heart",
    speed: 1.0,
    volume: 1.0,
    codeMode: "announce", // "announce" | "skip" | "short"
    tableMode: "read", // "read" | "announce" | "skip"
    autoAdvance: false,
    autoScroll: true,
    resume: true,
    showPanel: true,
    pronunciations: "",
    exportFormat: "mp3",
  };

  // Voices worth offering, best first. Grades come from the Kokoro model card.
  const RECOMMENDED_VOICES = [
    ["af_heart", "Heart (US female, best quality)"],
    ["af_bella", "Bella (US female)"],
    ["am_michael", "Michael (US male)"],
    ["am_fenrir", "Fenrir (US male)"],
    ["am_puck", "Puck (US male)"],
    ["af_nicole", "Nicole (US female, soft)"],
    ["af_sarah", "Sarah (US female)"],
    ["af_kore", "Kore (US female)"],
    ["af_aoede", "Aoede (US female)"],
    ["bf_emma", "Emma (British female)"],
    ["bm_george", "George (British male)"],
    ["bm_fable", "Fable (British male)"],
    ["bf_isabella", "Isabella (British female)"],
  ];

  async function getSettings() {
    const { settings } = await browser.storage.local.get("settings");
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  async function saveSettings(changes) {
    const current = await getSettings();
    const next = { ...current, ...changes };
    await browser.storage.local.set({ settings: next });
    return next;
  }

  function clampSpeed(s) {
    return Math.round(Math.min(2.5, Math.max(0.5, Number(s) || 1)) * 10) / 10;
  }

  root.HTBSettings = { DEFAULT_SETTINGS, RECOMMENDED_VOICES, getSettings, saveSettings, clampSpeed };
})(globalThis);
