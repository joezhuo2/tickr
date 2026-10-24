<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { accelerator, display } from "./lib/hotkey";
  import { ACTIONS, bindKey, keyLabel, rebind, type Action } from "./lib/keybinds";
  import type { Dots, Keybinds } from "./lib/types";

  let {
    hotkey = $bindable(),
    error = $bindable(null),
    defaultHotkey,
    keybinds = $bindable(),
    dots = $bindable(),
    onclose,
  }: {
    hotkey: string;
    /** Set by the backend when the saved hotkey could not be registered. */
    error?: string | null;
    defaultHotkey: string;
    keybinds: Keybinds;
    dots: Dots;
    onclose: () => void;
  } = $props();

  const DOTS: { id: keyof Dots; label: string }[] = [
    { id: "earnings", label: "Earnings" },
    { id: "news", label: "News" },
    { id: "analysts", label: "Analyst ratings" },
  ];

  function toggleDot(id: keyof Dots) {
    dots = { ...dots, [id]: !dots[id] };
    invoke("set_dots", { dots }).catch(console.warn);
  }

  let recording = $state<"hotkey" | Action | null>(null);

  function saveKeybinds(next: Keybinds) {
    recording = null;
    keybinds = next;
    invoke("set_keybinds", { keybinds: next }).catch(console.warn);
  }

  async function saveHotkey(next: string) {
    recording = null;
    try {
      hotkey = await invoke<string>("set_hotkey", { hotkey: next });
      error = null;
    } catch (e) {
      error = String(e);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!recording) {
      if (e.key === "Escape") onclose();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      recording = null;
      return;
    }
    if (recording === "hotkey") {
      const accel = accelerator(e);
      if (accel) saveHotkey(accel);
      return;
    }
    if (e.key === "Backspace" || e.key === "Delete") {
      saveKeybinds({ ...keybinds, [recording]: "" });
      return;
    }
    const key = bindKey(e);
    if (key) saveKeybinds(rebind(keybinds, recording, key));
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="panel" role="dialog" tabindex="-1" aria-modal="true" aria-label="Settings" onclick={(e) => e.stopPropagation()}>
    <header>
      <h2>Settings</h2>
      <button class="close" aria-label="Close" onclick={onclose}>×</button>
    </header>

    <h3>Global hotkey</h3>
    <div class="row">
      <span>Show or hide tickr</span>
      <span class="keys">
        {#if hotkey !== defaultHotkey}
          <button class="link" onclick={() => saveHotkey(defaultHotkey)}>Reset</button>
        {/if}
        <button
          class="key"
          class:recording={recording === "hotkey"}
          onclick={() => (recording = recording === "hotkey" ? null : "hotkey")}
          onblur={() => (recording = null)}
        >
          {recording === "hotkey" ? "Press keys…" : display(hotkey)}
        </button>
      </span>
    </div>
    {#if error}<p class="error">{error}</p>{/if}

    <h3>Keybinds</h3>
    {#each ACTIONS as a (a.id)}
      <div class="row">
        <span>{a.label}</span>
        <button
          class="key"
          class:recording={recording === a.id}
          title="Backspace to unbind"
          onclick={() => (recording = recording === a.id ? null : a.id)}
          onblur={() => (recording = null)}
        >
          {recording === a.id ? "Press a key…" : keyLabel(keybinds[a.id])}
        </button>
      </div>
    {/each}

    <h3>Chart dots</h3>
    {#each DOTS as d (d.id)}
      <label class="row">
        <span>{d.label}</span>
        <input type="checkbox" checked={dots[d.id]} onchange={() => toggleDot(d.id)} />
      </label>
    {/each}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.35);
  }
  .panel {
    width: min(420px, calc(100% - 32px));
    max-height: calc(100% - 32px);
    overflow-y: auto;
    padding: 14px 16px 16px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: var(--shadow);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    margin: 0;
    font-size: 15px;
  }
  h3 {
    margin: 14px 0 6px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--muted);
  }
  .close {
    border: 0;
    background: none;
    font-size: 18px;
    line-height: 1;
    color: var(--muted);
    cursor: pointer;
  }
  .close:hover {
    color: var(--text);
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 0;
  }
  .keys {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .key {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 5px;
    border: 1px solid var(--faint);
    background: var(--surface);
    cursor: pointer;
    min-width: 90px;
  }
  .key.recording {
    border-color: var(--accent);
    color: var(--accent);
  }
  .link {
    background: none;
    border: 0;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
  }
  .error {
    margin: 4px 0 0;
    color: var(--down);
  }
</style>
