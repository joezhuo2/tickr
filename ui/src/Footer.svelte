<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";

  let {
    error = null,
    status,
    settingsOn,
    onsettings,
    watchlistOn,
    onwatchlist,
    refreshing,
    onrefresh,
  }: {
    /** Set by the backend when the saved hotkey could not be registered. */
    error?: string | null;
    status: { kind: "live" | "stale" | "offline" | "loading"; text: string };
    settingsOn: boolean;
    onsettings: () => void;
    watchlistOn: boolean;
    onwatchlist: () => void;
    refreshing: boolean;
    onrefresh: () => void;
  } = $props();
</script>

<footer>
  <button class="gear" class:on={settingsOn} aria-pressed={settingsOn} title="Settings" aria-label="Settings" onclick={onsettings}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
      />
    </svg>
  </button>
  <span class="sep"></span>
  <button class="watch" class:on={watchlistOn} aria-pressed={watchlistOn} title="Watchlist" aria-label="Watchlist" onclick={onwatchlist}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" /></svg>
  </button>
  <button class="link credit" onclick={() => invoke("open_logo_credit").catch(console.warn)}>Logos by Elbstream</button>
  {#if error}<span class="error" title={error}>{error}</span>{/if}
  <button class="refresh" class:spinning={refreshing} title="Refresh" aria-label="Refresh" onclick={onrefresh}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></svg>
  </button>
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
  .gear {
    width: 22px;
    height: 22px;
    padding: 3px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }
  .gear:hover,
  .gear.on {
    background: var(--bg);
    color: var(--text);
  }
  .gear.on svg {
    transform: rotate(45deg);
  }
  .gear svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
    transition: transform var(--motion-slow) var(--ease-out);
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
    width: 22px;
    height: 22px;
    padding: 3px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }
  .watch:hover {
    background: var(--bg);
    color: var(--text);
  }
  .watch svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linejoin: round;
    transition: fill var(--motion-fast) var(--ease-out);
  }
  .watch.on {
    color: #f5b301;
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
  .refresh {
    margin-left: auto;
    width: 22px;
    height: 22px;
    padding: 3px;
    border: 0;
    border-radius: 5px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .refresh:hover {
    background: var(--bg);
    color: var(--text);
  }
  .refresh svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .refresh.spinning svg {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .status {
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
