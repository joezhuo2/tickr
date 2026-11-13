<script lang="ts">
  import ColorPicker from "./ColorPicker.svelte";
  import { FONTS, MAIN_PRESETS, MONO_FONTS, NO_CUSTOM, SUB_PRESETS, TOKENS, saveCustom, type Custom } from "./lib/display";
  import { cssToHex } from "./lib/color";
  import { applyLocal, parseLocal, withLocal } from "./lib/backupLocal";
  import { invoke } from "@tauri-apps/api/core";
  import { ago } from "./lib/format";
  import { accelerator, display } from "./lib/hotkey";
  import { DEFAULT_KEYBINDS, actionFor, bindKey, groupActions, keybindsCustomized, keyLabel, rebind, type Action, type Category } from "./lib/keybinds";
  import { backdrop, dialog, expand, paneIn } from "./lib/motion";
  import { onMount, tick } from "svelte";
  import { matchSettings, type SettingEntry } from "./lib/settingsSearch";
  import { chartAlerts } from "./lib/chartAlertStore.svelte";
  import { rr, setReward } from "./lib/rrStore.svelte";
  import { OVERLAY_TOGGLES, overlayVisibility, toggleChartPattern, toggleOverlay } from "./lib/indicators";
  import { CHART_PATTERN_INFO, CHART_PATTERN_KINDS } from "./lib/patternInfo";
  import type { IndicatorConfig } from "./lib/types";
  import type { ChartTimeZone, ConnectionsReport, ServiceStatus, AiConfig, AiTestResult, DataProvider, Dots, Keybinds, RefreshMode, Theme, TextSize, Palette } from "./lib/types";

  let {
    custom = $bindable(),
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
    indicators,
    onindicators,
    onclose,
  }: {
    indicators?: IndicatorConfig;
    onindicators: (config: IndicatorConfig) => Promise<void>;
    custom: Custom;
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

  let picking = $state<string | null>(null);
  const TOKEN_GROUPS = [...new Set(TOKENS.map((t) => t.group))].map((g) => ({ name: g, tokens: TOKENS.filter((t) => t.group === g) }));

  function tokenColor(name: string): string {
    void custom;
    return custom.colors[name] || cssToHex(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`));
  }

  function setToken(name: string, hex: string) {
    const colors = { ...custom.colors };
    if (hex) colors[name] = hex;
    else delete colors[name];
    setCustom({ colors });
  }

  function setCustom(change: Partial<Custom>) {
    custom = { ...custom, ...change };
    saveCustom(custom);
  }

  function shown(kind: "main" | "sub") {
    void custom;
    return custom[kind] || getComputedStyle(document.documentElement).getPropertyValue(kind === "main" ? "--accent" : "--bg").trim();
  }

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

  let analysisBusy = $state(false);
  let analysisError = $state<string | null>(null);
  async function saveAnalysis(next: IndicatorConfig) {
    analysisBusy = true;
    analysisError = null;
    try {
      await onindicators(next);
    } catch (e) {
      analysisError = String(e);
    } finally {
      analysisBusy = false;
    }
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

  let historyStatus = $state("");
  let historyError = $state(false);

  async function clearHistory() {
    try {
      await invoke("clear_bar_cache");
      historyStatus = "Cleared";
      historyError = false;
    } catch (e) {
      historyStatus = String(e);
      historyError = true;
    }
  }

  let backupStatus = $state("");
  let backupError = $state(false);
  let pendingImport = $state<string | null>(null);

  async function exportBackup() {
    backupStatus = "";
    backupError = false;
    try {
      const text = withLocal(await invoke<string>("export_settings"), localStorage);
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
      const local = parseLocal(text ?? "");
      await invoke("import_settings", { text });
      applyLocal(localStorage, local);
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

  function resetKeybinds() {
    saveKeybinds({ ...DEFAULT_KEYBINDS });
    if (hotkey !== defaultHotkey) saveHotkey(defaultHotkey);
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
  const TABS = [
    { id: "display", label: "Display" },
    { id: "hotkeys", label: "Hotkeys" },
    { id: "chart", label: "Chart" },
    { id: "data", label: "Market data" },
    { id: "ai", label: "AI" },
    { id: "backup", label: "Backup" },
    { id: "connections", label: "Connections" },
  ] as const;
  let tab = $state<(typeof TABS)[number]["id"]>("display");
  const KEY_GROUPS = groupActions();
  let keyGroup = $state<Category>(KEY_GROUPS[0].id);
  let keysOpen = $state(true);

  let find = $state("");
  let findOpen = $state(false);
  let findActive = $state(0);
  let content: HTMLDivElement | undefined = $state();
  const found = $derived(matchSettings(find));

  async function goTo(entry: SettingEntry) {
    findOpen = false;
    find = "";
    tab = entry.tab;
    if (entry.group) {
      keyGroup = entry.group;
      keysOpen = true;
    }
    await tick();
    const rows = [...(content?.querySelectorAll<HTMLElement>(".row, button.link") ?? [])];
    const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";
    const row = rows.find((r) => text(r.firstElementChild ?? r) === entry.label) ?? rows.find((r) => text(r).includes(entry.label));
    if (!row) return;
    row.scrollIntoView({ block: "center" });
    row.classList.remove("flash-setting");
    void row.offsetWidth;
    row.classList.add("flash-setting");
    setTimeout(() => row.classList.remove("flash-setting"), 1600);
  }

  function findKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      if (!findOpen && !find) return;
      findOpen = false;
      find = "";
    } else if (e.key === "ArrowDown") findActive = Math.min(found.length - 1, findActive + 1);
    else if (e.key === "ArrowUp") findActive = Math.max(0, findActive - 1);
    else if (e.key === "Enter" && found[findActive]) void goTo(found[findActive]);
    else return;
    e.preventDefault();
  }

  function openHotkeys() {
    keysOpen = tab === "hotkeys" ? !keysOpen : true;
    tab = "hotkeys";
  }
  const keys = $derived(KEY_GROUPS.find((g) => g.id === keyGroup) ?? KEY_GROUPS[0]);
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose} transition:backdrop>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="panel" role="dialog" tabindex="-1" aria-modal="true" aria-label="Settings" onclick={(e) => e.stopPropagation()} transition:dialog>
    <header>
      <h2>Settings</h2>
      <div class="find" onfocusout={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) findOpen = false; }}>
        <input
          type="search"
          placeholder="Search settings…"
          aria-label="Search settings"
          role="combobox"
          aria-expanded={findOpen && found.length > 0}
          aria-controls="settings-found"
          spellcheck="false"
          autocomplete="off"
          bind:value={find}
          oninput={() => { findOpen = true; findActive = 0; }}
          onfocus={() => { findOpen = true; findActive = 0; }}
          onkeydown={findKey}
        />
        {#if findOpen && found.length}
          <ul id="settings-found" class="found" role="listbox" aria-label="Matching settings" transition:expand>
            {#each found as entry, i (`${entry.tab} ${entry.group ?? ""} ${entry.label}`)}
              <li role="option" aria-selected={i === findActive}>
                <button tabindex="-1" onmouseenter={() => (findActive = i)} onclick={() => goTo(entry)}>
                  <span>{entry.label}</span>
                  <span class="where">{entry.section}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <button class="close" aria-label="Close" onclick={onclose}>×</button>
    </header>

    {#if picking && picking !== "main" && picking !== "sub"}
      {@const name = picking}
      <ColorPicker
        label={TOKENS.find((t) => t.name === name)?.label ?? name}
        value={tokenColor(name)}
        presets={MAIN_PRESETS}
        onchange={(hex) => setToken(name, hex)}
        onreset={() => { setToken(name, ""); picking = null; }}
        onclose={() => (picking = null)}
      />
    {:else if picking}
      {@const kind = picking as "main" | "sub"}
      <ColorPicker
        label={kind === "main" ? "Main color" : "Sub color"}
        value={shown(kind)}
        presets={kind === "main" ? MAIN_PRESETS : SUB_PRESETS}
        onchange={(hex) => setCustom({ [kind]: hex })}
        onreset={() => { setCustom({ [kind]: "" }); picking = null; }}
        onclose={() => (picking = null)}
      />
    {/if}
    <div class="body">
      <div class="nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
        {#each TABS as t (t.id)}
          {#if t.id === "hotkeys"}
            <button aria-expanded={tab === "hotkeys" && keysOpen} class:open={tab === "hotkeys"} onclick={openHotkeys}>{t.label}<span class="caret" class:turned={tab === "hotkeys" && keysOpen} aria-hidden="true">▸</span></button>
            {#if tab === "hotkeys" && keysOpen}
              <div class="subnav" transition:expand>
                {#each KEY_GROUPS as g (g.id)}
                  <button role="tab" class="sub" aria-selected={keyGroup === g.id} class:on={keyGroup === g.id} onclick={() => (keyGroup = g.id)}>{g.label}</button>
                {/each}
              </div>
            {/if}
          {:else}
            <button role="tab" aria-selected={tab === t.id} class:on={tab === t.id} onclick={() => (tab = t.id)}>{t.label}</button>
          {/if}
        {/each}
      </div>
      <div class="content" role="tabpanel" bind:this={content}>
      {#key `${tab} ${tab === "hotkeys" ? keyGroup : ""}`}
      <div class="section" in:paneIn={{ y: 8 }}>
    {#if tab === "display"}
    <h3>Display</h3>
    <div class="row">
      <span>Reset all colors</span>
      <button class="link" disabled={!custom.main && !custom.sub && !Object.keys(custom.colors).length} onclick={() => setCustom({ main: "", sub: "", colors: {} })}>Reset to defaults</button>
    </div>
    <label class="row">
      <span>Theme</span>
      <select class="field" value={theme} disabled={displayBusy} onchange={(e) => { const next = e.currentTarget.value as Theme; saveDisplay("set_theme", { theme: next }, () => theme = next); }}>
        <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
      </select>
    </label>
    <div class="row">
      <span>Main color</span>
      <span class="keys">
        {#if custom.main}<button class="link" onclick={() => setCustom({ main: "" })}>Reset</button>{/if}
        <button class="color" aria-label="Choose the main color" onclick={() => (picking = "main")}><span style:background={shown("main")}></span>{custom.main || "Theme default"}</button>
      </span>
    </div>
    <div class="row">
      <span>Sub color</span>
      <span class="keys">
        {#if custom.sub}<button class="link" onclick={() => setCustom({ sub: "" })}>Reset</button>{/if}
        <button class="color" aria-label="Choose the sub color" onclick={() => (picking = "sub")}><span style:background={shown("sub")}></span>{custom.sub || "Theme default"}</button>
      </span>
    </div>
    <p class="hint">Main is the accent on buttons, links and highlights. Sub is the background; text, panels and borders are derived from it, and a sub color decides light or dark on its own, overriding Theme.</p>
    <label class="row">
      <span>Font</span>
      <select class="field" value={custom.font} onchange={(e) => setCustom({ font: e.currentTarget.value })}>
        <option value="">System default</option>
        {#each FONTS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
      </select>
    </label>
    <label class="row">
      <span>Number font</span>
      <select class="field" value={custom.mono} onchange={(e) => setCustom({ mono: e.currentTarget.value })}>
        <option value="">System monospace</option>
        {#each MONO_FONTS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
      </select>
    </label>
    {#if custom.main || custom.sub || custom.font || custom.mono || Object.keys(custom.colors).length}
      <div class="row"><span></span><button class="link" onclick={() => setCustom(NO_CUSTOM)}>Reset colors and fonts</button></div>
    {/if}
    <h3>Colors</h3>
    <p class="hint">Every color tickr draws with. A color set here wins over Main, Sub and the gain/loss palette.</p>
    {#each TOKEN_GROUPS as g (g.name)}
      <h3>{g.name}</h3>
      {#each g.tokens as t (t.name)}
        <div class="row">
          <span>{t.label}</span>
          <span class="keys">
            {#if custom.colors[t.name]}<button class="link" onclick={() => setToken(t.name, "")}>Reset</button>{/if}
            <button class="color" aria-label="Choose the {t.label.toLowerCase()} color" onclick={() => (picking = t.name)}><span style:background={custom.colors[t.name] || `var(--${t.name})`}></span>{custom.colors[t.name] || "Theme default"}</button>
          </span>
        </div>
      {/each}
    {/each}
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

    {/if}
    {#if tab === "hotkeys"}
    <h3>{keys.label} hotkeys</h3>
    {#if keys.id === "general"}
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
    <div class="row">
      <span>Reset all keybinds</span>
      <button class="link" disabled={hotkey === defaultHotkey && !keybindsCustomized(keybinds)} onclick={resetKeybinds}>Reset to defaults</button>
    </div>
    {/if}
    {#each keys.actions as a (a.id)}
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

    {/if}
    {#if tab === "chart"}
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

    <h3>Drawings</h3>
    <label class="row">
      <span>R:R reward multiple</span>
      <input class="field" type="number" min="0.1" max="20" step="0.1" value={rr.reward} onchange={(e) => { setReward(e.currentTarget.valueAsNumber); e.currentTarget.value = String(rr.reward); }} />
    </label>
    <p class="hint">Target distance of the R:R drawing as a multiple of the risk. Applies to every R:R drawing.</p>

    <h3>Chart dots</h3>
    {#each DOTS as d (d.id)}
      <label class="row">
        <span>{d.label}</span>
        <input type="checkbox" checked={dots[d.id]} onchange={() => toggleDot(d.id)} />
      </label>
    {/each}

    <h3>Chart alerts</h3>
    <label class="row">
      <span>Check indicator and drawing alerts in the background</span>
      <input type="checkbox" checked={chartAlerts.background} onchange={(e) => { chartAlerts.background = e.currentTarget.checked; invoke("set_background_chart_alerts", { enabled: chartAlerts.background }).catch(console.warn); }} />
    </label>
    <p class="hint">Downloads candles for each symbol and interval with an armed alert about once per bar (at most every 15 minutes) while tickr runs, and keeps the window loaded in memory when it is minimized or closed to the tray.</p>

    {#if indicators}
      {@const config = indicators}
      <h3>Technical analysis</h3>
      <label class="row">
        <span>Auto analyze</span>
        <input type="checkbox" checked={config.keep_analysis} disabled={analysisBusy} onchange={(e) => saveAnalysis({ ...config, keep_analysis: e.currentTarget.checked })} />
      </label>
      <p class="hint">Runs the local technical analysis whenever a symbol, range or interval loads, on refresh and when new candles arrive, so you don't need to press Analyze. It never calls the AI. The items below are what the chart shows afterwards.</p>
      {#each OVERLAY_TOGGLES as o (o.key)}
        <label class="row">
          <span>{o.label}</span>
          <input type="checkbox" checked={overlayVisibility(config)[o.key]} disabled={analysisBusy} onchange={(e) => saveAnalysis(toggleOverlay(config, o.key, e.currentTarget.checked))} />
        </label>
      {/each}
      <h3>Chart patterns to detect</h3>
      {#each CHART_PATTERN_KINDS as k (k)}
        <label class="row">
          <span>{CHART_PATTERN_INFO[k].name}</span>
          <input type="checkbox" checked={!config.chart_patterns_off.includes(k)} disabled={analysisBusy} onchange={(e) => saveAnalysis(toggleChartPattern(config, k, e.currentTarget.checked))} />
        </label>
      {/each}
      {#if analysisError}<p class="error">{analysisError}</p>{/if}
    {/if}

    {/if}
    {#if tab === "data"}
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
    <p class="hint">Free Alpaca keys give real-time IEX trades for US stocks in the chart, watchlist and alerts, and deeper intraday history when you scroll the chart back. Yahoo quotes can be delayed.</p>
    {#if marketStatus}<p class="hint" class:error={!marketStatus.ok}>{marketStatus.text}</p>{/if}
    <div class="row">
      <button class="link" onclick={clearHistory}>Clear cached history</button>
    </div>
    <p class="hint" class:error={historyError} role="status">{historyStatus || "Intraday candles you load are kept on this computer, so scrolling back reaches past Yahoo's limit over time."}</p>

    {/if}
    {#if tab === "ai"}
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
    {/if}
    {#if tab === "backup"}
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
    {/if}
    {#if tab === "connections"}
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
    {/if}
      </div>
      {/key}
      </div>
    </div>
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
    position: relative;
    width: min(600px, calc(100% - 32px));
    height: min(480px, calc(100% - 32px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 14px 16px 16px;
    border-radius: 10px;
    background: var(--bg);
    box-shadow: var(--shadow);
  }
  .body {
    flex: 1;
    display: flex;
    gap: 14px;
    min-height: 0;
    margin-top: 8px;
  }
  .subnav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }
  .caret.turned {
    transform: rotate(90deg);
  }
  .nav {
    flex: 0 0 112px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-right: 10px;
    border-right: 1px solid var(--faint);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .nav button {
    border: 0;
    border-radius: 6px;
    padding: 5px 8px;
    background: none;
    color: var(--muted);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .nav button:hover {
    color: var(--text);
  }
  .nav button.on {
    background: var(--surface);
    color: var(--text);
    font-weight: 600;
  }
  .nav button.open {
    color: var(--text);
    font-weight: 600;
  }
  .nav button.sub {
    margin-left: 10px;
    font-size: 11px;
  }
  .caret {
    float: right;
    font-size: 9px;
    line-height: 16px;
    transition: transform var(--motion-base) var(--ease-out);
  }
  .nav button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-right: 6px;
  }
  .section > :global(h3:first-child) {
    margin-top: 2px;
  }
  @media (max-width: 520px) {
    .body {
      flex-direction: column;
    }
    .nav {
      flex: none;
      flex-direction: row;
      flex-wrap: wrap;
      padding: 0 0 8px;
      border-right: 0;
      border-bottom: 1px solid var(--faint);
      overflow: visible;
    }
    .subnav {
      flex-direction: row;
      flex-wrap: wrap;
    }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .find {
    position: relative;
    flex: 1;
    max-width: 260px;
    margin-right: auto;
  }
  .find input {
    width: 100%;
    font: inherit;
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 7px;
    border: 1px solid var(--faint);
    background: var(--surface);
    color: var(--text);
    outline: none;
  }
  .find input:focus {
    border-color: var(--accent);
  }
  .found {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 320px;
    max-width: calc(100vw - 64px);
    margin: 0;
    padding: 4px;
    list-style: none;
    background: var(--tooltip-bg);
    border: 1px solid var(--faint);
    border-radius: 8px;
    box-shadow: var(--shadow);
    z-index: 3;
  }
  .found button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 8px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--text);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .found li[aria-selected="true"] button {
    background: var(--surface);
  }
  .where {
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .content :global(.flash-setting) {
    border-radius: 6px;
    animation: flash-setting 1.5s var(--ease-out);
  }
  @keyframes flash-setting {
    0%, 45% {
      background: color-mix(in srgb, var(--accent) 30%, transparent);
      box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 30%, transparent);
    }
    100% {
      background: transparent;
      box-shadow: 0 0 0 4px transparent;
    }
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
  .color {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 220px;
    padding: 3px 8px;
    border-radius: 5px;
    border: 1px solid var(--faint);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 11px;
    cursor: pointer;
  }
  .color span {
    width: 26px;
    height: 14px;
    border-radius: 4px;
    border: 1px solid var(--faint);
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
  .link:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
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
