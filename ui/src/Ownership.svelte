<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { direction, fullTime, num, signed, volume } from "./lib/format";
  import type { Filing, Holder, Ownership } from "./lib/types";

  let { symbol }: { symbol: string } = $props();

  let tab = $state<"insiders" | "holders" | "filings">("insiders");
  let data = $state<Ownership | null | undefined>(undefined);
  let dataError = $state<string | null>(null);
  let filings = $state<Filing[] | null | undefined>(undefined);
  let filingsError = $state<string | null>(null);
  let email = $state<string | null>(null);
  let dataSeq = 0;
  let filingsSeq = 0;

  const offset = -new Date().getTimezoneOffset() * 60;
  const day = (t: number | null) => (t == null ? "—" : fullTime(t, offset, "1d"));
  const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);
  const money = (v: number | null) => (v == null ? "—" : `$${volume(v)}`);

  async function loadData() {
    const mine = ++dataSeq;
    const sym = symbol;
    data = undefined;
    dataError = null;
    try {
      const o = await invoke<Ownership | null>("get_ownership", { symbol: sym });
      if (mine === dataSeq) data = o;
    } catch (e) {
      if (mine === dataSeq) {
        data = null;
        dataError = String(e);
      }
      return String(e);
    }
  }

  async function loadFilings(force = false) {
    const mine = ++filingsSeq;
    const sym = symbol;
    try {
      email = await invoke<string>("get_sec_email");
    } catch (e) {
      email = "";
      console.warn(e);
    }
    filingsError = null;
    if (!email) {
      filings = undefined;
      return;
    }
    if (!force) filings = undefined;
    try {
      const list = await invoke<Filing[] | null>("get_filings", { symbol: sym, force });
      if (mine === filingsSeq) filings = list;
    } catch (e) {
      if (mine === filingsSeq) {
        filings = null;
        filingsError = String(e);
      }
      return String(e);
    }
  }

  export function refresh() {
    return tab === "filings" ? loadFilings(true) : loadData();
  }

  $effect(() => {
    symbol;
    loadData();
  });

  $effect(() => {
    symbol;
    if (tab === "filings") loadFilings();
  });

  function open(url: string) {
    invoke("open_news", { url }).catch(console.warn);
  }
</script>

{#snippet holders(list: Holder[])}
  {#if list.length}
    <div class="scroll"><table>
      <thead><tr><th>Holder</th><th>Shares</th><th>% held</th><th>Value</th><th>Change</th><th>Reported</th></tr></thead>
      <tbody>
        {#each list as h (h.name + h.reported)}
          <tr>
            <td class="name">{h.name}</td>
            <td>{volume(h.shares)}</td>
            <td>{pct(h.pct_held)}</td>
            <td>{money(h.value)}</td>
            <td class={direction(h.pct_change)}>{h.pct_change == null ? "—" : `${signed(h.pct_change * 100)}%`}</td>
            <td>{day(h.reported)}</td>
          </tr>
        {/each}
      </tbody>
    </table></div>
  {:else}
    <div class="sub">None reported</div>
  {/if}
{/snippet}

<div class="bar">
  <div class="seg" role="tablist" aria-label="Ownership view">
    {#each [["insiders", "Insiders"], ["holders", "Holders"], ["filings", "Filings"]] as [id, label] (id)}
      <button role="tab" class:on={tab === id} aria-selected={tab === id} onclick={() => (tab = id as typeof tab)}>{label}</button>
    {/each}
  </div>
</div>

<div class="panel">
  {#if tab === "filings"}
    {#if email === null}
      <span class="sk" style="width: 100%; height: 14px"></span>
    {:else if !email}
      <div class="msg">
        <div>SEC filings are off until you add a contact email.</div>
        <div class="sub">The SEC requires every automated client to identify itself. Set "SEC contact email" under Settings, Market data. It is only sent to sec.gov.</div>
        <button class="retry" onclick={() => loadFilings()}>Check again</button>
      </div>
    {:else if filings === undefined && !filingsError}
      {#each [0, 1, 2, 3, 4] as i (i)}<span class="sk" style="width: 100%; height: 14px; margin-bottom: 10px"></span>{/each}
    {:else if filingsError}
      <div class="msg">Could not load filings: {filingsError}<button class="retry" onclick={() => loadFilings(true)}>Retry</button></div>
    {:else if !filings?.length}
      <div class="msg">No SEC filings for {symbol}</div>
    {:else}
      <div class="scroll"><table>
        <thead><tr><th>Form</th><th>Filed</th><th>Description</th></tr></thead>
        <tbody>
          {#each filings as f (f.url)}
            <tr>
              <td class="form"><button class="link" onclick={() => open(f.url)} title="Open on sec.gov">{f.form}</button></td>
              <td>{f.date}</td>
              <td class="name">{f.description ?? "—"}</td>
            </tr>
          {/each}
        </tbody>
      </table></div>
    {/if}
  {:else if data === undefined}
    {#each [0, 1, 2, 3, 4] as i (i)}<span class="sk" style="width: 100%; height: 14px; margin-bottom: 10px"></span>{/each}
  {:else if data === null}
    <div class="msg">
      {#if dataError}
        Could not load ownership: {dataError}<button class="retry" onclick={loadData}>Retry</button>
      {:else}
        No ownership data for {symbol}
      {/if}
    </div>
  {:else if tab === "insiders"}
    {#if data.breakdown?.insiders_pct != null}
      <dl><dt>Held by insiders</dt><dd>{pct(data.breakdown.insiders_pct)}</dd></dl>
    {/if}
    {#if data.insiders.length}
      <div class="scroll"><table>
        <thead><tr><th>Insider</th><th>Transaction</th><th>Shares</th><th>Value</th><th>Date</th></tr></thead>
        <tbody>
          {#each data.insiders as i, n (n)}
            <tr>
              <td class="name">{i.name}{#if i.relation}<div class="sub">{i.relation}</div>{/if}</td>
              <td class="name">{i.text || "—"}</td>
              <td>{i.shares == null ? "—" : num(i.shares, 0)}</td>
              <td>{money(i.value)}</td>
              <td>{day(i.date)}</td>
            </tr>
          {/each}
        </tbody>
      </table></div>
    {:else}
      <div class="sub">No insider transactions reported</div>
    {/if}
  {:else}
    {#if data.breakdown}
      <dl>
        <dt>Held by institutions</dt><dd>{pct(data.breakdown.institutions_pct)}</dd>
        <dt>Institutions of float</dt><dd>{pct(data.breakdown.institutions_float_pct)}</dd>
        <dt>Institutions</dt><dd>{data.breakdown.institutions_count == null ? "—" : num(data.breakdown.institutions_count, 0)}</dd>
      </dl>
    {/if}
    <h2>Institutions</h2>
    {@render holders(data.institutions)}
    <h2>Funds</h2>
    {@render holders(data.funds)}
  {/if}
</div>

<style>
  .bar {
    padding: 8px 4px;
  }
  .seg {
    display: inline-flex;
    background: var(--surface);
    border: 1px solid var(--faint);
    border-radius: 7px;
    padding: 2px;
  }
  .seg button {
    border: 0;
    background: none;
    font: inherit;
    font-size: 12px;
    padding: 2px 10px;
    border-radius: 5px;
    cursor: pointer;
    color: var(--muted);
  }
  .seg button.on {
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }
  .seg button:focus-visible,
  .link:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .panel {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 10px 8px 4px;
    overflow: auto;
    overscroll-behavior: contain;
  }
  h2 {
    margin: 10px 0 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .sub {
    color: var(--muted);
    font-size: 12px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 10px;
    margin: 0;
    font-size: 12px;
    max-width: 320px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    width: 100%;
  }
  th {
    color: var(--muted);
    font-weight: 600;
    text-align: right;
    padding: 4px 6px;
    white-space: nowrap;
  }
  td {
    text-align: right;
    padding: 5px 6px;
    border-top: 1px solid var(--faint);
    white-space: nowrap;
  }
  th:first-child,
  td:first-child,
  td.name {
    text-align: left;
  }
  td.name {
    white-space: normal;
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    padding: 0;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .up {
    color: var(--up);
  }
  .down {
    color: var(--down);
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    gap: 8px;
    color: var(--muted);
    text-align: center;
    max-width: 420px;
    margin: 0 auto;
  }
  .retry {
    justify-self: center;
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
    color: inherit;
  }
</style>
