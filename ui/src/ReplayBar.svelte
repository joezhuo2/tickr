<script lang="ts">
  import { SPEEDS, isAtEnd, isSpeed, type ReplayState, type Speed } from "./lib/replay";

  let {
    state,
    intraday,
    start,
    min,
    max,
    when,
    note = null,
    onstart,
    ontoggle,
    onstep,
    onback,
    onspeed,
    onexit,
    practice = false,
  }: {
    state: ReplayState;
    intraday: boolean;
    start: string;
    min: string;
    max: string;
    when: string;
    note?: string | null;
    onstart: (value: string) => void;
    ontoggle: () => void;
    onstep: () => void;
    onback: () => void;
    onspeed: (speed: Speed) => void;
    onexit: () => void;
    practice?: boolean;
  } = $props();

  const end = $derived(isAtEnd(state));
</script>

<div class="replay" role="toolbar" aria-label={practice ? "Practice playback" : "Bar replay"}>
  <span class="tag">{practice ? "Practice" : "Replay"}</span>
  {#if !practice}
    <label>
      <span>Start</span>
      <input
        type={intraday ? "datetime-local" : "date"}
        aria-label="Replay start"
        value={start}
        {min}
        {max}
        onchange={(e) => {
          if (e.currentTarget.value) onstart(e.currentTarget.value);
        }}
      />
    </label>
  {/if}
  <div class="controls">
    {#if !practice}
      <button title="Step back (←)" aria-label="Step back" disabled={state.cursor <= state.start} onclick={onback}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14M18 5l-9 7 9 7z" /></svg>
      </button>
    {/if}
    <button class="play" title={state.playing ? "Pause (Space)" : "Play (Space)"} aria-label={state.playing ? "Pause" : "Play"} aria-pressed={state.playing} disabled={end && !state.playing} onclick={ontoggle}>
      {#if state.playing}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
      {/if}
    </button>
    <button title="Step forward (→)" aria-label="Step forward" disabled={end} onclick={onstep}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14M6 5l9 7-9 7z" /></svg>
    </button>
  </div>
  <select
    aria-label={practice ? "Practice speed" : "Replay speed"}
    value={state.speed}
    onchange={(e) => {
      const speed = Number(e.currentTarget.value);
      if (isSpeed(speed)) onspeed(speed);
    }}
  >
    {#each SPEEDS as s (s)}
      <option value={s}>{s}x</option>
    {/each}
  </select>
  <span class="when" role="status">{when}{#if end} · end of data{/if}{#if note} · {note}{/if}</span>
  <span class="count">{state.cursor - state.start + 1} / {state.total - state.start}</span>
  <button class="exit" title={practice ? "Exit practice (Esc)" : "Exit replay (Esc)"} onclick={onexit}>Exit</button>
</div>

<style>
  .replay {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin: 2px 0 6px;
    padding: 4px 8px;
    border: 1px solid var(--faint);
    border-left: 3px solid var(--accent);
    border-radius: 7px;
    background: var(--surface);
    font-size: 12px;
  }
  .tag {
    font-weight: 700;
    color: var(--accent);
  }
  label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
  }
  input,
  select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--faint);
    border-radius: 6px;
    padding: 2px 4px;
    font-size: 12px;
  }
  .controls {
    display: flex;
    gap: 2px;
  }
  .controls button {
    width: 24px;
    height: 24px;
    padding: 4px;
    border: 0;
    border-radius: 6px;
    background: none;
    color: var(--muted);
    cursor: pointer;
  }
  .controls button:hover:not(:disabled) {
    background: var(--bg);
    color: var(--text);
  }
  .controls button.play {
    color: var(--text);
  }
  .controls button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  svg {
    width: 100%;
    height: 100%;
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .when {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .count {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .exit {
    margin-left: auto;
    border: 1px solid var(--faint);
    background: var(--bg);
    color: var(--text);
    border-radius: 6px;
    padding: 2px 10px;
    cursor: pointer;
  }
</style>
