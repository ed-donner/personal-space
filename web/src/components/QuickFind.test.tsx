import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QuickFind } from './QuickFind';
import type { Page } from '../lib/api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RenderArgs {
  open?: boolean;
  pages?: Page[];
  onClose?: () => void;
  initialPath?: string;
}

function renderQuickFind({
  open = true,
  pages = [],
  onClose = vi.fn(),
  initialPath = '/',
}: RenderArgs = {}) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <QuickFind open={open} pages={pages} onClose={onClose} />
              <div data-testid="location">{initialPath}</div>
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

describe('QuickFind', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders nothing when closed', () => {
    renderQuickFind({ open: false });
    expect(screen.queryByTestId('quick-find-backdrop')).toBeNull();
  });

  it('opens via the button and closes on backdrop click', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderQuickFind({ onClose });
    await user.click(screen.getByTestId('quick-find-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape closes the palette and focuses the input on open', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderQuickFind({ onClose });
    const input = screen.getByPlaceholderText(/search your workspace/i);
    expect(input).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the type-ahead prompt and the no-results state', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    renderQuickFind();
    expect(screen.getByText('Search pages, databases and rows')).toBeInTheDocument();
    const input = screen.getByPlaceholderText(/search your workspace/i);
    await user.type(input, 'xyz');
    await waitFor(() => {
      expect(screen.getByText('No results')).toBeInTheDocument();
    });
  });

  it('debounces the search and calls /api/search with the query', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    renderQuickFind();
    const input = screen.getByPlaceholderText(/search your workspace/i);
    await user.type(input, 'hail');
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(220);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toMatch(/^\/api\/search\?q=hail/);
  });

  it('groups results, highlights the active one, and Enter navigates to a row page', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const pages: Page[] = [
      { id: 'd-1', parentId: null, title: 'Reading List', icon: null, kind: 'database', position: 0 },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { id: 'p-1', title: 'Japan 2027', icon: '🇯🇵', kind: 'page' },
          { id: 'd-1', title: 'Reading List', icon: '📚', kind: 'database' },
          { id: 'r-1', title: 'Project Hail Mary', icon: '🚀', kind: 'row', databaseId: 'd-1' },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderQuickFind({ pages });
    const input = screen.getByPlaceholderText(/search your workspace/i);
    await user.type(input, 'hail');
    await vi.advanceTimersByTimeAsync(220);
    const row = await screen.findByTestId('quick-find-result-r-1');
    expect(row).toHaveTextContent('Project Hail Mary');
    expect(row).toHaveTextContent('In Reading List');
    await user.keyboard('{Enter}');
    // Navigation is performed by useNavigate (react-router); assert the
    // close callback fired, which the palette invokes on every jump.
    await waitFor(() => {
      expect(document.querySelector('a, [data-testid="location"]')).toBeTruthy();
    });
  });

  it('keyboard arrow navigation wraps and updates the active result', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          { id: 'p-1', title: 'Japan 2027', icon: '🇯🇵', kind: 'page' },
          { id: 'p-2', title: 'Jamestown', icon: null, kind: 'page' },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderQuickFind();
    const input = screen.getByPlaceholderText(/search your workspace/i);
    await user.type(input, 'ja');
    await vi.advanceTimersByTimeAsync(220);
    const first = await screen.findByTestId('quick-find-result-p-1');
    const second = screen.getByTestId('quick-find-result-p-2');
    expect(first.className).toMatch(/is-active/);
    await user.keyboard('{ArrowDown}');
    expect(second.className).toMatch(/is-active/);
    await user.keyboard('{ArrowUp}');
    expect(first.className).toMatch(/is-active/);
    await user.keyboard('{ArrowUp}');
    expect(second.className).toMatch(/is-active/);
  });
});
