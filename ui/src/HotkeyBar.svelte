<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { accelerator } from "./lib/hotkey";

  let {
    hotkey = $bindable(),
    defaultHotkey,
    status,
  }: { hotkey: string; defaultHotkey: string; status: { kind: "live" | "stale" | "offline" | "loading"; text: string } } =
    $props();

  let recording = $state(false);
  let error = $state<string | null>(null);

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
  <button class="key" class:recording onclick={() => ((recording = !recording), (error = null))} onblur={() => (recording = false)}>
    {recording ? "Press keys… (Esc to cancel)" : hotkey}
  </button>
  {#if hotkey !== defaultHotkey}
    <button class="link" onclick={() => save(defaultHotkey)}>Reset</button>
  {/if}
  {#if error}<span class="error">{error}</span>{/if}
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
