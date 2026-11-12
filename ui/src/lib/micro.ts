// App-wide micro interactions, wired once at startup: themed tooltips for every `title`,
// a themed menu for every native <select>, and a sliding thumb for every `.seg` control.

type Box = { left: number; top: number; width: number; height: number };

/** Where a popup of `w` by `h` goes next to `anchor`: on the preferred side unless only the other fits, kept on screen. */
export function place(anchor: Box, w: number, h: number, vw: number, vh: number, prefer: "above" | "below", align: "center" | "start", gap = 6) {
  const fitsAbove = anchor.top - gap - h >= 0;
  const fitsBelow = anchor.top + anchor.height + gap + h <= vh;
  const above = prefer === "above" ? fitsAbove || !fitsBelow : fitsAbove && !fitsBelow;
  const top = above ? anchor.top - gap - h : anchor.top + anchor.height + gap;
  const left = align === "center" ? anchor.left + anchor.width / 2 - w / 2 : anchor.left;
  const clamp = (v: number, max: number) => Math.max(4, Math.min(v, max - 4));
  return { left: clamp(left, vw - w), top: clamp(top, vh - h), above };
}

const WAIT = 500;
const WARM = 400;

function tooltips() {
  const tip = document.createElement("div");
  tip.className = "mi-tip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let target: Element | null = null;
  let text = "";
  let timer = 0;
  let warmUntil = 0;

  function dismiss() {
    clearTimeout(timer);
    tip.hidden = true;
  }

  function hide() {
    if (!tip.hidden) warmUntil = performance.now() + WARM;
    dismiss();
    target?.removeAttribute("data-mi-tip");
    // The title goes back so it stays the element's accessible description, unless the app set a new one meanwhile.
    if (target && !target.hasAttribute("title")) target.setAttribute("title", text);
    target = null;
  }

  function show(el: Element | null) {
    const title = el?.getAttribute("title");
    if (el === target) {
      // The app changed the title under the pointer.
      if (el && title) {
        tip.textContent = text = title;
        el.removeAttribute("title");
      }
      return;
    }
    const warm = !tip.hidden || performance.now() < warmUntil;
    hide();
    if (!el || !title) return;
    target = el;
    text = title;
    el.removeAttribute("title");
    el.setAttribute("data-mi-tip", "");
    timer = window.setTimeout(
      () => {
        tip.textContent = text;
        tip.hidden = false;
        const p = place(el.getBoundingClientRect(), tip.offsetWidth, tip.offsetHeight, innerWidth, innerHeight, "above", "center");
        tip.style.left = `${p.left}px`;
        tip.style.top = `${p.top}px`;
      },
      warm ? 0 : WAIT,
    );
  }

  const titled = (t: EventTarget | null) => (t instanceof Element ? t.closest("[title], [data-mi-tip]") : null);
  // shortcut: disabled buttons get no pointer events in older WebKit, so their tips only show where the engine sends them.
  document.addEventListener("pointerover", (e) => show(titled(e.target)));
  document.addEventListener("pointerout", (e) => !e.relatedTarget && hide());
  document.addEventListener("focusin", (e) => e.target instanceof Element && e.target.matches(":focus-visible") && show(titled(e.target)));
  document.addEventListener("focusout", hide);
  // A click or key press puts the tip away until the pointer leaves, without handing the title back to the browser.
  document.addEventListener("pointerdown", dismiss, true);
  document.addEventListener("keydown", dismiss, true);
  document.addEventListener("scroll", dismiss, true);
}

function selects() {
  let sel: HTMLSelectElement | null = null;
  let menu: HTMLElement | null = null;
  let glide: HTMLElement | null = null;
  let active = -1;

  function close() {
    sel?.removeAttribute("data-open");
    sel?.removeAttribute("aria-activedescendant");
    menu?.remove();
    sel = menu = glide = null;
  }

  function move(i: number) {
    const row = menu?.querySelector<HTMLElement>(`[data-i="${i}"]`);
    if (!row || !glide || row.ariaDisabled) return;
    active = i;
    row.scrollIntoView({ block: "nearest" });
    glide.style.transform = `translateY(${row.offsetTop}px)`;
    glide.style.height = `${row.offsetHeight}px`;
    glide.style.opacity = "1";
    sel?.setAttribute("aria-activedescendant", row.id);
  }

  function step(by: number) {
    if (!sel) return;
    for (let i = active + by; i >= 0 && i < sel.options.length; i += by) {
      if (!sel.options[i].disabled) return move(i);
    }
  }

  function pick(i: number) {
    const s = sel;
    close();
    if (!s || i < 0 || s.selectedIndex === i) return;
    s.selectedIndex = i;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // shortcut: option groups render as a flat list, add headings when a select first uses <optgroup>.
  function open(s: HTMLSelectElement) {
    close();
    sel = s;
    s.setAttribute("data-open", "");
    const m = (menu = document.createElement("div"));
    m.className = "mi-menu";
    m.setAttribute("role", "listbox");
    glide = document.createElement("div");
    glide.className = "mi-glide";
    m.append(glide);
    [...s.options].forEach((o, i) => {
      const row = document.createElement("div");
      row.id = `mi-option-${i}`;
      row.dataset.i = String(i);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(o.selected));
      if (o.disabled) row.ariaDisabled = "true";
      row.textContent = o.label;
      m.append(row);
    });
    m.addEventListener("mousedown", (e) => e.preventDefault());
    m.addEventListener("pointermove", (e) => {
      const i = Number((e.target as Element).closest<HTMLElement>("[data-i]")?.dataset.i ?? -1);
      if (i !== active) move(i);
    });
    m.addEventListener("click", (e) => {
      const row = (e.target as Element).closest<HTMLElement>("[data-i]");
      if (row && !row.ariaDisabled) pick(Number(row.dataset.i));
    });
    document.body.append(m);
    const box = s.getBoundingClientRect();
    m.style.minWidth = `${box.width}px`;
    const p = place(box, m.offsetWidth, m.offsetHeight, innerWidth, innerHeight, "below", "start", 4);
    m.style.left = `${p.left}px`;
    m.style.top = `${p.top}px`;
    m.style.transformOrigin = p.above ? "bottom left" : "top left";
    move(s.selectedIndex);
    // Flushed first so the highlight starts on the current row instead of gliding in from the top.
    if (m.offsetWidth) m.classList.add("in");
  }

  const themed = (t: EventTarget | null) => (t instanceof HTMLSelectElement && !t.multiple && t.size <= 1 ? t : null);

  // Cancelling mousedown is what stops the OS-drawn popup from opening.
  document.addEventListener(
    "mousedown",
    (e) => {
      if (menu?.contains(e.target as Node)) return;
      const s = themed(e.target);
      if (!s) return close();
      if (e.button !== 0) return;
      e.preventDefault();
      if (s.disabled) return;
      s.focus();
      if (sel === s) close();
      else open(s);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      const s = themed(e.target);
      if (!s || e.ctrlKey || e.metaKey || e.altKey) return;
      if (!sel) {
        if (!["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) return;
        e.preventDefault();
        return open(s);
      }
      if (e.key === "Tab") return close();
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "ArrowDown") step(1);
      else if (e.key === "ArrowUp") step(-1);
      else if (e.key === "Home") ((active = -1), step(1));
      else if (e.key === "End") ((active = s.options.length), step(-1));
      else if (e.key === "Enter" || e.key === " ") pick(active);
      else if (e.key === "Escape") close();
    },
    true,
  );
  document.addEventListener("focusout", (e) => e.target === sel && close());
  document.addEventListener("scroll", (e) => e.target !== menu && close(), true);
  window.addEventListener("resize", close);
  window.addEventListener("blur", close);
}

function segments() {
  const sizes = new ResizeObserver((entries) => entries.forEach((e) => sync(e.target as HTMLElement)));

  function sync(seg: HTMLElement) {
    let thumb = seg.querySelector<HTMLElement>(":scope > .mi-thumb");
    if (!thumb) {
      thumb = document.createElement("span");
      thumb.className = "mi-thumb";
      thumb.ariaHidden = "true";
      seg.prepend(thumb);
      sizes.observe(seg);
    }
    const on = seg.querySelector<HTMLElement>(":scope > button.on");
    thumb.style.opacity = on ? "1" : "0";
    if (!on) return;
    const left = on.offsetLeft;
    // The leading edge moves first and the trailing edge catches up, which is the stretch.
    thumb.dataset.dir = left > parseFloat(thumb.style.left || "0") ? "right" : "left";
    thumb.style.left = `${left}px`;
    thumb.style.right = `${seg.clientWidth - left - on.offsetWidth}px`;
    thumb.style.top = `${on.offsetTop}px`;
    thumb.style.height = `${on.offsetHeight}px`;
    // The first placement is flushed before transitions turn on, so the thumb does not fly in from the corner.
    if (!thumb.classList.contains("in") && thumb.offsetWidth) thumb.classList.add("in");
  }

  const within = (n: Node) => (n instanceof Element ? [n.closest<HTMLElement>(".seg"), ...n.querySelectorAll<HTMLElement>(".seg")] : []);
  new MutationObserver((records) => {
    const found = new Set<HTMLElement | null>();
    for (const r of records) {
      for (const seg of within(r.target)) found.add(seg);
      for (const n of r.addedNodes) for (const seg of within(n)) found.add(seg);
    }
    for (const seg of found) if (seg?.isConnected) sync(seg);
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  document.querySelectorAll<HTMLElement>(".seg").forEach(sync);
}

export function install() {
  tooltips();
  selects();
  segments();
}
