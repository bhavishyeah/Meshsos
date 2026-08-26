import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ConnectivityState } from '@meshsos/shared';
import type { ConnectivityManager } from '../services/connectivity.service';
import { ConnectivityIndicator } from './ConnectivityIndicator';

type Listener = (state: ConnectivityState) => void;

function createMockConnectivityManager(
  initialStatus: ConnectivityState['status'] = 'connected'
): ConnectivityManager & { triggerChange: (status: ConnectivityState['status']) => void } {
  let currentState: ConnectivityState = {
    status: initialStatus,
    lastChecked: new Date(),
  };
  const listeners = new Set<Listener>();

  return {
    getState: () => ({ ...currentState }),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    start: vi.fn(),
    stop: vi.fn(),
    triggerChange(status: ConnectivityState['status']) {
      currentState = { status, lastChecked: new Date() };
      for (const listener of listeners) {
        listener({ ...currentState });
      }
    },
  };
}

describe('ConnectivityIndicator', () => {
  it('displays "Connected" with green styling when status is connected', () => {
    const manager = createMockConnectivityManager('connected');
    render(<ConnectivityIndicator connectivityManager={manager} />);

    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toHaveClass('text-green-700');

    const dot = screen.getByText('Connected').previousElementSibling;
    expect(dot).toHaveClass('bg-green-500');
    expect(dot).toHaveClass('rounded-full');
    expect(dot).toHaveClass('w-3');
    expect(dot).toHaveClass('h-3');
  });

  it('displays "Weak Signal" with yellow styling when status is weak', () => {
    const manager = createMockConnectivityManager('weak');
    render(<ConnectivityIndicator connectivityManager={manager} />);

    expect(screen.getByText('Weak Signal')).toBeInTheDocument();
    expect(screen.getByText('Weak Signal')).toHaveClass('text-yellow-700');

    const dot = screen.getByText('Weak Signal').previousElementSibling;
    expect(dot).toHaveClass('bg-yellow-500');
    expect(dot).toHaveClass('rounded-full');
  });

  it('displays "Offline" with red styling when status is offline', () => {
    const manager = createMockConnectivityManager('offline');
    render(<ConnectivityIndicator connectivityManager={manager} />);

    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.getByText('Offline')).toHaveClass('text-red-700');

    const dot = screen.getByText('Offline').previousElementSibling;
    expect(dot).toHaveClass('bg-red-500');
    expect(dot).toHaveClass('rounded-full');
  });

  it('updates reactively when connectivity state changes', () => {
    const manager = createMockConnectivityManager('connected');
    render(<ConnectivityIndicator connectivityManager={manager} />);

    expect(screen.getByText('Connected')).toBeInTheDocument();

    act(() => {
      manager.triggerChange('offline');
    });

    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
  });

  it('applies pulse animation when status transitions', () => {
    vi.useFakeTimers();
    const manager = createMockConnectivityManager('connected');
    render(<ConnectivityIndicator connectivityManager={manager} />);

    const getDot = () => screen.getByRole('status').querySelector('span:first-child');

    expect(getDot()).not.toHaveClass('animate-pulse');

    act(() => {
      manager.triggerChange('weak');
    });

    expect(getDot()).toHaveClass('animate-pulse');

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(getDot()).not.toHaveClass('animate-pulse');
    vi.useRealTimers();
  });

  it('has aria-live="polite" for screen reader announcements', () => {
    const manager = createMockConnectivityManager('connected');
    render(<ConnectivityIndicator connectivityManager={manager} />);

    const container = screen.getByRole('status');
    expect(container).toHaveAttribute('aria-live', 'polite');
    expect(container).toHaveAttribute('aria-atomic', 'true');
  });

  it('unsubscribes from connectivity manager on unmount', () => {
    const manager = createMockConnectivityManager('connected');
    const { unmount } = render(<ConnectivityIndicator connectivityManager={manager} />);

    unmount();

    // Trigger change after unmount - should not cause errors
    act(() => {
      manager.triggerChange('offline');
    });
  });
});
