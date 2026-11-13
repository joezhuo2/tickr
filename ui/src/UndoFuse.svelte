<script lang="ts" module>
  export interface UndoEntry {
    id: number;
    label: string;
    undo: () => unknown;
  }
</script>

<script lang="ts">
  import { fade } from "svelte/transition";
  import { duration, paneIn } from "./lib/motion";
  import { FUSE_MS, lightFuse, pauseFuse, remaining, resumeFuse, type Fuse } from "./lib/fuse";

  let { entry, ondone }: { entry: UndoEntry | null; ondone: () => void } = $props();

  let fuse: Fuse | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let paused = $state(false);
  let w = $state(0);
  let h = $state(0);

  function arm(f: Fuse) {
    clearTimeout(timer);
    fuse = f;
    timer = setTimeout(ondone, remaining(f, performance.now()));
  }

  $effect(() => {
    if (!entry) return;
    paused = false;
    arm(lightFuse(FUSE_MS, performance.now()));
    return () => clearTimeout(timer);
  });

  function hold() {
    if (!fuse || paused) return;
    clearTimeout(timer);
    fuse = pauseFuse(fuse, performance.now());
    paused = true;
  }

  function release() {
    if (!fuse || !paused) return;
    paused = false;
    arm(resumeFuse(fuse, performance.now()));
  }

  function run() {
    const e = entry;
    if (!e) return;
    clearTimeout(timer);
    ondone();
    void e.undo();
  }

  function onKey(e: KeyboardEvent) {
    if (!entry || e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
    if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault();
    e.stopPropagation();
    run();
  }

  $effect(() => {
    if (!entry) return;
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const out = (node: Element) => fade(node, { duration: duration("base") });
</script>

<div class="sr" aria-live="polite">{entry ? `Ran ${entry.label}. Undo with Ctrl+Z.` : ""}</div>
{#key entry?.id}
  {#if entry}
    <button
      class="pill"
      class:paused
      type="button"
      title="Undo (Ctrl+Z)"
      style:--fuse="{FUSE_MS}ms"
      bind:clientWidth={w}
      bind:clientHeight={h}
      onmouseenter={hold}
      onmouseleave={release}
      onmousedown={(e) => e.preventDefault()}
      onclick={run}
      in:paneIn={{ y: 12 }}
      out:out
    >
      <svg class="fuse" width={w} height={h} aria-hidden="true">
        {#if w && h}
          <rect class="rim" x="1" y="1" width={w - 2} height={h - 2} rx={(h - 2) / 2} />
          <rect class="lit" x="1" y="1" width={w - 2} height={h - 2} rx={(h - 2) / 2} pathLength="100" />
        {/if}
      </svg>
      <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
      <span class="label"><b>Undo</b> · {entry.label}</span>
    </button>
  {/if}
{/key}

<style>
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .pill {
    position: fixed;
    right: 16px;
    bottom: 36px;
    z-index: 12;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    max-width: min(420px, calc(100% - 32px));
    padding: 0 16px 0 13px;
    border: 0;
    border-radius: 999px;
    background: var(--bg);
    color: var(--text);
    font: inherit;
    box-shadow: var(--shadow);
    cursor: pointer;
  }
  .pill:hover {
    background: var(--surface);
  }
  .pill:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .fuse {
    position: absolute;
    inset: 0;
    overflow: visible;
    pointer-events: none;
  }
  .fuse rect {
    fill: none;
    stroke-width: 2;
  }
  .rim {
    stroke: var(--faint);
  }
  .lit {
    stroke: var(--accent);
    stroke-linecap: round;
    stroke-dasharray: 100 100;
    animation: burn var(--fuse) linear forwards;
  }
  .paused .lit {
    animation-play-state: paused;
  }
  @keyframes burn {
    from {
      stroke-dashoffset: 0;
    }
    to {
      stroke-dashoffset: -100;
    }
  }
  .glyph {
    flex: none;
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (prefers-reduced-motion: reduce) {
    .lit {
      animation: none;
    }
  }
</style>
