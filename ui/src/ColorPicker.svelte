<script lang="ts">
  import { hexToHsv, hsvToHex, isHex, type Hsv } from "./lib/color";
  import { backdrop, dialog } from "./lib/motion";
  import { untrack } from "svelte";

  let { label, value, presets, onchange, onreset, onclose }: {
    label: string;
    value: string;
    presets: string[];
    onchange: (hex: string) => void;
    onreset: () => void;
    onclose: () => void;
  } = $props();

  const initial = untrack(() => (isHex(value) ? value : "#808080"));
  let hsv = $state<Hsv>(hexToHsv(initial));
  let text = $state(initial);
  let square: HTMLDivElement | undefined = $state();
  let dragging = false;

  function set(next: Hsv) {
    hsv = next;
    text = hsvToHex(next);
    onchange(text);
  }

  function pick(hex: string) {
    hsv = hexToHsv(hex);
    text = hex;
    onchange(hex);
  }

  function drag(e: PointerEvent) {
    if (!square) return;
    const r = square.getBoundingClientRect();
    const unit = (v: number) => Math.min(1, Math.max(0, v));
    set({ h: hsv.h, s: unit((e.clientX - r.left) / r.width), v: 1 - unit((e.clientY - r.top) / r.height) });
  }

  function squareKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.1 : 0.02;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    const unit = (v: number) => Math.min(1, Math.max(0, v));
    set({ h: hsv.h, s: unit(hsv.s + d[0]), v: unit(hsv.v + d[1]) });
  }

  function key(e: KeyboardEvent) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onclose();
  }

  function focusFirst(node: HTMLElement) {
    node.focus();
  }
</script>

<svelte:window onkeydowncapture={key} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="veil" onclick={onclose} transition:backdrop>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="picker" role="dialog" tabindex="-1" aria-modal="true" aria-label={label} onclick={(e) => e.stopPropagation()} transition:dialog>
    <header>
      <strong>{label}</strong>
      <span class="chip" style:background={text}></span>
    </header>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="square"
      bind:this={square}
      role="slider"
      tabindex="0"
      aria-label="Saturation and brightness"
      aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
      style:--hue={hsv.h}
      onpointerdown={(e) => { dragging = true; e.currentTarget.setPointerCapture(e.pointerId); drag(e); }}
      onpointermove={(e) => { if (dragging) drag(e); }}
      onpointerup={() => (dragging = false)}
      onpointercancel={() => (dragging = false)}
      onkeydown={squareKey}
      use:focusFirst
    >
      <span class="dot" style:left="{hsv.s * 100}%" style:top="{(1 - hsv.v) * 100}%" style:background={text}></span>
    </div>
    <input class="hue" type="range" min="0" max="359" step="1" aria-label="Hue" value={Math.round(hsv.h)} oninput={(e) => set({ ...hsv, h: Number(e.currentTarget.value) })} />
    <div class="swatches" role="group" aria-label="Presets">
      {#each presets as p (p)}
        <button class="swatch" class:on={p === text} aria-label={`Use ${p}`} aria-pressed={p === text} style:background={p} onclick={() => pick(p)}></button>
      {/each}
    </div>
    <div class="foot">
      <input class="hex" aria-label="Hex color" maxlength="7" spellcheck="false" bind:value={text} oninput={() => { if (isHex(text)) pick(text.toLowerCase()); }} />
      <button class="link" onclick={onreset}>Reset</button>
      <button class="done" onclick={onclose}>Done</button>
    </div>
  </div>
</div>

<style>
  .veil {
    position: absolute;
    inset: 0;
    z-index: 5;
    display: grid;
    place-items: center;
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.3);
  }
  .picker {
    width: 248px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--faint);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: var(--shadow);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
  }
  .chip {
    width: 34px;
    height: 16px;
    border-radius: 5px;
    border: 1px solid var(--faint);
  }
  .square {
    position: relative;
    height: 140px;
    border-radius: 8px;
    border: 1px solid var(--faint);
    background:
      linear-gradient(to top, #000, transparent),
      linear-gradient(to right, #fff, hsl(var(--hue) 100% 50%));
    cursor: crosshair;
    touch-action: none;
    outline: none;
  }
  .square:focus-visible {
    border-color: var(--accent);
  }
  .dot {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    pointer-events: none;
  }
  .hue {
    appearance: none;
    width: 100%;
    height: 10px;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }
  .hue::-webkit-slider-thumb {
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #fff;
    background: transparent;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.5);
    cursor: pointer;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 5px;
  }
  .swatch {
    aspect-ratio: 1;
    padding: 0;
    border: 1px solid var(--faint);
    border-radius: 5px;
    cursor: pointer;
  }
  .swatch.on {
    box-shadow: 0 0 0 2px var(--text);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .hex {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid var(--faint);
    background: var(--surface);
    color: var(--text);
  }
  .link {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
  }
  .done {
    padding: 4px 12px;
    border: 0;
    border-radius: 6px;
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    cursor: pointer;
  }
</style>
