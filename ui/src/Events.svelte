<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { ago, direction, sentimentLabel, sentimentTone, signed } from "./lib/format";
  import {
    canShift,
    countryName,
    countryOptions,
    countrySummary,
    filterEvents,
    formatDay,
    groupByDay,
    IMPORTANCE_LABELS,
    importanceOf,
    mergeCalendar,
    rangeLabel,
    setCountries,
    setImportance,
    toggleCountry,
    watchEntries,
    type EventsTab,
    type WeekRange,
  } from "./lib/calendar";
  import type { EventAnalysis, EventFilter, EventImportance, EventsReport, MarketEvent, WatchDates } from "./lib/types";
  import WatchCalendar from "./WatchCalendar.svelte";

  // report: undefined while loading with nothing cached.
  let {
    report,
    error,
    loading,
    now,
    tab,
    week,
    weekOffset,
    today,
    filter,
    watchDates,
    watchError,
    watchLoading,
    watchAt,
    watchCount,
    onrefresh,
    onwatchrefresh,
    ontab,
    onweek,
    onfilter,
    onopensymbol,
  }: {
    report: EventsReport | undefined;
    error: string | null;
    loading: boolean;
    /** Unix seconds, for the relative times. */
    now: number;
    tab: EventsTab;
    week: WeekRange;
    weekOffset: number;
    today: string;
    filter: EventFilter;
    watchDates: WatchDates[] | undefined;
    watchError: string | null;
    watchLoading: boolean;
    watchAt: number;
    watchCount: number;
    onrefresh: () => void;
    onwatchrefresh: () => void;
    ontab: (tab: EventsTab) => void;
    onweek: (offset: number) => void;
    onfilter: (filter: EventFilter) => void;
    onopensymbol: (symbol: string) => void;
  } = $props();

  const IMPORTANCE_OPTIONS: { value: EventImportance; label: string; tip: string }[] = [
    { value: "high", label: "High", tip: "Headline releases: rates, jobs, inflation, GDP, retail sales, ISM and PPI" },
    { value: "medium", label: "Medium+", tip: "High and medium releases, such as JOLTS, durable goods, housing, sentiment and PMIs" },
    { value: "all", label: "All", tip: "Every release" },
  ];

  let menu: HTMLDetailsElement | undefined = $state();

  function closeMenu(e: KeyboardEvent) {
    if (e.key === "Escape" && menu?.open) menu.open = false;
  }

  function outside(e: MouseEvent) {
    if (menu?.open && e.target instanceof Node && !menu.contains(e.target)) menu.open = false;
  }

  let selected = $state<MarketEvent | null>(null);
  let summaryOpen = $state(false);
  let reasonOpen = $state<Record<string, boolean>>({});
  // The AI analysis runs only for the opened event.
  let analysis = $state<EventAnalysis | null>(null);
  let analysisError = $state<string | null>(null);
  let analyzing = $state(false);
  let analysisSeq = 0;
  let analysisForce = $state(false);

  async function analyze(e: MarketEvent, force = false) {
    analysisForce = force;
    const mine = ++analysisSeq;
    analysis = null;
    analysisError = null;
    analyzing = true;
    try {
      const a = await invoke<EventAnalysis>("analyze_event", { event: e, force });
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

  const day = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const offsetFor = (t: number) => -new Date(t * 1000).getTimezoneOffset() * 60;
  const visible = $derived(filterEvents(report?.events ?? [], filter));
  const days = $derived(groupByDay(visible, offsetFor));
  const merged = $derived(mergeCalendar(report?.events ?? [], watchEntries(watchDates ?? [], today), week, filter, offsetFor));
  const options = $derived(countryOptions(report?.events ?? [], filter.countries));
  const hidden = $derived((report?.events.length ?? 0) - visible.length);
  const showCountry = $derived(filter.countries.length !== 1);
  const chosen = (code: string) => filter.countries.length === 0 || filter.countries.includes(code);
</script>

{#snippet figures(e: MarketEvent)}
  {#if e.actual}<span>Actual <b>{e.actual}</b></span>{/if}
  {#if e.expected}<span>Expected <b>{e.expected}</b></span>{/if}
  {#if e.prior}<span>Prior <b>{e.prior}</b>{#if e.revised}<span class="muted"> (from {e.revised})</span>{/if}</span>{/if}
{/snippet}

{#snippet macroRow(e: MarketEvent)}
  {@const level = importanceOf(e)}
  <button class="row" onclick={() => open(e)}>
    <span class="title"
      ><span class="imp" title="{IMPORTANCE_LABELS[level - 1]} importance (curated by release name, Yahoo gives no rating)"
        >{#each [1, 2, 3] as n (n)}<i class:on={n <= level}></i>{/each}</span
      >{#if showCountry && e.country}<span class="cc">{e.country}</span>{/if}{e.name}</span
    >
    <span class="meta">
      {time(e.at)}{#if e.period}
        · For {e.period}{/if}
      {@render figures(e)}
    </span>
  </button>
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
        {day(ev.at)} · {time(ev.at)}{#if ev.country}
          · {countryName(ev.country)}{/if}{#if ev.period}
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
          <button class="btn" onclick={() => analyze(ev, analysisForce)}>Retry</button>
        </div>
      {:else if analysis}
        <h3>Details</h3>
        <div class="bar">
          <span class="muted">AI{#if analysis.model} · {analysis.model}{/if} · generated {ago(analysis.generated, now)}</span>
          <button class="btn" disabled={analyzing} onclick={() => analyze(ev, true)}>Regenerate</button>
        </div>
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
    <div class="tabs seg" role="tablist" aria-label="Calendar">
      <button role="tab" class:on={tab === "economic"} aria-selected={tab === "economic"} onclick={() => ontab("economic")}>Economic</button>
      <button role="tab" class:on={tab === "watchlist"} aria-selected={tab === "watchlist"} onclick={() => ontab("watchlist")}>Watchlist</button>
      <button role="tab" class:on={tab === "calendar"} aria-selected={tab === "calendar"} onclick={() => ontab("calendar")}>Calendar</button>
    </div>
    {#if tab === "economic"}
      <button class="btn" onclick={onrefresh} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
    {:else if tab === "calendar"}
      <button
        class="btn"
        onclick={() => {
          onrefresh();
          onwatchrefresh();
        }}
        disabled={loading || watchLoading}>{loading || watchLoading ? "Refreshing…" : "Refresh"}</button
      >
    {:else}
      <button class="btn" onclick={onwatchrefresh} disabled={watchLoading}>{watchLoading ? "Refreshing…" : "Refresh"}</button>
    {/if}
  </div>
  {#if tab === "watchlist"}
    <WatchCalendar
      dates={watchDates}
      error={watchError}
      loading={watchLoading}
      at={watchAt}
      count={watchCount}
      {today}
      {now}
      onopen={onopensymbol}
      onretry={onwatchrefresh}
    />
  {:else}
  <div class="bar">
    <div class="weeks">
      <button class="btn icon" aria-label="Previous week" title="Previous week" disabled={!canShift(week.start, today, -1)} onclick={() => onweek(weekOffset - 1)}>‹</button>
      <span class="range" title="Seven days from {week.start}">{rangeLabel(week)}</span>
      <button class="btn icon" aria-label="Next week" title="Next week" disabled={!canShift(week.start, today, 1)} onclick={() => onweek(weekOffset + 1)}>›</button>
      <button class="btn" disabled={weekOffset === 0} onclick={() => onweek(0)}>Today</button>
    </div>
    <div class="filters">
      <details class="menu" bind:this={menu}>
        <summary class="btn" aria-label="Countries: {countrySummary(filter)}">{countrySummary(filter)}</summary>
        <div class="panel">
          <div class="presets">
            <button class="btn" disabled={filter.countries.length === 0} onclick={() => onfilter(setCountries(filter, []))}>All countries</button>
            <button class="btn" onclick={() => onfilter(setCountries(filter, ["US"]))}>US only</button>
          </div>
          {#each options as code (code)}
            <label class="opt">
              <input type="checkbox" checked={chosen(code)} onchange={() => onfilter(toggleCountry(filter, code, options))} />
              <span>{countryName(code)}</span>
              <span class="muted">{code}</span>
            </label>
          {:else}
            <span class="muted">No countries in this week</span>
          {/each}
        </div>
      </details>
      <div class="seg" role="group" aria-label="Releases">
        {#each IMPORTANCE_OPTIONS as o (o.value)}
          <button class:on={filter.importance === o.value} aria-pressed={filter.importance === o.value} title={o.tip} onclick={() => onfilter(setImportance(filter, o.value))}>{o.label}</button>
        {/each}
      </div>
    </div>
  </div>
  {#if report}
    <p class="sub muted">
      Updated {ago(report.fetched, now)} · {visible.length} of {report.events.length} events{#if hidden > 0 && visible.length === 0}, all hidden by filters{/if}{#if report.total > report.events.length}
        · Yahoo lists {report.total}, showing the first {report.events.length}{/if}
    </p>
  {/if}
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
    {#if tab === "calendar"}
      {#if watchError}<p class="err" role="alert">{watchError}</p>{/if}
      {#if merged.length === 0}
        <div class="msg">
          Nothing on your watchlist or the economic calendar for {rangeLabel(week)}
          {#if hidden > 0}<button class="btn" onclick={() => onfilter({ countries: [], importance: "all" })}>Show everything</button>{/if}
        </div>
      {:else}
        <div class="list">
          {#each merged as d (d.key)}
            <h3 class="day">{d.key === today ? "Today" : formatDay(d.key, { weekday: "short", month: "short", day: "numeric" })}</h3>
            <ul>
              {#each d.items as it (it.id)}
                <li>
                  {#if it.kind === "watch"}
                    <button class="row" onclick={() => onopensymbol(it.entry.symbol)}>
                      <span class="title">{it.entry.symbol}</span>
                      <span class="meta">
                        <span class="pill {it.entry.kind}">{it.entry.kind === "earnings" ? "Earnings" : "Ex-dividend"}</span>
                        {#if it.entry.estimated}<span>Estimated date</span>{/if}
                        {#if it.entry.eps != null}<span>EPS estimate <b>{it.entry.eps.toFixed(2)}</b></span>{/if}
                      </span>
                    </button>
                  {:else}
                    {@render macroRow(it.event)}
                  {/if}
                </li>
              {/each}
            </ul>
          {/each}
        </div>
      {/if}
    {:else if report.events.length === 0}
      <div class="msg">No economic events for {rangeLabel(week)}</div>
    {:else if visible.length === 0}
      <div class="msg">
        No events match these filters
        <button class="btn" onclick={() => onfilter({ countries: [], importance: "all" })}>Show everything</button>
      </div>
    {:else}
      <div class="list">
        {#each days as d (d.key)}
          <h3 class="day">{formatDay(d.key, { weekday: "short", month: "short", day: "numeric" })}</h3>
          <ul>
            {#each d.items as e (e.id)}
              <li>
                {@render macroRow(e)}
              </li>
            {/each}
          </ul>
        {/each}
      </div>
    {/if}
  {/if}
  {/if}
{/if}

<svelte:window onclick={outside} onkeydown={closeMenu} />

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
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
  .tabs,
  .seg {
    display: flex;
    background: var(--surface);
    border: 1px solid var(--faint);
    border-radius: 7px;
    padding: 2px;
  }
  .tabs button,
  .seg button {
    border: 0;
    background: none;
    padding: 2px 10px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--muted);
  }
  .tabs button.on,
  .seg button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  .tabs button:focus-visible,
  .seg button:focus-visible,
  summary:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .weeks,
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .range {
    min-width: 120px;
    text-align: center;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .btn.icon {
    padding: 0 9px;
    font-size: 15px;
    line-height: 20px;
  }
  .menu {
    position: relative;
  }
  summary.btn {
    list-style: none;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  summary.btn::-webkit-details-marker {
    display: none;
  }
  summary.btn::after {
    content: " ▾";
    color: var(--muted);
  }
  .panel {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 240px;
    max-height: 280px;
    overflow: auto;
    padding: 6px;
    background: var(--bg);
    border: 1px solid var(--faint);
    border-radius: 8px;
    box-shadow: var(--shadow);
  }
  .presets {
    display: flex;
    gap: 6px;
    margin-bottom: 4px;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 4px;
    border-radius: 5px;
    cursor: pointer;
  }
  .opt:hover {
    background: var(--surface);
  }
  .opt span:nth-of-type(1) {
    flex: 1;
  }
  .sub {
    margin: 4px 0 0;
    font-size: 11.5px;
  }
  .cc {
    margin-right: 6px;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--surface);
    border: 1px solid var(--faint);
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 650;
    vertical-align: 1px;
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
  .imp {
    display: inline-flex;
    gap: 2px;
    align-items: flex-end;
    margin-right: 6px;
    vertical-align: -1px;
  }
  .imp i {
    width: 3px;
    border-radius: 1px;
    background: var(--border);
  }
  .imp i:nth-child(1) {
    height: 6px;
  }
  .imp i:nth-child(2) {
    height: 9px;
  }
  .imp i:nth-child(3) {
    height: 12px;
  }
  .imp i.on {
    background: var(--accent);
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
  .pill.earnings {
    background: var(--accent);
  }
  .pill.dividend {
    background: var(--dividend);
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
