const MENU_SELECTION_ID = "ask-chatgpt-sidepanel";
const MENU_IMAGE_ID = "ask-chatgpt-image";

const PROXY_TEXT_URL = "http://localhost:8787/ask";
const PROXY_IMAGE_URL = "http://localhost:8787/ask-image";

const THREAD_KEY = "globalThreadV1";
const LAST_SELECTION_KEY = "lastSelectionV1";
const STATUS_KEY = "globalStatusV1";

const FETCH_TIMEOUT_MS = 30000;

let inFlight = false;
let queue = []; // { kind: "text"|"image", payload: {text}|{url} }

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_SELECTION_ID,
    title: 'Ask ChatGPT (Side Panel): "%s"',
    contexts: ["selection"]
  });

  chrome.contextMenus.create({
    id: MENU_IMAGE_ID,
    title: "Ask ChatGPT about this image",
    contexts: ["image"]
  });
});

function openPanel(tabId) {
  chrome.sidePanel.setOptions({ tabId, path: "panel.html", enabled: true }, () => {
    if (chrome.runtime.lastError) {
      console.warn("sidePanel.setOptions error:", chrome.runtime.lastError.message);
    }

    chrome.sidePanel.open({ tabId }, () => {
      if (chrome.runtime.lastError) {
        console.warn("sidePanel.open error:", chrome.runtime.lastError.message);
      }
    });
  });
}

function nowTs() {
  return Date.now();
}

function makeId() {
  return `${nowTs()}-${Math.random().toString(16).slice(2)}`;
}

async function getThread() {
  const data = await chrome.storage.local.get(THREAD_KEY);
  const thread = data?.[THREAD_KEY];
  return Array.isArray(thread) ? thread : [];
}

async function setThread(thread) {
  await chrome.storage.local.set({ [THREAD_KEY]: thread });
  broadcast({ type: "THREAD_UPDATED", thread });
}

async function setStatus(text, kind = "") {
  const status = { text: text || "", kind: kind || "", at: nowTs() };
  await chrome.storage.local.set({ [STATUS_KEY]: status });
  broadcast({ type: "STATUS_UPDATED", status });
}

function broadcast(message) {
  // Any open panel(s) will receive this
  chrome.runtime.sendMessage(message).catch(() => {
    // No listeners (panel closed) is fine
  });
}

async function appendMessage(msg) {
  const thread = await getThread();
  thread.push(msg);
  await setThread(thread);
}

async function clearThread() {
  await chrome.storage.local.set({ [THREAD_KEY]: [] });
  await setStatus("", "");
  broadcast({ type: "THREAD_CLEARED" });
  broadcast({ type: "THREAD_UPDATED", thread: [] });
}

function abortableTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return { controller, timer };
}

async function safeJson(resp) {
  try {
    return await resp.json();
  } catch {
    return {};
  }
}

async function callTextProxy(text) {
  const { controller, timer } = abortableTimeout();
  try {
    const resp = await fetch(PROXY_TEXT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal
    });

    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
    return data?.answer || "No answer.";
  } finally {
    clearTimeout(timer);
  }
}

async function callImageProxy(url) {
  const { controller, timer } = abortableTimeout();
  try {
    const resp = await fetch(PROXY_IMAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal
    });

    const data = await safeJson(resp);
    if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
    return data?.answer || "No answer.";
  } finally {
    clearTimeout(timer);
  }
}

async function enqueue(kind, payload) {
  queue.push({ kind, payload });
  pumpQueue().catch((e) => console.warn("pumpQueue error:", e));
}

async function pumpQueue() {
  if (inFlight) return;
  const job = queue.shift();
  if (!job) return;

  inFlight = true;

  try {
    await setStatus(job.kind === "image" ? "Analyzing image…" : "Sending…", "");

    let answer = "";
    if (job.kind === "text") {
      answer = await callTextProxy(job.payload.text);
    } else {
      answer = await callImageProxy(job.payload.url);
    }

    await appendMessage({
      id: makeId(),
      role: "bot",
      text: answer,
      ts: nowTs()
    });

    await setStatus("Done.", "ok");
  } catch (e) {
    const msg = String(e?.message || e);
    await appendMessage({
      id: makeId(),
      role: "bot",
      text: `Error: ${msg}`,
      ts: nowTs()
    });
    await setStatus(msg, "error");
  } finally {
    inFlight = false;
    // Continue if more queued
    if (queue.length) pumpQueue().catch(() => {});
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const tabId = tab?.id;
  if (!tabId) {
    console.warn("No tabId on context menu click", { info, tab });
    return;
  }

  // ----- TEXT SELECTION -----
  if (info.menuItemId === MENU_SELECTION_ID) {
    const selected = (info.selectionText || "").trim();
    if (!selected) return;

    // Save "last selection" globally for optional includeSelection feature.
    chrome.storage.local.set({
      [LAST_SELECTION_KEY]: { text: selected, at: nowTs() }
    });

    // Add user message to global thread and enqueue request.
    appendMessage({ id: makeId(), role: "user", text: selected, ts: nowTs() })
      .then(() => enqueue("text", { text: selected }))
      .catch((e) => console.warn("selection flow error:", e));

    openPanel(tabId);
    return;
  }

  // ----- IMAGE -----
  if (info.menuItemId === MENU_IMAGE_ID) {
    const imageUrl = (info.srcUrl || "").trim();
    if (!imageUrl) {
      console.warn("No srcUrl for image click", info);
      return;
    }

    const display = `Analyze this image:\n${imageUrl}`;

    appendMessage({ id: makeId(), role: "user", text: display, ts: nowTs() })
      .then(() => enqueue("image", { url: imageUrl }))
      .catch((e) => console.warn("image flow error:", e));

    openPanel(tabId);
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Panel boot: get global state
  if (msg?.type === "GET_GLOBAL_STATE") {
    Promise.all([
      chrome.storage.local.get([THREAD_KEY, STATUS_KEY, LAST_SELECTION_KEY])
    ])
      .then(([data]) => {
        sendResponse({
          thread: Array.isArray(data?.[THREAD_KEY]) ? data[THREAD_KEY] : [],
          status: data?.[STATUS_KEY] || { text: "", kind: "", at: 0 },
          lastSelection: data?.[LAST_SELECTION_KEY] || null
        });
      })
      .catch(() => {
        sendResponse({
          thread: [],
          status: { text: "", kind: "", at: 0 },
          lastSelection: null
        });
      });

    return true;
  }

  // Panel sends a text prompt
  if (msg?.type === "USER_TEXT") {
    const text = (msg?.text || "").trim();
    if (!text) {
      sendResponse({ ok: false, error: "Empty text" });
      return;
    }

    appendMessage({ id: makeId(), role: "user", text, ts: nowTs() })
      .then(() => enqueue("text", { text }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));

    return true;
  }

  // Panel sends an image URL
  if (msg?.type === "USER_IMAGE") {
    const url = (msg?.url || "").trim();
    if (!url) {
      sendResponse({ ok: false, error: "Empty url" });
      return;
    }

    const display = `Analyze this image:\n${url}`;

    appendMessage({ id: makeId(), role: "user", text: display, ts: nowTs() })
      .then(() => enqueue("image", { url }))
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));

    return true;
  }

  // Clear global thread
  if (msg?.type === "CLEAR_THREAD") {
    clearThread()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
    return true;
  }
});