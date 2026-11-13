<script lang="ts">
  import { direction, newsDate, price, signed } from "./lib/format";
  import { localOffset } from "./lib/freshness";
  import { INTERVALS, INTERVAL_LABELS, RANGES, isInterval, rangesFor, scopes, validSetup, type Decision, type Exercise, type Result, type SavedRun, type Setup, type Summary } from "./lib/practice";
  import { breakdown, computeStats, filterRows, parseTags, tradeRows, type TradeRow } from "./lib/practiceStats";
  import { MODE_LABELS, NEXT_BARS, quizInfo, type PracticeMode, type Question, type Score } from "./lib/quiz";
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
    mode,
    onmode,
    quiz,
    quizGuess,
    quizScore,
    quizOutcome,
    onanswer,
    onsetup,
    onstart,
    oncancel,
    ondecide,
    onclose,
    onend,
    onnext,
    onchange,
    runs,
    saved,
    saving,
    onsave,
    onopen,
    ondelete,
    onannotate,
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
    mode: PracticeMode;
    onmode: (next: PracticeMode) => void;
    quiz: Question | null;
    quizGuess: string | null;
    quizScore: Score;
    quizOutcome: { move: string; pct: number } | null;
    onanswer: (guess: string) => void;
    onsetup: (next: Setup) => void;
    onstart: () => void;
    oncancel: () => void;
    ondecide: (decision: Decision) => void;
    onclose: () => void;
    onend: () => void;
    onnext: () => void;
    onchange: () => void;
    runs: SavedRun[];
    saved: boolean;
    saving: boolean;
    onsave: () => void;
    onopen: (run: SavedRun) => void;
    ondelete: (id: number) => void;
    onannotate: (id: number, note: string, tags: string[]) => void;
  } = $props();

  let confirming = $state<number | null>(null);
  let editing = $state<number | null>(null);
  let noteDraft = $state("");
  let tagDraft = $state("");
  let symbolFilter = $state("");
  let tagFilter = $state("");

  const rows = $derived(tradeRows(runs));
  const stats = $derived(computeStats(rows));
  const symbolGroups = $derived(breakdown(rows, "symbol"));
  const tagGroups = $derived(breakdown(rows, "tag"));
  const shown = $derived(filterRows(rows, symbolFilter, tagFilter).reverse());
  const ratio = (v: number | null) => (v == null ? "—" : v === Infinity ? "∞" : v.toFixed(2));
  const rText = (v: number | null) => (v == null ? "—" : `${signed(v, 2)}R`);
  const rate = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);

  function edit(row: TradeRow) {
    editing = row.id;
    noteDraft = row.note;
    tagDraft = row.tags.join(", ");
  }

  function commit(id: number) {
    onannotate(id, noteDraft.trim(), parseTags(tagDraft));
    editing = null;
  }

  const LABELS: Record<Decision, string> = { long: "Long", short: "Short", skip: "Skip" };
  const rangeLabel = (id: string) => RANGES.find((r) => r.id === id)?.label ?? id;
  const pct = (v: number) => `${signed(v, 2)}%`;
  const MODES = Object.keys(MODE_LABELS) as PracticeMode[];
  const answered = $derived(quizGuess != null);
  const right = $derived(!!quiz && quizGuess != null && (quiz.mode !== "move" ? quizGuess === quiz.kind : quizOutcome?.move === quizGuess));
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
        <span>Mode</span>
        <select aria-label="Practice mode" value={mode} disabled={busy} onchange={(e) => onmode(e.currentTarget.value as PracticeMode)}>
          {#each MODES as m (m)}
            <option value={m}>{MODE_LABELS[m]}</option>
          {/each}
        </select>
      </label>
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
    {#if runs.length}
      <div class="card runs" role="region" aria-label="Saved runs">
        <span class="tag sim">Saved runs</span>
        {#each runs as run (run.id)}
          <div class="head">
            <span class="muted">{newsDate(run.saved, localOffset(run.saved))}</span>
            <strong>{run.symbol}</strong>
            <span class="muted">{INTERVAL_LABELS[run.interval]}</span>
            <span>{LABELS[run.trade.decision]}</span>
            <span class={direction(run.return_pct)}>{pct(run.return_pct)}</span>
            {#if confirming === run.id}
              <span class="confirm" role="alert">
                Delete this saved run and its drawings?
                <button type="button" class="danger" onclick={() => { confirming = null; ondelete(run.id); }}>Confirm delete</button>
                <button type="button" onclick={() => (confirming = null)}>Cancel</button>
              </span>
            {:else}
              <button type="button" disabled={busy} onclick={() => onopen(run)}>Open</button>
              <button type="button" class="danger" onclick={() => (confirming = run.id)}>Delete…</button>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if rows.length}
      <div class="card runs stats" role="region" aria-label="Practice stats">
        <span class="tag sim">Practice stats</span>
        <dl class="totals">
          <dt>Trades</dt>
          <dd>{stats.trades}</dd>
          <dt>Win rate</dt>
          <dd>{rate(stats.winRate)}</dd>
          <dt>Average R</dt>
          <dd class={direction(stats.avgR)}>{rText(stats.avgR)}</dd>
          <dt>Expectancy</dt>
          <dd class={direction(stats.expectancy)}>{rText(stats.expectancy)}</dd>
          <dt>Profit factor</dt>
          <dd>{ratio(stats.profitFactor)}</dd>
          <dt>Longest win streak</dt>
          <dd>{stats.longestWin}</dd>
          <dt>Longest loss streak</dt>
          <dd>{stats.longestLoss}</dd>
          <dt>Current streak</dt>
          <dd>{stats.current ? `${stats.current.length} ${stats.current.outcome === "win" ? "won" : stats.current.outcome === "loss" ? "lost" : "even"}` : "—"}</dd>
        </dl>
        <span class="muted">R is the return divided by the 14-bar ATR at the decision candle.</span>
        {#each [{ label: "By symbol", list: symbolGroups }, { label: "By setup / tag", list: tagGroups }] as g (g.label)}
          {#if g.list.length}
            <table aria-label={g.label}>
              <thead><tr><th>{g.label}</th><th>Trades</th><th>Win</th><th>Avg R</th><th>Exp R</th></tr></thead>
              <tbody>
                {#each g.list as row (row.key)}
                  <tr><td>{row.key}</td><td>{row.trades}</td><td>{rate(row.winRate)}</td><td>{rText(row.avgR)}</td><td>{rText(row.expectancy)}</td></tr>
                {/each}
              </tbody>
            </table>
          {/if}
        {/each}
        <div class="head">
          <span class="tag sim">Trade history</span>
          <select aria-label="Filter by symbol" bind:value={symbolFilter}>
            <option value="">All symbols</option>
            {#each symbolGroups as g (g.key)}<option value={g.key}>{g.key}</option>{/each}
          </select>
          <select aria-label="Filter by tag" bind:value={tagFilter}>
            <option value="">All tags</option>
            {#each tagGroups as g (g.key)}<option value={g.key}>{g.key}</option>{/each}
          </select>
        </div>
        <table aria-label="Trade history">
          <thead><tr><th>Symbol</th><th>Date</th><th>Dir</th><th>Entry</th><th>Exit</th><th>R</th><th>Result</th><th>Tags</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {#each shown as t (t.id)}
              <tr>
                <td>{t.symbol}</td>
                <td>{newsDate(t.saved, localOffset(t.saved))}</td>
                <td>{LABELS[t.decision]}</td>
                <td>{price(t.entry, t.currency)}</td>
                <td>{price(t.exit, t.currency)}</td>
                <td class={direction(t.r)}>{rText(t.r)}</td>
                <td class={direction(t.pct)}>{pct(t.pct)}</td>
                <td>{t.tags.join(", ")}</td>
                <td class="note">{t.note}</td>
                <td><button type="button" onclick={() => (editing === t.id ? (editing = null) : edit(t))}>{editing === t.id ? "Close" : "Edit"}</button></td>
              </tr>
              {#if editing === t.id}
                <tr>
                  <td colspan="10">
                    <form
                      class="head"
                      onsubmit={(e) => {
                        e.preventDefault();
                        commit(t.id);
                      }}
                    >
                      <input aria-label="Tags (comma separated, e.g. a setup name)" placeholder="Tags, e.g. breakout" maxlength="300" bind:value={tagDraft} />
                      <textarea aria-label="Note" placeholder="Note" rows="2" maxlength="2000" bind:value={noteDraft}></textarea>
                      <button class="primary" type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
        {#if !shown.length}<span class="muted">No trades match.</span>{/if}
      </div>
    {/if}
  {:else if quiz}
    {@const info = quizInfo(quiz.kind)}
    <div class="card" role="region" aria-label="Pattern quiz">
      <div class="head">
        <span class="tag sim">{MODE_LABELS[quiz.mode]}</span>
        <span class="muted">Score {quizScore.correct}/{quizScore.total} · streak {quizScore.streak}</span>
      </div>
      {#if quiz.mode !== "move"}
        <div id="quiz-question">Which pattern do the highlighted candles form?</div>
        <div class="decide" role="group" aria-labelledby="quiz-question">
          {#each quiz.choices as k (k)}
            <button class:good={answered && k === quiz.kind} class:bad={answered && k === quizGuess && k !== quiz.kind} disabled={answered} onclick={() => onanswer(k)}>{quizInfo(k).name}</button>
          {/each}
        </div>
      {:else}
        <div id="quiz-question"><strong>{info.name}</strong> <span class="muted">({info.bias})</span> {info.text}</div>
        <div id="quiz-ask">Will the close {NEXT_BARS} candles after the highlighted pattern be higher or lower?</div>
        <div class="decide" role="group" aria-labelledby="quiz-ask">
          <button class="long" class:good={answered && quizOutcome?.move === "up"} disabled={answered} onclick={() => onanswer("up")}>Higher</button>
          <button class="short" class:good={answered && quizOutcome?.move === "down"} disabled={answered} onclick={() => onanswer("down")}>Lower</button>
        </div>
      {/if}
      {#if answered}
        <div role="status">
          <strong class={right ? "up" : "down"}>{right ? "Correct" : "Not quite"}</strong>
          {#if quiz.mode !== "move"}
            · {info.name} <span class="muted">({info.bias})</span>. {info.text}
          {:else if quizOutcome}
            · the close moved <span class={direction(quizOutcome.pct)}>{pct(quizOutcome.pct)}</span> over {NEXT_BARS} candles.
          {/if}
        </div>
        <div class="actions">
          <button class="primary" disabled={busy} onclick={onnext}>{busy ? "Finding a question…" : "Next question"}</button>
          <button disabled={busy} onclick={onchange}>Change setup</button>
          {#if error}<span class="error" role="alert">{error}</span>{/if}
        </div>
      {/if}
    </div>
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
        <button disabled={saved || saving} title={saved ? "Drawing changes are saved with the run" : "Save this run and its drawings"} onclick={onsave}>{saved ? "Saved" : saving ? "Saving…" : "Save run"}</button>
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
  button.good {
    border-color: var(--up);
    color: var(--up);
  }
  button.bad {
    border-color: var(--down);
    color: var(--down);
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
  .runs {
    margin-top: 4px;
    max-height: 180px;
    overflow-y: auto;
  }
  .danger {
    color: var(--down);
    border-color: var(--down);
  }
  .confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
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
  .stats {
    max-height: 360px;
    overflow-x: auto;
  }
  .totals {
    grid-template-columns: max-content max-content max-content max-content;
  }
  table {
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 1px 8px 1px 0;
    text-align: left;
    white-space: nowrap;
  }
  th {
    color: var(--muted);
    font-weight: 400;
  }
  td.note {
    white-space: normal;
    max-width: 200px;
  }
  input,
  textarea {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--faint);
    border-radius: 6px;
    padding: 2px 6px;
    font: inherit;
  }
  textarea {
    flex: 1;
    min-width: 160px;
    resize: vertical;
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
