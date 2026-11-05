<script lang="ts">
  import { direction, price, signed } from "./lib/format";
  import { INTERVALS, INTERVAL_LABELS, RANGES, isInterval, rangesFor, scopes, validSetup, type Decision, type Exercise, type Result, type Setup, type Summary } from "./lib/practice";
  import type { Group } from "./lib/types";

  let {
    setup,
    groups,
    count,
    exercise,
    result,
    summary,
    busy,
    error,
    currency,
    canDecide,
    canClose,
    whenAt,
    onsetup,
    onstart,
    oncancel,
    ondecide,
    onclose,
    onend,
    onnext,
    onchange,
  }: {
    setup: Setup;
    groups: Group[];
    count: number;
    exercise: Exercise | null;
    result: Result | null;
    summary: Summary | null;
    busy: boolean;
    error: string | null;
    currency: string;
    canDecide: boolean;
    canClose: boolean;
    whenAt: (index: number) => string;
    onsetup: (next: Setup) => void;
    onstart: () => void;
    oncancel: () => void;
    ondecide: (decision: Decision) => void;
    onclose: () => void;
    onend: () => void;
    onnext: () => void;
    onchange: () => void;
  } = $props();

  const LABELS: Record<Decision, string> = { long: "Long", short: "Short", skip: "Skip" };
  const rangeLabel = (id: string) => RANGES.find((r) => r.id === id)?.label ?? id;
  const pct = (v: number) => `${signed(v, 2)}%`;
</script>

<div class="practice" role="region" aria-label="Practice">
  {#if !exercise}
    <form
      class="row"
      onsubmit={(e) => {
        e.preventDefault();
        onstart();
      }}
    >
      <span class="tag">Practice</span>
      <label>
        <span>Symbols</span>
        <select aria-label="Practice symbols" value={setup.scope} disabled={busy} onchange={(e) => onsetup(validSetup({ ...setup, scope: e.currentTarget.value }, groups))}>
          {#each scopes(groups) as s (s.id)}
            <option value={s.id}>{s.label}</option>
          {/each}
        </select>
        <span class="muted">{count} {count === 1 ? "symbol" : "symbols"}</span>
      </label>
      <label>
        <span>Candles</span>
        <select
          aria-label="Practice candle interval"
          value={setup.interval}
          disabled={busy}
          onchange={(e) => {
            const v = e.currentTarget.value;
            if (isInterval(v)) onsetup(validSetup({ ...setup, interval: v }, groups));
          }}
        >
          {#each INTERVALS as i (i)}
            <option value={i}>{INTERVAL_LABELS[i]}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>From</span>
        <select aria-label="Practice date range" value={setup.range} disabled={busy} onchange={(e) => onsetup(validSetup({ ...setup, range: e.currentTarget.value as Setup["range"] }, groups))}>
          {#each rangesFor(setup.interval) as r (r)}
            <option value={r}>{rangeLabel(r)}</option>
          {/each}
        </select>
      </label>
      <button class="primary" type="submit" disabled={busy || count === 0}>{busy ? "Finding a setup…" : "Start"}</button>
      <button type="button" onclick={oncancel}>Cancel</button>
      {#if error}<span class="error" role="alert">{error}</span>{:else if count === 0}<span class="muted">Star symbols or pick a group with symbols</span>{/if}
    </form>
  {:else if !exercise.ended}
    <div class="row">
      <span class="tag sim">Simulated</span>
      <strong>{exercise.symbol}</strong>
      <span class="muted">{INTERVAL_LABELS[exercise.setup.interval]} · {rangeLabel(exercise.setup.range)}</span>
      {#if !exercise.trade}
        <div class="decide" role="group" aria-label="Decision">
          <button class="long" disabled={!canDecide} onclick={() => ondecide("long")}>Long</button>
          <button class="short" disabled={!canDecide} onclick={() => ondecide("short")}>Short</button>
          <button onclick={() => ondecide("skip")}>Skip</button>
        </div>
        <span class="muted">{canDecide ? "Decide at this candle's close; a trade fills at the next candle's open." : "No next candle to fill at; Skip or End."}</span>
      {:else if result?.status === "pending"}
        <span>{LABELS[exercise.trade.decision]} decided · fills at the next candle's open</span>
      {:else if result?.status === "open"}
        <span>
          {LABELS[exercise.trade.decision]} from {price(result.entry_price, currency)} ·
          <span class={direction(result.return_pct)}>{pct(result.return_pct)}</span>
          · {result.bars_held} {result.bars_held === 1 ? "bar" : "bars"}
        </span>
        <button class="primary" disabled={!canClose} onclick={onclose}>Close at this close</button>
      {/if}
      <button class="end" title="End the exercise and reveal the rest" onclick={onend}>End</button>
    </div>
    {#if error}<div class="error" role="alert">{error}</div>{/if}
  {:else if summary}
    {@const r = summary.result}
    <div class="card" role="status" aria-label="Simulated result">
      <div class="head">
        <span class="tag sim">Simulated result</span>
        <strong>{exercise.symbol}</strong>
        <span class="muted">{exercise.name} · {INTERVAL_LABELS[exercise.setup.interval]} · {exercise.volatile ? "volatile period" : "ordinary period"}</span>
      </div>
      <dl>
        <dt>Decision</dt>
        <dd>{LABELS[r.decision]}{#if r.status === "unfilled"} · ended before the entry candle, not filled{/if}</dd>
        {#if r.entry != null}
          <dt>Entry</dt>
          <dd>{price(r.entry_price, currency)} <span class="muted">open · {whenAt(r.entry)}</span></dd>
          <dt>Exit</dt>
          <dd>{price(r.exit_price, currency)} <span class="muted">close · {r.exit != null ? whenAt(r.exit) : ""}</span></dd>
          <dt>Return</dt>
          <dd class={direction(r.return_pct)}>{pct(r.return_pct)}</dd>
          <dt>Bars held</dt>
          <dd>{r.bars_held}</dd>
        {/if}
        <dt>Skip</dt>
        <dd>{pct(summary.skip_pct)} <span class="muted">always neutral</span></dd>
        <dt>Market</dt>
        <dd>
          {#if summary.market_pct != null}<span class={direction(summary.market_pct)}>{pct(summary.market_pct)}</span>{:else}—{/if}
          <span class="muted">close {whenAt(summary.market_from)} → close {whenAt(summary.market_to)}</span>
        </dd>
      </dl>
      <div class="actions">
        <button class="primary" disabled={busy} onclick={onnext}>{busy ? "Finding a setup…" : "Next setup"}</button>
        <button disabled={busy} onclick={onchange}>Change setup</button>
        {#if error}<span class="error" role="alert">{error}</span>{/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .practice {
    margin: 2px 0 6px;
    font-size: 12px;
  }
  .row,
  .card {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 8px;
    border: 1px solid var(--faint);
    border-left: 3px solid var(--accent);
    border-radius: 7px;
    background: var(--surface);
  }
  .card {
    flex-direction: column;
    align-items: stretch;
    padding: 8px 10px;
  }
  .head,
  .actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tag {
    font-weight: 700;
    color: var(--accent);
  }
  .sim {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 11px;
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
  }
  select,
  button {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--faint);
    border-radius: 6px;
    padding: 2px 8px;
    font-size: 12px;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button.primary {
    border-color: var(--accent);
    color: var(--accent);
  }
  button.long {
    color: var(--up);
  }
  button.short {
    color: var(--down);
  }
  .decide {
    display: flex;
    gap: 4px;
  }
  .end {
    margin-left: auto;
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: var(--down);
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 2px 12px;
    margin: 0;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
</style>
