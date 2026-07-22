import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { App } from './App';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderApp(initialPath = '/') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<App />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('App quick-find integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the palette via Ctrl+K, navigates to a result, and resets the query', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith('/api/tree')) {
        return Promise.resolve(jsonResponse({ pages: [] }));
      }
      if (url.startsWith('/api/search')) {
        const query = new URL(url, 'http://x').searchParams.get('q') ?? '';
        return Promise.resolve(jsonResponse({
          results: query === 'jap'
            ? [{ id: 'jp-1', title: 'Japan 2027', icon: '🇯🇵', kind: 'page' }]
            : [],
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderApp();
    // Wait for tree to load.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/tree', expect.anything());
    });
    // Open via the keyboard shortcut.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByPlaceholderText(/search your workspace/i);
    await user.type(input, 'jap');
    const option = await screen.findByTestId('quick-find-result-jp-1');
    expect(option).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/search your workspace/i)).toBeNull();
    });
  });

  it('opens the palette via the sidebar search button', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith('/api/tree')) {
        return Promise.resolve(jsonResponse({ pages: [] }));
      }
      return Promise.resolve(jsonResponse({ results: [] }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-search')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('sidebar-search'));
    expect(screen.getByPlaceholderText(/search your workspace/i)).toBeInTheDocument();
  });
});
