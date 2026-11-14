import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Providers } from '../test/Providers';
import { ManagerCombobox } from './ManagerCombobox';
import { installFetchMock } from '../test/fetchMock';
import { makeEmployee } from '../test/fixtures';

function renderCombobox(ui: React.ReactElement) {
  return render(<Providers>{ui}</Providers>);
}

describe('ManagerCombobox', () => {
  it('allows keyboard navigation and selection of "No manager (org root)"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderCombobox(
      <ManagerCombobox
        id="test-manager"
        value="emp-1"
        onChange={onChange}
        searchKey="test-key"
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);

    const listbox = await screen.findByRole('listbox', { name: /manager candidates/i });
    expect(listbox).toBeVisible();

    // Option 0: No manager (org root)
    const noneOption = screen.getByRole('option', { name: /no manager/i });
    expect(noneOption).toBeInTheDocument();

    // Arrow down highlights option 0
    await user.keyboard('{ArrowDown}');
    expect(noneOption).toHaveClass('is-active');
    expect(input).toHaveAttribute('aria-activedescendant', noneOption.id);

    // Pressing Enter picks option 0
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith('');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('allows clearing current selection independent of search results', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderCombobox(
      <ManagerCombobox
        id="test-manager"
        value="emp-1"
        onChange={onChange}
        searchKey="test-key"
      />,
    );

    const clearButton = screen.getByRole('button', { name: /clear manager/i });
    expect(clearButton).toBeVisible();

    await user.click(clearButton);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('does not offer stale selectable results while a newer query loads', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    installFetchMock({
      'GET /api/employees?q=Alice&status=ACTIVE&page=0&size=20&sort=fullName%2Casc': {
        body: {
          content: [makeEmployee({ id: 'emp-alice', fullName: 'Alice Smith', employeeNumber: 'EMP-0010' })],
          page: 0,
          size: 20,
          totalElements: 1,
          totalPages: 1,
        },
      },
      'GET /api/employees?q=Bob&status=ACTIVE&page=0&size=20&sort=fullName%2Casc': {
        // Delayed or pending
        body: {
          content: [makeEmployee({ id: 'emp-bob', fullName: 'Bob Jones', employeeNumber: 'EMP-0020' })],
          page: 0,
          size: 20,
          totalElements: 1,
          totalPages: 1,
        },
      },
    });

    renderCombobox(
      <ManagerCombobox
        id="test-manager"
        value=""
        onChange={onChange}
        searchKey="test-key"
      />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'Alice');

    // Wait for Alice to appear
    expect(await screen.findByRole('option', { name: /alice smith/i })).toBeInTheDocument();

    // Now type Bob; immediately Alice should not be selectable/visible while searching
    await user.clear(input);
    await user.type(input, 'Bob');

    // Alice should immediately not be present in options
    expect(screen.queryByRole('option', { name: /alice smith/i })).not.toBeInTheDocument();

    // Eventually Bob appears
    expect(await screen.findByRole('option', { name: /bob jones/i })).toBeInTheDocument();
  });

  it('supports cancellation with Escape key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderCombobox(
      <ManagerCombobox
        id="test-manager"
        value=""
        onChange={onChange}
        searchKey="test-key"
      />,
    );

    const input = screen.getByRole('combobox');
    await user.click(input);
    expect(await screen.findByRole('listbox')).toBeVisible();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports retry on search error', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    installFetchMock({
      'GET /api/employees?q=Error&status=ACTIVE&page=0&size=20&sort=fullName%2Casc': {
        status: 500,
        body: { status: 500, message: 'Server error' },
      },
    });

    renderCombobox(
      <ManagerCombobox
        id="test-manager"
        value=""
        onChange={vi.fn()}
        searchKey="test-key"
        onRetry={onRetry}
      />,
    );

    const input = screen.getByRole('combobox');
    await user.type(input, 'Error');

    const retryBtn = await screen.findByRole('button', { name: /retry/i });
    expect(retryBtn).toBeInTheDocument();

    await user.click(retryBtn);
    expect(onRetry).toHaveBeenCalled();
  });
});
