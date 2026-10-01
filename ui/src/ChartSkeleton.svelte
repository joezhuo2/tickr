<script lang="ts">
  // Fixed pseudo-random shapes so the placeholder does not jump between renders.
  const bars = Array.from({ length: 40 }, (_, i) => 20 + ((i * 37) % 60));
  const line = Array.from({ length: 24 }, (_, i) => 50 + 22 * Math.sin(i / 2.6) + ((i * 13) % 9));
  const points = line.map((y, i) => `${(i / (line.length - 1)) * 100},${y}`).join(" ");
</script>

<div class="wrap" aria-busy="true" aria-label="Loading chart">
  <div class="plot">
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline {points} />
    </svg>
    <div class="shine sk"></div>
  </div>
  <div class="vol">
    {#each bars as h, i (i)}
      <span class="sk" style:height="{h}%"></span>
    {/each}
  </div>
  <div class="axis">
    {#each [0, 1, 2, 3] as i (i)}<span class="sk"></span>{/each}
  </div>
</div>

<style>
  .wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 62px 6px 6px;
  }
  .plot {
    position: relative;
    flex: 1;
    border-radius: 8px;
    overflow: hidden;
  }
  svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  polyline {
    fill: none;
    stroke: var(--sk-shine);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
  .shine {
    position: absolute;
    inset: 0;
    opacity: 0.6;
  }
  .vol {
    height: 14%;
    display: flex;
    align-items: flex-end;
    gap: 3px;
  }
  .vol span {
    flex: 1;
    border-radius: 2px;
  }
  .axis {
    display: flex;
    justify-content: space-around;
  }
  .axis span {
    width: 38px;
    height: 10px;
  }
</style>
