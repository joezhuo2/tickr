<script lang="ts">
  import { localInputToEpoch, snoozeUntil, type SnoozeChoice } from "./lib/snooze";

  let { until, disabled = false, label = "Snooze", onsnooze }: {
    until: number | null;
    disabled?: boolean;
    label?: string;
    onsnooze: (until: number | null) => void;
  } = $props();

  let picking = $state(false);
  let custom = $state("");
  let invalid = $state(false);

  function pick(e: Event & { currentTarget: HTMLSelectElement }) {
    const value = e.currentTarget.value;
    e.currentTarget.value = "";
    if (value === "custom") picking = true;
    else if (value === "clear") onsnooze(null);
    else if (value) onsnooze(snoozeUntil(value as SnoozeChoice, Date.now() / 1000));
  }

  function apply() {
    const t = localInputToEpoch(custom);
    invalid = t == null || t <= Date.now() / 1000;
    if (invalid || t == null) return;
    onsnooze(t);
    picking = false;
    custom = "";
  }
</script>

<select aria-label={label} {disabled} onchange={pick}>
  <option value="">Snooze</option>
  <option value="1h">1 hour</option>
  <option value="4h">4 hours</option>
  <option value="open">Until next market open</option>
  <option value="custom">Until a date and time</option>
  {#if until != null}<option value="clear">Clear snooze</option>{/if}
</select>
{#if picking}
  <input type="datetime-local" aria-label="Snooze until" aria-invalid={invalid} bind:value={custom} />
  <button type="button" {disabled} onclick={apply}>Set</button>
  <button type="button" onclick={() => { picking = false; invalid = false; }}>Cancel</button>
{/if}

<style>
  select, input, button { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--faint); border-radius: 6px; padding: 6px 9px; }
  button { cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  input[aria-invalid="true"] { border-color: var(--down); }
</style>
