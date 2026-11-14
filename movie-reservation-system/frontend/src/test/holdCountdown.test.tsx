import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HoldTimer } from '../components/HoldTimer';

describe('HoldTimer Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders initial countdown time formatted MM:SS', () => {
    const expiresAt = new Date(Date.now() + 600 * 1000).toISOString(); // 10 minutes
    const onExpire = vi.fn();

    render(<HoldTimer expiresAt={expiresAt} onExpire={onExpire} />);

    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('counts down every second and triggers onExpire when zero is reached', () => {
    const expiresAt = new Date(Date.now() + 3000).toISOString(); // 3 seconds
    const onExpire = vi.fn();

    render(<HoldTimer expiresAt={expiresAt} onExpire={onExpire} />);

    expect(screen.getByText('00:03')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('00:01')).toBeInTheDocument();
    expect(onExpire).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});
