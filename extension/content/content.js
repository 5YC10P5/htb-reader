// HTB Reader content script for academy.hackthebox.com.
// Finds the lesson text, shows the floating player, highlights what's being
// read, and handles "read from here", resume, and auto-advance.

(() => {
  if (window.__htbReaderLoaded) return;
  window.__htbReaderLoaded = true;

  const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,pre,table,blockquote,dt,dd,figcaption";
  // HTB renders lessons inside .walkthrough-content; the rest are fallbacks
  // in case the layout changes.
  const ROOT_SELECTORS = [".walkthrough-content", "[class*='walkthrough']", "article", "main", "body"];
  const ACTIVE = ["playing", "loading", "paused"];

  let settings = { ...HTBSettings.DEFAULT_SETTINGS };
  let blocks = []; // [{ el, text, kind }]
  let blockIndex = new Map(); // element -> index in blocks
  let rootEl = null;
  let pageKey = location.pathname;
  let state = null;
  let serverOk = null; // null = unknown, true/false after a health check
  let highlighted = null;
  let lastContextTarget = null;
  let savedPosition = null;
  let exporting = false;
  let note = ""; // one-off message shown in the panel status line

  // ---------- helpers ----------

  function clean(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (el.checkVisibility) return el.checkVisibility({ visibilityProperty: true });
    return el.getClientRects().length > 0;
  }

  function pageTitle() {
    const h1 = rootEl?.querySelector("h1");
    const fromDoc = clean(document.title.replace(/\s*[|\-–]\s*Hack The Box Academy.*$/i, ""));
    return fromDoc || clean(h1?.textContent) || "HTB section";
  }

  function svg(pathD, size = 18) {
    const ns = "http://www.w3.org/2000/svg";
    const s = document.createElementNS(ns, "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("width", size);
    s.setAttribute("height", size);
    s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", pathD);
    p.setAttribute("fill", "currentColor");
    s.appendChild(p);
    return s;
  }

  const ICONS = {
    play: "M8 5v14l11-7z",
    pause: "M6 5h4v14H6zM14 5h4v14h-4z",
    next: "M6 18l8.5-6L6 6v12zM16 6h2v12h-2z",
    prev: "M6 6h2v12H6zm3.5 6l8.5 6V6z",
    stop: "M7 7h10v10H7z",
    download: "M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z",
    settings:
      "M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.47.47 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87a.47.47 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.48.48 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z",
    minimize: "M6 11h12v2H6z",
    headphones: "M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h3v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h3a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z",
    restart: "M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z",
  };

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.appendChild(c);
    return node;
  }

  function send(msg) {
    return browser.runtime.sendMessage(msg).catch(() => null);
  }

  // ---------- reading the lesson ----------

  function paragraphTextLength(container) {
    let n = 0;
    for (const p of container.querySelectorAll("p, li")) n += p.textContent.length;
    return n;
  }

  function findRoot() {
    for (const sel of ROOT_SELECTORS) {
      let best = null;
      let bestLen = 0;
      for (const candidate of document.querySelectorAll(sel)) {
        if (candidate.closest("#htbr-root") || !isVisible(candidate)) continue;
        const len = paragraphTextLength(candidate);
        if (len > bestLen) {
          best = candidate;
          bestLen = len;
        }
      }
      if (best && bestLen > 150) return best;
    }
    return null;
  }

  function ownText(node) {
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll(`${BLOCK_SELECTOR},script,style,svg,button,img,noscript,.sr-only,[aria-hidden='true']`)
      .forEach((n) => n.remove());
    clone.querySelectorAll("code").forEach((c) => {
      if (c.textContent.trim().length > 60) c.textContent = " this command ";
    });
    clone.querySelectorAll("br").forEach((b) => b.replaceWith(" "));
    return clean(clone.textContent);
  }

  const PROMPT_RE = /^(?:PS [^>]{1,80}>|[A-Za-z]:\\[^>]{0,80}>|\S{0,80}[$#])\s+/;

  function codeText(pre) {
    if (settings.codeMode === "skip") return null;
    const classes = `${pre.className} ${pre.querySelector("code")?.className || ""} ${pre.parentElement?.className || ""}`;
    const lines = pre.textContent.split("\n").map((l) => l.trim()).filter(Boolean);
    const isShell = pre.querySelector(".shell-symbol") || /shell|bash|powershell|cmd|console/i.test(classes) || lines.some((l) => PROMPT_RE.test(l));
    const label = isShell ? "Terminal example shown on screen." : "Code example shown on screen.";
    if (settings.codeMode !== "short") return label;

    const commands = lines.filter((l) => PROMPT_RE.test(l)).map((l) => l.replace(PROMPT_RE, ""));
    if (commands.length) {
      if (commands.length > 2 || commands.join(" ").length > 150) return label;
      const hasOutput = lines.length > commands.length;
      return `Command: ${commands.join(". Then: ")}.${hasOutput ? " Output shown on screen." : ""}`;
    }
    if (lines.length <= 2 && lines.join(" ").length <= 120) return `Code: ${lines.join(". ")}.`;
    return label;
  }

  function tableText(table) {
    if (settings.tableMode === "skip") return null;
    const rows = [...table.rows];
    if (!rows.length) return null;
    if (settings.tableMode === "announce" || rows.length > 16) {
      return `A table with ${rows.length} rows is shown on screen.`;
    }
    const hasHeader = rows[0].querySelectorAll("th").length > 0;
    const parts = [];
    if (hasHeader) parts.push(`Table with columns: ${[...rows[0].cells].map((c) => clean(c.textContent)).join(", ")}.`);
    else parts.push("Table.");
    for (const row of hasHeader ? rows.slice(1) : rows) {
      const cells = [...row.cells].map((c) => clean(c.textContent)).filter(Boolean);
      const line = cells.join(", ");
      if (line) parts.push(/[.!?]$/.test(line) ? line : `${line}.`);
    }
    return parts.join(" ");
  }

  function extract() {
    rootEl = findRoot();
    const out = [];
    if (!rootEl) return out;
    for (const node of rootEl.querySelectorAll(BLOCK_SELECTOR)) {
      if (node.closest("#htbr-root")) continue;
      const container = node.parentElement?.closest("pre,table");
      if (container && rootEl.contains(container)) continue; // read as part of the whole code block/table
      if (!isVisible(node)) continue;
      let text;
      let kind = "text";
      if (node.tagName === "PRE") {
        kind = "code";
        text = codeText(node);
      } else if (node.tagName === "TABLE") {
        kind = "table";
        text = tableText(node);
      } else {
        text = ownText(node);
        if (/^H[1-6]$/.test(node.tagName)) {
          kind = "heading";
          if (text && !/[.!?:]$/.test(text)) text += ".";
        }
      }
      if (text && text.trim()) out.push({ el: node, text: text.trim(), kind });
    }
    return out;
  }

  function setBlocks(list) {
    blocks = list;
    blockIndex = new Map(blocks.map((b, i) => [b.el, i]));
  }

  function blockFor(target) {
    for (let n = target; n && n !== document.body; n = n.parentElement) {
      if (blockIndex.has(n)) return blockIndex.get(n);
    }
    return -1;
  }

  // The first paragraph at or below an element, for "read from here" on
  // images or empty space.
  function blockBelow(target) {
    const top = target.getBoundingClientRect().top;
    const i = blocks.findIndex((b) => b.el.getBoundingClientRect().bottom >= top);
    return i === -1 ? 0 : i;
  }

  // ---------- positions (resume) ----------

  async function loadPosition() {
    const { positions = {} } = await browser.storage.local.get("positions");
    const p = positions[pageKey];
    savedPosition = settings.resume && p && p.index > 0 && p.index < blocks.length ? p.index : null;
  }

  async function savePosition(index) {
    const { positions = {} } = await browser.storage.local.get("positions");
    positions[pageKey] = { index, total: blocks.length, at: Date.now() };
    const keys = Object.keys(positions);
    if (keys.length > 400) {
      keys.sort((a, b) => positions[a].at - positions[b].at).slice(0, keys.length - 400).forEach((k) => delete positions[k]);
    }
    await browser.storage.local.set({ positions });
  }

  async function clearPosition() {
    const { positions = {} } = await browser.storage.local.get("positions");
    delete positions[pageKey];
    savedPosition = null;
    await browser.storage.local.set({ positions });
  }

  // ---------- starting playback ----------

  function startAt(index) {
    if (!blocks.length) refresh(true);
    if (!blocks.length) {
      note = "No lesson text found on this page.";
      render();
      return;
    }
    note = "";
    send({
      type: "start",
      source: "page",
      pageKey,
      title: pageTitle(),
      index: Math.max(0, Math.min(index, blocks.length - 1)),
      items: blocks.map((b) => ({ text: b.text })),
    });
  }

  function startOrResume() {
    startAt(savedPosition ?? 0);
  }

  function isMine(s) {
    return !!s && s.source === "page" && s.pageKey === pageKey && s.forThisTab !== false;
  }

  function onPlayClick() {
    if (isMine(state) && ACTIVE.includes(state.status)) send({ type: "control", action: "toggle" });
    else if (isMine(state) && state.status === "error") send({ type: "control", action: "toggle" });
    else startOrResume();
  }

  // ---------- auto-advance ----------

  function findNextLink() {
    let best = null;
    let bestScore = 0;
    for (const node of document.querySelectorAll("a, button")) {
      if (node.closest("#htbr-root") || !isVisible(node) || node.disabled) continue;
      const t = clean(`${node.textContent} ${node.getAttribute("aria-label") || ""}`).toLowerCase();
      // Never press buttons that change account progress (e.g. "Mark Complete & Next").
      if (!t || t.length > 50 || /prev|complete|submit|finish|reset|start|spawn/.test(t)) continue;
      let score = 0;
      if (/^next( section)?$/.test(t)) score = 3;
      else if (/next.*section/.test(t)) score = 2;
      else if (/\bnext\b/.test(t)) score = 1;
      if (score >= bestScore && score > 0) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  async function goToNextSection() {
    const link = findNextLink();
    if (!link) {
      note = "Section finished. No next section button found.";
      return render();
    }
    note = "Moving to the next section...";
    render();
    await browser.storage.local.set({ autoStart: { at: Date.now(), from: pageKey } });
    link.click();
  }

  async function checkAutoStart() {
    const { autoStart } = await browser.storage.local.get("autoStart");
    if (!autoStart || autoStart.from === pageKey) return false;
    if (Date.now() - autoStart.at > 60000) {
      await browser.storage.local.remove("autoStart");
      return false;
    }
    if (!blocks.length) return false; // the new section hasn't rendered yet; a later refresh retries
    await browser.storage.local.remove("autoStart");
    startAt(0);
    return true;
  }

  // ---------- highlight ----------

  function highlight(index) {
    const target = index >= 0 ? blocks[index]?.el : null;
    if (highlighted === target) return;
    highlighted?.classList.remove("htbr-reading");
    highlighted = target || null;
    if (!highlighted) return;
    highlighted.classList.add("htbr-reading");
    if (settings.autoScroll) {
      const r = highlighted.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 80) {
        highlighted.scrollIntoView({ block: r.height > window.innerHeight * 0.6 ? "start" : "center", behavior: "smooth" });
      }
    }
  }

  // ---------- panel ----------

  const ui = {};

  function buildPanel() {
    ui.playIcon = svg(ICONS.play, 26);
    ui.play = el("button", { class: "htbr-btn htbr-play", title: "Play / pause (Alt+Shift+P)", onclick: onPlayClick }, [ui.playIcon]);
    ui.status = el("div", { class: "htbr-status" });
    ui.dot = el("span", { class: "htbr-dot", title: "Voice server status" });
    ui.speed = el("span", { class: "htbr-speed-value" });
    ui.progress = el("span", { class: "htbr-progress" });
    ui.resume = el("button", { class: "htbr-chip", onclick: () => startAt(0), title: "Start reading this section from the top" }, [
      svg(ICONS.restart, 14),
      el("span", { text: "From the top" }),
    ]);
    ui.exportBtn = el("button", { class: "htbr-chip", title: "Save this section as an audio file", onclick: onExport }, [
      svg(ICONS.download, 14),
      el("span", { text: "Save audio" }),
    ]);

    ui.panel = el("div", { class: "htbr-panel" }, [
      el("div", { class: "htbr-head" }, [
        el("span", { class: "htbr-logo" }, [svg(ICONS.headphones, 16)]),
        el("span", { class: "htbr-title", text: "HTB Reader" }),
        ui.dot,
        el("button", { class: "htbr-icon", title: "Settings", onclick: () => send({ type: "openOptions" }) }, [svg(ICONS.settings, 16)]),
        el("button", { class: "htbr-icon", title: "Minimize", onclick: () => setCollapsed(true) }, [svg(ICONS.minimize, 16)]),
      ]),
      ui.status,
      el("div", { class: "htbr-controls" }, [
        el("button", { class: "htbr-btn", title: "Previous paragraph (Alt+Shift+Left)", onclick: () => send({ type: "control", action: "prev" }) }, [svg(ICONS.prev, 20)]),
        ui.play,
        el("button", { class: "htbr-btn", title: "Next paragraph (Alt+Shift+Right)", onclick: () => send({ type: "control", action: "next" }) }, [svg(ICONS.next, 20)]),
        el("button", { class: "htbr-btn", title: "Stop", onclick: () => send({ type: "control", action: "stop" }) }, [svg(ICONS.stop, 20)]),
      ]),
      el("div", { class: "htbr-row" }, [
        el("div", { class: "htbr-speed" }, [
          el("button", { class: "htbr-mini", title: "Slower (Alt+Shift+Down)", text: "−", onclick: () => send({ type: "speed", delta: -0.1 }) }),
          ui.speed,
          el("button", { class: "htbr-mini", title: "Faster (Alt+Shift+Up)", text: "+", onclick: () => send({ type: "speed", delta: 0.1 }) }),
        ]),
        ui.progress,
      ]),
      el("div", { class: "htbr-row htbr-chips" }, [ui.resume, ui.exportBtn]),
      el("div", { class: "htbr-tip", text: "Tip: hover a paragraph and press ▶ to read from there." }),
    ]);

    ui.fab = el("button", { class: "htbr-fab", title: "Open HTB Reader", onclick: () => setCollapsed(false) }, [svg(ICONS.headphones, 22)]);
    ui.root = el("div", { id: "htbr-root" }, [ui.panel, ui.fab]);
    ui.hoverPlay = el("button", { class: "htbr-hover-play", title: "Read from here" }, [svg(ICONS.play, 14)]);
    ui.hoverPlay.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const i = Number(ui.hoverPlay.dataset.index);
      if (i >= 0) startAt(i);
      ui.hoverPlay.classList.remove("htbr-show");
    });
    ui.root.appendChild(ui.hoverPlay);
    document.documentElement.appendChild(ui.root);
    makeDraggable(ui.panel.querySelector(".htbr-head"));
    restorePanelState();
  }

  async function restorePanelState() {
    const { panelState = {} } = await browser.storage.local.get("panelState");
    ui.root.classList.toggle("htbr-collapsed", !!panelState.collapsed);
    if (panelState.left != null) placePanel(panelState.left, panelState.top);
  }

  async function setCollapsed(collapsed) {
    ui.root.classList.toggle("htbr-collapsed", collapsed);
    const { panelState = {} } = await browser.storage.local.get("panelState");
    await browser.storage.local.set({ panelState: { ...panelState, collapsed } });
  }

  function placePanel(left, top) {
    const w = ui.panel.offsetWidth || 260;
    const h = ui.panel.offsetHeight || 200;
    left = Math.max(4, Math.min(left, window.innerWidth - w - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - h - 4));
    ui.root.style.left = `${left}px`;
    ui.root.style.top = `${top}px`;
    ui.root.style.right = "auto";
    ui.root.style.bottom = "auto";
  }

  function makeDraggable(handle) {
    let start = null;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      const r = ui.root.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (start) placePanel(start.left + e.clientX - start.x, start.top + e.clientY - start.y);
    });
    handle.addEventListener("pointerup", async () => {
      if (!start) return;
      start = null;
      const r = ui.root.getBoundingClientRect();
      const { panelState = {} } = await browser.storage.local.get("panelState");
      await browser.storage.local.set({ panelState: { ...panelState, left: r.left, top: r.top } });
    });
  }

  function statusText() {
    if (note) return note;
    if (exporting) return "Saving audio... this takes a while for long sections.";
    if (serverOk === false) return "Voice server is off. Run start.bat (or start.sh) to turn it on.";
    if (state && state.forThisTab !== false && state.source === "selection" && ACTIVE.includes(state.status)) {
      return state.status === "paused" ? "Paused (selected text)" : "Reading selected text";
    }
    if (isMine(state)) {
      if (state.status === "loading") return "Preparing voice...";
      if (state.status === "playing") return "Reading";
      if (state.status === "paused") return "Paused";
      if (state.status === "finished") return "Section finished.";
      if (state.status === "error") return state.error;
    }
    if (!blocks.length) return "Waiting for lesson text...";
    if (savedPosition != null) return `Press play to resume at paragraph ${savedPosition + 1}.`;
    return `Ready: ${blocks.length} paragraphs.`;
  }

  function render() {
    if (!ui.root) return;
    ui.root.hidden = !settings.showPanel || (!blocks.length && !isMine(state));
    const playing = (isMine(state) || state?.source === "selection") && (state.status === "playing" || state.status === "loading");
    ui.play.replaceChildren(svg(playing ? ICONS.pause : ICONS.play, 26));
    ui.root.classList.toggle("htbr-playing", playing);
    ui.status.textContent = statusText();
    ui.status.classList.toggle("htbr-error", (isMine(state) && state.status === "error") || serverOk === false);
    ui.dot.className = `htbr-dot ${serverOk === true ? "htbr-ok" : serverOk === false ? "htbr-bad" : ""}`;
    ui.dot.title = serverOk === true ? "Voice server running" : serverOk === false ? "Voice server not running" : "Checking voice server...";
    ui.speed.textContent = `${Number(settings.speed).toFixed(1)}×`;
    const showIndex = isMine(state) && ACTIVE.includes(state.status);
    ui.progress.textContent = blocks.length ? `${showIndex ? state.index + 1 : savedPosition != null ? savedPosition + 1 : 0} / ${blocks.length}` : "";
    ui.resume.hidden = !(savedPosition != null || showIndex);
    ui.exportBtn.disabled = exporting || !blocks.length;
  }

  async function onExport() {
    if (exporting || !blocks.length) return;
    exporting = true;
    note = "";
    render();
    const result = await send({ type: "export", title: pageTitle(), items: blocks.map((b) => ({ text: b.text })) });
    exporting = false;
    note = result?.ok ? "Audio saved." : `Couldn't save audio: ${result?.error || "unknown error"}`;
    render();
    setTimeout(() => {
      note = "";
      render();
    }, 6000);
  }

  // ---------- hover "read from here" button ----------

  function setupHover() {
    document.addEventListener(
      "mouseover",
      (e) => {
        if (!settings.showPanel || !blocks.length || e.target.closest?.("#htbr-root")) return;
        const i = blockFor(e.target);
        if (i < 0) return;
        const r = blocks[i].el.getBoundingClientRect();
        const left = r.left > 40 ? r.left - 32 : r.left + 4;
        ui.hoverPlay.style.left = `${left}px`;
        ui.hoverPlay.style.top = `${Math.max(4, r.top + 2)}px`;
        ui.hoverPlay.dataset.index = String(i);
        ui.hoverPlay.classList.add("htbr-show");
      },
      { passive: true }
    );
    document.addEventListener("scroll", () => ui.hoverPlay?.classList.remove("htbr-show"), { passive: true, capture: true });
    document.addEventListener("contextmenu", (e) => (lastContextTarget = e.target), { capture: true });
  }

  // ---------- page changes (HTB is a single-page app) ----------

  async function refresh(force = false) {
    if (location.pathname !== pageKey) {
      const oldKey = pageKey;
      pageKey = location.pathname;
      note = "";
      highlight(-1);
      const { autoStart } = await browser.storage.local.get("autoStart");
      if (!autoStart) send({ type: "pageLeft", pageKey: oldKey });
      force = true;
    }
    const playingHere = isMine(state) && ACTIVE.includes(state.status);
    if (!force && playingHere && rootEl?.isConnected) return; // don't reshuffle paragraphs mid-read
    const list = extract();
    const changed = list.length !== blocks.length || list.some((b, i) => b.el !== blocks[i]?.el);
    if (!changed && !force) return;
    setBlocks(list);
    await loadPosition();
    if (!(await checkAutoStart()) && isMine(state)) highlight(ACTIVE.includes(state.status) ? state.index : -1);
    render();
  }

  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(), 800);
  }

  // ---------- messages from the background page ----------

  function onState(s) {
    state = s;
    const mine = isMine(s);
    highlight(mine && ACTIVE.includes(s.status) ? s.index : -1);
    if (mine && ACTIVE.includes(s.status) && settings.resume) {
      savedPosition = s.index > 0 ? s.index : null;
      savePosition(s.index);
    }
    if (mine && s.status === "finished") {
      clearPosition();
      if (settings.autoAdvance) goToNextSection();
    }
    if (mine && s.status === "error") checkServer();
    else if (mine && s.status === "playing") serverOk = true;
    render();
  }

  browser.runtime.onMessage.addListener((msg) => {
    if (msg.type === "state") onState({ ...msg.state, forThisTab: true });
    else if (msg.type === "startReading") startOrResume();
    else if (msg.type === "readFromHere") {
      if (!blocks.length) refresh(true);
      const target = lastContextTarget || document.body;
      const i = blockFor(target);
      startAt(i >= 0 ? i : blockBelow(target));
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const old = settings;
    settings = { ...HTBSettings.DEFAULT_SETTINGS, ...changes.settings.newValue };
    if (old.codeMode !== settings.codeMode || old.tableMode !== settings.tableMode) refresh(true);
    render();
  });

  async function checkServer() {
    const h = await send({ type: "health" });
    serverOk = !!(h && h.reachable);
    render();
  }

  // ---------- start ----------

  async function init() {
    settings = await HTBSettings.getSettings();
    buildPanel();
    setupHover();
    setBlocks(extract());
    await loadPosition();
    const s = await send({ type: "getState" });
    if (s) {
      state = s;
      // A full page load while the previous section was still playing.
      if (s.forThisTab && s.source === "page" && s.pageKey !== pageKey && ACTIVE.includes(s.status)) {
        const { autoStart } = await browser.storage.local.get("autoStart");
        if (!autoStart) send({ type: "pageLeft", pageKey: s.pageKey });
      } else if (isMine(s)) {
        highlight(ACTIVE.includes(s.status) ? s.index : -1);
      }
    }
    await checkAutoStart();
    render();
    checkServer();
    setInterval(() => {
      if (serverOk !== true && !(isMine(state) && ACTIVE.includes(state.status))) checkServer();
    }, 15000);

    new MutationObserver((mutations) => {
      if (mutations.every((m) => m.target.closest?.("#htbr-root") || m.target.id === "htbr-root")) return;
      scheduleRefresh();
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", () => {
      const r = ui.root.getBoundingClientRect();
      if (ui.root.style.left) placePanel(r.left, r.top);
    });
  }

  // For debugging from the browser console (content-script scope).
  window.__htbReader = { blocks: () => blocks.map((b) => ({ kind: b.kind, text: b.text })) };

  init();
})();
