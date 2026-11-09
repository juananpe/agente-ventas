"use strict";

const chatEl = document.getElementById("chat");
const welcomeEl = document.getElementById("welcome");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const resetBtn = document.getElementById("reset");
const modelEl = document.getElementById("model");

// La conversación vive solo mientras la página está abierta: al recargar empieza una nueva.
let sessionId = null;
let busy = false;
let controller = null;

function saveSession(id) {
  sessionId = id;
}

fetch("/api/health")
  .then((r) => r.json())
  .then((d) => { if (d.model) modelEl.textContent = `Modelo: ${d.model}`; })
  .catch(() => {});

/* ---------- Markdown mínimo y seguro (todo se escapa antes de dar formato) ---------- */

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function inline(text) {
  const codes = [];
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~(.+?)~~/g, "<del>$1</del>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

const isTableSep = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let para = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    // Bloque de código
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      flushPara();
      const body = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    // Tabla
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushPara();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""
      );
      const style = (k) => (aligns[k] ? ` style="text-align:${aligns[k]}"` : "");
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(splitRow(lines[i++]));
      out.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((h, k) => `<th${style(k)}>${inline(h)}</th>`).join("")}</tr></thead>` +
          `<tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td${style(k)}>${inline(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      );
      continue;
    }

    // Encabezado
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = Math.min(h[1].length + 1, 4);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Separador
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara();
      out.push("<hr>");
      i++;
      continue;
    }

    // Listas
    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
        if (m && /\d/.test(m[1]) === ordered) { items.push(m[2]); i++; }
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) { items[items.length - 1] += " " + lines[i].trim(); i++; }
        else break;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (!line.trim()) { flushPara(); i++; continue; }
    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

/* ---------- Interfaz ---------- */

function scrollToBottom(force = false) {
  const nearBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
  if (force || nearBottom) chatEl.scrollTop = chatEl.scrollHeight;
}

function addUserMessage(text) {
  welcomeEl.hidden = true;
  const msg = document.createElement("div");
  msg.className = "msg user";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  msg.append(bubble);
  chatEl.append(msg);
  scrollToBottom(true);
}

/** Crea la burbuja del asistente y devuelve funciones para ir rellenándola. */
function createAssistantMessage() {
  const msg = document.createElement("div");
  msg.className = "msg assistant";
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  const thinking = document.createElement("div");
  thinking.className = "thinking";
  thinking.innerHTML = '<span class="spinner"></span> Pensando…';
  bubble.append(thinking);
  msg.append(bubble);
  chatEl.append(msg);
  scrollToBottom(true);

  let textEl = null;
  let textBuf = "";
  let renderPending = false;
  const tools = new Map();

  const clearThinking = () => thinking.remove();

  const render = () => {
    renderPending = false;
    if (textEl) textEl.innerHTML = renderMarkdown(textBuf);
    scrollToBottom();
  };

  return {
    appendText(t) {
      clearThinking();
      if (!textEl) {
        textEl = document.createElement("div");
        textEl.className = "md";
        textBuf = "";
        bubble.append(textEl);
      }
      textBuf += t;
      if (!renderPending) { renderPending = true; requestAnimationFrame(render); }
    },
    toolStart({ id, sql }) {
      clearThinking();
      if (textEl) render();
      textEl = null; // el texto posterior va en un bloque nuevo, debajo de la consulta
      const d = document.createElement("details");
      d.className = "tool";
      const summary = document.createElement("summary");
      summary.innerHTML = '<span class="spinner"></span> <span>Consultando la base de datos…</span><span class="status"></span>';
      const pre = document.createElement("pre");
      pre.textContent = sql || "(sin SQL)";
      d.append(summary, pre);
      bubble.append(d);
      tools.set(id, d);
      scrollToBottom();
    },
    toolEnd({ id, ok, count, truncated, error }) {
      const d = tools.get(id);
      if (!d) return;
      d.querySelector(".spinner")?.remove();
      d.querySelector("summary span").textContent = "Consulta SQL";
      d.classList.add(ok ? "ok" : "err");
      const status = d.querySelector(".status");
      if (ok) {
        status.textContent = typeof count === "number"
          ? `${count}${truncated ? "+" : ""} fila${count === 1 ? "" : "s"}`
          : "✓";
      } else {
        status.textContent = "Error";
        const e = document.createElement("div");
        e.className = "tool-error";
        e.textContent = error || "Error";
        d.append(e);
      }
    },
    error(message) {
      clearThinking();
      const e = document.createElement("div");
      e.className = "error-note";
      e.textContent = `⚠️ ${message}`;
      bubble.append(e);
      scrollToBottom();
    },
    finish() {
      clearThinking();
      if (textEl) render();
      if (!bubble.querySelector(".md, .tool, .error-note")) this.error("El agente no devolvió respuesta.");
    },
  };
}

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
  sendBtn.textContent = value ? "…" : "Enviar";
}

/** Lee un stream SSE de una respuesta fetch y llama a onEvent(nombre, datos). */
async function readSSE(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = "message";
      const data = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
      }
      if (data.length) onEvent(event, JSON.parse(data.join("\n")));
    }
  }
}

async function send(text) {
  if (busy || !text.trim()) return;
  setBusy(true);
  addUserMessage(text);
  const ui = createAssistantMessage();
  controller = new AbortController();
  let gotDone = false;

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, session_id: sessionId }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = `Error ${res.status}`;
      try { const j = await res.json(); if (j.detail) detail = typeof j.detail === "string" ? j.detail : detail; } catch {}
      throw new Error(detail);
    }
    await readSSE(res, (event, data) => {
      switch (event) {
        case "session": saveSession(data.session_id); break;
        case "delta": ui.appendText(data.text); break;
        case "tool_start": ui.toolStart(data); break;
        case "tool_end": ui.toolEnd(data); break;
        case "error": ui.error(data.message); gotDone = true; break;
        case "done": gotDone = true; break;
      }
    });
    if (!gotDone) ui.error("La respuesta se interrumpió.");
    ui.finish();
  } catch (err) {
    if (err.name !== "AbortError") ui.error(err.message || "No se pudo contactar con el servidor.");
    ui.finish();
  } finally {
    controller = null;
    setBusy(false);
    input.focus();
  }
}

/* ---------- Eventos ---------- */

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";
  autosize();
  send(text);
});

input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll(".chip").forEach((chip) =>
  chip.addEventListener("click", () => send(chip.textContent))
);

resetBtn.addEventListener("click", async () => {
  controller?.abort();
  const old = sessionId;
  saveSession(null);
  chatEl.querySelectorAll(".msg").forEach((m) => m.remove());
  welcomeEl.hidden = false;
  input.focus();
  if (old) {
    fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: old }),
    }).catch(() => {});
  }
});

input.focus();
