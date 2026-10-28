import { Component, createRef, type ReactNode } from 'react';
import type { Text, TextInput, View } from 'react-native';
import { easeOut } from './theme';

/** What a morph mark attaches to: on the web, React Native's views are elements. */
type MorphTarget = HTMLElement | View | Text | TextInput | null;

/** How long a change of screen takes; parts that appear on both screens fly for all of it. */
const duration = 560;

/** The page's scroll area, from Frame. */
const pageId = 'splitnext-page';

/** How far the screens slide past each other, toward where the new one came from. */
const slide = 28;

type Box = { x: number; y: number; w: number; h: number };

/** `clips`: text cut short with an ellipsis, which must stay cut while it flies. */
type Part = { box: Box; clone: HTMLElement; background: string; radius: string; border: string; borderWidth: string; color: string; font: string; clips: boolean; whiteSpace: string; textSize: number | null };

/** The font size of an element's own text, or null for one that only holds others. */
function textSize(element: HTMLElement, style: CSSStyleDeclaration): number | null {
  const text = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());

  return text ? parseFloat(style.fontSize) || null : null;
}

/** Text cut short, at the end of one line or of its last allowed line. */
function clipped(style: CSSStyleDeclaration): boolean {
  return style.textOverflow === 'ellipsis' || (style.webkitLineClamp !== '' && style.webkitLineClamp !== 'none');
}

type Snapshot = { parts: Map<string, Part>; screen: HTMLElement; scrolled: number };

/** A copy of an element that shows what it showed, typed values included. */
function copy(element: HTMLElement): HTMLElement {
  // SAFETY: cloneNode returns a node of the same kind as the element cloned.
  const clone = element.cloneNode(true) as HTMLElement;
  const inputs = element.querySelectorAll('input');
  const copies = clone.querySelectorAll('input');

  inputs.forEach((input, index) => copies[index]?.setAttribute('value', input.value));

  if (element instanceof HTMLInputElement && clone instanceof HTMLInputElement) clone.setAttribute('value', element.value);

  // A text area's copy starts from its first text, not what is in it now.
  if (element instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) clone.textContent = element.value;

  clone.removeAttribute('data-morph');

  // Ids stay unique: the copy's page is found by its mark instead.
  for (const node of [clone, ...clone.querySelectorAll<HTMLElement>('[id]')]) {
    if (node.id === pageId) node.dataset.copiedPage = '';
    node.removeAttribute('id');
  }

  return clone;
}

/** `sheet`: the screen rises over the one below it, like a drawer, rather than replacing it. */
type Props = { screen: string; depth: number; sheet?: boolean; children: ReactNode };

/** How long a sheet takes to rise over the screen below, or to fall away from it. */
const sheetDuration = 420;

/** The shade over the screen a sheet covers. */
const scrim = 'rgba(20, 20, 19, 0.32)';

/**
 * Changes of screen, as the prototype moves them: parts that appear on both
 * screens, marked with `morph`, fly from where they were to where they land
 * and change shape on the way, such as a group's name becoming its title.
 * Everything else fades and slides, forward when going deeper and back when
 * returning. Before the new screen replaces the old, the old one is copied
 * and measured; the copy then plays out over the new screen.
 */
export class ScreenMorph extends Component<Props, Record<string, never>> {
  root = createRef<HTMLDivElement>();
  underlay = createRef<HTMLDivElement>();
  content = createRef<HTMLDivElement>();
  overlay = createRef<HTMLDivElement>();
  finish: (() => void) | null = null;

  /** Where a box sits within the screen. */
  private within(rect: DOMRect): Box {
    const origin = this.root.current?.getBoundingClientRect();

    return { x: rect.left - (origin?.left ?? 0), y: rect.top - (origin?.top ?? 0), w: rect.width, h: rect.height };
  }

  /**
   * Whether a part can be seen: inside the screen, and for content of the
   * page, inside the page's visible part rather than scrolled under the
   * header or past the foot.
   */
  private visible(element: HTMLElement, box: Box): boolean {
    const height = this.root.current?.clientHeight ?? 0;
    const page = element.closest(`#${pageId}`);
    const area = page ? this.within(page.getBoundingClientRect()) : { y: 0, h: height };

    return box.w >= 1 && box.h >= 1 && box.y < Math.min(height, area.y + area.h) && box.y + box.h > Math.max(0, area.y);
  }

  override getSnapshotBeforeUpdate(previous: Props): Snapshot | null {
    const root = this.root.current;

    if (previous.screen === this.props.screen || !root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;

    this.finish?.();
    const parts = new Map<string, Part>();

    root.querySelectorAll<HTMLElement>('[data-morph]').forEach((element) => {
      const key = element.dataset.morph;
      const box = this.within(element.getBoundingClientRect());

      if (!key || !this.visible(element, box)) return;
      const style = getComputedStyle(element);

      parts.set(key, { box, clone: copy(element), background: style.backgroundColor, radius: style.borderRadius, border: style.borderTopColor, borderWidth: style.borderTopWidth, color: style.color, font: style.font, clips: clipped(style), whiteSpace: style.whiteSpace, textSize: textSize(element, style) });
    });

    return { parts, screen: copy(root), scrolled: root.querySelector(`#${pageId}`)?.scrollTop ?? 0 };
  }

  override componentDidUpdate(previous: Props, _state: Record<string, never>, snapshot: Snapshot | null): void {
    const root = this.root.current;
    const overlay = this.overlay.current;
    const content = this.content.current;

    if (!snapshot || !root || !overlay || !(content instanceof HTMLElement)) return;

    if (Boolean(this.props.sheet) !== Boolean(previous.sheet)) {
      this.sheet(snapshot, content, overlay, Boolean(this.props.sheet));

      return;
    }

    const direction = Math.sign(this.props.depth - previous.depth);
    const dx = direction > 0 ? -slide : direction < 0 ? slide : 0;
    const animations: Animation[] = [];
    const landed: HTMLElement[] = [];

    overlay.replaceChildren();
    const old = snapshot.screen;

    Object.assign(old.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    overlay.appendChild(old);
    // The copy keeps the old page's scroll position.
    const page = old.querySelector('[data-copied-page]');

    if (page) page.scrollTop = snapshot.scrolled;

    animations.push(old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dx}px)` }], { duration: duration * 0.42, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' }));
    animations.push(content.animate([{ opacity: 0, transform: `translateX(${-dx}px)` }, { opacity: 1, transform: 'none' }], { duration: duration * 0.7, delay: duration * 0.2, easing: easeOut, fill: 'backwards' }));

    // Where parts land is measured a frame later: the new screen settles its
    // own header first, such as growing back to full size from the compact
    // one the old screen was scrolled to. It is still invisible meanwhile.
    const frame = requestAnimationFrame(() => this.fly(snapshot, overlay, old, animations, landed));
    const timer = setTimeout(() => this.finish?.(), duration + 60);

    this.finish = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      overlay.replaceChildren();
      landed.forEach((element) => { element.style.visibility = ''; });
      animations.forEach((animation) => animation.cancel());
      this.finish = null;
    };
  }

  /**
   * A sheet rising over the screen it opens from, which stays where it was and
   * dims; or, closing, falling away to show the screen below as it brightens.
   */
  private sheet(snapshot: Snapshot, content: HTMLElement, overlay: HTMLDivElement, rising: boolean): void {
    const underlay = this.underlay.current;

    if (!underlay) return;
    const old = snapshot.screen;
    const shade = document.createElement('div');
    const animations: Animation[] = [];

    Object.assign(old.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    shade.style.cssText = `position:absolute;inset:0;pointer-events:none;background:${scrim};`;

    if (rising) {
      // The screen below stays put under its shade while the sheet comes up over it.
      underlay.replaceChildren(old, shade);
      animations.push(shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: sheetDuration, easing: easeOut, fill: 'forwards' }));
      animations.push(content.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: sheetDuration, easing: easeOut }));
    } else {
      // The sheet falls away over the screen it returns to, whose shade lifts.
      overlay.replaceChildren(shade, old);
      animations.push(shade.animate([{ opacity: 1 }, { opacity: 0 }], { duration: sheetDuration * 0.85, easing: easeOut, fill: 'forwards' }));
      animations.push(old.animate([{ transform: 'none' }, { transform: 'translateY(100%)' }], { duration: sheetDuration * 0.85, easing: 'cubic-bezier(.4,0,.7,.2)', fill: 'forwards' }));
    }

    const page = old.querySelector('[data-copied-page]');

    if (page) page.scrollTop = snapshot.scrolled;
    const timer = setTimeout(() => this.finish?.(), sheetDuration + 60);

    this.finish = () => {
      clearTimeout(timer);
      underlay.replaceChildren();
      overlay.replaceChildren();
      animations.forEach((animation) => animation.cancel());
      this.finish = null;
    };
  }

  /** Flies each part shown on both screens from where it was to where it has landed. */
  private fly(snapshot: Snapshot, overlay: HTMLDivElement, old: HTMLElement, animations: Animation[], landed: HTMLElement[]): void {
    const root = this.root.current;

    const content = this.content.current;

    if (!root || !(content instanceof HTMLElement)) return;
    const pairs: { element: HTMLElement; from: Part; to: Box; style: CSSStyleDeclaration }[] = [];
    // The new screen has already begun sliding in; parts land where they sit once it stops.
    const shift = this.within(content.getBoundingClientRect());

    root.querySelectorAll<HTMLElement>('[data-morph]').forEach((element) => {
      if (overlay.contains(element)) return;
      const from = element.dataset.morph ? snapshot.parts.get(element.dataset.morph) : undefined;
      const sliding = this.within(element.getBoundingClientRect());
      const to = { ...sliding, x: sliding.x - shift.x, y: sliding.y - shift.y };

      if (from && this.visible(element, to)) pairs.push({ element, from, to, style: getComputedStyle(element) });
    });

    const keys = new Set(pairs.map((pair) => pair.element.dataset.morph));

    old.querySelectorAll<HTMLElement>('[data-morph]').forEach((element) => {
      if (keys.has(element.dataset.morph)) element.style.visibility = 'hidden';
    });

    for (const { element, from, to, style } of pairs) {
      const a = from.box;
      // A bar stretches to its new shape; text keeps its proportions and crossfades.
      const stretch = element.dataset.morphStretch !== undefined;
      // Text grows or shrinks by its font size, not its box: a name on two lines
      // that lands on one would otherwise shrink far past its size and jump back.
      const fromText = from.textSize;
      const toText = textSize(element, style);
      const scale = !stretch && fromText && toText ? toText / fromText : to.h / a.h;
      const sx = to.w / a.w;
      const base = { position: 'absolute', margin: '0', background: 'transparent', borderColor: 'transparent', transformOrigin: '0 0', boxSizing: 'border-box', visibility: 'visible', transition: 'none', overflow: 'visible' };
      const box = document.createElement('div');

      element.style.visibility = 'hidden';
      landed.push(element);
      box.style.cssText = `position:absolute;left:0;top:0;box-sizing:border-box;border-style:solid;border-width:${from.borderWidth};`;
      overlay.appendChild(box);
      animations.push(box.animate([
        { transform: `translate(${a.x}px,${a.y}px)`, width: `${a.w}px`, height: `${a.h}px`, backgroundColor: from.background, borderRadius: from.radius, borderColor: from.border },
        { transform: `translate(${to.x}px,${to.y}px)`, width: `${to.w}px`, height: `${to.h}px`, backgroundColor: style.backgroundColor, borderRadius: style.borderRadius, borderColor: style.borderTopColor },
      ], { duration, easing: easeOut, fill: 'forwards' }));

      // Each copy keeps its endpoint layout while it scales and crossfades.
      // Resizing it as well rewraps names and bends the path of right-aligned
      // amounts (their changing width is multiplied by the changing scale).
      const unclipped = element.dataset.morphUnclipped !== undefined;
      // Amounts align to their right edge, including an editor's full-width
      // input. Its left edge is not where the visible figure starts.
      const travelX = to.x - a.x + (unclipped ? to.w - a.w : 0);
      const origin = unclipped ? '100% 0' : '0 0';

      const cut = (clips: boolean) => (unclipped ? { overflow: 'visible', textOverflow: 'clip' } : clips ? { overflow: 'hidden', textOverflow: 'ellipsis' } : {});
      const leaving = from.clone;

      Object.assign(leaving.style, base, cut(from.clips), { transformOrigin: origin, whiteSpace: unclipped ? 'nowrap' : from.whiteSpace, left: `${a.x}px`, top: `${a.y}px`, width: `${a.w}px`, height: `${a.h}px`, color: from.color, font: from.font });
      overlay.appendChild(leaving);
      animations.push(leaving.animate(stretch
        // Fades only once the arriving copy is mostly in, so the bar never
        // thins out midway, and gone by the end, so nothing of it pops away.
        ? [{ transform: 'none', opacity: 1 }, { opacity: 1, offset: 0.4 }, { transform: `translate(${to.x - a.x}px,${to.y - a.y}px) scale(${sx},${scale})`, opacity: 0 }]
        : [{ transform: 'none', opacity: 1 }, { opacity: 0, offset: 0.45 }, { transform: `translate(${travelX}px,${to.y - a.y}px) scale(${scale})`, opacity: 0 }], { duration, easing: easeOut, fill: 'forwards' }));

      const arriving = copy(element);

      arriving.dataset.morphArriving = '';

      Object.assign(arriving.style, base, cut(clipped(style)), { transformOrigin: origin, whiteSpace: unclipped ? 'nowrap' : style.whiteSpace, left: `${to.x}px`, top: `${to.y}px`, width: `${to.w}px`, height: `${to.h}px`, color: style.color, font: style.font });
      overlay.appendChild(arriving);
      animations.push(arriving.animate(stretch
        ? [{ transform: `translate(${a.x - to.x}px,${a.y - to.y}px) scale(${1 / sx},${1 / scale})`, opacity: 0 }, { opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }]
        : [{ transform: `translate(${-travelX}px,${a.y - to.y}px) scale(${1 / scale})`, opacity: 0 }, { opacity: 0, offset: 0.3 }, { transform: 'none', opacity: 1 }], { duration, easing: easeOut, fill: 'forwards' }));
    }
  }

  override componentWillUnmount(): void {
    this.finish?.();
  }

  override render() {
    return (
      // The screen never scrolls as a whole; focusing a field still sliding in would otherwise scroll it into view and jump.
      <div ref={this.root} onScroll={(event) => { event.currentTarget.scrollTop = 0; event.currentTarget.scrollLeft = 0; }} style={{ position: 'relative', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div ref={this.underlay} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }} />
        <div ref={this.content} style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{this.props.children}</div>
        <div ref={this.overlay} aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 20, overflow: 'hidden' }} />
      </div>
    );
  }
}

/**
 * Marks a part that appears on two screens, so changing between them flies it
 * across; with `stretch`, such as for a bar, it takes its new shape rather
 * than keeping its proportions. `unclipped` keeps amounts complete while their
 * boxes change size.
 */
export function morph(key: string | null | undefined, options?: { stretch?: boolean; unclipped?: boolean }) {
  return (node: MorphTarget) => {
    if (!(node instanceof HTMLElement)) return;

    if (key) node.dataset.morph = key;
    else delete node.dataset.morph;

    if (key && options?.stretch) node.dataset.morphStretch = '';
    else delete node.dataset.morphStretch;

    if (key && options?.unclipped) node.dataset.morphUnclipped = '';
    else delete node.dataset.morphUnclipped;
  };
}
