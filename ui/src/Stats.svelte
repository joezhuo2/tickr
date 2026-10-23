<script lang="ts">
  import type { StatSection } from "./lib/types";

  let { symbol, stats }: { symbol: string; stats: StatSection[] | null | undefined } = $props();
</script>

{#if stats === undefined}
  <div class="grid" aria-busy="true" aria-label="Loading stats">
    {#each [0, 1, 2] as i (i)}
      <section>
        <span class="sk" style="width: 90px; height: 12px"></span>
        {#each [0, 1, 2, 3, 4, 5] as j (j)}
          <span class="sk" style="width: 100%; height: 11px; margin-top: 9px"></span>
        {/each}
      </section>
    {/each}
  </div>
{:else if !stats?.length}
  <div class="msg">No stats for {symbol}</div>
{:else}
  <div class="grid">
    {#each stats as s (s.title)}
      <section>
        <h2>{s.title}</h2>
        <dl>
          {#each s.rows as [label, value] (label)}
            <dt>{label}</dt>
            <dd>{value}</dd>
          {/each}
        </dl>
      </section>
    {/each}
  </div>
{/if}

<style>
  .grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    align-content: start;
    gap: 18px 28px;
    padding: 14px 10px 8px 4px;
    overflow: auto;
  }
  section {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  dl {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 3px 10px;
    margin: 0;
    font-size: 12px;
  }
  dt {
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd {
    margin: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    color: var(--muted);
  }
</style>
