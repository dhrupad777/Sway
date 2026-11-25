import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { basename } from "node:path";
import { recentSessions, bySession, summary, record, newSessionId, pairs, projectStats, recentProjectCalls } from "./metrics.js";
import { complete } from "./providers.js";
import { costUsd, DEFAULTS, TOKEN_BUDGET } from "./pricing.js";
import { loadContext, splitSections } from "./context.js";
import { runPipeline } from "./pipeline.js";
import { loadRouterModel } from "./learned-router.js";
import { semCount, computeCacheSweep, DEFAULT_SIM_THRESHOLD } from "./semcache.js";
import { evalRows, evalRuns, type EvalRow } from "./evalstore.js";
import { summarizeRows, CONFIGS, bundled } from "./eval.js";

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

  /* ===== v0.2 additions ===== */
  :root { --amber: #b26a00; --amber-soft: rgba(230,140,0,0.10); --series-2: #e8590c; --mono: ui-monospace, "SF Mono", Consolas, monospace; }
  .status .pill { padding: 3px 9px; border-radius: var(--radius-pill); background: var(--surface-2); border: 1px solid var(--line); }
  .status .pill.ok { color: #1a7c34; background: var(--sway-soft); border-color: rgba(40,167,69,0.25); }
  .status .pill.warn { color: var(--amber); background: var(--amber-soft); border-color: rgba(230,140,0,0.25); }
  .scroll-view { overflow-y: auto; padding-bottom: 28px; }
  .scroll-view > * { flex-shrink: 0; }

  /* Pipeline map (intro) + per-turn trace share one visual language */
  .pipe-map { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin-bottom: 18px; flex-shrink: 0; }
  .stage {
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: 11px 12px; box-shadow: var(--shadow-sm); position: relative; min-width: 0;
    transition: opacity 150ms ease, border-color 150ms ease;
  }
  .stage .n { font-family: var(--mono); font-size: 10px; color: var(--blue); font-weight: 600; }
  .stage .t { font-size: 12.5px; font-weight: 600; margin: 2px 0 3px; }
  .stage .d { font-size: 11px; color: var(--ink-2); line-height: 1.4; }
  .stage .s { margin-top: 7px; font-family: var(--mono); font-size: 10.5px; color: var(--blue); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stage .new { position: absolute; top: 9px; right: 9px; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; color: var(--blue); background: var(--blue-soft); border-radius: var(--radius-pill); padding: 1px 6px; }
  .stage.off { opacity: 0.45; }
  .stage.off .s { color: var(--ink-3); }

  .trace { list-style: none; margin: 0 0 10px; padding: 0; border: 1px solid var(--blue-border); border-radius: var(--radius-sm); background: var(--surface); overflow: hidden; }
  .trace li { display: grid; grid-template-columns: 14px 92px 1fr; gap: 8px; align-items: baseline; padding: 6px 12px; font-size: 11.5px; border-top: 1px solid var(--line); }
  .trace li:first-child { border-top: 0; }
  .trace .ic { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); align-self: center; }
  .trace .k { font-weight: 600; color: var(--ink); }
  .trace .v { font-family: var(--mono); font-size: 11px; color: var(--ink-2); word-break: break-word; }
  .trace .v b { color: var(--ink); font-weight: 600; }
  .trace li.on  .ic { background: var(--blue); }
  .trace li.hit .ic { background: var(--sway); box-shadow: 0 0 0 3px var(--sway-soft); }
  .trace li.hit .v { color: #1a7c34; }
  .trace li.warn .ic { background: #e68c00; }
  .trace li.warn .v { color: var(--amber); }
  .trace li.off .k, .trace li.off .v { color: var(--ink-3); }
  .badge { display: inline-block; font-family: var(--mono); font-size: 10px; font-weight: 600; padding: 1px 7px; border-radius: var(--radius-pill); letter-spacing: 0; text-transform: none; }
  .badge.nano { color: var(--blue); background: var(--blue-soft); }
  .badge.flagship { color: var(--ink); background: rgba(0,0,0,0.06); }
  .badge.hit { color: #1a7c34; background: var(--sway-soft); }
  .badge.esc { color: var(--amber); background: var(--amber-soft); }
  .hitbanner { background: var(--sway-soft); border: 1px solid rgba(40,167,69,0.3); border-radius: 8px; padding: 9px 13px; margin-bottom: 10px; font-size: 12.5px; color: #1a7c34; font-weight: 600; }
  .hitbanner span { font-weight: 400; color: var(--ink-2); }
  .optbox { margin-bottom: 10px; font-size: 12px; }
  .optbox summary { cursor: pointer; color: var(--blue); font-weight: 600; font-size: 11.5px; }
  .optbox .v { margin-top: 6px; padding: 8px 11px; background: var(--blue-soft); border-radius: 6px; font-family: var(--mono); font-size: 11.5px; white-space: pre-wrap; word-break: break-word; }

  .bento.v2 { grid-template-columns: 1.3fr 1fr 1fr; }
  .card-mix { padding: 20px 22px; }
  .card-mix .label { font-size: 11px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-2); margin-bottom: 10px; }
  .card-mix .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12.5px; color: var(--ink-2); }
  .card-mix .row b { color: var(--ink); font-family: var(--mono); font-weight: 600; }

  /* Segmented controls */
  .seg { display: inline-flex; align-items: center; background: var(--surface-2); border: 1px solid var(--line); border-radius: var(--radius-pill); padding: 2px; gap: 2px; }
  .seg .nm { padding: 0 8px 0 9px; color: var(--ink-2); font-weight: 600; font-size: 11px; }
  .seg button { border: 0; background: transparent; font: inherit; font-size: 11.5px; font-weight: 500; color: var(--ink-2); padding: 3px 10px; border-radius: var(--radius-pill); cursor: pointer; transition: background 150ms ease, color 150ms ease; }
  .seg button:hover { color: var(--ink); }
  .seg button.on { background: var(--surface); color: var(--blue); box-shadow: var(--shadow-sm); }
  .seg button:focus-visible, .btn:focus-visible, .tabs button:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

  /* Generic panels for Evaluation / Gateway */
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow-md); padding: 18px 22px; margin-bottom: 14px; }
  .panel h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; letter-spacing: -0.01em; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .panel .sub { font-size: 12.5px; color: var(--ink-2); margin: 0 0 14px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .grid2 > .panel { margin-bottom: 0; }
  .row-gap { margin-bottom: 14px; }
  .btn { background: var(--blue); color: #fff; border: 0; border-radius: 8px; padding: 7px 14px; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; transition: background 150ms ease, transform 100ms ease; }
  .btn:hover { background: var(--blue-hover); }
  .btn:active { transform: scale(0.97); }
  .btn:disabled { background: var(--ink-3); cursor: default; }
  .btn.ghost { background: var(--surface-2); color: var(--ink); border: 1px solid var(--line); }
  .btn.ghost:hover { background: var(--surface); }
  select.sel { font: inherit; font-size: 12.5px; padding: 6px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); max-width: 100%; }

  .steps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .step { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: 12px 14px; background: var(--surface-2); min-width: 0; }
  .step .hd { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 600; margin-bottom: 4px; }
  .step .ck { width: 18px; height: 18px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex-shrink: 0; border: 1.5px solid var(--ink-3); color: transparent; }
  .step.done { background: var(--surface); }
  .step.done .ck { background: var(--sway); border-color: var(--sway); color: #fff; }
  .step .d { font-size: 11.5px; color: var(--ink-2); margin-bottom: 8px; line-height: 1.45; }
  .cmd { display: flex; align-items: center; gap: 6px; background: #1d1d1f; color: #f5f5f7; border-radius: 6px; padding: 6px 6px 6px 10px; font-family: var(--mono); font-size: 11px; }
  .cmd code { flex: 1; min-width: 0; overflow-x: auto; white-space: nowrap; }
  .cmd button { background: rgba(255,255,255,0.12); color: #f5f5f7; border: 0; border-radius: 4px; font: inherit; font-size: 10px; padding: 3px 7px; cursor: pointer; flex-shrink: 0; }
  .cmd button:hover { background: rgba(255,255,255,0.22); }
  pre.snippet { background: #1d1d1f; color: #f5f5f7; border-radius: 8px; padding: 12px 14px; margin: 0; font-family: var(--mono); font-size: 11.5px; line-height: 1.55; overflow-x: auto; }

  .headline { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
  .headline .big { font-size: 40px; font-weight: 600; letter-spacing: -0.03em; color: var(--blue); line-height: 1; }
  .headline .txt { font-size: 14px; color: var(--ink-2); }
  .headline .txt b { color: var(--ink); }

  table.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.tbl th { text-align: left; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-2); padding: 7px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  table.tbl td { padding: 7px 10px; border-bottom: 1px solid var(--line); font-family: var(--mono); font-size: 11.5px; white-space: nowrap; }
  table.tbl td.txt { font-family: inherit; white-space: normal; max-width: 360px; }
  table.tbl tr:last-child td { border-bottom: 0; }
  table.tbl tr.hl td { background: var(--blue-soft); }
  table.tbl .num { text-align: right; }
  .tbl-wrap { overflow-x: auto; }
  .good { color: #1a7c34; font-weight: 600; }
  .bad { color: var(--raw); font-weight: 600; }

  .chart { position: relative; }
  .chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .chart .axis text, .chart .lbl { font-size: 11px; fill: var(--ink-2); font-family: -apple-system, "Segoe UI", system-ui, sans-serif; }
  .chart .lbl.strong { fill: var(--ink); font-weight: 600; }
  .chart .grid line { stroke: rgba(0,0,0,0.07); stroke-width: 1; }
  .legend { display: flex; gap: 16px; font-size: 11.5px; color: var(--ink-2); margin-bottom: 8px; flex-wrap: wrap; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 6px; vertical-align: -1px; }
  .legend i.line { width: 14px; height: 2px; border-radius: 1px; vertical-align: 3px; }
  .tip { position: absolute; pointer-events: none; background: var(--ink); color: #fff; font-size: 11.5px; line-height: 1.5; padding: 8px 10px; border-radius: 8px; box-shadow: var(--shadow-lg); opacity: 0; transition: opacity 100ms ease; white-space: nowrap; z-index: 5; }
  .tip b { font-weight: 600; }
  .tip .m { font-family: var(--mono); color: #d2d2d7; }

  .kv { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 12.5px; }
  .kv .k { color: var(--ink-2); }
  .kv .v { font-family: var(--mono); font-size: 12px; }
  .note { font-size: 12px; color: var(--ink-2); line-height: 1.55; }
  .note code, .panel .sub code, .h2-sub code, .eyebrow code { background: var(--surface-2); padding: 1px 5px; border-radius: 4px; font-family: var(--mono); font-size: 11px; }
  .live-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); }
  .live-dot.up { background: var(--sway); box-shadow: 0 0 0 3px var(--sway-soft); }

  @media (max-width: 1100px) {
    .pipe-map { grid-template-columns: repeat(3, 1fr); }
    .steps { grid-template-columns: 1fr 1fr; }
    .grid2, .bento.v2 { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    header { flex-wrap: wrap; padding: 12px 16px; }
    .view { padding: 20px 16px 0; }
    .turn-cols, .sessions-grid { grid-template-columns: 1fr; }
    .pipe-map, .steps { grid-template-columns: 1fr 1fr; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>

<header>
  <div class="logo">sway<span class="accent">.</span></div>
  <div class="tabs">
    <button data-view="live" class="active">Live</button>
    <button data-view="eval">Evaluation</button>
    <button data-view="gateway">Gateway</button>
    <button data-view="sessions">Sessions</button>
  </div>
  <div class="status" id="status">
    <span class="dot"></span>
    <span id="status-models">loading…</span>
  </div>
</header>

<main>
  <!-- LIVE VIEW -->
  <div class="view active" id="view-live">
    <div class="timeline" id="timeline">
      <div class="eyebrow">
        <span>Live</span><span class="sep">·</span>
        <span>raw API vs the v0.2 Sway pipeline</span><span class="sep">·</span>
        <span>same prompt, run in parallel</span>
      </div>
      <h1 class="h1">Cut your LLM bill. <span class="muted">Keep the quality.</span></h1>
      <p class="h2-sub" id="live-sub">Left: your prompt sent straight to the flagship model with a 4096-token cap. Right: the same prompt through Sway's six stages. Every stage can be switched off below, so you can see what each one contributes.</p>

      <div class="pipe-map" id="pipe-map"></div>

      <div class="bento v2" id="hero-stats" style="display:none">
        <div class="card card-savings">
          <div class="label">Saved this session</div>
          <div class="value-row">
            <span class="value" id="hero-savings">—</span>
            <span class="value-suffix">cheaper</span>
          </div>
          <div class="meta">
            <span><b id="hero-calls">0</b> prompts</span>
            <span><b id="hero-cost-raw">$0</b> raw</span>
            <span><b id="hero-cost-sway">$0</b> sway</span>
          </div>
        </div>
        <div class="card card-mix">
          <div class="label">Where Sway sent them</div>
          <div class="row"><span>Answered by the cheap model</span><b id="hero-nano">0</b></div>
          <div class="row"><span>Routed to the flagship</span><b id="hero-flag">0</b></div>
          <div class="row"><span>Escalated cheap → flagship</span><b id="hero-esc">0</b></div>
        </div>
        <div class="card card-mix">
          <div class="label">What it skipped</div>
          <div class="row"><span>Semantic cache hits</span><b id="hero-hits">0</b></div>
          <div class="row"><span>Context tokens not sent</span><b id="hero-ctx">0</b></div>
          <div class="row"><span>Avg Sway overhead</span><b id="hero-ovh">—</b></div>
        </div>
      </div>

      <div class="timeline-empty" id="timeline-empty">
        <b>Try the presets below in order.</b> Ask <b>"what is a hash map"</b>, then its paraphrase. The trace shows how similar the paraphrase was to the stored prompt, and whether it cleared the threshold and skipped the model call.
        Then compare where the router sends a short definition and a hard debugging question.
      </div>
    </div>

    <div class="input-row">
      <div class="toggles" id="toggles">
        <span class="label">Pipeline</span>
        <span class="seg" data-flag="context"><span class="nm">Context</span><button data-v="off">off</button><button data-v="full">full</button><button data-v="retrieve">retrieve</button></span>
        <span class="seg" data-flag="optimize"><span class="nm">Optimizer</span><button data-v="false">off</button><button data-v="true">on</button></span>
        <span class="seg" data-flag="router"><span class="nm">Router</span><button data-v="off">off</button><button data-v="rules">rules</button><button data-v="learned">learned</button></span>
        <span class="seg" data-flag="cache"><span class="nm">Semantic cache</span><button data-v="false">off</button><button data-v="true">on</button></span>
        <span class="seg" data-flag="escalate"><span class="nm">Escalation</span><button data-v="false">off</button><button data-v="true">on</button></span>
      </div>
      <div class="input-wrap">
        <textarea id="prompt" rows="1" placeholder="Ask anything. Sloppy, student-style questions work best." autofocus></textarea>
        <button class="send-btn" id="send" title="Send (Enter)" aria-label="Send">↑</button>
      </div>
      <div class="hint">
        <span>
          Try
          <span class="preset" data-prompt="what is a hash map">hash map</span> ·
          <span class="preset" data-prompt="explain hashmaps to me like im dumb">its paraphrase (cache test)</span> ·
          <span class="preset" data-prompt="what is a tuple in python">short definition</span> ·
          <span class="preset" data-prompt="my python program that reads a csv and computes averages per student crashes with KeyError on some rows and the totals are wrong when a student appears twice. walk me through debugging it and show a fixed version">hard debugging question</span>
        </span>
        <span><kbd>Enter</kbd> send · <kbd>Shift+Enter</kbd> newline</span>
      </div>
    </div>
  </div>

  <!-- EVALUATION VIEW -->
  <div class="view scroll-view" id="view-eval">
    <div class="eyebrow">
      <span>Evaluation</span><span class="sep">·</span>
      <span>quality judge · learned router · cache threshold</span>
    </div>
    <h1 class="h1">Cheaper, but is it as good? <span class="muted">Here's the evidence.</span></h1>
    <p class="h2-sub">Every answer is graded 1–10 by an LLM judge against a reference answer. The router is trained on those grades, and the cache threshold is picked from labelled near-miss pairs.</p>

    <div class="panel">
      <h3>Evaluation workflow</h3>
      <p class="sub">Run these in a terminal from the project folder, then reload this tab.</p>
      <div class="steps" id="eval-steps"></div>
    </div>

    <div id="eval-results"></div>

    <div class="grid2 row-gap">
      <div class="panel" id="router-panel"></div>
      <div class="panel" id="cache-panel"></div>
    </div>
  </div>

  <!-- GATEWAY VIEW -->
  <div class="view scroll-view" id="view-gateway">
    <div class="eyebrow">
      <span>Gateway</span><span class="sep">·</span>
      <span>OpenAI-compatible · per-project budgets · streaming</span>
    </div>
    <h1 class="h1">Any app can use Sway. <span class="muted">Just change the base URL.</span></h1>
    <p class="h2-sub">Point any OpenAI SDK at the Sway proxy. Requests with <code>model: "sway-auto"</code> go through the full pipeline. Each project gets a daily budget, and every response reports what it cost in its headers.</p>

    <div class="panel" id="gw-status"></div>
    <div class="grid2 row-gap">
      <div class="panel">
        <h3>Use it from code</h3>
        <p class="sub">Nothing else in the app changes.</p>
        <pre class="snippet">import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "http://localhost:8788/v1",
  apiKey: "unused",
});

const r = await client.chat.completions.create(
  { model: "sway-auto",
    messages: [{ role: "user", content: "what is a tuple" }] },
  { headers: { "x-sway-project": "cs101" } },
);</pre>
      </div>
      <div class="panel">
        <h3>What comes back</h3>
        <p class="sub">Extra response headers on every call.</p>
        <div class="kv">
          <span class="k">x-sway-cost-usd</span><span class="v">what this call cost</span>
          <span class="k">x-sway-model</span><span class="v">model Sway picked</span>
          <span class="k">x-sway-cache</span><span class="v">hit | miss</span>
          <span class="k">x-sway-overhead-ms</span><span class="v">Sway's own latency</span>
          <span class="k">HTTP 429</span><span class="v">project over daily budget</span>
        </div>
        <p class="note" style="margin-top:14px">Also: <code>stream: true</code> (SSE), long chats summarised by the cheap model, and any model from <code>sway models</code> can be requested directly.</p>
      </div>
    </div>
    <div class="panel" id="gw-projects"></div>
    <div class="panel" id="gw-recent"></div>
  </div>

  <!-- SESSIONS VIEW -->
  <div class="view" id="view-sessions">
    <div class="eyebrow">
      <span>Sessions</span><span class="sep">·</span>
      <span>every Live prompt and bench run, saved</span>
    </div>
    <h1 class="h1">Pick a prompt. <span class="muted">See both answers.</span></h1>
    <p class="h2-sub">Each card on the left is a prompt that was run through both the raw API and Sway. Click one to see the side-by-side comparison with full stats. Data lives in <code style="background:var(--surface-2);padding:1px 5px;border-radius:3px;font-size:11.5px">~/.sway/metrics.db</code>.</p>

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
      ['live', 'eval', 'gateway', 'sessions'].forEach(n =>
        document.getElementById('view-' + n).classList.toggle('active', v === n));
      clearInterval(gwTimer);
      if (v === 'sessions') loadSessions();
      if (v === 'eval') loadEval();
      if (v === 'gateway') { loadGateway(); gwTimer = setInterval(loadGateway, 5000); }
    });
  });
  let gwTimer = null;

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

  // ===== Config: models, router, cache, sway.md =====
  let CFG = null;
  const flags = { context: 'full', optimize: true, router: 'learned', cache: true, escalate: true };
  // "eu.anthropic.claude-haiku-4-5-20251001-v1:0" -> "claude-haiku-4-5"
  function short(m) {
    return String(m || '').replace('eu.anthropic.', '').split('-')
      .filter(p => !/^[0-9]{8}$/.test(p) && p.indexOf('v1:') !== 0).join('-');
  }
  async function loadConfig() {
    try { CFG = await (await fetch('/api/config')).json(); } catch (e) { return; }
    const m = CFG.models;
    document.getElementById('status-models').innerHTML =
      '<span class="pill" title="flagship / cheap model">' + escape(short(m.flagship)) + ' · ' + escape(short(m.nano)) + '</span> ' +
      '<span class="pill ' + (CFG.router ? 'ok' : 'warn') + '">router: ' + (CFG.router ? 'learned' : 'not trained') + '</span> ' +
      '<span class="pill">cache: ' + CFG.cache.entries + '</span>';
    renderPipeMap();
  }

  // ===== Pipeline map (one card per stage, reflects the toggles) =====
  const STAGES = [
    { k: 'context',  t: 'Context',        v2: true,  d: 'Adds your sway.md. In "retrieve" mode, only the sections relevant to this prompt are sent.' },
    { k: 'optimize', t: 'Optimizer',      v2: false, d: 'A cheap model rewrites the prompt and labels its intent, which sets the output cap.' },
    { k: 'router',   t: 'Router',         v2: true,  d: 'Chooses the cheap or the flagship model. "learned" is trained on judge grades.' },
    { k: 'cache',    t: 'Semantic cache', v2: true,  d: 'Reuses a stored answer when an earlier prompt meant the same thing.' },
    { k: 'model',    t: 'Model call',     v2: false, d: 'Calls the chosen model, with the output capped by intent.' },
    { k: 'escalate', t: 'Escalation',     v2: true,  d: 'If the cheap answer is empty, cut off or hedging, Sway retries on the flagship.' },
  ];
  function stageState(k) {
    const c = CFG, m = c && c.models;
    if (k === 'context') {
      if (flags.context === 'off') return ['off', false];
      if (!c || !c.context) return ['no sway.md found', false];
      return [flags.context + ' · ' + c.context.sections.length + ' sections · ' + c.context.tokens + ' tok', true];
    }
    if (k === 'optimize') return flags.optimize ? ['on · ' + (m ? short(m.optimizer) : ''), true] : ['off', false];
    if (k === 'router') {
      if (flags.router === 'off') return ['off · always flagship', false];
      if (flags.router === 'learned' && !(c && c.router)) return ['not trained · using rules', true];
      if (flags.router === 'learned') return ['learned · threshold ' + c.router.threshold, true];
      return ['rules · keyword signals', true];
    }
    if (k === 'cache') return flags.cache ? ['threshold ' + (c ? c.cache.threshold : '') + ' · ' + (c ? c.cache.entries : 0) + ' stored', true] : ['off', false];
    if (k === 'model') return [m ? short(m.nano) + ' / ' + short(m.flagship) : '', true];
    return flags.escalate ? ['on', true] : ['off', false];
  }
  function renderPipeMap() {
    document.getElementById('pipe-map').innerHTML = STAGES.map((s, i) => {
      const st = stageState(s.k);
      return '<div class="stage' + (st[1] ? '' : ' off') + '">' + (s.v2 ? '<span class="new">v0.2</span>' : '') +
        '<div class="n">0' + (i + 1) + '</div><div class="t">' + s.t + '</div><div class="d">' + s.d + '</div>' +
        '<div class="s" title="' + escape(st[0]) + '">' + escape(st[0]) + '</div></div>';
    }).join('');
  }

  // ===== Toggles =====
  document.querySelectorAll('.seg').forEach(seg => {
    const f = seg.dataset.flag;
    const sync = () => seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(flags[f])));
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      flags[f] = b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v;
      sync(); renderPipeMap();
    }));
    sync();
  });

  // ===== Hero stats accumulator =====
  const stats = { count: 0, rawCost: 0, swayCost: 0, nano: 0, flag: 0, esc: 0, hits: 0, ctxSaved: 0, ovh: 0 };
  function updateHero(raw, s) {
    stats.count++;
    stats.rawCost += raw.cost;
    stats.swayCost += s.costUsd;
    if (s.cacheHit) stats.hits++;
    else if (s.escalated) stats.esc++;
    else if (s.tier === 'nano') stats.nano++;
    else stats.flag++;
    stats.ctxSaved += Math.max(0, s.contextTokensFull - s.contextTokensSent);
    stats.ovh += s.overheadMs;
    document.getElementById('hero-stats').style.display = 'grid';
    const avg = stats.rawCost === 0 ? 0 : ((stats.rawCost - stats.swayCost) / stats.rawCost) * 100;
    document.getElementById('hero-savings').textContent = avg.toFixed(1) + '%';
    document.getElementById('hero-calls').textContent = stats.count;
    document.getElementById('hero-cost-raw').textContent = fmtUsd4(stats.rawCost);
    document.getElementById('hero-cost-sway').textContent = fmtUsd4(stats.swayCost);
    document.getElementById('hero-nano').textContent = stats.nano;
    document.getElementById('hero-flag').textContent = stats.flag;
    document.getElementById('hero-esc').textContent = stats.esc;
    document.getElementById('hero-hits').textContent = stats.hits;
    document.getElementById('hero-ctx').textContent = stats.ctxSaved.toLocaleString();
    document.getElementById('hero-ovh').textContent = Math.round(stats.ovh / stats.count) + ' ms';
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

  function loadingHTML(label) {
    return '<div class="loading">' + label + '<span class="loading-dots"><span></span><span></span><span></span></span></div>';
  }
  function colHeader(label, modelHtml) {
    return '<h4><span class="dot"></span> ' + label + (modelHtml ? ' <span style="color:var(--ink-2);font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;margin-left:6px">' + modelHtml + '</span>' : '') + '</h4>';
  }

  function newTurn(prompt) {
    const empty = document.getElementById('timeline-empty');
    if (empty) empty.remove();
    turnCounter++;
    const turn = document.createElement('div');
    turn.className = 'turn';
    turn.innerHTML =
      '<div class="turn-prompt"><span class="num">#' + turnCounter + '</span>' + escape(prompt) + '</div>' +
      '<div class="turn-cols">' +
        '<div class="turn-col raw" data-side="raw">' + colHeader('Raw API', 'flagship · no Sway · 4096 cap') + loadingHTML('Flagship is answering') + '</div>' +
        '<div class="turn-col sway" data-side="sway">' + colHeader('Sway', 'running the pipeline') + loadingHTML('Sway is working') + '</div>' +
      '</div>';
    timeline.appendChild(turn);
    timeline.scrollTop = timeline.scrollHeight;
    return turn;
  }
  function fillRaw(turn, raw) {
    const col = turn.querySelector('[data-side="raw"]');
    col.innerHTML =
      colHeader('Raw API', escape(short(raw.model))) +
      '<div class="text">' + (raw.text ? renderMd(raw.text) : '<em style="color:var(--ink-2)">(no response)</em>') + '</div>' +
      '<div class="meta">' +
        '<span>in <b>' + raw.inputTokens + '</b></span>' +
        '<span>out <b>' + raw.outputTokens + '</b></span>' +
        '<span>cost <b>' + fmtUsd(raw.cost) + '</b></span>' +
        '<span>' + raw.ms + 'ms</span>' +
      '</div>';
  }

  function tierBadge(s) {
    if (s.cacheHit) return '<span class="badge hit">cache hit</span>';
    if (s.escalated) return '<span class="badge esc">escalated</span>';
    if (s.tier === 'nano') return '<span class="badge nano">cheap model</span>';
    return '<span class="badge flagship">flagship</span>';
  }
  function traceHTML(s, f) {
    const li = (cls, k, v) => '<li class="' + cls + '"><span class="ic"></span><span class="k">' + k + '</span><span class="v">' + v + '</span></li>';
    const thr = CFG ? CFG.cache.threshold : 0.92;
    const out = [];
    // 1. Context
    if (f.context === 'off') out.push(li('off', 'Context', 'off'));
    else if (!s.contextHash) out.push(li('off', 'Context', 'no sway.md found'));
    else if (f.context === 'retrieve' && s.contextTokensSent < s.contextTokensFull)
      out.push(li('hit', 'Context', 'sent <b>' + s.contextTokensSent + '</b> of ' + s.contextTokensFull + ' tok · dropped: ' + escape(s.contextDropped.join(', '))));
    else out.push(li('on', 'Context', (f.context === 'retrieve' ? 'every section relevant · ' : 'full sway.md · ') + '<b>' + s.contextTokensSent + '</b> tok'));
    // 2. Optimizer
    if (!f.optimize) out.push(li('off', 'Optimizer', 'off'));
    else if (!s.optimizedPrompt) out.push(li('warn', 'Optimizer', 'failed, so the original prompt was sent'));
    else out.push(li('on', 'Optimizer', 'intent <b>' + escape(s.intent) + '</b> · prompt rewritten'));
    // 3. Router
    if (s.tier === 'forced' || f.router === 'off') out.push(li('off', 'Router', 'off · flagship'));
    else if (s.routeProb != null) {
      out.push(li('on', 'Router', 'p(needs flagship) = <b>' + s.routeProb.toFixed(2) + '</b> ' + (s.tier === 'nano' ? '&lt;' : '≥') +
        ' threshold ' + (CFG && CFG.router ? CFG.router.threshold : '') + ' → <b>' + s.tier + '</b>'));
    } else {
      const isFb = x => x.indexOf(': rules fallback') > 0;
      const fb = s.routeSignals.find(isFb);
      const sig = s.routeSignals.filter(x => !isFb(x) && x.indexOf('escalated:') !== 0).slice(0, 3);
      out.push(li(fb ? 'warn' : 'on', 'Router', (fb ? (fb.indexOf('no model trained') === 0 ? 'no trained model' : 'learned router unavailable') + ', so rules were used' : 'rules') + ' → <b>' + s.tier + '</b>' +
        (sig.length ? ' · ' + escape(sig.join(', ')) : '')));
    }
    // 4. Semantic cache
    if (!f.cache) out.push(li('off', 'Cache', 'off'));
    else if (s.cacheHit) out.push(li('hit', 'Cache', '<b>hit</b> · similarity ' + Number(s.cacheSimilarity).toFixed(3) + ' ≥ ' + thr + ', so no model call was made'));
    else if (s.cacheSimilarity) out.push(li('on', 'Cache', 'miss · closest ' + s.cacheSimilarity.toFixed(3) + ' &lt; ' + thr));
    else out.push(li('on', 'Cache', 'miss · no similar prompt stored yet'));
    // 5. Model call
    if (s.cacheHit) out.push(li('off', 'Model call', 'skipped'));
    else {
      const cap = s.intent && CFG ? (CFG.tokenBudget[s.intent] || 1200) : 2048;
      const mdl = s.escalated && CFG ? escape(short(CFG.models.nano)) + ', then <b>' + escape(short(s.model)) + '</b>' : '<b>' + escape(short(s.model)) + '</b>';
      out.push(li('on', 'Model call', mdl + ' · output cap ' + cap + ' tok (raw: 4096)'));
    }
    // 6. Escalation
    if (!f.escalate) out.push(li('off', 'Escalation', 'off'));
    else if (s.escalated) out.push(li('warn', 'Escalation', 'cheap answer was <b>' + escape(s.escalationReason) + '</b>, so it was retried on the flagship'));
    else if (s.cacheHit || s.tier !== 'nano') out.push(li('off', 'Escalation', 'not needed'));
    else out.push(li('on', 'Escalation', 'cheap answer passed the checks'));
    return '<ul class="trace">' + out.join('') + '</ul>';
  }
  function fillSway(turn, raw, s, f) {
    const col = turn.querySelector('[data-side="sway"]');
    col.innerHTML =
      colHeader('Sway', escape(short(s.model)) + ' ' + tierBadge(s)) +
      (s.cacheHit
        ? '<div class="hitbanner">⚡ Answered from the semantic cache <span>· cost ' + fmtUsd(s.costUsd) + ' vs ' + fmtUsd(raw.cost) + ' raw</span></div>'
        : '') +
      traceHTML(s, f) +
      (s.optimizedPrompt
        ? '<details class="optbox"><summary>Show the rewritten prompt</summary><div class="v">' + escape(s.optimizedPrompt) + '</div></details>'
        : '') +
      '<div class="text">' + (s.text ? renderMd(s.text) : '<em style="color:var(--ink-2)">(no response)</em>') + '</div>' +
      '<div class="meta">' +
        '<span>in <b>' + s.inputTokens + '</b></span>' +
        '<span>out <b>' + s.outputTokens + '</b></span>' +
        '<span>cost <b>' + fmtUsd(s.costUsd) + '</b></span>' +
        '<span>' + s.latencyMs + 'ms</span>' +
        '<span title="Time spent inside Sway, excluding API calls">overhead <b>' + s.overheadMs + 'ms</b></span>' +
        '<span class="savings">saved ' + pct(s.costUsd, raw.cost) + '</span>' +
      '</div>';
  }
  function fillError(turn, message) {
    ['raw', 'sway'].forEach(side => {
      const col = turn.querySelector('[data-side="' + side + '"]');
      col.classList.add('error');
      col.innerHTML = colHeader(side === 'raw' ? 'Raw API' : 'Sway', '') + '<div class="text">Error: ' + escape(message) + '</div>';
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
        body: JSON.stringify(Object.assign({ prompt: text }, flags)),
      });
      const data = await r.json();
      if (data.error) throw new Error(data.error);
      fillRaw(turn, data.raw);
      fillSway(turn, data.raw, data.sway, data.flags);
      updateHero(data.raw, data.sway);
      loadConfig(); // cache entry count changed
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

  // ===== Shared bits for Evaluation / Gateway =====
  function cmdBox(cmd) {
    return '<div class="cmd"><code>' + escape(cmd) + '</code><button type="button">copy</button></div>';
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('.cmd button');
    if (!b) return;
    navigator.clipboard.writeText(b.previousElementSibling.textContent).then(() => {
      b.textContent = 'copied';
      setTimeout(() => { b.textContent = 'copy'; }, 1200);
    });
  });
  function svgEl(w, h, inner) {
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img">' + inner + '</svg>';
  }
  function niceTicks(max, n) {
    const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
    const out = [];
    for (let v = 0; v <= max + step * 0.01; v += step) out.push(+v.toFixed(10));
    return out;
  }
  // Show a tooltip at an SVG coordinate inside .chart
  function showTip(chart, svgX, svgY, vbW, html) {
    const tip = chart.querySelector('.tip');
    const svg = chart.querySelector('svg');
    const k = svg.getBoundingClientRect().width / vbW;
    tip.innerHTML = html;
    tip.style.opacity = 1;
    const x = svgX * k, y = svgY * k;
    const left = Math.min(x + 12, chart.clientWidth - tip.offsetWidth - 4);
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + 'px';
  }
  function hideTip(chart) { chart.querySelector('.tip').style.opacity = 0; }

  // ===== EVALUATION =====
  let cacheResult = null;
  async function loadEval() {
    const results = await Promise.all([fetch('/api/evals').then(r => r.json()), loadConfig()]);
    const runs = results[0];
    renderSteps(runs);
    renderRouter();
    renderCachePanel();
    const box = document.getElementById('eval-results');
    if (!runs.length) {
      box.innerHTML = '<div class="panel"><h3>No evaluation runs yet</h3><p class="sub" style="margin:0">Run step 1 to get the first cost-vs-quality comparison. Add <code>-n 5</code> for a quick, cheap smoke test.</p></div>';
      return;
    }
    box.innerHTML = '<div class="panel"><h3>Results <select class="sel" id="run-sel" aria-label="Eval run">' +
      runs.map(r => '<option value="' + escape(r.run_id) + '">' + escape(r.run_id) + ' · ' + escape(r.dataset) + ' · ' + escape(r.configs) + '</option>').join('') +
      '</select></h3><div id="run-body"></div></div>';
    document.getElementById('run-sel').addEventListener('change', e => loadRun(e.target.value));
    loadRun(runs[0].run_id);
  }

  function renderSteps(runs) {
    const has = c => runs.some(r => (',' + r.configs + ',').indexOf(',' + c + ',') >= 0);
    const steps = [
      { t: 'Baseline eval', d: 'Grades flagship, cheap model and v0.1 Sway on 40 CS-101 prompts. This also produces the labels for training the router.', cmd: 'sway eval --configs flagship,nano,sway-v01', done: has('nano') && has('flagship') },
      { t: 'Train the router', d: 'Fits a logistic regression on the grades with 5-fold cross-validation and compares it to the v0.1 rules.', cmd: 'sway train-router', done: !!(CFG && CFG.router) },
      { t: 'Full eval', d: 'Compares v0.1 with the learned router, and with router + cache + context retrieval.', cmd: 'sway eval --configs flagship,sway-v01,sway-learned,sway-full', done: has('sway-full') || has('sway-learned') },
      { t: 'Cache threshold', d: 'Tries similarity thresholds on 40 labelled prompt pairs. You can also run this from the panel below.', cmd: 'sway cache-eval', done: !!cacheResult },
    ];
    document.getElementById('eval-steps').innerHTML = steps.map((s, i) =>
      '<div class="step' + (s.done ? ' done' : '') + '"><div class="hd"><span class="ck">✓</span>' + (i + 1) + '. ' + s.t + '</div>' +
      '<div class="d">' + s.d + '</div>' + cmdBox(s.cmd) + '</div>').join('');
  }

  async function loadRun(id) {
    const body = document.getElementById('run-body');
    body.innerHTML = '<p class="note">Loading…</p>';
    const r = await fetch('/api/eval?run=' + encodeURIComponent(id)).then(x => x.json());
    if (r.error) { body.innerHTML = '<p class="note">' + escape(r.error) + '</p>'; return; }
    const base = r.summary.find(s => s.config === 'flagship');
    // Headline = the most complete Sway config in the run (not the best-looking one).
    const swayCfgs = r.summary.filter(s => s.config.indexOf('sway') === 0);
    const hero = swayCfgs[swayCfgs.length - 1];
    let html = '';
    if (base && hero && base.cost > 0 && hero.n) {
      const saved = (1 - hero.cost / base.cost) * 100;
      const dq = hero.quality - base.quality;
      html += '<div class="headline"><span class="big">' + Math.abs(saved).toFixed(0) + '% ' + (saved >= 0 ? 'cheaper' : 'more expensive') + '</span>' +
        '<span class="txt"><b>' + escape(hero.config) + '</b> vs raw flagship on ' + hero.n + ' prompts. Judge quality <b>' + hero.quality.toFixed(2) +
        '</b> vs <b>' + base.quality.toFixed(2) + '</b> (<span class="' + (dq >= -0.3 ? 'good' : 'bad') + '">' + (dq >= 0 ? '+' : '') + dq.toFixed(2) + '</span>)</span></div>';
    }
    html += '<div class="grid2 row-gap"><div>' + scatterHTML(r.summary) + '</div><div>' + categoryHTML(r) + '</div></div>';
    html += '<div class="tbl-wrap">' + summaryTable(r, base, hero) + '</div>';
    html += lowHTML(r.low);
    body.innerHTML = html;
    bindScatter(body.querySelector('.chart.scatter'), r.summary, base);
  }

  function summaryTable(r, base, hero) {
    const label = {};
    r.configs.forEach(c => { label[c.id] = c.label; });
    const rows = r.summary.map(s => {
      const dq = base ? s.quality - base.quality : null;
      const saved = base && base.cost > 0 ? (1 - s.cost / base.cost) * 100 : null;
      return '<tr' + (hero && s.config === hero.config ? ' class="hl"' : '') + '>' +
        '<td title="' + escape(label[s.config]) + '"><b>' + escape(s.config) + '</b></td>' +
        '<td class="num">' + s.n + (s.errors ? ' <span class="bad">+' + s.errors + ' err</span>' : '') + '</td>' +
        '<td class="num">' + s.quality.toFixed(2) + '</td>' +
        '<td class="num">' + (dq == null || s.config === 'flagship' ? '—' : '<span class="' + (dq >= -0.3 ? 'good' : 'bad') + '">' + (dq >= 0 ? '+' : '') + dq.toFixed(2) + '</span>') + '</td>' +
        '<td class="num">' + fmtUsd4(s.cost) + '</td>' +
        '<td class="num">' + (saved == null || s.config === 'flagship' ? '—' : saved.toFixed(1) + '%') + '</td>' +
        '<td class="num">' + (s.nanoShare * 100).toFixed(0) + '%</td>' +
        '<td class="num">' + s.cacheHits + '</td>' +
        '<td class="num">' + s.escalations + '</td>' +
        '<td class="num">' + s.latency.toFixed(0) + ' ms</td></tr>';
    }).join('');
    return '<table class="tbl"><thead><tr><th>Config</th><th class="num">N</th><th class="num">Quality</th><th class="num">Δ vs raw</th><th class="num">Cost</th><th class="num">Saved</th><th class="num">→ cheap</th><th class="num">Cache hits</th><th class="num">Escalated</th><th class="num">Avg latency</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function categoryHTML(r) {
    const head = r.configs.map(c => '<th class="num">' + escape(c.id) + '</th>').join('');
    const rows = r.categories.map(c => '<tr><td>' + escape(c.category) + '</td>' +
      c.scores.map(v => '<td class="num">' + (v == null ? '—' : v.toFixed(1)) + '</td>').join('') + '</tr>').join('');
    return '<div class="note" style="margin-bottom:6px"><b style="color:var(--ink)">Quality by category</b> (mean judge score)</div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Category</th>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function lowHTML(low) {
    if (!low.length) return '<p class="note" style="margin-top:14px">No Sway answer scored 5 or below in this run.</p>';
    return '<div class="note" style="margin:16px 0 6px"><b style="color:var(--ink)">Weakest Sway answers</b> (score ≤ 5), with the judge’s reason</div>' +
      '<div class="tbl-wrap"><table class="tbl"><tbody>' + low.map(l =>
        '<tr><td><b>' + escape(l.config) + '</b></td><td class="num bad">' + l.score + '/10</td><td class="txt">' + escape(l.prompt.slice(0, 90)) +
        '</td><td class="txt" style="color:var(--ink-2)">' + escape(l.reason || '') + '</td></tr>').join('') + '</tbody></table></div>';
  }

  // Cost (x) vs quality (y), one dot per config. Up-left is better.
  const SC = { W: 520, H: 300, l: 44, r: 96, t: 22, b: 40 };
  function scatterHTML(summary) {
    const pts = summary.filter(s => s.n);
    if (pts.length < 2) return '<p class="note">Need at least two configs to plot cost against quality.</p>';
    const maxC = Math.max.apply(null, pts.map(p => p.cost)) * 1.12 || 1;
    const minQ = Math.max(0, Math.floor(Math.min.apply(null, pts.map(p => p.quality)) - 1));
    const x = v => SC.l + (v / maxC) * (SC.W - SC.l - SC.r);
    const y = v => SC.t + (1 - (v - minQ) / (10 - minQ)) * (SC.H - SC.t - SC.b);
    let g = '<g class="grid">';
    const yt = []; for (let q = minQ; q <= 10; q++) yt.push(q);
    const step = yt.length > 6 ? 2 : 1;
    let ax = '<g class="axis">';
    yt.filter(q => (q - minQ) % step === 0).forEach(q => {
      g += '<line x1="' + SC.l + '" x2="' + (SC.W - SC.r) + '" y1="' + y(q) + '" y2="' + y(q) + '"/>';
      ax += '<text x="' + (SC.l - 8) + '" y="' + (y(q) + 4) + '" text-anchor="end">' + q + '</text>';
    });
    const xt = niceTicks(maxC, 4);
    const dp = Math.max(0, -Math.floor(Math.log10(xt[1] || 1)) + 1); // one decimal finer than the step
    xt.forEach(c => {
      ax += '<text x="' + x(c) + '" y="' + (SC.H - SC.b + 18) + '" text-anchor="middle">$' + c.toFixed(dp) + '</text>';
    });
    g += '</g>';
    ax += '<text x="' + SC.l + '" y="' + (SC.t - 9) + '">Quality (1–10)</text>';
    ax += '<text x="' + (SC.W - SC.r) + '" y="' + (SC.H - 4) + '" text-anchor="end">Total cost →</text></g>';
    const placed = [];
    let dots = '';
    pts.forEach((p, i) => {
      const cx = x(p.cost), cy = y(p.quality);
      const isBase = p.config === 'flagship' || p.config === 'nano';
      const w = p.config.length * 6.4;
      let lx = cx + 11, anchor = 'start';
      const box = () => ({ a: anchor === 'start' ? lx : lx - w, b: anchor === 'start' ? lx + w : lx, y: cy });
      const hits = bx => placed.some(o => Math.abs(o.y - bx.y) < 13 && bx.a < o.b && bx.b > o.a);
      if (hits(box())) { lx = cx - 11; anchor = 'end'; }
      placed.push(box());
      dots += '<circle cx="' + cx + '" cy="' + cy + '" r="6" fill="' + (isBase ? '#86868b' : '#1a56ff') + '" stroke="#fff" stroke-width="2"/>' +
        '<text class="lbl' + (isBase ? '' : ' strong') + '" x="' + lx + '" y="' + (cy + 4) + '" text-anchor="' + anchor + '">' + escape(p.config) + '</text>' +
        '<circle class="hit" data-i="' + i + '" cx="' + cx + '" cy="' + cy + '" r="14" fill="transparent" style="cursor:default"/>';
    });
    const corner = '<text class="lbl" x="' + (SC.l + 6) + '" y="' + (SC.t + 12) + '" style="fill:var(--ink-3)">↖ cheaper and better</text>';
    return '<div class="legend"><span><i style="background:#86868b"></i>Raw baseline</span><span><i style="background:#1a56ff"></i>Sway config</span></div>' +
      '<div class="chart scatter">' + svgEl(SC.W, SC.H, g + ax + corner + dots) + '<div class="tip"></div></div>';
  }
  function bindScatter(chart, summary, base) {
    if (!chart) return;
    const pts = summary.filter(s => s.n);
    chart.querySelectorAll('circle.hit').forEach(c => {
      c.addEventListener('mouseenter', () => {
        const p = pts[+c.dataset.i];
        const saved = base && base.cost > 0 && p.config !== 'flagship' ? ' · ' + ((1 - p.cost / base.cost) * 100).toFixed(1) + '% saved' : '';
        showTip(chart, +c.getAttribute('cx'), +c.getAttribute('cy'), SC.W,
          '<b>' + escape(p.config) + '</b><br><span class="m">quality ' + p.quality.toFixed(2) + ' · ' + fmtUsd4(p.cost) + saved +
          '<br>' + (p.nanoShare * 100).toFixed(0) + '% to cheap model · ' + p.cacheHits + ' cache hits</span>');
      });
      c.addEventListener('mouseleave', () => hideTip(chart));
    });
  }

  function renderRouter() {
    const p = document.getElementById('router-panel');
    const r = CFG && CFG.router;
    let h = '<h3>Learned router</h3><p class="sub">Predicts whether a prompt needs the flagship. It is trained on the judge grades: a prompt is labelled "needs flagship" when the cheap model answered it clearly worse.</p>';
    if (!r) {
      p.innerHTML = h + '<p class="note">Not trained yet, so the router uses the v0.1 keyword rules. Complete steps 1 and 2 above, then restart <code>sway serve</code>.</p>';
      return;
    }
    const m = r.metrics || {}, sim = m.simulated || {};
    const base = sim.allFlagship;
    const row = (name, acc, s, hl) => !s ? '' : '<tr' + (hl ? ' class="hl"' : '') + '><td>' + name + '</td><td class="num">' + acc + '</td><td class="num">' +
      (s.nanoShare * 100).toFixed(0) + '%</td><td class="num">' + s.quality.toFixed(2) + '</td><td class="num">' +
      (base && base.cost ? ((1 - s.cost / base.cost) * 100).toFixed(1) + '%' : '—') + '</td></tr>';
    const pc = v => v == null ? '—' : (v * 100).toFixed(0) + '%';
    p.innerHTML = h +
      '<div class="kv row-gap"><span class="k">Features</span><span class="v">' + escape(r.variant) + '</span>' +
      '<span class="k">Threshold</span><span class="v">' + r.threshold + ' (p ≥ threshold → flagship)</span>' +
      '<span class="k">Trained on</span><span class="v">' + escape(r.runId) + ' · ' + (m.items || '?') + ' prompts · ' + new Date(r.trainedAt).toLocaleDateString() + '</span></div>' +
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Policy (5-fold CV)</th><th class="num">Accuracy</th><th class="num">→ cheap</th><th class="num">Quality</th><th class="num">Saved</th></tr></thead><tbody>' +
      row('All flagship', '—', sim.allFlagship) + row('All cheap', '—', sim.allNano) +
      row('v0.1 rules', pc(m.rulesAccuracy), sim.rules) + row('Learned', pc(m.cvAccuracy), sim.learned, true) +
      '</tbody></table></div>';
  }

  function renderCachePanel() {
    const p = document.getElementById('cache-panel');
    const h = '<h3>Semantic cache threshold</h3><p class="sub">How similar two prompts must be before Sway reuses an answer. If it is too low, wrong answers get served (false hits). If it is too high, nothing ever hits.</p>';
    if (!cacheResult) {
      p.innerHTML = h + '<button class="btn" id="run-sweep">Run threshold sweep</button>' +
        '<p class="note" style="margin-top:8px">Embeds 80 prompts once (results are cached). Costs well under $0.001.</p>';
      document.getElementById('run-sweep').addEventListener('click', runSweep);
      return;
    }
    const c = cacheResult;
    const best = c.best;
    p.innerHTML = h +
      (best ? '<p class="note row-gap">Best threshold with ≤ 5% false hits: <b style="color:var(--ink)">' + best.threshold.toFixed(2) + '</b>, which catches <b style="color:var(--ink)">' +
        (best.hitRate * 100).toFixed(0) + '%</b> of true paraphrases. The current default is ' + c.current + '.</p>'
        : '<p class="note row-gap">No threshold from 0.80 to 0.98 keeps false hits at or below 5%.</p>') +
      sweepHTML(c) +
      '<div class="note" style="margin:12px 0 6px"><b style="color:var(--ink)">Hardest near-misses</b>: these must not hit</div>' +
      '<div class="tbl-wrap"><table class="tbl"><tbody>' + c.nearMisses.map(x =>
        '<tr><td class="num' + (x.sim >= c.current ? ' bad' : '') + '">' + x.sim.toFixed(3) + '</td><td class="txt">' + escape(x.a) + ' <span style="color:var(--ink-3)">vs</span> ' + escape(x.b) + '</td></tr>').join('') +
      '</tbody></table></div>';
    bindSweep(p.querySelector('.chart.sweep'), c);
  }
  async function runSweep() {
    const b = document.getElementById('run-sweep');
    b.disabled = true; b.textContent = 'Embedding pairs…';
    try {
      const r = await fetch('/api/cache-eval', { method: 'POST' }).then(x => x.json());
      if (r.error) throw new Error(r.error);
      cacheResult = r;
      renderCachePanel();
      document.querySelectorAll('#eval-steps .step')[3].classList.add('done');
    } catch (e) {
      b.disabled = false; b.textContent = 'Run threshold sweep';
      b.insertAdjacentHTML('afterend', '<p class="note bad" style="margin-top:8px">' + escape(e.message) + '</p>');
    }
  }
  // Hit rate and false-hit rate vs threshold, same 0–100% axis.
  const SW = { W: 460, H: 230, l: 40, r: 74, t: 16, b: 34 };
  function sweepHTML(c) {
    const rows = c.rows;
    const t0 = rows[0].threshold, t1 = rows[rows.length - 1].threshold;
    const x = t => SW.l + ((t - t0) / (t1 - t0)) * (SW.W - SW.l - SW.r);
    const y = v => SW.t + (1 - v) * (SW.H - SW.t - SW.b);
    let g = '<g class="grid">', ax = '<g class="axis">';
    [0, 0.25, 0.5, 0.75, 1].forEach(v => {
      g += '<line x1="' + SW.l + '" x2="' + (SW.W - SW.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      ax += '<text x="' + (SW.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + (v * 100) + '%</text>';
    });
    [0.80, 0.84, 0.88, 0.92, 0.96].forEach(t => { ax += '<text x="' + x(t) + '" y="' + (SW.H - SW.b + 16) + '" text-anchor="middle">' + t.toFixed(2) + '</text>'; });
    ax += '<text x="' + (SW.W - SW.r) + '" y="' + (SW.H - 2) + '" text-anchor="end">similarity threshold →</text></g>';
    g += '</g>';
    const ref = (t, label, col) => '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="' + SW.t + '" y2="' + (SW.H - SW.b) + '" stroke="' + col + '" stroke-width="1"/>' +
      '<text class="lbl" x="' + (x(t) + 4) + '" y="' + (SW.t + 10) + '">' + label + '</text>';
    let refs = ref(c.current, 'default', '#86868b');
    if (c.best && Math.abs(c.best.threshold - c.current) > 0.001) refs += ref(c.best.threshold, 'best', '#1a56ff').replace('y="' + (SW.t + 10) + '"', 'y="' + (SW.t + 22) + '"');
    const line = (key, col) => '<polyline fill="none" stroke="' + col + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' +
      rows.map(r => x(r.threshold) + ',' + y(r[key])).join(' ') + '"/>';
    const last = rows[rows.length - 1];
    const ends = '<text class="lbl strong" x="' + (x(t1) + 8) + '" y="' + (y(last.hitRate) + 4) + '">hit rate</text>' +
      '<text class="lbl strong" x="' + (x(t1) + 8) + '" y="' + (y(last.falseHitRate) + 4) + '">false hits</text>';
    const hover = '<line class="xh" y1="' + SW.t + '" y2="' + (SW.H - SW.b) + '" stroke="#1d1d1f" stroke-width="1" style="opacity:0"/>' +
      '<rect class="ov" x="' + SW.l + '" y="' + SW.t + '" width="' + (SW.W - SW.l - SW.r) + '" height="' + (SW.H - SW.t - SW.b) + '" fill="transparent"/>';
    return '<div class="legend"><span><i class="line" style="background:#1a56ff"></i>Hit rate (true paraphrases reused)</span><span><i class="line" style="background:#e8590c"></i>False-hit rate (wrong answer served)</span></div>' +
      '<div class="chart sweep">' + svgEl(SW.W, SW.H, g + ax + refs + line('hitRate', '#1a56ff') + line('falseHitRate', '#e8590c') + ends + hover) + '<div class="tip"></div></div>';
  }
  function bindSweep(chart, c) {
    if (!chart) return;
    const svg = chart.querySelector('svg'), ov = chart.querySelector('.ov'), xh = chart.querySelector('.xh');
    const rows = c.rows, t0 = rows[0].threshold, t1 = rows[rows.length - 1].threshold;
    const x = t => SW.l + ((t - t0) / (t1 - t0)) * (SW.W - SW.l - SW.r);
    ov.addEventListener('mousemove', e => {
      const k = SW.W / svg.getBoundingClientRect().width;
      const sx = (e.clientX - svg.getBoundingClientRect().left) * k;
      const r = rows.reduce((a, b) => Math.abs(x(b.threshold) - sx) < Math.abs(x(a.threshold) - sx) ? b : a);
      xh.setAttribute('x1', x(r.threshold)); xh.setAttribute('x2', x(r.threshold)); xh.style.opacity = 0.25;
      showTip(chart, x(r.threshold), SW.t + 30, SW.W, '<b>threshold ' + r.threshold.toFixed(2) + '</b><br><span class="m">hit rate ' + (r.hitRate * 100).toFixed(0) +
        '% · false hits ' + (r.falseHitRate * 100).toFixed(0) + '%<br>precision ' + (r.precision * 100).toFixed(0) + '%</span>');
    });
    ov.addEventListener('mouseleave', () => { xh.style.opacity = 0; hideTip(chart); });
  }

  // ===== GATEWAY =====
  async function loadGateway() {
    let g;
    try { g = await fetch('/api/gateway').then(r => r.json()); } catch (e) { return; }
    const base = 'http://localhost:' + g.port + '/v1';
    const curl = 'curl ' + base + '/chat/completions -H "Content-Type: application/json" -H "x-sway-project: demo" -d ' + "'" + '{"model":"sway-auto","messages":[{"role":"user","content":"what is a tuple"}]}' + "'";
    document.getElementById('gw-status').innerHTML =
      '<h3><span class="live-dot' + (g.up ? ' up' : '') + '"></span> Proxy ' + (g.up ? 'running' : 'not running') +
      ' <span class="badge flagship">' + base + '</span></h3>' +
      (g.up
        ? '<p class="sub">Listening. Traffic below refreshes every 5 seconds. Send a request to see it appear:</p>' + cmdBox(curl)
        : '<p class="sub">Start it in a second terminal. The budget is in USD per project per UTC day, and the project is set by the <code>x-sway-project</code> header.</p>' +
          '<div style="max-width:440px">' + cmdBox('sway proxy --budget 1') + '</div>');

    const pj = g.projects;
    document.getElementById('gw-projects').innerHTML = '<h3>Projects</h3><p class="sub">Spend per <code>x-sway-project</code>, which is what the daily budget is checked against.</p>' +
      (!pj.length ? '<p class="note">No gateway traffic yet.</p>' :
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Project</th><th class="num">Calls</th><th class="num">Spent today</th><th class="num">All time</th><th class="num">→ cheap</th><th class="num">Cache hits</th><th class="num">Escalated</th><th>Last call</th></tr></thead><tbody>' +
      pj.map(p => '<tr><td><b>' + escape(p.project) + '</b></td><td class="num">' + p.calls + '</td><td class="num">' + fmtUsd4(p.cost_today) + '</td><td class="num">' + fmtUsd4(p.cost) +
        '</td><td class="num">' + (p.calls ? (p.nano / p.calls * 100).toFixed(0) : 0) + '%</td><td class="num">' + p.cache_hits + '</td><td class="num">' + p.escalations +
        '</td><td>' + new Date(p.last_ts).toLocaleTimeString() + '</td></tr>').join('') + '</tbody></table></div>');

    const rc = g.recent;
    document.getElementById('gw-recent').innerHTML = '<h3>Recent requests</h3>' +
      (!rc.length ? '<p class="note">Requests made through the proxy will appear here.</p>' :
      '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Time</th><th>Project</th><th>Prompt</th><th>Model</th><th class="num">Cost</th><th class="num">Latency</th><th>Sway</th></tr></thead><tbody>' +
      rc.map(r => '<tr><td>' + new Date(r.ts).toLocaleTimeString() + '</td><td>' + escape(r.project) + '</td><td class="txt">' + escape((r.prompt || '').slice(0, 70)) +
        '</td><td>' + escape(short(r.model)) + '</td><td class="num">' + fmtUsd(r.cost) + '</td><td class="num">' + r.latencyMs + ' ms</td><td>' +
        (r.cacheHit ? '<span class="badge hit">cache ' + (r.sim != null ? r.sim.toFixed(2) : '') + '</span>' : r.escalated ? '<span class="badge esc">escalated</span>' :
          r.tier ? '<span class="badge ' + (r.tier === 'nano' ? 'nano' : 'flagship') + '">' + escape(r.tier) + '</span>' : '') +
        '</td></tr>').join('') + '</tbody></table></div>');
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
            '<span class="label">Raw · ' + escape(short(p.raw.model)) + '</span>' +
            '<span class="cost">' + fmtUsd(p.raw.cost_usd) + '</span>' +
            '<span class="tokens">' + p.raw.input_tokens + ' in · ' + p.raw.output_tokens + ' out</span>' +
          '</div>' +
          '<div class="stat-side sway">' +
            '<span class="label">Sway · ' + escape(short(p.sway.model)) + '</span>' +
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
            '<h4><span class="dot"></span> Raw API <span style="color:var(--ink-2);font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;margin-left:6px">' + escape(short(p.raw.model)) + '</span></h4>' +
            '<div class="text">' + (p.raw.text ? renderMd(p.raw.text) : '<em style="color:var(--ink-2)">(no response stored)</em>') + '</div>' +
            '<div class="meta">' +
              '<span>in <b>' + p.raw.inputTokens + '</b></span>' +
              '<span>out <b>' + p.raw.outputTokens + '</b></span>' +
              '<span>cost <b>' + fmtUsd(p.raw.cost) + '</b></span>' +
            '</div>' +
          '</div>' +
          '<div class="turn-col sway">' +
            '<h4><span class="dot"></span> Sway <span style="color:var(--ink-2);font-weight:400;letter-spacing:0;text-transform:none;font-size:11px;margin-left:6px">' + escape(short(p.sway.model)) + (p.sway.routeTier ? ' · ' + p.sway.routeTier : '') + '</span></h4>' +
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

  loadConfig();
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
    cacheHit: false,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    tokenBudget: null,
  });
  return { model: res.model, text: res.text, inputTokens: res.inputTokens, outputTokens: res.outputTokens, cost, ms };
}

// Live-mode switches. Each maps 1:1 onto a v0.2 pipeline stage so it can be ablated from the UI.
interface LiveFlags {
  context: "off" | "full" | "retrieve";
  optimize: boolean;
  router: "off" | "rules" | "learned";
  cache: boolean;
  escalate: boolean;
}

function parseFlags(p: Record<string, unknown>): LiveFlags {
  const pick = <T extends string>(v: unknown, ok: readonly T[], def: T): T => (ok.includes(v as T) ? (v as T) : def);
  return {
    context: pick(p.context, ["off", "full", "retrieve"] as const, "full"),
    optimize: p.optimize !== false,
    router: pick(p.router, ["off", "rules", "learned"] as const, "learned"),
    cache: p.cache !== false,
    escalate: p.escalate !== false,
  };
}

/** Raw (flagship, no Sway, 4096 cap) and the v0.2 Sway pipeline, run in parallel on the same prompt. */
async function handleRun(prompt: string, f: LiveFlags) {
  const session = newSessionId();
  const [raw, sway] = await Promise.all([
    runRaw(prompt, session + "_raw"),
    runPipeline(prompt, {
      context: f.context,
      optimize: f.optimize,
      router: f.router,
      semanticCache: f.cache,
      escalate: f.escalate,
      tokenBudget: true,
      session: session + "_sway",
    }),
  ]);
  return { raw, sway, flags: f };
}

const PROXY_PORT = 8788;

function configInfo() {
  const ctx = loadContext();
  const m = loadRouterModel();
  return {
    models: { flagship: DEFAULTS.flagship, nano: DEFAULTS.nano, optimizer: DEFAULTS.optimizer, judge: DEFAULTS.judge, embedding: DEFAULTS.embedding },
    tokenBudget: TOKEN_BUDGET,
    router: m ? { variant: m.variant, threshold: m.threshold, trainedAt: m.trainedAt, runId: m.runId, metrics: m.metrics } : null,
    cache: { entries: semCount(), threshold: DEFAULT_SIM_THRESHOLD },
    context: ctx ? { file: basename(ctx.path), bytes: ctx.bytes, tokens: Math.ceil(ctx.text.length / 4), sections: splitSections(ctx.text).map(s => s.heading).filter(Boolean) } : null,
  };
}

function evalReport(runId: string) {
  const rows = evalRows(runId);
  if (!rows.length) return null;
  const order = Object.keys(CONFIGS);
  const configs = [...new Set(rows.map(r => r.config))].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const cats = [...new Set(rows.map(r => r.category ?? "-"))];
  const avg = (rs: EvalRow[]) => (rs.length ? rs.reduce((s, r) => s + (r.score ?? 0), 0) / rs.length : null);
  return {
    runId,
    dataset: rows[0].dataset,
    ts: Math.min(...rows.map(r => r.ts)),
    configs: configs.map(c => ({ id: c, label: CONFIGS[c]?.label ?? c })),
    summary: summarizeRows(rows, configs),
    categories: cats.map(cat => ({
      category: cat,
      scores: configs.map(c => avg(rows.filter(r => r.config === c && (r.category ?? "-") === cat && r.score != null))),
    })),
    low: rows.filter(r => r.config !== "flagship" && r.score != null && r.score <= 5).slice(0, 10)
      .map(r => ({ config: r.config, score: r.score, prompt: r.prompt, reason: r.reason })),
  };
}

async function gatewayInfo() {
  let up = false;
  try { up = (await fetch(`http://localhost:${PROXY_PORT}/health`, { signal: AbortSignal.timeout(600) })).ok; } catch { /* not running */ }
  const d = new Date();
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    up,
    port: PROXY_PORT,
    projects: projectStats(today),
    recent: recentProjectCalls(25).map(r => ({
      ts: r.ts, project: r.project, prompt: r.raw_prompt, model: r.model, tier: r.route_tier, cost: r.cost_usd,
      latencyMs: r.latency_ms, cacheHit: !!r.cache_hit, sim: r.cache_similarity, escalated: !!r.escalated,
    })),
  };
}

async function cacheSweep() {
  const s = await computeCacheSweep(bundled("evals/cache_pairs.json"));
  const withSim = s.pairs.map((p, i) => ({ ...p, sim: s.sims[i] }));
  return {
    name: s.name,
    current: DEFAULT_SIM_THRESHOLD,
    rows: s.rows,
    best: s.best,
    nearMisses: withSim.filter(p => !p.same).sort((a, b) => b.sim - a.sim).slice(0, 5),
    missed: withSim.filter(p => p.same).sort((a, b) => a.sim - b.sim).slice(0, 3),
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
      if (req.method === "GET" && url.pathname === "/api/config") {
        return json(res, 200, configInfo());
      }
      if (req.method === "GET" && url.pathname === "/api/evals") {
        return json(res, 200, evalRuns(20));
      }
      if (req.method === "GET" && url.pathname === "/api/eval") {
        const run = url.searchParams.get("run");
        const report = run ? evalReport(run) : null;
        return report ? json(res, 200, report) : json(res, 404, { error: "eval run not found" });
      }
      if (req.method === "GET" && url.pathname === "/api/gateway") {
        return json(res, 200, await gatewayInfo());
      }
      if (req.method === "POST" && url.pathname === "/api/cache-eval") {
        return json(res, 200, await cacheSweep());
      }
      if (req.method === "POST" && url.pathname === "/api/run") {
        const body = await readBody(req);
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(body) as Record<string, unknown>; }
        catch { return json(res, 400, { error: "invalid JSON body" }); }
        const prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
        if (!prompt.trim()) return json(res, 400, { error: "prompt required" });
        return json(res, 200, await handleRun(prompt, parseFlags(parsed)));
      }
      return json(res, 404, { error: "not found" });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  });

  srv.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n  \x1b[1mSway dashboard\x1b[0m running at \x1b[36m${url}\x1b[0m`);
    console.log(`  Live: raw flagship vs the v0.2 Sway pipeline, side by side.`);
    console.log(`  Evaluation · Gateway · Sessions tabs: eval results, proxy traffic, past runs.`);
    console.log(`  Press Ctrl+C to stop.\n`);
  });
}
