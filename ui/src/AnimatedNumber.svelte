<script lang="ts">
  import { untrack } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { Tween, prefersReducedMotion } from "svelte/motion";

  let { value, format }: { value: number; format: (v: number) => string } = $props();

  const tween = new Tween(untrack(() => value), { duration: 600, easing: cubicOut });

  $effect.pre(() => {
    const v = value;
    untrack(() => {
      if (v === tween.target) return;
      const snap = prefersReducedMotion.current || !Number.isFinite(v) || !Number.isFinite(tween.current);
      tween.set(v, snap ? { duration: 0 } : undefined);
    });
  });
</script>

<span>{format(tween.current)}</span>

<style>
  span {
    font-variant-numeric: tabular-nums;
  }
</style>
