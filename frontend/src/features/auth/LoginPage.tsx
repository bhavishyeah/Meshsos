import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import type { AuthUser, LoginResult } from '../../context/AuthContext';
import { API_BASE_URL } from '../../config/env';

/**
 * Redirect the user to the appropriate route based on their role.
 */
function redirectByRole(role: string): void {
  switch (role) {
    case 'administrator':
      window.location.hash = '#/admin';
      break;
    case 'dispatcher':
    case 'supervisor':
      window.location.hash = '#/command-center';
      break;
    case 'responder':
      window.location.hash = '#/responder';
      break;
    default:
      window.location.hash = '#/';
      break;
  }
}

/**
 * MFA Verification Flow component.
 * Shows a 6-digit TOTP code input for users with MFA enabled.
 * On successful verification, stores the token and redirects by role.
 *
 * Requirements: 1.3
 */
function MFAVerificationFlow({ userId }: { userId: string }) {
  const { completeLogin } = useAuth();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the code input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (code.length !== 6 || !/^\d{6}$/.test(code)) {
        setError('Please enter a valid 6-digit code');
        return;
      }

      setIsVerifying(true);

      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/mfa/verify`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, code }),
        });

        const data = await response.json();

        if (!response.ok || !data.verified) {
          setError(data.error || 'Invalid or expired code. Please try again.');
          setIsVerifying(false);
          return;
        }

        // MFA verification successful — store token and redirect by role
        completeLogin(data.user, data.accessToken);
        redirectByRole(data.user.role);
      } catch {
        setError('Network error. Please try again.');
        setIsVerifying(false);
      }
    },
    [code, userId, completeLogin]
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8">
        <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
          Two-Factor Authentication
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          Enter the 6-digit code from your authenticator app to continue.
        </p>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-4">
            <label
              htmlFor="mfa-verify-code"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Verification Code
            </label>
            <input
              ref={inputRef}
              id="mfa-verify-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={isVerifying}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60 text-center text-lg tracking-widest font-mono"
              placeholder="000000"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isVerifying || code.length !== 6}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isVerifying ? 'Verifying...' : 'Verify'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          <a
            href="#/login"
            onClick={(e) => {
              e.preventDefault();
              window.location.reload();
            }}
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Back to login
          </a>
        </p>
      </div>
    </div>
  );
}

/**
 * MFA Setup Flow component.
 * Handles the complete MFA setup process:
 * 1. Fetches the TOTP secret and otpauth URI from the backend
 * 2. Displays the secret for manual entry
 * 3. Accepts a 6-digit verification code
 * 4. Verifies the code and completes login
 *
 * Requirements: 1.4
 */
function MFASetupFlow({ userId, user, accessToken }: { userId: string; user: AuthUser; accessToken: string }) {
  const { completeLogin } = useAuth();

  const [step, setStep] = useState<'loading' | 'display' | 'verifying'>('loading');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);

  // Fetch MFA setup data on mount
  useEffect(() => {
    let cancelled = false;

    async function fetchSetup() {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/mfa/setup`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          if (!cancelled) {
            setSetupError(data.error || 'Failed to initialize MFA setup');
            setStep('display');
          }
          return;
        }

        const data = await response.json();
        if (!cancelled) {
          setOtpauthUri(data.otpauthUri || '');
          setSecret(data.secret || '');
          setStep('display');
        }
      } catch {
        if (!cancelled) {
          setSetupError('Network error. Please try again.');
          setStep('display');
        }
      }
    }

    fetchSetup();
    return () => { cancelled = true; };
  }, [accessToken]);

  const handleVerify = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (code.length !== 6 || !/^\d{6}$/.test(code)) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setStep('verifying');

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/mfa/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ userId, code }),
      });

      const data = await response.json();

      if (!response.ok || !data.verified) {
        setError(data.error || 'Invalid verification code. Please try again.');
        setStep('display');
        return;
      }

      // MFA setup complete — finalize login
      completeLogin(user, accessToken);
      redirectByRole(user.role);
    } catch {
      setError('Network error. Please try again.');
      setStep('display');
    }
  }, [code, userId, accessToken, user, completeLogin]);

  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8 text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Setting Up MFA</h2>
          <div className="flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" role="status" aria-label="Loading"></div>
          </div>
          <p className="text-gray-600 mt-4">Generating your authentication secret...</p>
        </div>
      </div>
    );
  }

  if (setupError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8 text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-4">MFA Setup Error</h2>
          <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
            {setupError}
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8">
        <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
          Set Up Multi-Factor Authentication
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          Scan the QR code or enter the secret manually in your authenticator app.
        </p>

        {/* QR Code display using otpauth URI */}
        {otpauthUri && (
          <div className="flex justify-center mb-4">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUri)}`}
              alt="MFA QR Code"
              className="w-48 h-48 border border-gray-200 rounded-lg"
            />
          </div>
        )}

        {/* Manual secret entry */}
        {secret && (
          <div className="mb-6">
            <label className="block text-xs font-medium text-gray-500 mb-1 text-center">
              Manual entry secret
            </label>
            <div className="bg-gray-100 rounded-lg p-3 text-center">
              <code className="text-sm font-mono text-gray-800 break-all select-all">
                {secret}
              </code>
            </div>
          </div>
        )}

        {/* Verification form */}
        <form onSubmit={handleVerify} noValidate>
          <div className="mb-4">
            <label
              htmlFor="mfa-code"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Verification Code
            </label>
            <input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              pattern="\d{6}"
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              disabled={step === 'verifying'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60 text-center text-lg tracking-widest font-mono"
              placeholder="000000"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={step === 'verifying' || code.length !== 6}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {step === 'verifying' ? 'Verifying...' : 'Verify & Complete Setup'}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Login page with email/password form.
 * On success, redirects based on user role.
 * Handles MFA required / MFA setup states.
 *
 * Requirements: 1.1, 1.2
 */
export function LoginPage() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mfaState, setMfaState] = useState<
    | { type: 'none' }
    | { type: 'mfaRequired'; userId: string }
    | { type: 'mfaSetupRequired'; userId: string; user: AuthUser; accessToken: string }
  >({ type: 'none' });

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setIsSubmitting(true);

      try {
        const result: LoginResult = await login(email, password);

        if ('success' in result && result.success === true) {
          redirectByRole(result.user.role);
          return;
        }

        if ('mfaRequired' in result && result.mfaRequired) {
          setMfaState({ type: 'mfaRequired', userId: result.userId });
          return;
        }

        if ('mfaSetupRequired' in result && result.mfaSetupRequired) {
          setMfaState({ type: 'mfaSetupRequired', userId: result.userId, user: result.user, accessToken: result.accessToken });
          return;
        }

        if ('success' in result && result.success === false) {
          setError(result.error);
        }
      } catch {
        setError('An unexpected error occurred. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [email, password, login]
  );

  // MFA required state — show TOTP verification input
  // Requirements: 1.3
  if (mfaState.type === 'mfaRequired') {
    return (
      <MFAVerificationFlow
        userId={mfaState.userId}
      />
    );
  }

  // MFA setup required state (placeholder for task 2.3)
  if (mfaState.type === 'mfaSetupRequired') {
    return (
      <MFASetupFlow
        userId={mfaState.userId}
        user={mfaState.user}
        accessToken={mfaState.accessToken}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-md p-8">
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-6">
          Sign In to MeshSOS
        </h1>

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-4">
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
              placeholder="you@example.com"
            />
          </div>

          <div className="mb-6">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
              placeholder="Enter your password"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500">
          <a
            href="#/"
            className="text-blue-600 hover:text-blue-700 font-medium"
          >
            Back to home
          </a>
        </p>
      </div>
    </div>
  );
}
