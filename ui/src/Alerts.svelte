<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { alertSummary } from "./lib/format";
  import type { AlertKind, PriceAlert, Quote } from "./lib/types";

  let { symbol, quote, alerts, onchange }: {
    symbol: string;
    quote: Quote | null;
    alerts: PriceAlert[];
    onchange: (alerts: PriceAlert[]) => void;
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

  async function save(command: string, args: Record<string, unknown>) {
    if (busy) return;
    busy = true;
    error = null;
    try {
      onchange(await invoke<PriceAlert[]>(command, args));
      if (command === "add_alert") level = undefined;
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
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
  {#if !alerts.length}
    <div class="empty">No price alerts yet.</div>
  {:else}
    <ul aria-label="Saved price alerts">
      {#each alerts as alert (alert.id)}
        <li>
          <div class="details">
            <strong>{alert.symbol}</strong>
            <span>{alertSummary(alert)}</span>
            {#if alert.recurring}<span class="tag">Recurring, {alert.cooldown_mins} min cooldown</span>{/if}
            {#if alert.regular_only}<span class="tag">Regular only</span>{/if}
            <span class="status" title={alert.triggered_at ? new Date(alert.triggered_at * 1000).toLocaleString() : undefined}>
              {alert.enabled
                ? alert.recurring && alert.triggered_at ? `Armed, last fired ${new Date(alert.triggered_at * 1000).toLocaleString()}` : "Armed"
                : alert.triggered_at ? "Triggered" : "Paused"}
            </span>
          </div>
          <div class="actions">
            <button disabled={busy} onclick={() => save("set_alert_enabled", { id: alert.id, enabled: !alert.enabled })}
              aria-label={`${alert.enabled ? "Pause" : "Rearm"} ${alert.symbol} ${alertSummary(alert)} alert`}>
              {alert.enabled ? "Pause" : "Rearm"}
            </button>
            <button disabled={busy} onclick={() => save("delete_alert", { id: alert.id })}
              aria-label={`Delete ${alert.symbol} ${alertSummary(alert)} alert`}>Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .alerts { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 14px 10px 8px 4px; }
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
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
