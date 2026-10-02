<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { accelerator, display } from "./lib/hotkey";

  let {
    hotkey = $bindable(),
    error = $bindable(null),
    defaultHotkey,
    status,
    watchlistOn,
    onwatchlist,
  }: {
    hotkey: string;
    /** Set by the backend when the saved hotkey could not be registered. */
    error?: string | null;
    defaultHotkey: string;
    status: { kind: "live" | "stale" | "offline" | "loading"; text: string };
    watchlistOn: boolean;
    onwatchlist: () => void;
  } = $props();

  let recording = $state(false);

  async function save(next: string) {
    recording = false;
    try {
      hotkey = await invoke<string>("set_hotkey", { hotkey: next });
      error = null;
    } catch (e) {
      error = String(e);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      recording = false;
      return;
    }
    const accel = accelerator(e);
    if (accel) save(accel);
  }
</script>

<svelte:window onkeydown={onKey} />

<footer>
  <span class="label">Hotkey</span>
  <button class="key" class:recording onclick={() => (recording = !recording)} onblur={() => (recording = false)}>
    {recording ? "Press keys… (Esc to cancel)" : display(hotkey)}
  </button>
  {#if hotkey !== defaultHotkey}
    <button class="link" onclick={() => save(defaultHotkey)}>Reset</button>
  {/if}
  <span class="sep"></span>
  <button class="watch" class:on={watchlistOn} aria-pressed={watchlistOn} onclick={onwatchlist}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
    Watchlist
  </button>
  <button class="link credit" onclick={() => invoke("open_logo_credit")}>Logos by Elbstream</button>
  {#if error}<span class="error" title={error}>{error}</span>{/if}
  <span class="status {status.kind}" title={status.text}><i></i>{status.text}</span>
</footer>

<style>
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-top: 1px solid var(--faint);
    background: var(--surface);
    font-size: 12px;
    flex: none;
  }
  .label {
    color: var(--muted);
  }
  .key {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 5px;
    border: 1px solid var(--faint);
    background: var(--bg);
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
  /* Elbstream's free tier asks for a visible link of at least 12 pt. */
  .credit {
    font-size: 12pt;
    color: var(--muted);
    white-space: nowrap;
  }
  .credit:hover {
    color: var(--accent);
  }
  .sep {
    width: 1px;
    height: 14px;
    background: var(--faint);
  }
  .watch {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 5px;
    border: 1px solid var(--faint);
    background: var(--bg);
    cursor: pointer;
    font-size: 11px;
  }
  .watch svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linejoin: round;
  }
  .watch.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .watch.on svg {
    fill: currentColor;
  }
  .error {
    color: var(--down);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .status {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    white-space: nowrap;
  }
  .status i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .live i {
    background: var(--up);
  }
  .stale i {
    background: #ffb340;
  }
  .offline i {
    background: var(--down);
  }
  .loading i {
    background: var(--flat);
  }
</style>
