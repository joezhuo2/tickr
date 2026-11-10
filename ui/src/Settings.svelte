<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { ago } from "./lib/format";
  import { accelerator, display } from "./lib/hotkey";
  import { actionFor, bindKey, groupActions, keyLabel, rebind, type Action } from "./lib/keybinds";
  import { backdrop, dialog } from "./lib/motion";
  import { onMount } from "svelte";
  import type { ChartTimeZone, ConnectionsReport, ServiceStatus, AiConfig, AiTestResult, DataProvider, Dots, Keybinds, RefreshMode, Theme, TextSize, Palette } from "./lib/types";

  let {
    theme = $bindable(),
    textSize = $bindable(),
    palette = $bindable(),
    hotkey = $bindable(),
    error = $bindable(null),
    defaultHotkey,
    keybinds = $bindable(),
    dots = $bindable(),
    refreshMode = $bindable(),
    extended,
    shade,
    timeZone,
    onextended,
    onshade,
    ontimezone,
    onclose,
  }: {
    theme: Theme;
    textSize: TextSize;
    palette: Palette;
    hotkey: string;
    /** Set by the backend when the saved hotkey could not be registered. */
    error?: string | null;
    defaultHotkey: string;
    keybinds: Keybinds;
    dots: Dots;
    refreshMode: RefreshMode;
    extended: boolean;
    shade: boolean;
    timeZone: ChartTimeZone;
    onextended: (enabled: boolean) => void;
    onshade: (enabled: boolean) => void;
    ontimezone: (zone: ChartTimeZone) => void;
    onclose: () => void;
  } = $props();

  let displayError = $state<string | null>(null);
  let displayBusy = $state(false);
  async function saveDisplay(command: string, args: Record<string, string | number>, apply: () => void) {
    displayBusy = true;
    displayError = null;
    try {
      await invoke(command, args);
      apply();
    } catch (e) {
      displayError = String(e);
    } finally {
      displayBusy = false;
    }
  }

  const DOTS: { id: keyof Dots; label: string }[] = [
    { id: "earnings", label: "Earnings" },
    { id: "news", label: "News" },
    { id: "analysts", label: "Analyst ratings" },
  ];

  function toggleDot(id: keyof Dots) {
    dots = { ...dots, [id]: !dots[id] };
    invoke("set_dots", { dots }).catch(console.warn);
  }

  let ai = $state<AiConfig>({ enabled: true, base_url: "", model: "", news_model: "", events_model: "", api_key: "", has_key: false });
  let aiStatus = $state<{ text: string; ok: boolean } | null>(null);
  let aiTesting = $state(false);
  let aiResults = $state<AiTestResult[]>([]);
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


  let connections = $state<ConnectionsReport | null>(null);
  let connectionError = $state("");
  let connectionNow = $state(Math.floor(Date.now() / 1000));
  let retrying = $state<Record<string, boolean>>({});
  let copyStatus = $state("");
  let copyError = $state(false);
  const connectionStates = { ok: "OK", error: "Error", unknown: "Not checked", off: "Off" };

  async function loadConnections() {
    try {
      connections = await invoke<ConnectionsReport>("get_connections");
      connectionNow = Math.floor(Date.now() / 1000);
      connectionError = "";
    } catch (e) {
      connectionError = String(e);
    }
  }

  async function retryConnection(service: ServiceStatus["id"]) {
    retrying[service] = true;
    connectionError = "";
    try {
      connections = await invoke<ConnectionsReport>("retry_connection", { service });
      connectionNow = Math.floor(Date.now() / 1000);
    } catch (e) {
      connectionError = String(e);
    } finally {
      retrying[service] = false;
    }
  }

  async function copyDiagnostics() {
    copyStatus = "";
    copyError = false;
    try {
      await navigator.clipboard.writeText(await invoke<string>("get_diagnostics"));
      copyStatus = "Copied";
    } catch (e) {
      copyStatus = String(e);
      copyError = true;
    }
  }

  let backupStatus = $state("");
  let backupError = $state(false);
  let pendingImport = $state<string | null>(null);

  async function exportBackup() {
    backupStatus = "";
    backupError = false;
    try {
      const text = await invoke<string>("export_settings");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      link.download = `tickr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
      backupStatus = "Exported";
    } catch (e) {
      backupStatus = String(e);
      backupError = true;
    }
  }

  async function chooseBackup(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    backupStatus = "";
    backupError = false;
    if (!file) return;
    try {
      pendingImport = await file.text();
    } catch (err) {
      backupStatus = String(err);
      backupError = true;
    }
  }

  async function importBackup() {
    const text = pendingImport;
    pendingImport = null;
    try {
      await invoke("import_settings", { text });
      sessionStorage.setItem("tickr-reload-state", "1");
      location.reload();
    } catch (e) {
      backupStatus = String(e);
      backupError = true;
    }
  }

  onMount(() => {
    loadConnections();
    invoke<DataProvider>("get_data_provider").then((c) => (market = c)).catch((e) => (marketStatus = { text: String(e), ok: false }));
    invoke<AiConfig>("get_ai_config").then((c) => (ai = c)).catch(console.warn);
  });

  async function clearAiKey() {
    try {
      await invoke("clear_ai_key");
      ai.api_key = "";
      ai.has_key = false;
      aiStatus = { ok: true, text: "API key cleared." };
    } catch (e) {
      aiStatus = { ok: false, text: String(e) };
    }
  }

  async function saveAi() {
    try {
      await invoke("set_ai_config", { prefs: ai });
      if (ai.api_key.trim()) ai.has_key = true;
      ai.api_key = "";
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
      await loadConnections();
      return true;
    } catch (e) {
      aiStatus = { ok: false, text: String(e) };
      return false;
    }
  }

  async function testAi() {
    aiTesting = true;
    aiResults = [];
    try {
      if (!await saveAi()) return;
      aiResults = await invoke<AiTestResult[]>("test_ai");
    } catch (e) {
      aiStatus = { ok: false, text: String(e) };
    } finally {
      aiTesting = false;
      await loadConnections();
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

    <h3>Display</h3>
    <label class="row">
      <span>Theme</span>
      <select class="field" value={theme} disabled={displayBusy} onchange={(e) => { const next = e.currentTarget.value as Theme; saveDisplay("set_theme", { theme: next }, () => theme = next); }}>
        <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
      </select>
    </label>
    <label class="row">
      <span>Text size</span>
      <select class="field" value={textSize} disabled={displayBusy} onchange={(e) => { const next = Number(e.currentTarget.value) as TextSize; saveDisplay("set_text_size", { percent: next }, () => textSize = next); }}>
        <option value={100}>100%</option><option value={110}>110%</option><option value={125}>125%</option><option value={150}>150%</option>
      </select>
    </label>
    <label class="row">
      <span>Gain/loss colors</span>
      <select class="field" value={palette} disabled={displayBusy} onchange={(e) => { const next = e.currentTarget.value as Palette; saveDisplay("set_palette", { palette: next }, () => palette = next); }}>
        <option value="standard">Standard</option><option value="accessible">Accessible blue and orange</option>
      </select>
    </label>
    {#if displayError}<p class="error">{displayError}</p>{/if}

    <div class="row">
      <label for="refresh-mode">Background refresh</label>
      <select id="refresh-mode" class="field" bind:value={refreshMode} onchange={() => invoke("set_refresh_mode", { mode: refreshMode }).catch(console.warn)}>
        <option value="balanced">Balanced</option>
        <option value="low_power">Low-power</option>
      </select>
    </div>
    <p class="hint">Low-power slows updates while the window is hidden, and alerts keep their usual cadence.</p>

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

    <h3>Chart sessions</h3>
    <label class="row">
      <span>Extended-hours candles</span>
      <input type="checkbox" checked={extended} onchange={(e) => onextended(e.currentTarget.checked)} />
    </label>
    <label class="row">
      <span>Shade pre-market and after-hours</span>
      <input type="checkbox" checked={shade} onchange={(e) => onshade(e.currentTarget.checked)} />
    </label>
    <label class="row">
      <span>Chart times</span>
      <select class="field" value={timeZone} onchange={(e) => ontimezone(e.currentTarget.value as ChartTimeZone)}>
        <option value="exchange">Exchange time</option><option value="local">Local time</option>
      </select>
    </label>
    <p class="hint">Extended-hours candles apply to the 1D chart. The tray quote has its own extended-hours setting. Local time applies to intraday candles; daily and longer candles keep exchange dates.</p>

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
        <input class="field" type="password" autocomplete="off" spellcheck="false" bind:value={ai.api_key} placeholder={ai.has_key ? "Key saved" : ""} onchange={saveAi} />
        <button class="link" disabled={!ai.has_key} onclick={(e) => { e.preventDefault(); clearAiKey(); }}>Clear</button>
      </span>
    </label>
    <button class="link" disabled={aiTesting} onclick={testAi}>{aiTesting ? "Testing…" : "Test connection"}</button>
    {#each aiResults as result (result.model)}
      <p class="hint" class:error={!result.ok}>{result.model}: {result.ok ? "OK (" + result.ms + " ms)" : result.error}</p>
    {/each}
    <p class:error={aiStatus && !aiStatus.ok} class="hint">
      {aiStatus ? aiStatus.text : "Any OpenAI-compatible endpoint. Leave a feature's model blank to use Model. Saved to .env.local; keyword tone is the fallback."}
    </p>
    <h3>Backup</h3>
    <div class="row">
      <button class="link" onclick={exportBackup}>Export</button>
      <label class="link">
        Import
        <input type="file" accept=".json,application/json" hidden onchange={chooseBackup} />
      </label>
    </div>
    {#if pendingImport !== null}
      <p class="hint" role="alert">Replace your settings, drawings and watchlists with this backup?</p>
      <div class="row">
        <button class="link" onclick={importBackup}>Replace</button>
        <button class="link" onclick={() => (pendingImport = null)}>Cancel</button>
      </div>
    {/if}
    <p class="hint" class:error={backupError} role="status">{backupStatus || "Saves settings, drawings, watchlists and alerts to a file. API keys are not included."}</p>
    <h3>Connections</h3>
    {#if connections}
      {#each connections.services as service (service.id)}
        <div class="row">
          <span>{service.label}</span>
          <span class="connection-state" class:ok={service.state === "ok"} class:error={service.state === "error"}>{connectionStates[service.state]}</span>
          {#if service.state !== "off"}
            <button class="link" disabled={retrying[service.id]} onclick={() => retryConnection(service.id)} aria-label={`Retry ${service.label}`}>{retrying[service.id] ? "Retrying…" : "Retry"}</button>
          {/if}
        </div>
        <p class="hint">{service.last_ok ? `Last success ${ago(service.last_ok, connectionNow)}` : "No success yet"}</p>
        {#if service.state === "error" && service.last_error}
          <p class="hint error connection-error">{service.last_error}</p>
        {/if}
      {/each}
      <p class="hint">tickr {connections.app_version} · {connections.os}</p>
    {/if}
    {#if connectionError}<p class="hint error" role="status">{connectionError}</p>{/if}
    <button class="link" onclick={copyDiagnostics}>Copy diagnostics</button>
    <p class="hint" class:error={copyError} role="status">{copyStatus}</p>
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
  .connection-state {
    margin-left: auto;
    color: var(--muted);
  }
  .connection-state.ok {
    color: var(--up);
  }
  .connection-state.error {
    color: var(--down);
  }
  .connection-error {
    overflow-wrap: anywhere;
  }
  .hint.error {
    color: var(--down);
  }
  .error {
    margin: 4px 0 0;
    color: var(--down);
  }
</style>
