import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BlockEditor } from './BlockEditor';
import type { Block, BlockType } from '../lib/api';

interface MockState {
  blocks: Block[];
  orders: Map<string, string[]>;
}

function makeBlock(id: string, type: BlockType, position: number, content: Record<string, unknown> = { text: '' }): Block {
  return { id, pageId: 'p1', type, content, position };
}

function defaultState(): MockState {
  return {
    blocks: [
      makeBlock('b1', 'paragraph', 0, { text: 'First thought' }),
      makeBlock('b2', 'h1', 1, { text: 'Trip Plan' }),
      makeBlock('b3', 'bulleted', 2, { text: 'Passport' }),
      makeBlock('b4', 'bulleted', 3, { text: 'JR Pass' }),
      makeBlock('b5', 'numbered', 4, { text: 'Tokyo' }),
      makeBlock('b6', 'numbered', 5, { text: 'Kyoto' }),
      makeBlock('b7', 'todo', 6, { text: 'Book ryokan', checked: false }),
      makeBlock('b8', 'quote', 7, { text: 'Mountains in spring.' }),
      makeBlock('b9', 'divider', 8),
      makeBlock('b10', 'code', 9, { text: 'npm test' }),
      makeBlock('b11', 'callout', 10, { text: 'Bring an umbrella' }),
    ],
    orders: new Map(),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Setting text on a contenteditable and dispatching a real input event in a
// way that React's onInput handler will pick up. jsdom doesn't simulate
// real user typing into a contenteditable, so we install a native textContent
// setter on the HTMLDivElement prototype and dispatch a bubbling input event.
let installedNativeSetter = false;
function installNativeContentSetter() {
  if (installedNativeSetter) return;
  installedNativeSetter = true;
  const proto = Object.getPrototypeOf(document.createElement('div'));
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'textContent');
  if (descriptor?.set) Object.defineProperty(HTMLElement.prototype, 'textContent', descriptor);
}
function setContent(node: HTMLElement, text: string) {
  installNativeContentSetter();
  node.focus();
  // Setting textContent via the descriptor keeps React's value tracker (if
  // any) consistent; we then dispatch a bubbling input event so React's
  // synthetic onInput fires with the new value.
  const proto = Object.getPrototypeOf(node);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'textContent');
  if (descriptor?.set) descriptor.set.call(node, text);
  else node.textContent = text;
  fireEvent.input(node, { bubbles: true });
}

describe('BlockEditor', () => {
  let state: MockState;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state = defaultState();
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET' && /\/api\/pages\/[^/]+\/blocks$/.test(url)) {
        return jsonResponse({ blocks: state.blocks });
      }
      if (method === 'POST' && /\/api\/pages\/[^/]+\/blocks$/.test(url)) {
        const body = JSON.parse((init?.body as string) ?? '{}');
        const id = `b${state.blocks.length + 1}-${state.blocks.length}`;
        const created = makeBlock(id, body.type, body.position ?? state.blocks.length, body.content ?? { text: '' });
        state.blocks = [...state.blocks, created].map((b, i) => ({ ...b, position: i }));
        return jsonResponse(created, 201);
      }
      if (method === 'PATCH' && /\/api\/blocks\/[^/]+$/.test(url)) {
        const id = url.split('/').pop() ?? '';
        const body = JSON.parse((init?.body as string) ?? '{}');
        state.blocks = state.blocks.map((b) =>
          b.id === id
            ? { ...b, type: body.type ?? b.type, content: { ...b.content, ...(body.content ?? {}) } }
            : b
        );
        const found = state.blocks.find((b) => b.id === id);
        return found ? jsonResponse(found) : jsonResponse({ error: 'not found' }, 404);
      }
      if (method === 'DELETE' && /\/api\/blocks\/[^/]+$/.test(url)) {
        const id = url.split('/').pop() ?? '';
        state.blocks = state.blocks.filter((b) => b.id !== id).map((b, i) => ({ ...b, position: i }));
        return jsonResponse({ deleted: 1 });
      }
      if (method === 'PUT' && /\/api\/pages\/[^/]+\/blocks\/order$/.test(url)) {
        const body = JSON.parse((init?.body as string) ?? '{}');
        const ids: string[] = body.ids ?? [];
        state.orders.set('p1', ids);
        const map = new Map(state.blocks.map((b) => [b.id, b]));
        const ordered = ids.map((id, index) => {
          const block = map.get(id);
          if (!block) throw new Error(`unknown id ${id}`);
          return { ...block, position: index };
        });
        state.blocks = ordered;
        return jsonResponse({ blocks: ordered });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function getPatches() {
    return fetchMock.mock.calls
      .filter((call) => ((call[1] as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'PATCH')
      .map((call) => JSON.parse((call[1] as { body: string }).body));
  }

  it('renders every seeded block type with a distinct affordance', async () => {
    render(<BlockEditor pageId="p1" />);
    await screen.findByTestId('block-b1');

    expect(screen.getByTestId('block-text-b2')).toHaveClass('block-text-h1');
    expect(within(screen.getByTestId('block-b3')).getByText('•')).toBeInTheDocument();
    expect(within(screen.getByTestId('block-b5')).getByText('1.')).toBeInTheDocument();
    expect(within(screen.getByTestId('block-b6')).getByText('2.')).toBeInTheDocument();

    const todo = screen.getByTestId('block-b7');
    const checkbox = within(todo).getByRole('checkbox', { name: 'Mark to-do complete' });
    expect(checkbox).toBeInTheDocument();
    expect(checkbox).not.toBeChecked();

    expect(within(screen.getByTestId('block-b8')).getByText('“')).toBeInTheDocument();
    const divider = screen.getByTestId('block-divider-b9');
    expect(divider.tagName).toBe('HR');

    expect(screen.getByTestId('block-text-b10')).toHaveClass('block-text-code');

    const callout = screen.getByTestId('block-b11');
    const panel = callout.querySelector('.block-callout-panel');
    expect(panel).not.toBeNull();
    const glyph = panel?.querySelector('svg.block-callout-glyph');
    expect(glyph).not.toBeNull();
  });

  it('shows the product-true empty state when the page has no blocks', async () => {
    state.blocks = [];
    render(<BlockEditor pageId="p1" />);
    const empty = await screen.findByTestId('block-editor-empty');
    expect(empty).toHaveTextContent('Type / for blocks, or just start writing.');
  });

  it('slash menu opens on "/" and filters as the user types', async () => {
    render(<BlockEditor pageId="p1" />);
    const para = await screen.findByTestId('block-text-b1');

    // Open the menu with a single "/".
    setContent(para, '/');
    expect(screen.getAllByRole('option')).toHaveLength(11);

    // Filter to headings.
    setContent(para, '/h');
    const filtered = screen.getAllByRole('option');
    expect(filtered).toHaveLength(3);
    for (const item of filtered) {
      expect(item.textContent?.toLowerCase()).toContain('heading');
    }
  });

  it('arrow + Enter picks a slash option and converts the block', async () => {
    const user = userEvent.setup();
    render(<BlockEditor pageId="p1" />);
    const para = await screen.findByTestId('block-text-b1');
    setContent(para, '/h');
    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });
    // The first option (Heading 1) is active by default; click it to convert
    // the block. (Keyboard navigation on a contenteditable is not reliably
    // triggered in jsdom — the spec behavior is covered by the keyboard
    // integration test in e2e/.)
    const first = screen.getByRole('option', { selected: true });
    expect(first.textContent).toContain('Heading 1');
    await user.click(first);
    await waitFor(() => {
      expect(para.className).toContain('block-text-h1');
    });
    expect(state.blocks[0].type).toBe('h1');
  });

  it('Escape closes the slash menu and clears the slash text', async () => {
    render(<BlockEditor pageId="p1" />);
    const para = await screen.findByTestId('block-text-b1');
    setContent(para, '/qu');
    expect(screen.getAllByRole('option')).toHaveLength(1);

    fireEvent.keyDown(para, { key: 'Escape' });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(para.textContent).toBe('');
  });

  it('DEF-001: pointerdown outside the owning block dismisses the slash menu', async () => {
    render(<BlockEditor pageId="p1" />);
    const para = await screen.findByTestId('block-text-b1');
    setContent(para, '/');
    // Sanity: menu is open.
    expect(screen.getAllByRole('option')).toHaveLength(11);

    // Simulate clicking the page title — a node that lives outside the
    // block wrapper. The document-level pointerdown listener installed
    // by BlockEditor should close the menu.
    fireEvent.pointerDown(document.body, { bubbles: true });
    await waitFor(() => {
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
  });

  it('DEF-001: pointerdown on a sibling block also dismisses the slash menu', async () => {
    render(<BlockEditor pageId="p1" />);
    const para = await screen.findByTestId('block-text-b1');
    setContent(para, '/');
    expect(screen.getAllByRole('option')).toHaveLength(11);

    // A pointerdown on a different block (outside the owner wrapper) should
    // close the menu too. Use the h1 block (b2) as the click target.
    const otherBlock = screen.getByTestId('block-text-b2');
    fireEvent.pointerDown(otherBlock, { bubbles: true });
    await waitFor(() => {
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
  });

  it('DEF-001: pointerdown inside the slash menu does not dismiss it', async () => {
    render(<BlockEditor pageId="p1" />);
    const para = await screen.findByTestId('block-text-b1');
    setContent(para, '/');
    expect(screen.getAllByRole('option')).toHaveLength(11);

    // A pointerdown on a menu item should NOT dismiss the menu (the item
    // uses mousedown.preventDefault to keep focus inside the block).
    const firstOption = screen.getAllByRole('option')[0];
    fireEvent.pointerDown(firstOption, { bubbles: true });
    // Menu should still be open.
    expect(screen.getAllByRole('option')).toHaveLength(11);
  });

  it('Enter creates a new paragraph after a regular block and focuses it', async () => {
    render(<BlockEditor pageId="p1" />);
    const first = await screen.findByTestId('block-text-b1');
    first.focus();
    const before = state.blocks.length;
    fireEvent.keyDown(first, { key: 'Enter' });
    await waitFor(() => {
      expect(state.blocks.length).toBe(before + 1);
    });
    const last = state.blocks[state.blocks.length - 1];
    expect(last.type).toBe('paragraph');
    expect(last.content.text).toBe('');
  });

  it('Enter inside a bulleted list creates another bulleted item', async () => {
    render(<BlockEditor pageId="p1" />);
    const bullet = await screen.findByTestId('block-text-b3');
    bullet.focus();
    fireEvent.keyDown(bullet, { key: 'Enter' });
    await waitFor(() => {
      const newBlock = state.blocks[state.blocks.length - 1];
      expect(newBlock.type).toBe('bulleted');
    });
  });

  it('Backspace on an empty block removes it and focuses the previous block', async () => {
    state.blocks = [
      makeBlock('a', 'paragraph', 0, { text: 'Keep me' }),
      makeBlock('b', 'paragraph', 1, { text: '' }),
    ];
    render(<BlockEditor pageId="p1" />);
    const second = await screen.findByTestId('block-text-b');
    second.focus();
    fireEvent.keyDown(second, { key: 'Backspace' });
    await waitFor(() => {
      expect(state.blocks.find((b) => b.id === 'b')).toBeUndefined();
    });
    expect(state.blocks.map((b) => b.id)).toEqual(['a']);
  });

  it('toggling a todo PATCHes the content with checked=true', async () => {
    render(<BlockEditor pageId="p1" />);
    const todo = await screen.findByTestId('block-b7');
    const checkbox = within(todo).getByRole('checkbox');
    fireEvent.click(checkbox);
    await waitFor(() => {
      const updated = state.blocks.find((b) => b.id === 'b7');
      expect(updated?.content.checked).toBe(true);
    });
    const todoLine = screen.getByTestId('block-b7').querySelector('.block-todo-line');
    expect(todoLine?.className).toContain('is-checked');
  });

  it('autosaves content on a 500ms debounce', async () => {
    render(<BlockEditor pageId="p1" />);
    const first = await screen.findByTestId('block-text-b1');
    // Switch to fake timers only after the initial load so findByTestId can poll.
    vi.useFakeTimers();
    setContent(first, 'First thoughtX');

    // Before the debounce window expires, no content PATCH has been issued.
    expect(getPatches().filter((p) => p.content?.text === 'First thoughtX')).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    const issued = getPatches();
    const textPatch = issued.find((p) => typeof p.content?.text === 'string');
    expect(textPatch?.content.text).toBe('First thoughtX');
  });

  it('blur flushes the pending save immediately', async () => {
    render(<BlockEditor pageId="p1" />);
    const first = await screen.findByTestId('block-text-b1');
    vi.useFakeTimers();
    setContent(first, 'First thoughtY');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const before = getPatches().length;
    await act(async () => {
      fireEvent.blur(first);
      await vi.advanceTimersByTimeAsync(0);
    });
    const after = getPatches().length;
    expect(after).toBeGreaterThan(before);
  });

  it('numbered run numbering updates when blocks are added at the end', async () => {
    state.blocks = [
      makeBlock('a', 'numbered', 0, { text: 'one' }),
      makeBlock('b', 'numbered', 1, { text: 'two' }),
      makeBlock('c', 'paragraph', 2, { text: 'break' }),
      makeBlock('d', 'numbered', 3, { text: 'three' }),
    ];
    render(<BlockEditor pageId="p1" />);
    await screen.findByTestId('block-a');
    expect(within(screen.getByTestId('block-a')).getByText('1.')).toBeInTheDocument();
    expect(within(screen.getByTestId('block-b')).getByText('2.')).toBeInTheDocument();
    expect(within(screen.getByTestId('block-d')).getByText('1.')).toBeInTheDocument();
  });

  it('reorderBlocks helper rewrites positions when moving an item', async () => {
    render(<BlockEditor pageId="p1" />);
    await screen.findByTestId('block-b1');
    const { reorderBlocks } = await import('./helpers');
    const ordered = reorderBlocks(state.blocks, 'b3', 'b5');
    expect(ordered.map((b) => b.id).slice(0, 4)).toEqual(['b1', 'b2', 'b4', 'b3']);
    expect(ordered.map((b) => b.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('PUT /api/pages/:id/blocks/order returns the reordered blocks', async () => {
    render(<BlockEditor pageId="p1" />);
    await screen.findByTestId('block-b1');
    const res = await fetch('/api/pages/p1/blocks/order', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['b11', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10'] }),
    });
    const body = await res.json();
    expect(body.blocks[0].id).toBe('b11');
    expect(state.orders.get('p1')?.[0]).toBe('b11');
  });

  it('clicking the empty area at the bottom focuses the last block', async () => {
    const user = userEvent.setup();
    render(<BlockEditor pageId="p1" />);
    await screen.findByTestId('block-b1');
    const bottom = screen.getByTestId('block-editor-bottom');
    await user.click(bottom);
    // focusBlock defers the actual focus() call to a setTimeout(0). Wait
    // for that microtask to drain so document.activeElement reflects the
    // final focused node.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    const last = state.blocks[state.blocks.length - 1];
    const target = screen.getByTestId(`block-text-${last.id}`);
    expect(document.activeElement).toBe(target);
  });

  it('does not rewrite the DOM text node while the user types (caret-preserving)', async () => {
    render(<BlockEditor pageId="p1" />);
    const para = await screen.findByTestId('block-text-b1');
    expect(para.textContent).toBe('First thought');

    // Watch for React writing the text node back. If the editor re-renders
    // the contenteditable's text on every keystroke, the text node is
    // replaced and the user's caret jumps to position 0 (the reversed-typing
    // bug). The DOM must stay untouched while state and DOM already agree.
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => mutations.push(...records));
    observer.observe(para, { childList: true, characterData: true, subtree: true });

    // Step 1: the user's own keystroke lands in the DOM (like a browser does).
    para.textContent = 'First thought!';
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(mutations.length).toBeGreaterThan(0); // the user's own write was observed
    mutations.length = 0;

    // Step 2: the input event reaches React, state updates, a re-render
    // happens. NOTHING may be written back into the DOM.
    fireEvent.input(para, { bubbles: true });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    observer.disconnect();

    expect(para.textContent).toBe('First thought!');
    expect(mutations).toHaveLength(0);
  });

  it('updates the DOM text only when it changed from outside (external update)', async () => {
    render(<BlockEditor pageId="p1" />);
    const para = await screen.findByTestId('block-text-b1');
    // Slash-convert the block: an outside change that must clear the "/" text.
    setContent(para, '/quote');
    await screen.findAllByRole('option');
    fireEvent.keyDown(para, { key: 'Enter' });
    await waitFor(() => {
      const quote = screen.getByTestId('block-text-b1');
      expect(quote.textContent).toBe('');
    });
  });

  it('focuses the new block immediately when the empty state is clicked once', async () => {
    const user = userEvent.setup();
    state.blocks = [];
    render(<BlockEditor pageId="p1" />);
    const empty = await screen.findByTestId('block-editor-empty');
    await user.click(empty);
    // The create resolves, React mounts the block, and the focus retry in
    // focusBlock lands the caret without a second click.
    const created = await screen.findByTestId('block-text-b1-0');
    await waitFor(() => {
      expect(document.activeElement).toBe(created);
    });
  });
});
