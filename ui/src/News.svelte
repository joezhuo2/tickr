<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { ago, newsDate } from "./lib/format";
  import type { Article } from "./lib/types";

  // articles: undefined while loading with nothing cached.
  let {
    symbol,
    articles,
    error,
    now,
    onretry,
  }: {
    symbol: string;
    articles: Article[] | undefined;
    error: string | null;
    /** Unix seconds, for the relative times. */
    now: number;
    onretry: () => void;
  } = $props();

  // Headlines show in the viewer's own time zone.
  const offset = -new Date().getTimezoneOffset() * 60;

  function open(a: Article) {
    invoke("open_news", { url: a.link });
  }
</script>

{#if articles === undefined && error}
  <div class="msg">
    Could not load news: {error}
    <button class="retry" onclick={onretry}>Retry</button>
  </div>
{:else if articles === undefined}
  <div class="list" aria-busy="true" aria-label="Loading news">
    {#each [0, 1, 2, 3, 4, 5] as i (i)}
      <div class="row">
        <span class="sk" style="width: {70 + ((i * 17) % 25)}%; height: 13px"></span>
        <span class="sk" style="width: 160px; height: 10px; margin-top: 6px"></span>
      </div>
    {/each}
  </div>
{:else if articles.length === 0}
  <div class="msg">No recent news for {symbol}</div>
{:else}
  <ul class="list">
    {#each articles as a (a.link)}
      <li>
        <button class="row" title={a.link} onclick={() => open(a)}>
          <span class="title">{a.title}</span>
          <span class="meta">
            {#if a.publisher}<span>{a.publisher}</span> ·{/if}
            <time datetime={new Date(a.published * 1000).toISOString()}>{newsDate(a.published, offset)}</time>
            · <span>{ago(a.published, now)}</span>
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .list {
    flex: 1;
    min-height: 0;
    margin: 6px 0 0;
    padding: 0 6px 0 0;
    list-style: none;
    overflow: auto;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 3px;
    width: 100%;
    padding: 8px 8px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }
  button.row {
    cursor: pointer;
  }
  button.row:hover,
  button.row:focus-visible {
    background: var(--surface);
  }
  li + li {
    border-top: 1px solid var(--faint);
  }
  .title {
    font-weight: 600;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .meta {
    font-size: 11.5px;
    color: var(--muted);
  }
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    gap: 8px;
    color: var(--muted);
    text-align: center;
  }
  .retry {
    justify-self: center;
    border: 1px solid var(--faint);
    background: var(--surface);
    border-radius: 6px;
    padding: 3px 10px;
    cursor: pointer;
  }
</style>
