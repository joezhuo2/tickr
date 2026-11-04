<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { accelerator, display } from "./lib/hotkey";
  import { actionFor, bindKey, groupActions, keyLabel, rebind, type Action } from "./lib/keybinds";
  import { backdrop, dialog } from "./lib/motion";
  import { onMount } from "svelte";
  import type { AiConfig, DataProvider, Dots, Keybinds } from "./lib/types";

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

  let ai = $state<AiConfig>({ enabled: true, base_url: "", model: "", news_model: "", events_model: "", api_key: "" });
  let aiStatus = $state<{ text: string; ok: boolean } | null>(null);
  let showKey = $state(false);
  let market = $state<DataProvider>({ provider: "yahoo", feed: "iex", has_keys: false, stream: { kind: "off" } });
  let keyId = $state("");
  let secret = $state("");
  let marketBusy = $state(false);
  let marketStatus = $state<{ text: string; ok: boolean } | null>(null);

  async function marketAction(action: "save" | "test" | "clear") {
    marketBusy = true;
    marketStatus = null;
    try {
      if (action === "test") {
        await invoke("test_alpaca");
        marketStatus = { text: "Connection successful.", ok: true };
      } else {
        market = action === "clear"
          ? await invoke<DataProvider>("clear_alpaca_keys")
          : await invoke<DataProvider>("set_data_provider", { provider: market.provider, feed: market.feed, keyId, secret });
        keyId = "";
        secret = "";
        marketStatus = { text: "Saved.", ok: true };
      }
    } catch (e) {
      marketStatus = { text: String(e), ok: false };
    } finally {
      marketBusy = false;
    }
  }


  onMount(() => {
    invoke<DataProvider>("get_data_provider").then((c) => (market = c)).catch((e) => (marketStatus = { text: String(e), ok: false }));
    invoke<AiConfig>("get_ai_config").then((c) => (ai = c)).catch(console.warn);
  });

  async function saveAi() {
    try {
      await invoke("set_ai_config", { prefs: ai });
      const ready = (own: string) => !!ai.base_url.trim() && !!(own.trim() || ai.model.trim());
      aiStatus = {
        ok: true,
        text:
          !ready(ai.events_model) || (ai.enabled && !ready(ai.news_model))
            ? "Saved. Base URL and a model are needed to use AI."
            : ai.enabled
              ? "Saved."
              : "Saved. News uses keyword tone.",
      };
    } catch (e) {
      aiStatus = { ok: false, text: String(e) };
    }
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
      if (e.defaultPrevented || e.repeat) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onclose();
        return;
      }
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const key = bindKey(e);
      if (key && actionFor(keybinds, key) === "settings") {
        e.preventDefault();
        onclose();
      }
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
<div class="backdrop" onclick={onclose} transition:backdrop>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="panel" role="dialog" tabindex="-1" aria-modal="true" aria-label="Settings" onclick={(e) => e.stopPropagation()} transition:dialog>
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
    {#each groupActions() as g (g.id)}
      <h4>{g.label}</h4>
      {#each g.actions as a (a.id)}
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
    {/each}

    <h3>Chart dots</h3>
    {#each DOTS as d (d.id)}
      <label class="row">
        <span>{d.label}</span>
        <input type="checkbox" checked={dots[d.id]} onchange={() => toggleDot(d.id)} />
      </label>
    {/each}

    <h3>Market data</h3>
    <label class="row">
      <span>Provider</span>
      <select class="field" bind:value={market.provider} disabled={marketBusy}>
        <option value="yahoo">Yahoo</option><option value="alpaca">Alpaca</option>
      </select>
    </label>
    {#if market.provider === "alpaca"}
      <label class="row"><span>Feed</span><select class="field" bind:value={market.feed} disabled={marketBusy}>
        <option value="iex">IEX (free)</option><option value="sip">SIP (paid)</option>
      </select></label>
      <label class="row"><span>Key ID</span><input class="field" type="password" autocomplete="off" spellcheck="false" bind:value={keyId} placeholder={market.has_keys ? "Key saved" : ""} disabled={marketBusy} /></label>
      <label class="row"><span>Secret</span><input class="field" type="password" autocomplete="off" spellcheck="false" bind:value={secret} placeholder={market.has_keys ? "Key saved" : ""} disabled={marketBusy} /></label>
    {/if}
    <div class="row">
      <button class="link" disabled={marketBusy} onclick={() => marketAction("save")}>Save</button>
      <button class="link" disabled={marketBusy || !market.has_keys} onclick={() => marketAction("test")}>Test connection</button>
      <button class="link" disabled={marketBusy || !market.has_keys} onclick={() => marketAction("clear")}>Clear keys</button>
    </div>
    <p class="hint">Free Alpaca keys give real-time IEX trades for US stocks. Watchlist and alerts still use Yahoo.</p>
    {#if marketStatus}<p class="hint" class:error={!marketStatus.ok}>{marketStatus.text}</p>{/if}

    <h3>AI</h3>
    <label class="row">
      <span>News analysis</span>
      <input type="checkbox" bind:checked={ai.enabled} onchange={saveAi} />
    </label>
    <label class="row">
      <span>Base URL</span>
      <input class="field" type="text" placeholder="https://api.openai.com/v1" spellcheck="false" bind:value={ai.base_url} onchange={saveAi} />
    </label>
    <label class="row">
      <span>Model</span>
      <input class="field" type="text" placeholder="gpt-4o-mini" spellcheck="false" bind:value={ai.model} onchange={saveAi} />
    </label>
    <label class="row">
      <span>News model</span>
      <input class="field" type="text" placeholder="Same as Model" spellcheck="false" bind:value={ai.news_model} onchange={saveAi} />
    </label>
    <label class="row">
      <span>Events model</span>
      <input class="field" type="text" placeholder="Same as Model" spellcheck="false" bind:value={ai.events_model} onchange={saveAi} />
    </label>
    <label class="row">
      <span>API key</span>
      <span class="keys">
        <input class="field" type={showKey ? "text" : "password"} autocomplete="off" spellcheck="false" bind:value={ai.api_key} onchange={saveAi} />
        <button class="link" onclick={(e) => { e.preventDefault(); showKey = !showKey; }}>{showKey ? "Hide" : "Show"}</button>
      </span>
    </label>
    <p class:error={aiStatus && !aiStatus.ok} class="hint">
      {aiStatus ? aiStatus.text : "Any OpenAI-compatible endpoint. Leave a feature's model blank to use Model. Saved to .env.local; keyword tone is the fallback."}
    </p>
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
    overscroll-behavior: contain;
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
  h4 {
    margin: 10px 0 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--text);
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
  .field {
    width: 220px;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 5px;
    border: 1px solid var(--faint);
    background: var(--surface);
    color: var(--text);
  }
  .hint {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--muted);
  }
  .hint.error {
    color: var(--down);
  }
  .error {
    margin: 4px 0 0;
    color: var(--down);
  }
</style>
