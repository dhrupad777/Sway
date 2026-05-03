import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { recentSessions, bySession, summary, record, newSessionId, pairs } from "./metrics.js";
import { complete, type Message } from "./providers.js";
import { costUsd, DEFAULTS } from "./pricing.js";
import { optimize } from "./optimizer.js";
import { classify } from "./router.js";
import { loadContext } from "./context.js";

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sway · Cost-aware LLM gateway</title>
<style>
  /* ===== Design tokens ===== */
  :root {
    --bg: #fafafa;
    --surface: #ffffff;
    --surface-2: #f5f5f7;
    --ink: #1d1d1f;
    --ink-2: #6e6e73;
    --ink-3: #86868b;
    --line: rgba(0,0,0,0.08);
    --blue: #1a56ff;
    --blue-hover: #0040e6;
    --blue-soft: rgba(26,86,255,0.08);
    --blue-border: rgba(26,86,255,0.18);
    --raw: #d72c2c;
    --raw-soft: rgba(215,44,44,0.06);
    --sway: #28a745;
    --sway-soft: rgba(40,167,69,0.08);
    --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
    --shadow-md: 0 1px 3px rgba(0,0,0,0.05), 0 8px 24px rgba(0,0,0,0.04);
    --shadow-lg: 0 2px 8px rgba(0,0,0,0.08), 0 16px 40px rgba(0,0,0,0.06);
    --radius: 14px;
    --radius-sm: 10px;
    --radius-pill: 999px;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
    animation: fade-in 200ms ease both;
  }
  @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes fade-up {
    from { opacity: 0; transform: translateY(12px) }
    to   { opacity: 1; transform: translateY(0) }
  }
  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.85); }
    40% { opacity: 1; transform: scale(1); }
  }

  /* ===== Top bar ===== */
  header {
    flex-shrink: 0;
    padding: 14px 32px;
    background: var(--surface);
    border-bottom: 1px solid var(--line);
    display: flex; align-items: center; justify-content: space-between;
    gap: 24px;
  }
  .logo { font-size: 19px; font-weight: 600; letter-spacing: -0.025em; color: var(--ink); }
  .logo .accent { color: var(--blue); }
  .tabs { display: flex; gap: 4px; }
  .tabs button {
    background: transparent; color: var(--ink-2);
    border: 0; padding: 7px 16px;
    font-size: 13px; font-weight: 500;
    border-radius: var(--radius-pill);
    cursor: pointer; font-family: inherit;
    transition: background 150ms ease, color 150ms ease;
  }
  .tabs button:hover { background: var(--surface-2); }
  .tabs button.active { background: var(--blue-soft); color: var(--blue); }
  .status {
    display: flex; align-items: center; gap: 8px;
    font-size: 12px; color: var(--ink-2);
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
  }
  .status .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--sway);
    box-shadow: 0 0 0 3px rgba(40,167,69,0.18);
  }

  main { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .view { display: none; flex: 1; min-height: 0; padding: 28px 32px 0; flex-direction: column; }
  .view.active { display: flex; }

  /* ===== Page intro ===== */
  .eyebrow {
    font-size: 11px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--blue);
    display: flex; align-items: center; gap: 8px;
    margin-bottom: 10px;
    flex-shrink: 0;
  }
  .eyebrow .sep { color: var(--ink-3); font-weight: 400; }
  .h1 {
    font-size: 30px; font-weight: 600;
    letter-spacing: -0.025em;
    margin: 0 0 6px;
    color: var(--ink);
    flex-shrink: 0;
  }
  .h1 .muted { color: var(--ink-2); }
  .h2-sub {
    font-size: 14px; color: var(--ink-2);
    margin: 0 0 22px;
    max-width: 720px;
    flex-shrink: 0;
  }

  /* ===== Bento hero ===== */
  .bento {
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 14px;
    margin-bottom: 18px;
    animation: fade-up 350ms ease both;
    flex-shrink: 0;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .card:hover { transform: translateY(-1px); box-shadow: var(--shadow-lg); }

  .card-savings { padding: 22px 26px; }
  .card-savings .label {
    font-size: 11px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--ink-2);
    margin-bottom: 6px;
  }
  .card-savings .value-row { display: flex; align-items: baseline; gap: 6px; }
  .card-savings .value {
    font-size: 56px; font-weight: 600;
    letter-spacing: -0.03em;
    color: var(--blue);
    line-height: 1;
  }
  .card-savings .value-suffix {
    font-size: 22px; color: var(--ink);
    font-weight: 500; letter-spacing: -0.01em;
  }
  .card-savings .meta {
    margin-top: 14px;
    padding-top: 14px;
    border-top: 1px solid var(--line);
    display: flex; gap: 24px; flex-wrap: wrap;
    font-size: 12.5px; color: var(--ink-2);
  }
  .card-savings .meta b { color: var(--ink); font-weight: 600; }

  .card-latest {
    padding: 20px 22px;
    background: linear-gradient(155deg, #1d1d1f 0%, #0a0a0a 100%);
    color: #fff;
    position: relative; overflow: hidden;
    border-color: rgba(255,255,255,0.08);
  }
  .card-latest::after {
    content: '';
    position: absolute; right: -50px; top: -50px;
    width: 180px; height: 180px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255,69,69,0.18) 0%, transparent 70%);
    pointer-events: none;
  }
  .card-latest .label {
    display: flex; align-items: center; gap: 8px;
    font-size: 11px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
    color: #ff6b6b;
    margin-bottom: 14px;
  }
  .card-latest .label .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #ff6b6b;
    box-shadow: 0 0 0 3px rgba(255,107,107,0.25);
    animation: pulse 1.6s ease-in-out infinite;
  }
  .card-latest .row {
    display: flex; align-items: baseline; justify-content: space-between;
    padding: 5px 0; font-size: 12.5px;
  }
  .card-latest .row .k { color: #a1a1a6; }
  .card-latest .row .v {
    color: #fff;
    font-family: ui-monospace, "SF Mono", monospace;
    font-weight: 500; font-size: 13px;
  }
  .card-latest .savings-tag {
    margin-top: 12px;
    display: inline-flex; align-items: center; gap: 6px;
    padding: 6px 12px;
    background: rgba(40,167,69,0.18);
    color: #5fd57b;
    border: 1px solid rgba(40,167,69,0.32);
    border-radius: var(--radius-pill);
    font-size: 11.5px; font-weight: 600;
    font-family: ui-monospace, monospace;
  }

  /* ===== Timeline (paired turn blocks) ===== */
  .timeline {
    flex: 1; min-height: 0;
    overflow-y: auto;
    margin-bottom: 14px;
    padding-right: 4px;
    scroll-behavior: smooth;
  }
  .timeline-empty {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-sm);
    padding: 22px 24px;
    color: var(--ink-2);
    font-size: 13.5px;
    line-height: 1.6;
  }
  .timeline-empty b { color: var(--ink); font-weight: 600; }

  .turn {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    padding: 18px 20px;
    margin-bottom: 14px;
    animation: fade-up 320ms ease both;
    transition: box-shadow 120ms ease;
  }
  .turn:hover { box-shadow: var(--shadow-lg); }
  .turn-prompt {
    font-size: 13.5px; font-weight: 500;
    margin-bottom: 14px;
    padding: 11px 14px;
    background: var(--blue-soft);
    border-left: 3px solid var(--blue);
    border-radius: 8px;
    color: var(--ink);
    white-space: pre-wrap; word-break: break-word;
  }
  .turn-prompt .num {
    display: inline-block;
    margin-right: 8px;
    color: var(--blue); font-weight: 600;
    font-family: ui-monospace, monospace;
    font-size: 12px;
  }
  .turn-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }
  .turn-col {
    background: var(--surface-2);
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    border-top: 3px solid;
    min-width: 0;
  }
  .turn-col.raw  { border-top-color: var(--raw); }
  .turn-col.sway { border-top-color: var(--sway); }
  .turn-col h4 {
    margin: 0 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-weight: 600;
    display: flex; align-items: center; gap: 7px;
  }
  .turn-col h4 .dot { width: 7px; height: 7px; border-radius: 50%; }
  .turn-col.raw  h4 { color: var(--raw); }
  .turn-col.raw  h4 .dot { background: var(--raw); box-shadow: 0 0 0 3px var(--raw-soft); }
  .turn-col.sway h4 { color: var(--sway); }
  .turn-col.sway h4 .dot { background: var(--sway); box-shadow: 0 0 0 3px var(--sway-soft); }
  .turn-col .meta {
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 10.5px; color: var(--ink-2);
    margin-bottom: 8px;
    display: flex; flex-wrap: wrap; gap: 8px 12px;
  }
  .turn-col .meta b { color: var(--ink); font-weight: 600; }
  .turn-col .meta .savings {
    color: #1a7c34; font-weight: 600;
    background: var(--sway-soft);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
  }
  .turn-col .text {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 10px;
    font-size: 13px; line-height: 1.65;
    word-break: break-word;
    color: var(--ink);
  }
  .turn-col.error .text { border-color: var(--raw); background: var(--raw-soft); color: var(--raw); }

  /* Rendered markdown inside .text */
  .text > *:first-child { margin-top: 0; }
  .text > *:last-child { margin-bottom: 0; }
  .text h1, .text h2, .text h3 {
    margin: 14px 0 6px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.3;
  }
  .text h1 { font-size: 17px; }
  .text h2 { font-size: 15.5px; }
  .text h3 { font-size: 14px; color: var(--ink); }
  .text p { margin: 0 0 10px; }
  .text ul, .text ol { margin: 6px 0 10px; padding-left: 22px; }
  .text li { margin-bottom: 4px; }
  .text li::marker { color: var(--blue); }
  .text strong { font-weight: 600; color: var(--ink); }
  .text em { font-style: italic; color: var(--ink); }
  .text code {
    background: rgba(0,0,0,0.05);
    padding: 1.5px 6px;
    border-radius: 4px;
    font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 12px;
    color: #c83d39;
  }
  .text pre {
    background: #1d1d1f;
    color: #f5f5f7;
    border-radius: 8px;
    padding: 12px 14px;
    margin: 10px 0;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.55;
  }
  .text pre code {
    background: transparent;
    padding: 0;
    color: inherit;
    font-size: 12px;
  }
  .text a { color: var(--blue); text-decoration: none; font-weight: 500; }
  .text a:hover { text-decoration: underline; }
  .text blockquote {
    margin: 10px 0;
    padding: 8px 14px;
    border-left: 3px solid var(--line);
    color: var(--ink-2);
    background: var(--surface-2);
    border-radius: 0 6px 6px 0;
  }

  .loading {
    color: var(--ink-2); font-size: 12.5px;
    padding: 11px 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    display: inline-flex; align-items: center; gap: 10px;
  }
  .loading-dots { display: inline-flex; gap: 4px; align-items: center; }
  .loading-dots span {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--blue);
    animation: pulse 1.4s ease-in-out infinite;
  }
  .loading-dots span:nth-child(2) { animation-delay: 0.2s; }
  .loading-dots span:nth-child(3) { animation-delay: 0.4s; }

  /* ===== "What sway did" panel ===== */
  .swaybox {
    margin-bottom: 10px;
    background: var(--blue-soft);
    border: 1px solid var(--blue-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    font-size: 12px;
  }
  .swaybox summary {
    cursor: pointer;
    padding: 9px 14px;
    font-weight: 600; color: var(--blue);
    user-select: none; list-style: none;
    display: flex; align-items: center; gap: 8px;
  }
  .swaybox summary::-webkit-details-marker { display: none; }
  .swaybox summary::before { content: '›'; font-size: 16px; line-height: 1; transition: transform 150ms ease; }
  .swaybox[open] summary::before { transform: rotate(90deg); }
  .swaybox .body { padding: 10px 14px 12px; border-top: 1px solid var(--blue-border); background: rgba(255,255,255,0.55); }
  .swaybox .row { display: grid; grid-template-columns: 100px 1fr; gap: 10px; padding: 4px 0; }
  .swaybox .k { color: var(--ink-2); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; padding-top: 1px; font-weight: 600; }
  .swaybox .v { font-family: ui-monospace, monospace; font-size: 11.5px; word-break: break-word; white-space: pre-wrap; color: var(--ink); }
  .swaybox .v code { background: rgba(0,0,0,0.06); padding: 1px 6px; border-radius: 4px; font-size: 11px; }
  .swaybox .v.highlight { color: var(--blue); font-weight: 600; }

  /* ===== Input row ===== */
  .input-row {
    flex-shrink: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 14px 16px;
    margin-bottom: 22px;
    box-shadow: var(--shadow-md);
  }
  .toggles {
    display: flex; gap: 7px; align-items: center;
    margin-bottom: 11px; font-size: 11.5px;
    flex-wrap: wrap;
  }
  .toggles .label {
    color: var(--ink-2);
    text-transform: uppercase; letter-spacing: 0.08em;
    font-size: 10.5px; font-weight: 600;
    margin-right: 4px;
  }
  .toggle {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 5px 11px;
    border-radius: var(--radius-pill);
    background: var(--surface-2);
    border: 1px solid var(--line);
    color: var(--ink-2);
    cursor: pointer; user-select: none;
    transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    font-weight: 500;
  }
  .toggle:hover { background: var(--surface); border-color: var(--ink-3); }
  .toggle.on { background: var(--blue-soft); border-color: var(--blue-border); color: var(--blue); }
  .toggle.on:hover { background: var(--blue-soft); }
  .toggle .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: 0.55; transition: opacity 150ms ease; }
  .toggle.on .dot { opacity: 1; }
  .toggle.locked { cursor: default; opacity: 0.85; }

  .input-wrap {
    display: flex; align-items: flex-end; gap: 8px;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    padding: 6px 6px 6px 14px;
    transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
  }
  .input-wrap:focus-within {
    border-color: var(--blue);
    background: var(--surface);
    box-shadow: 0 0 0 3px var(--blue-soft);
  }
  .input-wrap textarea {
    flex: 1;
    background: transparent;
    border: 0; outline: none;
    color: var(--ink);
    font: inherit; font-size: 14px;
    resize: none;
    padding: 8px 0;
    line-height: 1.5;
    max-height: 200px;
    font-family: inherit;
  }
  .input-wrap textarea::placeholder { color: var(--ink-3); }
  .send-btn {
    background: var(--blue); color: #fff; border: 0;
    border-radius: 8px;
    width: 34px; height: 34px;
    cursor: pointer;
    font-size: 16px; font-weight: 600;
    display: inline-flex; align-items: center; justify-content: center;
    transition: background 150ms ease, transform 100ms ease;
    flex-shrink: 0;
  }
  .send-btn:hover { background: var(--blue-hover); }
  .send-btn:active { transform: scale(0.94); }
  .send-btn:disabled { background: var(--ink-3); cursor: not-allowed; }

  .hint {
    margin-top: 10px;
    font-size: 11.5px;
    color: var(--ink-2);
    display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap;
  }
  .preset { color: var(--blue); cursor: pointer; font-weight: 500; }
  .preset:hover { text-decoration: underline; }
  .hint kbd {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 10px;
    color: var(--ink-2);
  }

  /* ===== Sessions tab ===== */
  .sessions-grid {
    flex: 1; min-height: 0;
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 14px;
    margin-bottom: 22px;
  }
  .sessions-list {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    padding: 16px;
    overflow-y: auto;
  }
  .sessions-list h2 {
    font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--ink-2);
    margin: 14px 0 10px;
    font-weight: 600;
  }
  .pick-box {
    background: var(--blue-soft);
    border: 1px solid var(--blue-border);
    border-radius: var(--radius-sm);
    padding: 12px;
    font-size: 12px;
  }
  .pick-box label { display: block; color: var(--ink-2); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; font-weight: 600; }
  .pick-box .slot {
    font-family: ui-monospace, monospace; font-size: 11px;
    padding: 6px 9px; background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 6px;
    min-height: 26px;
    display: flex; align-items: center;
  }
  .pick-box .slot.empty { color: var(--ink-3); }
  .pick-box button {
    width: 100%; margin-top: 10px;
    padding: 8px;
    background: var(--blue); color: #fff;
    border: 0; border-radius: 6px;
    font-weight: 600; cursor: pointer;
    font-family: inherit; font-size: 12.5px;
    transition: background 150ms ease;
  }
  .pick-box button:hover:not(:disabled) { background: var(--blue-hover); }
  .pick-box button:disabled { background: var(--ink-3); cursor: not-allowed; }

  .pair-card {
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    margin-bottom: 10px;
    cursor: pointer;
    background: var(--surface);
    transition: border-color 150ms ease, transform 120ms ease, box-shadow 120ms ease, background 150ms ease;
  }
  .pair-card:hover { border-color: var(--blue); transform: translateY(-1px); box-shadow: var(--shadow-sm); }
  .pair-card.selected { border-color: var(--blue); background: var(--blue-soft); box-shadow: var(--shadow-sm); }
  .pair-card .pair-prompt {
    font-size: 13px; font-weight: 500;
    color: var(--ink);
    line-height: 1.45;
    margin-bottom: 10px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
  .pair-card .pair-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    margin-bottom: 10px;
    background: var(--surface-2);
    border-radius: 8px;
    overflow: hidden;
  }
  .pair-card .stat-side {
    padding: 8px 10px;
    display: flex; flex-direction: column;
    gap: 2px;
    border-left: 3px solid;
  }
  .pair-card .stat-side.raw  { border-left-color: var(--raw); }
  .pair-card .stat-side.sway { border-left-color: var(--sway); border-right: 0; }
  .pair-card .stat-side .label {
    font-size: 9.5px; font-weight: 600;
    letter-spacing: 0.1em; text-transform: uppercase;
  }
  .pair-card .stat-side.raw  .label { color: var(--raw); }
  .pair-card .stat-side.sway .label { color: var(--sway); }
  .pair-card .stat-side .cost {
    font-family: ui-monospace, "SF Mono", monospace;
    font-weight: 600; font-size: 12.5px;
    color: var(--ink);
    margin-top: 1px;
  }
  .pair-card .stat-side .tokens {
    font-family: ui-monospace, monospace;
    font-size: 10.5px;
    color: var(--ink-2);
  }
  .pair-card .pair-footer {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11px;
    color: var(--ink-2);
    font-family: ui-monospace, "SF Mono", monospace;
  }
  .pair-card .pair-footer .savings {
    color: #1a7c34; font-weight: 600;
    background: var(--sway-soft);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 11px;
  }
  .pair-card .pair-footer .turns {
    color: var(--blue); font-weight: 500;
    background: var(--blue-soft);
    padding: 2px 8px;
    border-radius: var(--radius-pill);
    font-size: 10.5px;
  }
  .conv-header {
    margin-bottom: 14px;
    padding: 14px 18px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    display: flex; flex-wrap: wrap; gap: 18px; align-items: center;
  }
  .conv-header .label {
    font-size: 10px; font-weight: 600;
    letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--ink-2);
    margin-right: 4px;
  }
  .conv-header .v {
    font-family: ui-monospace, monospace;
    font-size: 13px; font-weight: 600;
    color: var(--ink);
  }
  .conv-header .v.savings { color: var(--blue); }
  .conv-header .pipe { color: var(--line); font-size: 16px; }

  .compare-content { overflow-y: auto; padding: 0; min-width: 0; }
  .summary-card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    padding: 18px 22px; margin-bottom: 14px;
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px;
  }
  .stat .label { font-size: 10px; color: var(--ink-2); text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
  .stat .value { font-size: 26px; font-weight: 600; margin-top: 4px; letter-spacing: -0.015em; }
  .stat .sub { font-size: 11px; color: var(--ink-3); margin-top: 2px; }
  .pair {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
    padding: 16px 20px; margin-bottom: 14px;
  }
  .pair .prompt {
    font-size: 13px; font-weight: 500;
    margin-bottom: 12px; padding: 10px 12px;
    background: var(--blue-soft);
    border-radius: 8px;
    border-left: 3px solid var(--blue);
    color: var(--ink);
    white-space: pre-wrap; word-break: break-word;
  }
  .columns2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .col2 {
    border-radius: var(--radius-sm);
    padding: 14px 16px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  .col2.raw  { border-top: 3px solid var(--raw); }
  .col2.sway { border-top: 3px solid var(--sway); }
  .col2 h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 600; }
  .col2.raw h4  { color: var(--raw); }
  .col2.sway h4 { color: var(--sway); }
  .col2 .meta-line { font-family: ui-monospace, monospace; font-size: 11px; color: var(--ink-2); margin-bottom: 10px; }
  .col2 .meta-line b { color: var(--ink); font-weight: 600; }
  .col2 .text { font-size: 12.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow-y: auto; color: var(--ink); }

  .empty-state {
    color: var(--ink-2);
    padding: 60px 20px;
    text-align: center;
    font-size: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow-md);
  }
  .empty-state code { background: var(--surface-2); padding: 2px 6px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 12.5px; }

  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }
</style>
</head>
<body>

<header>
  <div class="logo">sway<span class="accent">.</span></div>
  <div class="tabs">
    <button data-view="live" class="active">Live</button>
    <button data-view="sessions">Bench sessions</button>
  </div>
  <div class="status">
    <span class="dot"></span>
    <span>connected · gemini 2.5</span>
  </div>
</header>

<main>
  <!-- LIVE VIEW -->
  <div class="view active" id="view-live">
    <div class="eyebrow">
      <span>Verified</span><span class="sep">·</span>
      <span>3 mechanisms live</span><span class="sep">·</span>
      <span>CS-101 tutor context</span>
    </div>
    <h1 class="h1">Cut your LLM bill. <span class="muted">Show the receipts.</span></h1>
    <p class="h2-sub">Type a prompt below — both columns answer in parallel. Raw uses Gemini Pro with no optimization. Sway runs the same prompt through optimizer → router → context.md, locked to Flash to make the cost contrast visible.</p>

    <!-- Bento hero — hidden until first call -->
    <div class="bento" id="hero-stats" style="display:none">
      <div class="card card-savings">
        <div class="label">Average savings</div>
        <div class="value-row">
          <span class="value" id="hero-savings">—</span>
          <span class="value-suffix">saved.</span>
        </div>
        <div class="meta">
          <span><b id="hero-calls">0</b> calls</span>
          <span><b id="hero-cost-raw">$0</b> raw</span>
          <span><b id="hero-cost-sway">$0</b> sway</span>
        </div>
      </div>
      <div class="card card-latest">
        <div class="label"><span class="dot"></span> Latest run</div>
        <div class="row"><span class="k">Pro spent</span><span class="v" id="hero-latest-raw-cost">—</span></div>
        <div class="row"><span class="k">Sway spent</span><span class="v" id="hero-latest-sway-cost">—</span></div>
        <div class="row"><span class="k">Model</span><span class="v" id="hero-latest-meta">—</span></div>
        <div class="savings-tag" id="hero-latest-savings">— saved</div>
      </div>
    </div>

    <!-- Timeline (paired turn blocks) -->
    <div class="timeline" id="timeline">
      <div class="timeline-empty" id="timeline-empty">
        <b>Type a prompt below.</b> Both columns answer in parallel.
        Raw uses Gemini Pro with no optimization — what you'd get hitting Gemini directly with a sloppy prompt.
        Sway runs the same prompt through optimizer → router → sway.md context, locked to Flash to keep the cost contrast visible.
        Same prompt, two answers, side-by-side.
      </div>
    </div>

    <!-- Input row -->
    <div class="input-row">
      <div class="toggles">
        <span class="label">Sway mechanisms</span>
        <span class="toggle on" id="toggle-context" title="Inject sway.md as system message"><span class="dot"></span>context.md</span>
        <span class="toggle on" id="toggle-optimizer" title="Rewrite raw prompt via cheap optimizer"><span class="dot"></span>optimizer</span>
        <span class="toggle on locked" title="Routing always forced to Flash in live demo"><span class="dot"></span>router · forced flash</span>
      </div>
      <div class="input-wrap">
        <textarea id="prompt" rows="1" placeholder="ask anything — try a sloppy student-style question" autofocus></textarea>
        <button class="send-btn" id="send" title="Send (Enter)">↑</button>
      </div>
      <div class="hint">
        <span>
          Try
          <span class="preset" data-prompt="ok so im super confused about closures in javascript like everyone keeps talking about them but i still dont get it. why do they exist? what are they actually used for? and do i need to know them for interviews">closures</span> ·
          <span class="preset" data-prompt="explain hashmaps to me like im dumb">hashmaps</span> ·
          <span class="preset" data-prompt="loop or recursion which is better">loop vs recursion</span>
        </span>
        <span><kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline</span>
      </div>
    </div>
  </div>

  <!-- SESSIONS VIEW -->
  <div class="view" id="view-sessions">
    <div class="eyebrow">
      <span>Bench sessions</span><span class="sep">·</span>
      <span>compare any prompt's raw vs sway response</span>
    </div>
    <h1 class="h1">Pick a prompt. <span class="muted">See both answers.</span></h1>
    <p class="h2-sub">Each card on the left is a prompt that's been run through both Raw Pro and Sway. Click one to see the side-by-side comparison with full stats. Data lives in <code style="background:var(--surface-2);padding:1px 5px;border-radius:3px;font-size:11.5px">~/.sway/metrics.db</code>.</p>

    <div class="sessions-grid">
      <aside class="sessions-list">
        <h2 style="margin-top:0">Comparable prompts</h2>
        <div id="pairs-container"></div>
      </aside>
      <section class="compare-content" id="compare-content">
        <div class="empty-state">
          Click a prompt on the left to see Raw vs Sway responses, side by side, with cost and token stats.
        </div>
      </section>
    </div>
  </div>
</main>

<script>
  // ===== Tabs =====
  document.querySelectorAll('.tabs button').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('active', x === b));
      const v = b.dataset.view;
      document.getElementById('view-live').classList.toggle('active', v === 'live');
      document.getElementById('view-sessions').classList.toggle('active', v === 'sessions');
      if (v === 'sessions') loadSessions();
    });
  });

  // ===== Helpers =====
  function fmtUsd(n) { return '$' + Number(n || 0).toFixed(5); }
  function fmtUsd4(n) { return '$' + Number(n || 0).toFixed(4); }
  function pct(numer, denom) {
    if (!denom || denom === 0) return 'n/a';
    return (((denom - numer) / denom) * 100).toFixed(1) + '%';
  }
  function escape(s) { return String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

  // Tiny markdown → HTML renderer. Handles fenced code, inline code, headers,
  // bold, italic, links, bullet/numbered lists, paragraphs. ~70 LOC, no deps.
  function renderMd(input) {
    if (!input) return '';
    let text = String(input);
    const fences = [];
    text = text.replace(/\`\`\`(\\w+)?\\n?([\\s\\S]*?)\`\`\`/g, function(_m, _lang, code) {
      fences.push(code.replace(/\\n$/, ''));
      return '\\u0000FENCE' + (fences.length - 1) + '\\u0000';
    });
    const inlines = [];
    text = text.replace(/\`([^\`\\n]+)\`/g, function(_m, code) {
      inlines.push(code);
      return '\\u0000INLINE' + (inlines.length - 1) + '\\u0000';
    });
    text = text.replace(/[&<>]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; });
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    text = text.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\\*([^*\\n]+)\\*(?!\\*)/g, '$1<em>$2</em>');
    text = text.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, function(_m, t, u) {
      const safe = (u.indexOf('http') === 0 || u.charAt(0) === '/') ? u : '#';
      return '<a href="' + safe + '" target="_blank" rel="noopener">' + t + '</a>';
    });
    const lines = text.split('\\n');
    const out = [];
    let listType = null;
    let para = [];
    function flushPara() { if (para.length) { out.push('<p>' + para.join('<br>') + '</p>'); para = []; } }
    function closeList() { if (listType) { out.push('</' + listType + '>'); listType = null; } }
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const trimmed = ln.replace(/^\\s+/, '');
      const isBullet = /^[*-] /.test(trimmed);
      const isNumbered = /^\\d+\\. /.test(trimmed);
      const isHeader = /^<h\\d>/.test(trimmed);
      const isBlank = trimmed === '';
      if (isHeader) { flushPara(); closeList(); out.push(ln); }
      else if (isBullet || isNumbered) {
        flushPara();
        const want = isBullet ? 'ul' : 'ol';
        if (listType !== want) { closeList(); out.push('<' + want + '>'); listType = want; }
        out.push('<li>' + trimmed.replace(/^[*-] |^\\d+\\. /, '') + '</li>');
      } else if (isBlank) { flushPara(); closeList(); }
      else { closeList(); para.push(ln); }
    }
    flushPara(); closeList();
    let result = out.join('\\n');
    result = result.replace(/\\u0000INLINE(\\d+)\\u0000/g, function(_m, idx) {
      return '<code>' + inlines[idx].replace(/[&<>]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }) + '</code>';
    });
    result = result.replace(/\\u0000FENCE(\\d+)\\u0000/g, function(_m, idx) {
      return '<pre><code>' + fences[idx].replace(/[&<>]/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c]; }) + '</code></pre>';
    });
    return result;
  }

  // ===== Hero stats accumulator =====
  const stats = { count: 0, rawCost: 0, swayCost: 0 };
  function updateHero(data) {
    stats.count++;
    stats.rawCost  += data.raw.cost;
    stats.swayCost += data.sway.cost;
    document.getElementById('hero-stats').style.display = 'grid';
    const avg = stats.rawCost === 0 ? 0 : ((stats.rawCost - stats.swayCost) / stats.rawCost) * 100;
    document.getElementById('hero-savings').textContent = avg.toFixed(1) + '%';
    document.getElementById('hero-calls').textContent = stats.count;
    document.getElementById('hero-cost-raw').textContent = fmtUsd4(stats.rawCost);
    document.getElementById('hero-cost-sway').textContent = fmtUsd4(stats.swayCost);
    const latestSav = data.raw.cost === 0 ? 0 : ((data.raw.cost - data.sway.cost) / data.raw.cost) * 100;
    document.getElementById('hero-latest-raw-cost').textContent = fmtUsd(data.raw.cost);
    document.getElementById('hero-latest-sway-cost').textContent = fmtUsd(data.sway.cost);
    document.getElementById('hero-latest-meta').textContent = data.sway.model.replace('gemini-2.5-', '') + ' · ' + data.sway.details.intent;
    document.getElementById('hero-latest-savings').textContent = latestSav.toFixed(1) + '% saved';
  }

  // ===== LIVE =====
  const promptEl = document.getElementById('prompt');
  const sendEl = document.getElementById('send');
  const timeline = document.getElementById('timeline');
  let turnCounter = 0;

  promptEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  promptEl.addEventListener('input', () => {
    promptEl.style.height = 'auto';
    promptEl.style.height = Math.min(promptEl.scrollHeight, 200) + 'px';
  });
  document.querySelectorAll('.preset').forEach(p => {
    p.addEventListener('click', () => { promptEl.value = p.dataset.prompt; promptEl.focus(); });
  });
  sendEl.addEventListener('click', send);

  // Toggle bindings (router toggle is locked — always forced to flash in live mode)
  ['toggle-context', 'toggle-optimizer'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('click', () => {
      const on = el.classList.toggle('on');
      el.classList.toggle('off', !on);
    });
  });
  function flagsFromUI() {
    return {
      useContext:   document.getElementById('toggle-context').classList.contains('on'),
      useOptimizer: document.getElementById('toggle-optimizer').classList.contains('on'),
    };
  }

  function row(k, v) { return '<div class="row"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'; }
  function loadingHTML(label) {
    return '<div class="loading">' + label + '<span class="loading-dots"><span></span><span></span><span></span></span></div>';
  }
  function colHeader(side, label, modelText) {
    return '<h4><span class="dot"></span> ' + label + (modelText ? ' <span style="color:var(--ink-2);font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;margin-left:6px">' + escape(modelText) + '</span>' : '') + '</h4>';
  }

  function newTurn(prompt) {
    // Remove empty state on first turn
    const empty = document.getElementById('timeline-empty');
    if (empty) empty.remove();
    turnCounter++;
    const turn = document.createElement('div');
    turn.className = 'turn';
    turn.innerHTML =
      '<div class="turn-prompt"><span class="num">#' + turnCounter + '</span>' + escape(prompt) + '</div>' +
      '<div class="turn-cols">' +
        '<div class="turn-col raw" data-side="raw">' +
          colHeader('raw', '● Raw API', 'no optimizer · no context') +
          loadingHTML('Pro is thinking') +
        '</div>' +
        '<div class="turn-col sway" data-side="sway">' +
          colHeader('sway', '● Sway', 'rewriting + routing') +
          loadingHTML('Sway is working') +
        '</div>' +
      '</div>';
    timeline.appendChild(turn);
    timeline.scrollTop = timeline.scrollHeight;
    return turn;
  }
  function fillRaw(turn, raw) {
    const col = turn.querySelector('[data-side="raw"]');
    col.innerHTML =
      colHeader('raw', '● Raw API', raw.model) +
      '<div class="text">' + (raw.text ? renderMd(raw.text) : '<em style="color:var(--ink-2)">(no response)</em>') + '</div>' +
      '<div class="meta">' +
        '<span>in <b>' + raw.inputTokens + '</b></span>' +
        '<span>out <b>' + raw.outputTokens + '</b></span>' +
        '<span>cost <b>' + fmtUsd(raw.cost) + '</b></span>' +
        '<span>' + raw.ms + 'ms</span>' +
      '</div>';
  }
  function fillSway(turn, raw, sway) {
    const col = turn.querySelector('[data-side="sway"]');
    const savings = pct(sway.cost, raw.cost);
    const detailsBox =
      '<details class="swaybox">' +
        '<summary>ⓘ what sway did</summary>' +
        '<div class="body">' +
          row('Original',     '<code>' + escape(sway.details.rawPrompt) + '</code>') +
          row('Optimized',    '<span class="highlight">' + escape(sway.details.optimizedPrompt) + '</span>') +
          row('Intent',       '<code>' + escape(sway.details.intent) + '</code> · optimizer ran in ' + sway.details.optimizerMs + 'ms') +
          row('Router said',  'tier=<b>' + sway.details.routerDecision.tier + '</b>, score=' + sway.details.routerDecision.score + (sway.details.routerDecision.signals.length ? ', signals=[' + sway.details.routerDecision.signals.join(' | ') + ']' : '')) +
          row('Forced model', '<span class="highlight">' + escape(sway.model) + '</span> · live demo locks Sway to Flash') +
          row('Context',      sway.details.contextHash ? 'sway.md ' + sway.details.contextBytes + 'B · hash <code>' + sway.details.contextHash + '</code>' : '(none — context.md disabled)') +
          row('Mechanisms',   '✓ context.md · ✓ optimizer · ✓ router · forced flash') +
        '</div>' +
      '</details>';
    col.innerHTML =
      colHeader('sway', '● Sway', sway.model + ' · ' + sway.details.intent) +
      detailsBox +
      '<div class="text">' + (sway.text ? renderMd(sway.text) : '<em style="color:var(--ink-2)">(no response)</em>') + '</div>' +
      '<div class="meta">' +
        '<span>in <b>' + sway.inputTokens + '</b></span>' +
        '<span>out <b>' + sway.outputTokens + '</b></span>' +
        '<span>cost <b>' + fmtUsd(sway.cost) + '</b></span>' +
        '<span>' + sway.ms + 'ms</span>' +
        '<span class="savings">saved ' + savings + '</span>' +
      '</div>';
  }
  function fillError(turn, message) {
    ['raw', 'sway'].forEach(side => {
      const col = turn.querySelector('[data-side="' + side + '"]');
      col.classList.add('error');
      col.innerHTML =
        colHeader(side, side === 'raw' ? '● Raw API' : '● Sway', '') +
        '<div class="text">Error: ' + escape(message) + '</div>';
    });
  }

  async function send() {
    const text = promptEl.value.trim();
    if (!text) return;
    sendEl.disabled = true;
    promptEl.disabled = true;

    const turn = newTurn(text);

    try {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: text, ...flagsFromUI() }),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      fillRaw(turn, data.raw);
      fillSway(turn, data.raw, data.sway);
      updateHero(data);
    } catch (e) {
      fillError(turn, e.message);
    } finally {
      sendEl.disabled = false;
      promptEl.disabled = false;
      promptEl.value = '';
      promptEl.style.height = 'auto';
      promptEl.focus();
      timeline.scrollTop = timeline.scrollHeight;
    }
  }

  // ===== BENCH SESSIONS (prompt-pair picker with chat-history view) =====
  let pairsCache = [];

  async function loadSessions() {
    const r = await fetch('/api/pairs');
    pairsCache = await r.json();
    const el = document.getElementById('pairs-container');
    if (!pairsCache.length) {
      el.innerHTML = '<div style="color:var(--ink-2);font-size:12.5px;padding:12px 4px;line-height:1.55">No comparisons yet.<br><br>Send a prompt in <b>Live</b> mode (each prompt records both Raw and Sway) or run <code style="background:var(--surface-2);padding:1px 5px;border-radius:3px">sway bench</code> in terminal.</div>';
      return;
    }
    el.innerHTML = pairsCache.map((p, i) => {
      // Pre-count how many other prompts share this raw session — gives "X turns"
      const rawSession = p.raw.session;
      const swaySession = p.sway.session;
      const sharedCount = pairsCache.filter(q =>
        q.raw.session === rawSession && q.sway.session === swaySession
      ).length;
      const turnsLabel = sharedCount > 1 ? sharedCount + ' turns' : '1 turn';
      return '<div class="pair-card" data-i="' + i + '">' +
        '<div class="pair-prompt">' + escape(p.prompt) + '</div>' +
        '<div class="pair-stats">' +
          '<div class="stat-side raw">' +
            '<span class="label">Raw · Pro</span>' +
            '<span class="cost">' + fmtUsd(p.raw.cost_usd) + '</span>' +
            '<span class="tokens">' + p.raw.input_tokens + ' in · ' + p.raw.output_tokens + ' out</span>' +
          '</div>' +
          '<div class="stat-side sway">' +
            '<span class="label">Sway · Flash</span>' +
            '<span class="cost">' + fmtUsd(p.sway.cost_usd) + '</span>' +
            '<span class="tokens">' + p.sway.input_tokens + ' in · ' + p.sway.output_tokens + ' out</span>' +
          '</div>' +
        '</div>' +
        '<div class="pair-footer">' +
          '<span class="savings">↓ ' + p.savingsPct.toFixed(1) + '%</span>' +
          (sharedCount > 1 ? '<span class="turns">' + turnsLabel + '</span>' : '<span>' + new Date(p.ts).toLocaleString() + '</span>') +
        '</div>' +
      '</div>';
    }).join('');
    el.querySelectorAll('.pair-card').forEach(node => {
      node.addEventListener('click', async () => {
        el.querySelectorAll('.pair-card').forEach(n => n.classList.remove('selected'));
        node.classList.add('selected');
        const p = pairsCache[parseInt(node.dataset.i, 10)];
        await loadConversation(p);
      });
    });
  }

  async function loadConversation(originPair) {
    const c = document.getElementById('compare-content');
    c.innerHTML = '<div class="empty-state" style="padding:40px">Loading conversation…</div>';
    const url = '/api/compare?raw=' + encodeURIComponent(originPair.raw.session) +
                '&sway=' + encodeURIComponent(originPair.sway.session);
    try {
      const r = await fetch(url);
      const data = await r.json();
      renderConversation(data, originPair);
    } catch (e) {
      c.innerHTML = '<div class="empty-state" style="color:var(--raw)">Error loading: ' + escape(e.message) + '</div>';
    }
  }

  function renderConversation(data, originPair) {
    const c = document.getElementById('compare-content');
    if (!data.pairs || !data.pairs.length) {
      c.innerHTML = '<div class="empty-state">No turns found in this session pair.</div>';
      return;
    }
    const t = data.totals;
    const overallSavings = t.raw.cost === 0 ? 0 : ((t.raw.cost - t.sway.cost) / t.raw.cost) * 100;
    const isMultiTurn = data.pairs.length > 1;

    const header =
      '<div class="conv-header">' +
        '<div><span class="label">Turns</span><span class="v">' + data.pairs.length + '</span></div>' +
        '<span class="pipe">·</span>' +
        '<div><span class="label">Raw cost</span><span class="v" style="color:var(--raw)">' + fmtUsd4(t.raw.cost) + '</span></div>' +
        '<span class="pipe">·</span>' +
        '<div><span class="label">Sway cost</span><span class="v" style="color:var(--sway)">' + fmtUsd4(t.sway.cost) + '</span></div>' +
        '<span class="pipe">·</span>' +
        '<div><span class="label">Saved</span><span class="v savings">' + overallSavings.toFixed(1) + '%</span></div>' +
        '<span class="pipe">·</span>' +
        '<div><span class="label">Tokens out</span><span class="v">' + t.raw.outputTokens + ' → ' + t.sway.outputTokens + '</span></div>' +
      '</div>';

    const turns = data.pairs.map((p, i) =>
      '<div class="turn">' +
        '<div class="turn-prompt">' + (isMultiTurn ? '<span class="num">#' + (i+1) + '</span>' : '') + escape(p.prompt) + '</div>' +
        '<div class="turn-cols">' +
          '<div class="turn-col raw">' +
            '<h4><span class="dot"></span> ● Raw API <span style="color:var(--ink-2);font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;margin-left:6px">' + escape(p.raw.model) + '</span></h4>' +
            '<div class="text">' + (p.raw.text ? renderMd(p.raw.text) : '<em style="color:var(--ink-2)">(no response stored)</em>') + '</div>' +
            '<div class="meta">' +
              '<span>in <b>' + p.raw.inputTokens + '</b></span>' +
              '<span>out <b>' + p.raw.outputTokens + '</b></span>' +
              '<span>cost <b>' + fmtUsd(p.raw.cost) + '</b></span>' +
            '</div>' +
          '</div>' +
          '<div class="turn-col sway">' +
            '<h4><span class="dot"></span> ● Sway <span style="color:var(--ink-2);font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;margin-left:6px">' + escape(p.sway.model) + (p.sway.routeTier ? ' · ' + p.sway.routeTier : '') + '</span></h4>' +
            '<div class="text">' + (p.sway.text ? renderMd(p.sway.text) : '<em style="color:var(--ink-2)">(no response stored)</em>') + '</div>' +
            '<div class="meta">' +
              '<span>in <b>' + p.sway.inputTokens + '</b></span>' +
              '<span>out <b>' + p.sway.outputTokens + '</b></span>' +
              '<span>cost <b>' + fmtUsd(p.sway.cost) + '</b></span>' +
              '<span class="savings">saved ' + pct(p.sway.cost, p.raw.cost) + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    ).join('');

    c.innerHTML = header + turns;
  }
  function statTile(label, value, sub, color) {
    return '<div class="stat"><div class="label">' + label + '</div><div class="value"' + (color ? ' style="color:' + color + '"' : '') + '>' + value + '</div><div class="sub">' + sub + '</div></div>';
  }
</script>
</body>
</html>`;

interface ComparePair {
  prompt: string;
  raw: { model: string; cost: number; inputTokens: number; outputTokens: number; text: string };
  sway: { model: string; cost: number; inputTokens: number; outputTokens: number; text: string; optimizedPrompt: string | null; routeTier: string | null };
}

function buildCompare(rawId: string, swayId: string) {
  const rawRows = bySession(rawId);
  const swayRows = bySession(swayId);
  const swayByPrompt = new Map(swayRows.map(r => [r.raw_prompt, r]));
  const pairs: ComparePair[] = [];
  let rawCost = 0, rawIn = 0, rawOut = 0;
  let swayCost = 0, swayIn = 0, swayOut = 0;
  for (const r of rawRows) {
    const s = swayByPrompt.get(r.raw_prompt);
    if (!s) continue;
    pairs.push({
      prompt: r.raw_prompt,
      raw:  { model: r.model, cost: r.cost_usd, inputTokens: r.input_tokens, outputTokens: r.output_tokens, text: r.response_text ?? "" },
      sway: { model: s.model, cost: s.cost_usd, inputTokens: s.input_tokens, outputTokens: s.output_tokens, text: s.response_text ?? "",
              optimizedPrompt: s.optimized_prompt, routeTier: s.route_tier },
    });
    rawCost += r.cost_usd; rawIn += r.input_tokens; rawOut += r.output_tokens;
    swayCost += s.cost_usd; swayIn += s.input_tokens; swayOut += s.output_tokens;
  }
  return {
    pairs,
    totals: {
      raw:  { cost: rawCost,  inputTokens: rawIn,  outputTokens: rawOut },
      sway: { cost: swayCost, inputTokens: swayIn, outputTokens: swayOut },
    },
  };
}

interface RunResult {
  raw: {
    model: string;
    text: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    ms: number;
  };
  sway: {
    model: string;
    text: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
    ms: number;
    details: {
      rawPrompt: string;
      optimizedPrompt: string;
      intent: string;
      optimizerMs: number;
      routerDecision: { tier: string; score: number; model: string; signals: string[] };
      contextHash: string | null;
      contextBytes: number;
    };
  };
}

async function runRaw(prompt: string, session: string) {
  const t0 = Date.now();
  const res = await complete({
    model: DEFAULTS.flagship,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 4096,
  });
  const ms = Date.now() - t0;
  const cost = costUsd(res.model, res.inputTokens, res.outputTokens);
  record({
    rawPrompt: prompt,
    optimizedPrompt: null,
    responseText: res.text,
    model: res.model,
    provider: res.provider,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: cost,
    optimized: false,
    routed: false,
    routeTier: null,
    contextHash: null,
    latencyMs: ms,
    session,
  });
  return { res, ms, cost };
}

interface SwayFlags {
  useContext: boolean;
  useOptimizer: boolean;
}

async function runSway(prompt: string, session: string, flags: SwayFlags) {
  const t0 = Date.now();
  const opt = flags.useOptimizer
    ? await optimize(prompt)
    : { intent: "other" as const, optimizedPrompt: prompt, optimizerInputTokens: 0, optimizerOutputTokens: 0, optimizerMs: 0, fallback: true };
  const finalPrompt = opt.fallback ? prompt : opt.optimizedPrompt;
  const decision = classify(finalPrompt);
  const forcedModel = DEFAULTS.nano;
  const ctx = flags.useContext ? loadContext() : null;
  const messages: Message[] = [];
  if (ctx) messages.push({ role: "system", content: ctx.text });
  messages.push({ role: "user", content: finalPrompt });
  const res = await complete({ model: forcedModel, messages, maxTokens: 4096 });
  const ms = Date.now() - t0;
  const optCost = costUsd(DEFAULTS.optimizer, opt.optimizerInputTokens, opt.optimizerOutputTokens);
  const callCost = costUsd(res.model, res.inputTokens, res.outputTokens);
  const cost = optCost + callCost;
  record({
    rawPrompt: prompt,
    optimizedPrompt: opt.fallback ? null : opt.optimizedPrompt,
    responseText: res.text,
    model: res.model,
    provider: res.provider,
    inputTokens: res.inputTokens + opt.optimizerInputTokens,
    outputTokens: res.outputTokens + opt.optimizerOutputTokens,
    costUsd: cost,
    optimized: !opt.fallback,
    routed: true,
    routeTier: decision.tier,
    contextHash: ctx?.hash ?? null,
    latencyMs: ms,
    session,
  });
  return { res, ms, cost, opt, decision, ctx };
}

async function handleRun(prompt: string, flags: SwayFlags): Promise<RunResult> {
  const session = newSessionId();
  const [rawResult, swayResult] = await Promise.all([
    runRaw(prompt, session + "_raw"),
    runSway(prompt, session + "_sway", flags),
  ]);
  return {
    raw: {
      model: rawResult.res.model,
      text: rawResult.res.text,
      inputTokens: rawResult.res.inputTokens,
      outputTokens: rawResult.res.outputTokens,
      cost: rawResult.cost,
      ms: rawResult.ms,
    },
    sway: {
      model: swayResult.res.model,
      text: swayResult.res.text,
      inputTokens: swayResult.res.inputTokens + swayResult.opt.optimizerInputTokens,
      outputTokens: swayResult.res.outputTokens + swayResult.opt.optimizerOutputTokens,
      cost: swayResult.cost,
      ms: swayResult.ms,
      details: {
        rawPrompt: prompt,
        optimizedPrompt: swayResult.opt.fallback ? prompt : swayResult.opt.optimizedPrompt,
        intent: swayResult.opt.intent,
        optimizerMs: swayResult.opt.optimizerMs,
        routerDecision: {
          tier: swayResult.decision.tier,
          score: swayResult.decision.score,
          model: swayResult.decision.model,
          signals: swayResult.decision.signals,
        },
        contextHash: swayResult.ctx?.hash ?? null,
        contextBytes: swayResult.ctx?.bytes ?? 0,
      },
    },
  };
}

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(body);
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; if (data.length > 100_000) { req.destroy(); reject(new Error("payload too large")); } });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export function serve(port: number): void {
  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return send(res, 200, HTML, "text/html; charset=utf-8");
      }
      if (req.method === "GET" && url.pathname === "/api/sessions") {
        return json(res, 200, recentSessions(50));
      }
      if (req.method === "GET" && url.pathname === "/api/pairs") {
        return json(res, 200, pairs(50));
      }
      if (req.method === "GET" && url.pathname === "/api/summary") {
        return json(res, 200, summary());
      }
      if (req.method === "GET" && url.pathname === "/api/compare") {
        const raw = url.searchParams.get("raw");
        const sway = url.searchParams.get("sway");
        if (!raw || !sway) return json(res, 400, { error: "raw and sway query params required" });
        return json(res, 200, buildCompare(raw, sway));
      }
      if (req.method === "POST" && url.pathname === "/api/run") {
        const body = await readBody(req);
        let prompt = "";
        let useContext = true;
        let useOptimizer = true;
        try {
          const parsed = JSON.parse(body) as { prompt?: string; useContext?: boolean; useOptimizer?: boolean };
          prompt = parsed.prompt ?? "";
          if (parsed.useContext === false) useContext = false;
          if (parsed.useOptimizer === false) useOptimizer = false;
        } catch { return json(res, 400, { error: "invalid JSON body" }); }
        if (!prompt.trim()) return json(res, 400, { error: "prompt required" });
        const result = await handleRun(prompt, { useContext, useOptimizer });
        return json(res, 200, result);
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  });

  srv.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  \x1b[1mSway dashboard\x1b[0m running at \x1b[36m${url}\x1b[0m`);
    console.log(`  Live mode: type prompts → see Pro vs Sway side-by-side.`);
    console.log(`  Sessions tab: review past \`sway bench\` runs.`);
    console.log(`  Press Ctrl+C to stop.\n`);
  });
}
