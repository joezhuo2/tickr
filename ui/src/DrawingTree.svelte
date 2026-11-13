<script lang="ts">
  import { DRAWING_NAMES, drawingSummary } from "./lib/drawing";
  import type { Drawing } from "./lib/types";

  let { list, selected, busy, onselect, onchange, onclose }: {
    list: Drawing[];
    selected: number | null;
    busy: boolean;
    onselect: (id: number) => void;
    onchange: (next: Drawing[]) => void;
    onclose: () => void;
  } = $props();

  let renaming = $state<{ id: number; text: string } | null>(null);
  let confirming = $state(false);
  const rows = $derived([...list].reverse());
  const allHidden = $derived(list.length > 0 && list.every((d) => d.hidden));
  const allLocked = $derived(list.length > 0 && list.every((d) => d.locked));
  const removable = $derived(list.filter((d) => !d.locked));

  function patch(id: number, p: Partial<Drawing>) {
    onchange(list.map((d) => (d.id === id ? { ...d, ...p } : d)));
  }

  function rename() {
    const r = renaming;
    renaming = null;
    const text = r?.text.trim();
    if (r && text && text !== list.find((d) => d.id === r.id)?.text) patch(r.id, { text });
  }

  function focusInput(input: HTMLInputElement) { input.focus(); input.select(); }

  function onKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape" && !renaming && !confirming) onclose();
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const names = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button.name")];
    const i = names.indexOf(document.activeElement as HTMLButtonElement);
    names[Math.max(0, Math.min(names.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    e.preventDefault();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="drawing-tools object-tree" role="dialog" aria-label="Drawings on this chart" tabindex="-1" onkeydown={onKey}>
  <div class="head">
    <strong>Drawings ({list.length})</strong>
    <button disabled={busy || !list.length} onclick={() => onchange(list.map((d) => ({ ...d, hidden: !allHidden })))}>{allHidden ? "Show all" : "Hide all"}</button>
    <button disabled={busy || !list.length} onclick={() => onchange(list.map((d) => ({ ...d, locked: !allLocked })))}>{allLocked ? "Unlock all" : "Lock all"}</button>
    {#if !confirming}
      <button disabled={busy || !removable.length} title="Delete every unlocked drawing" onclick={() => (confirming = true)}>Delete all…</button>
    {/if}
    <button class="close" aria-label="Close drawing list" title="Close (Escape)" onclick={onclose}>×</button>
  </div>
  {#if confirming}
    <div class="confirm" role="alert">
      Delete {removable.length} unlocked drawing{removable.length === 1 ? "" : "s"}?
      <button class="danger" disabled={busy} onclick={() => { confirming = false; onchange(list.filter((d) => d.locked)); }}>Confirm delete</button>
      <button onclick={() => (confirming = false)}>Cancel</button>
    </div>
  {/if}
  {#if rows.length}
    <ul>
      {#each rows as d (d.id)}
        {@const name = `${DRAWING_NAMES[d.kind]} ${drawingSummary(d)}`}
        <li class:off={d.hidden}>
          {#if renaming?.id === d.id}
            <input aria-label="Text of {DRAWING_NAMES[d.kind]}" maxlength="200" bind:value={renaming.text} onblur={rename} onkeydown={(e) => { if (e.key === "Enter") rename(); else if (e.key === "Escape") { e.stopPropagation(); renaming = null; } }} use:focusInput />
          {:else}
            <button class="name" aria-pressed={d.id === selected} title="Select and scroll into view" onclick={() => onselect(d.id)}>
              <span>{DRAWING_NAMES[d.kind]}</span> <span class="sub">{drawingSummary(d)}</span>
            </button>
          {/if}
          {#if d.kind === "text" || d.kind === "callout"}
            <button aria-label="Rename {name}" disabled={busy} onclick={() => (renaming = { id: d.id, text: d.text })}>Rename</button>
          {/if}
          <button aria-label="Hide {name}" aria-pressed={!!d.hidden} disabled={busy} onclick={() => patch(d.id, { hidden: !d.hidden })}>Hide</button>
          <button aria-label="Lock {name}" aria-pressed={!!d.locked} title="Locked drawings cannot be moved, resized or deleted on the chart" disabled={busy} onclick={() => patch(d.id, { locked: !d.locked })}>Lock</button>
          <button aria-label="Delete {name}" disabled={busy || !!d.locked} onclick={() => onchange(list.filter((x) => x.id !== d.id))}>Delete</button>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="empty">No drawings on this chart.</p>
  {/if}
</div>

<style>
  .object-tree {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 340px;
    max-width: 100%;
    max-height: 280px;
    padding: 6px;
    box-sizing: border-box;
    border: 1px solid var(--faint);
    border-radius: 6px;
    background: var(--bg);
    box-shadow: var(--shadow);
    pointer-events: auto;
    cursor: default;
    font-size: 11px;
  }
  .head, .confirm, li { display: flex; align-items: center; gap: 3px; }
  .head strong { flex: 1; color: var(--text); }
  button {
    border: 0;
    border-radius: 4px;
    padding: 2px 5px;
    font-size: 10px;
    background: var(--bg);
    color: var(--muted);
  }
  button:hover:not(:disabled) { background: var(--surface); color: var(--text); }
  button[aria-pressed="true"] { background: var(--surface); color: var(--text); }
  button:disabled { opacity: 0.4; }
  .close { font-size: 13px; line-height: 1; }
  .danger { color: var(--down); }
  .confirm { flex-wrap: wrap; color: var(--text); }
  ul { margin: 0; padding: 0; list-style: none; overflow-y: auto; min-height: 0; }
  li { padding: 1px 0; }
  li.off .name { opacity: 0.5; }
  .name { flex: 1; min-width: 0; overflow: hidden; text-align: left; white-space: nowrap; text-overflow: ellipsis; color: var(--text); }
  .sub { color: var(--muted); }
  li input { flex: 1; min-width: 0; font-size: 11px; }
  .empty { margin: 4px 0; color: var(--muted); }
</style>
