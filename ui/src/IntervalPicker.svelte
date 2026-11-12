<script lang="ts">
  import { intervalHint, intervalLabel, parseInterval, pickerIntervals } from "./lib/types";

  let {
    value,
    label,
    recent = [],
    disabled = false,
    onchange,
  }: {
    value: string;
    label: string;
    recent?: readonly string[];
    disabled?: boolean;
    onchange: (interval: string) => void;
  } = $props();

  let typing = $state(false);
  let text = $state("");
  const parsed = $derived(text.trim() ? parseInterval(text) : null);
  const error = $derived(parsed && "error" in parsed ? parsed.error : null);
  const hint = $derived(error ?? (parsed && "hint" in parsed ? parsed.hint : null) ?? "Minutes (m), hours (h), days (D), weeks (W) or months (mo)");

  function pick(next: string) {
    if (next !== "custom") return onchange(next);
    text = "";
    typing = true;
  }

  function apply() {
    if (!parsed || "error" in parsed) return;
    typing = false;
    onchange(parsed.interval);
  }

  function focus(node: HTMLInputElement) {
    node.focus();
  }
</script>

{#if typing}
  <span class="custom">
    <input
      use:focus
      aria-label={`${label}, custom`}
      aria-invalid={!!error}
      placeholder="45m, 4h, 2D"
      maxlength="8"
      spellcheck="false"
      bind:value={text}
      onkeydown={(e) => {
        if (e.key === "Enter") apply();
        else if (e.key === "Escape") typing = false;
      }}
      onblur={() => (typing = false)}
    />
    <span class="hint" class:error role={error ? "alert" : "status"}>{hint}</span>
  </span>
{:else}
  <select aria-label={label} {value} {disabled} onchange={(e) => pick(e.currentTarget.value)}>
    <option value="auto">Auto</option>
    {#each pickerIntervals([...recent, value]) as i (i)}
      <option value={i} title={intervalHint(i) ?? undefined}>{intervalLabel(i)}</option>
    {/each}
    <option value="custom">Custom…</option>
  </select>
{/if}

<style>
  select,
  input {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--faint);
    border-radius: 6px;
    padding: 3px;
    font-size: 12px;
  }
  .custom {
    position: relative;
    display: inline-flex;
  }
  input {
    width: 9ch;
  }
  .hint {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    width: 240px;
    padding: 6px 8px;
    background: var(--surface);
    border: 1px solid var(--faint);
    border-radius: 6px;
    box-shadow: var(--shadow);
    font-size: 11px;
    color: var(--muted);
  }
  .hint.error {
    color: var(--down);
  }
</style>
