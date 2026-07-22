import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';

describe('ConfirmDeleteModal', () => {
  it('names the page being deleted and warns about nested pages', () => {
    render(
      <MemoryRouter>
        <ConfirmDeleteModal
          pageTitle="Projects"
          onCancel={() => {}}
          onConfirm={() => {}}
        />
      </MemoryRouter>
    );
    expect(screen.getByText(/Projects/)).toBeInTheDocument();
    expect(
      screen.getByText(/nested inside this page is also deleted/i)
    ).toBeInTheDocument();
  });

  it('calls onCancel when Cancel is clicked', () => {
    let cancelled = 0;
    render(
      <MemoryRouter>
        <ConfirmDeleteModal
          pageTitle="X"
          onCancel={() => {
            cancelled++;
          }}
          onConfirm={() => {}}
        />
      </MemoryRouter>
    );
    screen.getByTestId('confirm-cancel').click();
    expect(cancelled).toBe(1);
  });

  it('calls onConfirm when Delete is clicked', () => {
    let confirmed = 0;
    render(
      <MemoryRouter>
        <ConfirmDeleteModal
          pageTitle="X"
          onCancel={() => {}}
          onConfirm={() => {
            confirmed++;
          }}
        />
      </MemoryRouter>
    );
    screen.getByTestId('confirm-delete').click();
    expect(confirmed).toBe(1);
  });

  it('disables both buttons while pending', () => {
    render(
      <MemoryRouter>
        <ConfirmDeleteModal
          pageTitle="X"
          onCancel={() => {}}
          onConfirm={() => {}}
          isPending
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('confirm-cancel')).toBeDisabled();
    expect(screen.getByTestId('confirm-delete')).toBeDisabled();
    expect(screen.getByTestId('confirm-delete').textContent).toMatch(/Deleting/);
  });
});
