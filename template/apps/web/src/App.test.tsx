import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ConfirmModal } from './components/ConfirmModal';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            input.endsWith('/auth/config') ? { googleEnabled: false } : { authenticated: false },
          ),
          {
            status: input.endsWith('/auth/me') ? 401 : 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
    ),
  );
});
function open(path: string) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe('public routes', () => {
  it('shows a truthful disabled sign-in when credentials are not configured', async () => {
    open('/login');
    expect(await screen.findByText('Google sign-in needs setup')).toBeTruthy();
    expect(screen.getByText('Google sign-in needs setup').closest('button')?.disabled).toBe(true);
    expect(screen.queryByText('View security & audit')).toBeNull();
  });
  it('guards private workspace without a test login bypass', async () => {
    open('/dashboard');
    expect(await screen.findByText('Welcome back.')).toBeTruthy();
    expect(screen.queryByText('A space for your next idea.')).toBeNull();
  });
  it('renders the 404 page', () => {
    open('/missing-page');
    expect(screen.getByText('404')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to home' }).getAttribute('href')).toBe('/');
  });
  it('explains registration approval', async () => {
    open('/register?status=pending');
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText(/request is with the administrator/)).toBeTruthy();
  });
});
it('uses an accessible shadcn alert dialog for confirmation', () => {
  render(
    <ConfirmModal
      title="Sign out?"
      description="End your session."
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
  expect(screen.getByRole('alertdialog')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirm' })).toBeTruthy();
});
