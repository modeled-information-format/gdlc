#!/usr/bin/env node
// ADR-0010: entrypoint for the board-hygiene background monitor, declared
// in this plugin's monitors/monitors.json. The Claude Code host starts
// this process at session start and delivers every stdout line to the
// acting model as a notification; monitor-core.mjs owns the poll ->
// assess -> emit-once loop (opt-in gating on packs.monitors, jitter,
// backoff, dedup), board-hygiene.mjs owns the checks. This file only
// wires the two together.
//
// Never-die contract: runMonitorLoop try/catches every cycle; the final
// backstop below turns anything that still escapes into a quiet exit 0 --
// a monitor must never spam the session with a crash, and a dead monitor
// is not restarted until session restart anyway.
import { runMonitorLoop } from './lib/monitor-core.mjs';
import { createBoardHygieneAssess } from './lib/board-hygiene.mjs';

runMonitorLoop({ name: 'board-hygiene', assess: createBoardHygieneAssess() }).catch(() => process.exit(0));
