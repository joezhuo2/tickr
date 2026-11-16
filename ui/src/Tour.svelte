<script lang="ts">
  import { onMount, tick } from "svelte";
  import { display } from "./lib/hotkey";
  import { place } from "./lib/micro";
  import { TOUR_STEPS, availableSteps, move } from "./lib/tour";

  let { hotkey, onclose }: { hotkey: string; onclose: () => void } = $props();

  let steps = $state(TOUR_STEPS);
  let index = $state(0);
  let box = $state<{ left: number; top: number; width: number; height: number } | null>(null);
  let pos = $state({ left: 0, top: 0 });
  let card = $state<HTMLElement>();

  const step = $derived(steps[index]);
  const last = $derived(index === steps.length - 1);
  const body = $derived(step.id === "tray" ? `${step.body} Current hotkey: ${display(hotkey)}.` : step.body);

  async function layout() {
    await tick();
    const el = step.selector ? document.querySelector(step.selector) : null;
    const r = el?.getBoundingClientRect();
    box = r ? { left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 } : null;
    const w = card?.offsetWidth ?? 320;
    const h = card?.offsetHeight ?? 160;
    pos = box ? place(box, w, h, innerWidth, innerHeight, "below", "start", 8) : { left: (innerWidth - w) / 2, top: (innerHeight - h) / 2 };
    card?.focus({ preventScroll: true });
  }

  function go(delta: number) {
    const next = move(index, delta, steps.length);
    if (next !== index) {
      index = next;
      void layout();
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onclose();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Tab" && card) {
      const focusable = [...card.querySelectorAll<HTMLElement>("button")];
      const at = focusable.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? focusable.length - 1 : at - 1) : at === focusable.length - 1 ? 0 : at + 1;
      e.preventDefault();
      focusable[next]?.focus();
    }
  }

  onMount(() => {
    steps = availableSteps(TOUR_STEPS, (s) => !!document.querySelector(s));
    void layout();
  });
</script>

<svelte:window onkeydown={onKey} onresize={layout} />

<div class="tour">
  {#if box}
    <div class="spot" style:left="{box.left}px" style:top="{box.top}px" style:width="{box.width}px" style:height="{box.height}px"></div>
  {:else}
    <div class="dim"></div>
  {/if}
  <div class="card" bind:this={card} role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body" style:left="{pos.left}px" style:top="{pos.top}px">
    <h2 id="tour-title">{step.title}</h2>
    <p id="tour-body">{body}</p>
    <div class="actions">
      <span class="count">{index + 1} / {steps.length}</span>
      <button class="skip" onclick={onclose}>Skip</button>
      <button disabled={index === 0} onclick={() => go(-1)}>Back</button>
      <button class="primary" onclick={() => (last ? onclose() : go(1))}>{last ? "Done" : "Next"}</button>
    </div>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .dim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
  }
  .spot {
    position: absolute;
    border-radius: 8px;
    outline: 2px solid var(--accent);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }
  .card {
    position: absolute;
    width: 320px;
    max-width: calc(100vw - 16px);
    padding: 14px 16px;
    background: var(--tooltip-bg);
    color: var(--text);
    border: 1px solid var(--faint);
    border-radius: 10px;
    box-shadow: var(--shadow);
    outline: none;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 15px;
  }
  p {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--muted);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .count {
    flex: 1;
    font-size: 12px;
    color: var(--muted);
  }
  button {
    padding: 4px 10px;
    font: inherit;
    font-size: 13px;
    color: var(--text);
    background: var(--surface);
    border: 1px solid var(--faint);
    border-radius: 6px;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .skip {
    background: none;
    border-color: transparent;
    color: var(--muted);
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
</style>
