"use strict";

const chatEl = document.getElementById("chat");
const welcomeEl = document.getElementById("welcome");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const resetBtn = document.getElementById("reset");
const template = document.getElementById("tpl-message");

let sessionId = newSessionId();
let busy = false;

function newSessionId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // crypto.randomUUID solo existe en contextos seguros; alternativa para http en red local
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

fetch("/api/info")
  .then((r) => r.json())
  .then((info) => { document.getElementById("model").textContent = info.model; })
  .catch(() => { document.getElementById("model").textContent = "modelo desconocido"; });

/* ---------- Markdown mínimo y seguro (se escapa todo antes de dar formato) ---------- */

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
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const NUMERIC = /^[-+]?[$€]?\s?[\d.,]+\s?(%|€|\$)?$/;

function splitRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function renderTable(lines) {
  const head = splitRow(lines[0]);
  const rows = lines.slice(2).map(splitRow);
  const numCols = head.map((_, i) => rows.length > 0 && rows.every((r) => !r[i] || NUMERIC.test(r[i])));
  const cls = (i) => (numCols[i] ? ' class="num"' : "");
  const th = head.map((c, i) => `<th${cls(i)}>${inline(c)}</th>`).join("");
  const body = rows
    .map((r) => `<tr>${head.map((_, i) => `<td${cls(i)}>${inline(r[i] || "")}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderMarkdown(src) {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) tbl.push(lines[i++]);
      out.push(renderTable(tbl));
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""))}</li>`);
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(q.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*+]|\d+[.)])\s|>|\s*\|)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (para.length === 0) para.push(lines[i++]);
    out.push(`<p>${para.map(inline).join("<br>")}</p>`);
  }
  return out.join("");
}

/* ---------- Interfaz ---------- */

function addMessage(role) {
  welcomeEl.hidden = true;
  const node = template.content.firstElementChild.cloneNode(true);
  node.classList.add(role);
  chatEl.appendChild(node);
  return {
    node,
    content: node.querySelector(".content"),
    tools: node.querySelector(".tools"),
  };
}

function scrollToBottom(force = false) {
  const nearBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 120;
  if (force || nearBottom) chatEl.scrollTop = chatEl.scrollHeight;
}

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
  sendBtn.textContent = value ? "Pensando…" : "Enviar";
}

function addToolCall(container, sql) {
  const details = document.createElement("details");
  details.className = "tool";
  details.innerHTML = '<summary>Consulta SQL <span class="status"></span></summary><pre></pre>';
  details.querySelector("pre").textContent = sql;
  container.appendChild(details);
  return details;
}

async function ask(question) {
  if (busy) return;
  setBusy(true);

  const user = addMessage("user");
  user.content.textContent = question;

  const bot = addMessage("assistant");
  bot.content.classList.add("typing");
  scrollToBottom(true);

  let text = "";
  const toolNodes = new Map();
  let renderPending = false;
  const render = () => {
    renderPending = false;
    bot.content.innerHTML = renderMarkdown(text);
    scrollToBottom();
  };

  const handle = (ev) => {
    if (ev.type === "delta") {
      text += ev.text;
      if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(render);
      }
    } else if (ev.type === "tool") {
      toolNodes.set(ev.id, addToolCall(bot.tools, ev.sql));
      scrollToBottom();
    } else if (ev.type === "tool_done") {
      toolNodes.get(ev.id)?.classList.add(ev.success ? "ok" : "fail");
    } else if (ev.type === "error") {
      const shown = [...bot.node.querySelectorAll(".error")].map((e) => e.dataset.msg);
      if (shown.includes(ev.message)) return; // el SDK puede notificar el mismo error dos veces
      const p = document.createElement("p");
      p.dataset.msg = ev.message;
      p.className = "error";
      p.textContent = `⚠️ ${ev.message}`;
      bot.node.querySelector(".bubble").appendChild(p);
    }
  };

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message: question }),
    });
    if (!res.ok || !res.body) {
      let detail = `${res.status} ${res.statusText}`;
      try { detail = (await res.json()).detail ?? detail; } catch { /* respuesta sin JSON */ }
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = chunk
          .split("\n")
          .filter((l) => l.startsWith("data:"))
          .map((l) => l.slice(5).trimStart())
          .join("\n");
        if (data) handle(JSON.parse(data));
      }
    }
  } catch (err) {
    handle({ type: "error", message: err.message || String(err) });
  } finally {
    render();
    bot.content.classList.remove("typing");
    if (!text && !bot.node.querySelector(".error")) {
      bot.content.innerHTML = '<p class="error">No se recibió respuesta.</p>';
    }
    setBusy(false);
    input.focus();
  }
}

function autoGrow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q || busy) return;
  input.value = "";
  autoGrow();
  ask(q);
});

input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll(".suggestion").forEach((btn) =>
  btn.addEventListener("click", () => ask(btn.textContent.trim()))
);

resetBtn.addEventListener("click", async () => {
  if (busy) return;
  const old = sessionId;
  sessionId = newSessionId();
  chatEl.querySelectorAll(".message").forEach((m) => m.remove());
  welcomeEl.hidden = false;
  input.focus();
  try {
    await fetch("/api/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: old }),
    });
  } catch { /* no es crítico */ }
});

input.focus();
