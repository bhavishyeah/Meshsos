import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { usePWAInstall } from './usePWAInstall';

describe('usePWAInstall', () => {
  let matchMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    matchMediaMock = vi.fn().mockReturnValue({ matches: false });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: matchMediaMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with isInstallable false and isInstalled false', () => {
    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.isInstallable).toBe(false);
    expect(result.current.isInstalled).toBe(false);
  });

  it('should detect standalone mode as installed', () => {
    matchMediaMock.mockReturnValue({ matches: true });

    const { result } = renderHook(() => usePWAInstall());

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });

  it('should capture beforeinstallprompt event and become installable', () => {
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(event, 'prompt', { value: vi.fn().mockResolvedValue(undefined) });
      Object.defineProperty(event, 'userChoice', {
        value: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });
      window.dispatchEvent(event);
    });

    expect(result.current.isInstallable).toBe(true);
  });

  it('should call prompt and return true when user accepts install', async () => {
    const mockPrompt = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(event, 'prompt', { value: mockPrompt });
      Object.defineProperty(event, 'userChoice', {
        value: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });
      window.dispatchEvent(event);
    });

    let accepted: boolean = false;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });

    expect(mockPrompt).toHaveBeenCalledOnce();
    expect(accepted).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });

  it('should return false when user dismisses install prompt', async () => {
    const mockPrompt = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => usePWAInstall());

    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(event, 'prompt', { value: mockPrompt });
      Object.defineProperty(event, 'userChoice', {
        value: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
      });
      window.dispatchEvent(event);
    });

    let accepted: boolean = true;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });

    expect(accepted).toBe(false);
    expect(result.current.isInstallable).toBe(false);
  });

  it('should return false from promptInstall when no deferred prompt exists', async () => {
    const { result } = renderHook(() => usePWAInstall());

    let accepted: boolean = true;
    await act(async () => {
      accepted = await result.current.promptInstall();
    });

    expect(accepted).toBe(false);
  });

  it('should set isInstalled true and clear prompt on appinstalled event', () => {
    const { result } = renderHook(() => usePWAInstall());

    // First capture the install prompt
    act(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(event, 'prompt', { value: vi.fn().mockResolvedValue(undefined) });
      Object.defineProperty(event, 'userChoice', {
        value: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      });
      window.dispatchEvent(event);
    });

    expect(result.current.isInstallable).toBe(true);

    // Then fire appinstalled
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(result.current.isInstalled).toBe(true);
    expect(result.current.isInstallable).toBe(false);
  });

  it('should clean up event listeners on unmount', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => usePWAInstall());

    expect(addSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('appinstalled', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('beforeinstallprompt', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('appinstalled', expect.any(Function));
  });
});
