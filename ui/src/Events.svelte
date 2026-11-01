<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { ago, direction, sentimentLabel, sentimentTone, signed } from "./lib/format";
  import type { EventAnalysis, EventsReport, MarketEvent } from "./lib/types";

  // report: undefined while loading with nothing cached.
  let {
    report,
    error,
    loading,
    now,
    onrefresh,
  }: {
    report: EventsReport | undefined;
    error: string | null;
    loading: boolean;
    /** Unix seconds, for the relative times. */
    now: number;
    onrefresh: () => void;
  } = $props();

  let selected = $state<MarketEvent | null>(null);
  let summaryOpen = $state(false);
  let reasonOpen = $state<Record<string, boolean>>({});
  // The AI analysis runs only for the opened event.
  let analysis = $state<EventAnalysis | null>(null);
  let analysisError = $state<string | null>(null);
  let analyzing = $state(false);
  let analysisSeq = 0;

  async function analyze(e: MarketEvent) {
    const mine = ++analysisSeq;
    analysis = null;
    analysisError = null;
    analyzing = true;
    try {
      const a = await invoke<EventAnalysis>("analyze_event", { event: e });
      if (mine === analysisSeq) analysis = a;
    } catch (err) {
      if (mine === analysisSeq) analysisError = String(err);
    } finally {
      if (mine === analysisSeq) analyzing = false;
    }
  }

  function open(e: MarketEvent) {
    selected = e;
    summaryOpen = false;
    reasonOpen = {};
    analyze(e);
  }

  function back() {
    selected = null;
    analysisSeq++;
    analyzing = false;
  }

  const dayKey = (t: number) => new Date(t * 1000).toDateString();
  const day = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  /** Events grouped by local day, in time order. */
  const days = $derived.by(() => {
    const out: { key: string; label: string; events: MarketEvent[] }[] = [];
    for (const e of report?.events ?? []) {
      const key = dayKey(e.at);
      if (out.at(-1)?.key !== key) out.push({ key, label: day(e.at), events: [] });
      out[out.length - 1].events.push(e);
    }
    return out;
  });
</script>

{#snippet figures(e: MarketEvent)}
  {#if e.actual}<span>Actual <b>{e.actual}</b></span>{/if}
  {#if e.expected}<span>Expected <b>{e.expected}</b></span>{/if}
  {#if e.prior}<span>Prior <b>{e.prior}</b>{#if e.revised}<span class="muted"> (from {e.revised})</span>{/if}</span>{/if}
{/snippet}

{#if selected}
  {@const ev = selected}
  <div class="detail">
    <div class="bar">
      <button class="btn" onclick={back}>← Back</button>
    </div>
    <div class="scroll">
      <h2>{ev.name}</h2>
      <div class="meta">
        {day(ev.at)} · {time(ev.at)}{#if ev.period}
          · For {ev.period}{/if}
        {#if analysis}<span class="pill {sentimentTone(analysis.tone)}">{sentimentLabel(analysis.tone)}</span>{/if}
      </div>
      {#if ev.actual || ev.expected || ev.prior}
        <div class="figs">{@render figures(ev)}</div>
      {/if}
      {#if analyzing}
        <div aria-busy="true" aria-label="Analyzing event">
          <h3>Details</h3>
          <span class="sk" style="width: 92%; height: 12px"></span>
          <span class="sk" style="width: 70%; height: 12px; margin-top: 6px"></span>
          <h3>Affected</h3>
          {#each [0, 1, 2] as i (i)}
            <span class="sk" style="width: {55 + i * 12}%; height: 12px; margin-top: 8px"></span>
          {/each}
        </div>
      {:else if analysisError}
        <div class="msg">
          Could not analyze this event: {analysisError}
          <button class="btn" onclick={() => analyze(ev)}>Retry</button>
        </div>
      {:else if analysis}
        <h3>Details</h3>
        <p class="summary" class:clamp={!summaryOpen}>{analysis.summary}</p>
        <button class="more" aria-expanded={summaryOpen} aria-label={summaryOpen ? "Show less" : "Show full details"} onclick={() => (summaryOpen = !summaryOpen)}>…</button>
        <h3>Affected</h3>
        {#if analysis.impacts.length === 0}
          <p class="muted">No affected stocks or sectors listed</p>
        {:else}
          <ul class="impacts">
            {#each analysis.impacts as im, i (i)}
              <li>
                <div class="irow">
                  <span class="iname">{im.name}</span>
                  <span class="muted">{im.kind}</span>
                  <span class="score {direction(im.score)}" title="Impact score, −100 to +100">{signed(im.score, 0)}</span>
                  <span class="muted" title="How sure the estimate is">
                    Confidence <b class="conf-{im.confidence_label}">{im.confidence_label}</b> {im.confidence}%
                  </span>
                  <button
                    class="more"
                    aria-expanded={!!reasonOpen[i]}
                    aria-label={reasonOpen[i] ? "Hide reasoning" : "Show reasoning"}
                    onclick={() => (reasonOpen[i] = !reasonOpen[i])}>…</button
                  >
                </div>
                {#if reasonOpen[i]}<p class="reason">{im.reasoning}</p>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </div>
  </div>
{:else}
  <div class="bar">
    <span class="muted">{report ? `US economic calendar · updated ${ago(report.fetched, now)}` : ""}</span>
    <button class="btn" onclick={onrefresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
  </div>
  {#if report === undefined && error}
    <div class="msg">
      Could not load events: {error}
      <button class="btn" onclick={onrefresh}>Retry</button>
    </div>
  {:else if report === undefined}
    <div class="list" aria-busy="true" aria-label="Loading events">
      {#each [0, 1, 2, 3, 4, 5] as i (i)}
        <div class="row">
          <span class="sk" style="width: {70 + ((i * 17) % 25)}%; height: 13px"></span>
          <span class="sk" style="width: 160px; height: 10px; margin-top: 6px"></span>
        </div>
      {/each}
    </div>
  {:else}
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if report.events.length === 0}
      <div class="msg">No US economic events in the next 7 days</div>
    {:else}
      <div class="list">
        {#each days as d (d.key)}
          <h3 class="day">{d.label}</h3>
          <ul>
            {#each d.events as e (e.id)}
              <li>
                <button class="row" onclick={() => open(e)}>
                  <span class="title">{e.name}</span>
                  <span class="meta">
                    {time(e.at)}{#if e.period}
                      · For {e.period}{/if}
                    {@render figures(e)}
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/each}
      </div>
    {/if}
  {/if}
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 6px;
    font-size: 11.5px;
  }
  .btn,
  .more {
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .btn:focus-visible,
  .more:focus-visible,
  .row:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .more {
    padding: 0 8px;
    line-height: 16px;
    font-weight: 700;
  }
  .list {
    flex: 1;
    min-height: 0;
    margin: 6px 0 0;
    padding: 0 6px 0 0;
    list-style: none;
    overflow: auto;
    overscroll-behavior: contain;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 8px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  button.row {
    cursor: pointer;
  }
  button.row:hover,
  button.row:focus-visible {
    background: var(--surface);
  }
  .list ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  li + li {
    border-top: 1px solid var(--faint);
  }
  h3.day {
    position: sticky;
    top: 0;
    z-index: 1;
    margin: 0;
    padding: 8px 8px 4px;
    background: var(--bg);
  }
  .meta > span:not(.pill) {
    margin-left: 10px;
  }
  .meta b,
  .figs b {
    color: var(--text);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .figs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .title {
    font-weight: 600;
    line-height: 1.3;
  }
  .meta {
    font-size: 11.5px;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .pill {
    display: inline-block;
    margin-left: 6px;
    padding: 0 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 650;
    line-height: 16px;
    vertical-align: 1px;
    color: #fff;
    background: var(--flat);
  }
  .pill.up {
    background: var(--up);
  }
  .pill.down {
    background: var(--down);
  }
  .detail {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: 0 6px 0 2px;
  }
  h2 {
    margin: 10px 0 2px;
    font-size: 16px;
  }
  h3 {
    margin: 12px 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .summary {
    margin: 0 0 4px;
    line-height: 1.4;
    white-space: pre-line;
  }
  .summary.clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .impacts {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 12px;
  }
  .impacts li {
    padding: 6px 0;
  }
  .irow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
  }
  .iname {
    font-weight: 650;
  }
  .score {
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .conf-high {
    color: var(--up);
  }
  .conf-low {
    color: var(--down);
  }
  .reason {
    margin: 4px 0 0;
    color: var(--muted);
    line-height: 1.4;
  }
  .err {
    margin: 4px 0;
    color: var(--down);
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    gap: 8px;
    color: var(--muted);
    text-align: center;
  }
  .msg .btn {
    justify-self: center;
  }
</style>
