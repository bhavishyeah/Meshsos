import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginPage } from './LoginPage';

// Mock the AuthContext
const mockLogin = vi.fn();
const mockCompleteLogin = vi.fn();

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    login: mockLogin,
    logout: vi.fn(),
    refreshToken: vi.fn(),
    completeLogin: mockCompleteLogin,
    user: null,
    accessToken: null,
    isAuthenticated: false,
    isLoading: false,
  }),
}));

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '';
  });

  it('renders email and password fields and a submit button', () => {
    render(<LoginPage />);

    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('renders a link back to survivor home', () => {
    render(<LoginPage />);

    const homeLink = screen.getByText(/back to home/i);
    expect(homeLink).toBeInTheDocument();
    expect(homeLink).toHaveAttribute('href', '#/');
  });

  it('calls login with email and password on form submit', async () => {
    mockLogin.mockResolvedValue({ success: false, error: 'Invalid' });
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin@test.com', 'secret123');
    });
  });

  it('redirects administrator to #/admin on successful login', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      user: { id: '1', role: 'administrator', name: 'Admin', email: 'admin@test.com' },
      accessToken: 'token123',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'admin@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/admin');
    });
  });

  it('redirects dispatcher to #/command-center on successful login', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      user: { id: '2', role: 'dispatcher', name: 'Dispatcher', email: 'd@test.com' },
      accessToken: 'token123',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'd@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/command-center');
    });
  });

  it('redirects supervisor to #/command-center on successful login', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      user: { id: '3', role: 'supervisor', name: 'Supervisor', email: 's@test.com' },
      accessToken: 'token123',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 's@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/command-center');
    });
  });

  it('redirects responder to #/responder on successful login', async () => {
    mockLogin.mockResolvedValue({
      success: true,
      user: { id: '4', role: 'responder', name: 'Responder', email: 'r@test.com' },
      accessToken: 'token123',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'r@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(window.location.hash).toBe('#/responder');
    });
  });

  it('displays error message for invalid credentials', async () => {
    mockLogin.mockResolvedValue({
      success: false,
      error: 'Invalid email or password',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'bad@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or password');
    });
  });

  it('shows loading state on submit button while login is in progress', async () => {
    mockLogin.mockReturnValue(new Promise(() => {})); // never resolves

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent('Signing in...');
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  it('shows MFA verification state when mfaRequired is returned', async () => {
    mockLogin.mockResolvedValue({
      mfaRequired: true,
      userId: 'user-123',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'mfa@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
    });
  });

  it('shows MFA setup state when mfaSetupRequired is returned', async () => {
    // Mock the fetch for MFA setup endpoint
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ otpauthUri: 'otpauth://totp/MeshSOS:admin@test.com?secret=JBSWY3DPEHPK3PXP&issuer=MeshSOS', secret: 'JBSWY3DPEHPK3PXP' }),
    });

    mockLogin.mockResolvedValue({
      mfaSetupRequired: true,
      userId: 'user-456',
      user: { id: 'user-456', role: 'administrator', name: 'Admin', email: 'admin@test.com' },
      accessToken: 'setup-token-123',
    });

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'setup@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByText(/set up multi-factor authentication/i)).toBeInTheDocument();
    });
  });

  it('disables form inputs while submitting', async () => {
    mockLogin.mockReturnValue(new Promise(() => {}));

    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@test.com' },
    });
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'password' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeDisabled();
      expect(screen.getByLabelText(/password/i)).toBeDisabled();
    });
  });

  describe('MFA Setup Flow', () => {
    const setupUser = { id: 'user-456', role: 'administrator', name: 'Admin', email: 'admin@test.com' };
    const setupToken = 'setup-token-123';

    beforeEach(() => {
      mockLogin.mockResolvedValue({
        mfaSetupRequired: true,
        userId: 'user-456',
        user: setupUser,
        accessToken: setupToken,
      });
    });

    async function triggerMfaSetup() {
      render(<LoginPage />);
      fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@test.com' } });
      fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password' } });
      fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    }

    it('displays the secret for manual entry after setup fetch', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ otpauthUri: 'otpauth://totp/MeshSOS:admin@test.com?secret=JBSWY3DPEHPK3PXP&issuer=MeshSOS', secret: 'JBSWY3DPEHPK3PXP' }),
      });

      await triggerMfaSetup();

      await waitFor(() => {
        expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
      });
    });

    it('displays QR code image from otpauth URI', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ otpauthUri: 'otpauth://totp/MeshSOS:admin@test.com?secret=ABC123&issuer=MeshSOS', secret: 'ABC123' }),
      });

      await triggerMfaSetup();

      await waitFor(() => {
        const img = screen.getByAltText('MFA QR Code');
        expect(img).toBeInTheDocument();
        expect(img).toHaveAttribute('src', expect.stringContaining('otpauth'));
      });
    });

    it('shows verification code input field', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ otpauthUri: 'otpauth://totp/test', secret: 'SECRET' }),
      });

      await triggerMfaSetup();

      await waitFor(() => {
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      });
    });

    it('shows error when setup fetch fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'Failed to initialize MFA setup' }),
      });

      await triggerMfaSetup();

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to initialize MFA setup');
      });
    });

    it('disables verify button when code is incomplete', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ otpauthUri: 'otpauth://totp/test', secret: 'SECRET' }),
      });

      await triggerMfaSetup();

      await waitFor(() => {
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      });

      // Enter incomplete code
      fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123' } });

      expect(screen.getByRole('button', { name: /verify/i })).toBeDisabled();
    });

    it('calls verify endpoint and completes login on success', async () => {
      // First call: MFA setup fetch
      // Second call: MFA verify
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ otpauthUri: 'otpauth://totp/test', secret: 'SECRET' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ verified: true, mfaComplete: true }),
        });

      await triggerMfaSetup();

      await waitFor(() => {
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '123456' } });
      fireEvent.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        expect(mockCompleteLogin).toHaveBeenCalledWith(setupUser, setupToken);
      });

      expect(window.location.hash).toBe('#/admin');
    });

    it('shows error when verification code is invalid', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ otpauthUri: 'otpauth://totp/test', secret: 'SECRET' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ verified: false, error: 'Invalid or expired MFA code' }),
        });

      await triggerMfaSetup();

      await waitFor(() => {
        expect(screen.getByLabelText(/verification code/i)).toBeInTheDocument();
      });

      fireEvent.change(screen.getByLabelText(/verification code/i), { target: { value: '000000' } });
      fireEvent.click(screen.getByRole('button', { name: /verify/i }));

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid or expired MFA code');
      });
    });
  });
});
