<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { ago, newsDate, sentimentLabel, sentimentTone } from "./lib/format";
  import type { Article, FeedArticle, Group } from "./lib/types";
  import { filterArticles, topics } from "./lib/newsfeed";

  // articles: undefined while loading with nothing cached.
  let {
    symbol,
    groups,
    scope = $bindable("symbol"),
    feed,
    emptyScope,
    articles,
    error,
    now,
    onretry,
  }: {
    symbol: string;
    groups: Group[];
    scope: string;
    feed: FeedArticle[] | undefined;
    emptyScope: boolean;
    articles: Article[] | undefined;
    error: string | null;
    /** Unix seconds, for the relative times. */
    now: number;
    onretry: () => void;
  } = $props();

  let ticker = $state("");
  let publisher = $state("");
  let topic = $state("");
  const isFeed = $derived(scope !== "symbol");
  const loaded = $derived(isFeed ? feed : articles);
  const tickers = $derived([...new Set(feed?.flatMap((a) => a.symbols) ?? [])].sort());
  const publishers = $derived([...new Set(feed?.map((a) => a.publisher).filter(Boolean) ?? [])].sort());
  const allTopics = $derived([...new Set(feed?.flatMap((a) => topics(a.title)) ?? [])].sort());
  const rows = $derived(isFeed ? filterArticles(feed ?? [], ticker, publisher, topic) : (articles ?? []).map((a) => ({ ...a, symbols: [] })));

  function clearFilters() {
    ticker = "";
    publisher = "";
    topic = "";
  }

  $effect(() => {
    scope;
    clearFilters();
  });

  // Headlines show in the viewer's own time zone.
  const offset = -new Date().getTimezoneOffset() * 60;

  function open(a: Article) {
    invoke("open_news", { url: a.link }).catch(console.warn);
  }
</script>

<div class="controls">
  <select aria-label="News scope" bind:value={scope}>
    <option value="symbol">{symbol}</option>
    <option value="watchlist">Watchlist</option>
    {#each groups as group (group.name)}
      <option value={`group:${group.name}`}>{group.name}</option>
    {/each}
  </select>
  {#if isFeed && feed?.length}
    <select aria-label="Ticker" bind:value={ticker}>
      <option value="">All tickers</option>
      {#each tickers as value}<option {value}>{value}</option>{/each}
    </select>
    <select aria-label="Publisher" bind:value={publisher}>
      <option value="">All publishers</option>
      {#each publishers as value}<option {value}>{value}</option>{/each}
    </select>
    <select aria-label="Topic" bind:value={topic}>
      <option value="">All topics</option>
      {#each allTopics as value}<option {value}>{value}</option>{/each}
    </select>
  {/if}
</div>

{#if isFeed && emptyScope}
  <div class="msg">{scope === "watchlist" ? "Your watchlist is empty" : "This group is empty"}</div>
{:else if loaded === undefined && error}
  <div class="msg">
    Could not load news: {error}
    <button class="retry" onclick={onretry}>Retry</button>
  </div>
{:else if loaded === undefined && isFeed}
  <div class="msg" aria-busy="true">Loading news…</div>
{:else if loaded === undefined}
  <div class="list" aria-busy="true" aria-label="Loading news">
    {#each [0, 1, 2, 3, 4, 5] as i (i)}
      <div class="row">
        <span class="sk" style="width: {70 + ((i * 17) % 25)}%; height: 13px"></span>
        <span class="sk" style="width: 160px; height: 10px; margin-top: 6px"></span>
      </div>
    {/each}
  </div>
{:else if loaded.length === 0}
  <div class="msg">No recent news for {isFeed ? (scope === "watchlist" ? "your watchlist" : "this group") : symbol}</div>
{:else if rows.length === 0}
  <div class="msg">
    No headlines match these filters
    <button class="retry" onclick={clearFilters}>Clear filters</button>
  </div>
{:else}
  <ul class="list">
    {#each rows as a (a.link)}
      {@const toneTitle = a.ai_model ? "AI tone from " + a.ai_model + (a.ai_at == null ? "" : ", generated " + ago(a.ai_at, now)) : "Tone guessed from words in the headline"}
      <li>
        <button class="row" title={a.link} onclick={() => open(a)}>
          <span class="title">{a.title}</span>
          <span class="meta">
            {#each a.symbols as ticker}<span class="ticker">{ticker}</span>{/each}
            {#if a.publisher}<span>{a.publisher}</span> ·{/if}
            <time datetime={new Date(a.published * 1000).toISOString()}>{newsDate(a.published, offset)}</time>
            · <span>{ago(a.published, now)}</span>
            <span class="pill {sentimentTone(a.sentiment)}" title={toneTitle}
              >{sentimentLabel(a.sentiment)}</span
            >
            <small title={toneTitle}>{a.ai_model ? "AI" : "Keyword"}</small>
          </span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 0;
  }
  select {
    min-width: 0;
    max-width: 100%;
    border: 1px solid var(--faint);
    border-radius: 6px;
    background: var(--surface);
    color: inherit;
    font: inherit;
    padding: 3px 6px;
  }
  .ticker {
    display: inline-block;
    margin-right: 6px;
    padding: 0 4px;
    border: 1px solid var(--faint);
    border-radius: 4px;
    font-size: 10.5px;
  }
  .list {
    flex: 1;
    min-height: 0;
    margin: 6px 0 0;
    padding: 0 6px 0 0;
    list-style: none;
    overflow: auto;
    overscroll-behavior: contain;
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
  .pill {
    display: inline-block;
    margin-left: 6px;
    padding: 0 7px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 650;
    line-height: 16px;
    vertical-align: 1px;
    color: #fff;
    background: var(--flat);
  }
  .pill.up {
    background: var(--up);
  }
  .pill.down {
    background: var(--down);
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
