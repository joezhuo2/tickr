<script lang="ts">
  import ChartAlerts from "./ChartAlerts.svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { ALERT_FILTERS, addedAlert, alertCounts, alertStatus, emptyMessage, levelError, toggleLabel, triggerInfo, visibleAlerts, type AlertFilter } from "./lib/alerts";
  import { alertSummary } from "./lib/format";
  import { noteTitle, notesOf } from "./lib/notes";
  import type { AlertKind, PriceAlert, Quote } from "./lib/types";

  let { symbol, quote, alerts, onchange, onopen, interval = "", drawings = [], onnote }: {
    interval?: string;
    drawings?: import("./lib/types").Drawing[];
    symbol: string;
    quote: Quote | null;
    alerts: PriceAlert[];
    onchange: (alerts: PriceAlert[]) => void;
    onopen: (symbol: string) => void;
    onnote?: (id: number) => void;
  } = $props();

  let direction = $state<"above" | "below">("above");
  let kind = $state<AlertKind>("price");
  let level = $state<number | undefined>(undefined);
  let recurring = $state(false);
  let cooldownMins = $state<number | undefined>(15);
  let regularOnly = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const labels: Record<AlertKind, [string, string]> = {
    price: ["At or above", "At or below"],
    day_percent: ["Up", "Down"],
    armed_percent: ["Up", "Down"],
    trail_percent: ["Rises from low", "Falls from high"],
    trail_amount: ["Rises from low", "Falls from high"],
  };
  const noun = $derived(kind === "price" ? "Price" : kind === "trail_amount" ? "Amount" : "Percent");

  let filter = $state<AlertFilter>("all");
  let editingId = $state<number | null>(null);
  let editDirection = $state<"above" | "below">("above");
  let editLevel = $state<number | undefined>(undefined);

  const counts = $derived(alertCounts(alerts));
  const shown = $derived(visibleAlerts(alerts, filter));

  function unit(a: PriceAlert): string {
    return a.kind === "price" || a.kind === "trail_amount" ? "" : "%";
  }

  function nounFor(a: PriceAlert): string {
    return a.kind === "price" ? "Price" : a.kind === "trail_amount" ? "Amount" : "Percent";
  }

  async function save(command: string, args: Record<string, unknown>): Promise<PriceAlert[] | null> {
    if (busy) return null;
    busy = true;
    error = null;
    try {
      const next = await invoke<PriceAlert[]>(command, args);
      onchange(next);
      if (command === "add_alert") level = undefined;
      return next;
    } catch (e) {
      error = String(e);
      return null;
    } finally {
      busy = false;
    }
  }

  function startEdit(a: PriceAlert) {
    error = null;
    editingId = a.id;
    editDirection = a.direction;
    editLevel = a.level;
  }

  function cancelEdit() {
    editingId = null;
    error = null;
  }

  async function saveEdit(e: SubmitEvent, a: PriceAlert) {
    e.preventDefault();
    const invalid = levelError(editLevel, nounFor(a));
    if (invalid) {
      error = invalid;
      return;
    }
    if (await save("update_alert", { id: a.id, level: editLevel, direction: editDirection })) editingId = null;
  }

  async function duplicate(a: PriceAlert) {
    const before = alerts;
    const next = await save("duplicate_alert", { id: a.id });
    const copy = next && addedAlert(before, next);
    if (copy) {
      filter = "all";
      startEdit(copy);
    }
  }

  function add(e: SubmitEvent) {
    e.preventDefault();
    if (level === undefined || !Number.isFinite(level) || level <= 0) {
      error = `Enter a ${noun.toLowerCase()} greater than zero.`;
      return;
    }
    const cooldown = recurring ? cooldownMins : 15;
    if (cooldown === undefined || !Number.isInteger(cooldown) || cooldown < 0) {
      error = "Enter a whole number of cooldown minutes.";
      return;
    }
    save("add_alert", { symbol, kind, direction, level, recurring, cooldownMins: cooldown, regularOnly });
  }
</script>

<div class="alerts">
  <header>
    <h2>Price alerts</h2>
    <p>Set an alert for {symbol}. One-shot alerts fire once when crossed; rearm to use one again. Recurring alerts stay armed and fire again after a fresh crossing and the cooldown.</p>
  </header>
  <form onsubmit={add}>
    <span class="symbol">{symbol}</span>
    <label>
      <span class="sr-only">Alert kind</span>
      <select bind:value={kind} disabled={busy}>
        <option value="price">Price</option>
        <option value="day_percent">Day move %</option>
        <option value="armed_percent">Move since armed %</option>
        <option value="trail_percent">Trailing %</option>
        <option value="trail_amount">Trailing amount</option>
      </select>
    </label>
    <label>
      <span class="sr-only">Alert direction</span>
      <select bind:value={direction} disabled={busy}>
        <option value="above">{labels[kind][0]}</option>
        <option value="below">{labels[kind][1]}</option>
      </select>
    </label>
    <label class="level">
      <span class="sr-only">Alert {noun.toLowerCase()}</span>
      <input type="number" min="0" step="any" placeholder={noun} required bind:value={level} disabled={busy} />
    </label>
    {#if kind === "price" || kind === "trail_amount"}
      {#if quote?.currency}<span class="currency">{quote.currency}</span>{/if}
    {:else}
      <span class="currency">%</span>
    {/if}
    <label class="check"><input type="checkbox" bind:checked={recurring} disabled={busy} /> Recurring</label>
    {#if recurring}
      <label class="check">
        <input class="cooldown" type="number" min="0" step="1" aria-label="Cooldown minutes" bind:value={cooldownMins} disabled={busy} /> min cooldown
      </label>
    {/if}
    <label class="check"><input type="checkbox" bind:checked={regularOnly} disabled={busy} /> Regular session only</label>
    <button class="add" type="submit" disabled={busy}>Add alert</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="hint">Armed symbols are checked about every 15 seconds while tickr is running, even with the window closed. The first price after arming or restarting establishes a baseline; trailing alerts check a stop reached while tickr was closed. Allow tickr notifications in your system settings.</p>
  {#if alerts.length}
    <div class="filters jelly" role="group" aria-label="Filter alerts">
      {#each ALERT_FILTERS as f (f.key)}
        <button type="button" class:on={filter === f.key} aria-pressed={filter === f.key} onclick={() => (filter = f.key)}>
          {f.label} <span class="count">{counts[f.key]}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if !shown.length}
    <div class="empty">{emptyMessage(filter)}</div>
  {:else}
    <ul aria-label="Saved price alerts">
      {#each shown as alert (alert.id)}
        {@const status = alertStatus(alert)}
        {@const fired = triggerInfo(alert)}
        {@const label = `${alert.symbol} ${alertSummary(alert)} alert`}
        <li>
          <div class="details">
            <button class="ticker" type="button" title={`Open ${alert.symbol} chart`} aria-label={`Open ${alert.symbol} chart`} onclick={() => onopen(alert.symbol)}>{alert.symbol}</button>
            {#if editingId === alert.id}
              <form class="edit" onsubmit={(e) => saveEdit(e, alert)}>
                <label>
                  <span class="sr-only">Direction for {label}</span>
                  <select bind:value={editDirection} disabled={busy}>
                    <option value="above">{labels[alert.kind][0]}</option>
                    <option value="below">{labels[alert.kind][1]}</option>
                  </select>
                </label>
                <label class="level">
                  <span class="sr-only">{nounFor(alert)} for {label}</span>
                  <input type="number" min="0" step="any" required bind:value={editLevel} disabled={busy} />
                </label>
                {#if unit(alert)}<span class="currency">{unit(alert)}</span>{/if}
                <button class="add" type="submit" disabled={busy}>Save</button>
                <button type="button" disabled={busy} onclick={cancelEdit}>Cancel</button>
              </form>
            {:else}
              <span>{alertSummary(alert)}</span>
            {/if}
            {#if alert.recurring}<span class="tag">Recurring, {alert.cooldown_mins} min cooldown</span>{/if}
            {#if alert.regular_only}<span class="tag">Regular only</span>{/if}
            <span class="status {status}">{status === "armed" ? "Armed" : status === "triggered" ? "Triggered" : "Paused"}</span>
            {#if fired}
              <span class="fired">
                {fired.label}{#if fired.price} at <strong>{fired.price}</strong>{/if} on <time datetime={new Date(alert.triggered_at! * 1000).toISOString()}>{fired.time}</time>
              </span>
            {/if}
          </div>
          <div class="actions">
            <button disabled={busy || editingId === alert.id} onclick={() => startEdit(alert)} aria-label={`Edit ${label}`}>Edit</button>
            <button disabled={busy} onclick={() => duplicate(alert)} aria-label={`Duplicate ${label}`}>Duplicate</button>
            <button disabled={busy} onclick={() => save("set_alert_enabled", { id: alert.id, enabled: !alert.enabled })}
              aria-label={`${toggleLabel(status)} ${label}`}>
              {toggleLabel(status)}
            </button>
            <button disabled={busy} onclick={() => save("delete_alert", { id: alert.id })}
              aria-label={`Delete ${label}`}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
  <ChartAlerts {symbol} {interval} {drawings} />
  {#if notesOf(drawings).length}
    <section aria-label="Notes">
      <h3>Notes on {symbol}</h3>
      <ul class="notes">
        {#each notesOf(drawings) as n (n.id)}
          <li><button type="button" title="Show on the chart" onclick={() => onnote?.(n.id)}><span class="dot" style:background={n.color || "var(--accent)"}></span>{noteTitle(n.text)}<span class="when">{n.edited ? new Date(n.edited).toLocaleDateString() : ""}</span></button></li>
        {/each}
      </ul>
    </section>
  {/if}
</div>

<style>
  .alerts { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 14px 10px 8px 4px; }
  h3 { margin: 16px 0 8px; font-size: 13px; }
  .notes { margin: 0; padding: 0; list-style: none; }
  .notes button { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; }
  .notes .dot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
  .notes .when { margin-left: auto; color: var(--muted); font-size: 11px; }
  h2 { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
  p { margin: 0; color: var(--muted); }
  form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 16px 0 10px; }
  .symbol { font-weight: 600; }
  .currency, .hint, .status, .tag { color: var(--muted); font-size: 12px; }
  .check { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--muted); }
  .check input { width: auto; }
  .check .cooldown { width: 60px; }
  .level { flex: 1; min-width: 90px; max-width: 180px; }
  input { width: 100%; }
  input, select, button { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--faint); border-radius: 6px; padding: 6px 9px; }
  button { cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .add { background: var(--accent); color: white; border-color: var(--accent); }
  .hint { max-width: 640px; line-height: 1.5; }
  .error { color: var(--down); margin: 8px 0; }
  .empty { color: var(--muted); padding: 35px 0; text-align: center; }
  ul { list-style: none; margin: 18px 0 0; padding: 0; }
  li { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--grid); }
  .details, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
  .details { font-variant-numeric: tabular-nums; }
  .filters { display: flex; flex-wrap: wrap; gap: 6px; margin: 16px 0 0; }
  .filters button { font-size: 12px; padding: 4px 10px; }
  .filters button.on { background: var(--accent); color: white; border-color: var(--accent); }
  .count { opacity: 0.75; font-variant-numeric: tabular-nums; }
  .ticker { font-weight: 600; padding: 2px 6px; background: none; border-color: transparent; color: var(--accent); }
  .ticker:hover { border-color: var(--faint); }
  .edit { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; }
  .status.armed { color: var(--up); }
  .status.triggered { color: var(--down); }
  .fired { flex-basis: 100%; font-size: 12px; color: var(--muted); }
  .fired strong { color: var(--text); }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
