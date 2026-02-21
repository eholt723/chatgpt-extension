const threadEl = document.getElementById("thread");
const inputEl = document.getElementById("input");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const statusEl = document.getElementById("status");
const includeSelectionEl = document.getElementById("includeSelection");

let inFlight = false;
let lastSelection = null;
let threadCache = [];

function setStatus(text, kind = "") {
  statusEl.textContent = text || "";
  statusEl.className = "status" + (kind ? ` ${kind}` : "");
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return new Date().toLocaleTimeString();
  }
}

function renderThread(thread) {
  threadEl.innerHTML = "";
  for (const msg of thread) {
    const div = document.createElement("div");
    div.className = `msg ${msg.role}`;

    const textNode = document.createElement("div");
    textNode.className = "text";
    textNode.textContent = msg.text || "";
    div.appendChild(textNode);

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatTime(msg.ts || Date.now());
    div.appendChild(meta);

    threadEl.appendChild(div);
  }
  threadEl.scrollTop = threadEl.scrollHeight;
}

async function loadGlobalState() {
  const data = await chrome.runtime.sendMessage({ type: "GET_GLOBAL_STATE" });
  threadCache = Array.isArray(data?.thread) ? data.thread : [];
  lastSelection = data?.lastSelection || null;

  renderThread(threadCache);

  const st = data?.status || { text: "", kind: "" };
  setStatus(st.text || "", st.kind || "");
}

async function buildPromptFromInput() {
  const userText = inputEl.value.trim();
  if (!userText) return "";

  if (!includeSelectionEl.checked) return userText;

  const sel = lastSelection?.text?.trim();
  if (!sel) return userText;

  return `Selected text:\n${sel}\n\nQuestion:\n${userText}`;
}

async function sendUserText(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return;

  if (inFlight) return;
  inFlight = true;
  sendBtn.disabled = true;
  setStatus("Sending…");

  try {
    const res = await chrome.runtime.sendMessage({ type: "USER_TEXT", text: trimmed });
    if (!res?.ok) throw new Error(res?.error || "Send failed");
  } catch (e) {
    setStatus(String(e?.message || e), "error");
  } finally {
    inFlight = false;
    sendBtn.disabled = false;
  }
}

async function clearChat() {
  const ok = confirm("Clear the entire chat?");
  if (!ok) return;

  clearBtn.disabled = true;
  setStatus("Clearing…");

  try {
    const res = await chrome.runtime.sendMessage({ type: "CLEAR_THREAD" });
    if (!res?.ok) throw new Error(res?.error || "Clear failed");
    setStatus("Cleared.", "ok");
  } catch (e) {
    setStatus(String(e?.message || e), "error");
  } finally {
    clearBtn.disabled = false;
  }
}

sendBtn.addEventListener("click", async () => {
  const prompt = await buildPromptFromInput();
  if (!prompt) return;
  inputEl.value = "";
  await sendUserText(prompt);
});

inputEl.addEventListener("keydown", async (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const prompt = await buildPromptFromInput();
    if (!prompt) return;
    inputEl.value = "";
    await sendUserText(prompt);
  }
});

clearBtn.addEventListener("click", clearChat);

// Listen for background broadcasts
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "THREAD_UPDATED" && Array.isArray(msg.thread)) {
    threadCache = msg.thread;
    renderThread(threadCache);
  }

  if (msg?.type === "STATUS_UPDATED" && msg.status) {
    setStatus(msg.status.text || "", msg.status.kind || "");
  }

  if (msg?.type === "THREAD_CLEARED") {
    threadCache = [];
    renderThread(threadCache);
    setStatus("", "");
  }
});

// Boot
loadGlobalState();