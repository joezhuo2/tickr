<script lang="ts">
  let { symbol, what }: { symbol: string; what: string } = $props();
</script>

<div class="msg">{what} are not available for {symbol}</div>

<style>
  .msg {
    flex: 1;
    display: grid;
    place-content: center;
    color: var(--muted);
  }
</style>
