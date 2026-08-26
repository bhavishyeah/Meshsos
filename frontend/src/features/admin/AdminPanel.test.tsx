import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdminPanel } from './AdminPanel';

// Mock AuthContext
const mockLogout = vi.fn();
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: '1', name: 'Admin User', email: 'admin@meshsos.com', role: 'administrator' },
    accessToken: 'test-token',
    isAuthenticated: true,
    isLoading: false,
    login: vi.fn(),
    logout: mockLogout,
    refreshToken: vi.fn(),
    completeLogin: vi.fn(),
  }),
}));

// Mock authFetch to prevent real API calls
vi.mock('../../services/api', () => ({
  authFetch: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  }),
  getAuthHeaders: vi.fn().mockReturnValue({ Authorization: 'Bearer test-token' }),
}));

// Mock sub-components to keep tests focused on layout/navigation
vi.mock('./MetricsDashboard', () => ({
  MetricsDashboard: () => <div data-testid="metrics-dashboard">MetricsDashboard</div>,
}));
vi.mock('./StationManagement', () => ({
  StationManagement: () => <div data-testid="station-management">StationManagement</div>,
}));
vi.mock('./DisasterManagement', () => ({
  DisasterManagement: () => <div data-testid="disaster-management">DisasterManagement</div>,
}));
vi.mock('./AuditTrailView', () => ({
  AuditTrailView: () => <div data-testid="audit-trail-view">AuditTrailView</div>,
}));
vi.mock('./SystemHealthPanel', () => ({
  SystemHealthPanel: () => <div data-testid="system-health-panel">SystemHealthPanel</div>,
}));

describe('AdminPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = '#/admin/dashboard';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('renders sidebar with all navigation links', () => {
    render(<AdminPanel />);

    const sidebar = screen.getByRole('navigation', { name: /admin sidebar/i });
    expect(sidebar).toBeInTheDocument();

    // All nav items are rendered as buttons within the sidebar
    const buttons = sidebar.querySelectorAll('button');
    const buttonLabels = Array.from(buttons).map((b) => b.textContent?.trim());
    expect(buttonLabels).toContain('Dashboard');
    expect(buttonLabels).toContain('Regions');
    expect(buttonLabels).toContain('Stations');
    expect(buttonLabels).toContain('Responders');
    expect(buttonLabels).toContain('Users');
    expect(buttonLabels).toContain('Disasters');
    expect(buttonLabels).toContain('Audit');
    expect(buttonLabels).toContain('Health');
  });

  it('renders the MetricsDashboard as default content', () => {
    render(<AdminPanel />);

    expect(screen.getByTestId('metrics-dashboard')).toBeInTheDocument();
  });

  it('renders the correct sub-component when hash changes to stations', () => {
    window.location.hash = '#/admin/stations';
    render(<AdminPanel />);

    expect(screen.getByTestId('station-management')).toBeInTheDocument();
  });

  it('renders the correct sub-component when hash changes to disasters', () => {
    window.location.hash = '#/admin/disasters';
    render(<AdminPanel />);

    expect(screen.getByTestId('disaster-management')).toBeInTheDocument();
  });

  it('renders the correct sub-component when hash changes to audit', () => {
    window.location.hash = '#/admin/audit';
    render(<AdminPanel />);

    expect(screen.getByTestId('audit-trail-view')).toBeInTheDocument();
  });

  it('renders the correct sub-component when hash changes to health', () => {
    window.location.hash = '#/admin/health';
    render(<AdminPanel />);

    expect(screen.getByTestId('system-health-panel')).toBeInTheDocument();
  });

  it('navigates to a tab when sidebar link is clicked', () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByText('Stations'));

    expect(window.location.hash).toBe('#/admin/stations');
  });

  it('displays user name and email in the sidebar footer', () => {
    render(<AdminPanel />);

    expect(screen.getByText('Admin User')).toBeInTheDocument();
    expect(screen.getByText('admin@meshsos.com')).toBeInTheDocument();
  });

  it('calls logout when logout button is clicked', () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByText('Logout'));

    expect(mockLogout).toHaveBeenCalled();
  });

  it('navigates back to home when Back to Home is clicked', () => {
    render(<AdminPanel />);

    fireEvent.click(screen.getByText('Back to Home'));

    expect(window.location.hash).toBe('#/');
  });

  it('has a hamburger menu button for mobile', () => {
    render(<AdminPanel />);

    const menuButton = screen.getByLabelText('Open sidebar menu');
    expect(menuButton).toBeInTheDocument();
  });

  it('marks the active nav item with aria-current=page', () => {
    window.location.hash = '#/admin/stations';
    render(<AdminPanel />);

    const sidebar = screen.getByRole('navigation', { name: /admin sidebar/i });
    const stationsBtn = sidebar.querySelector('button[aria-current="page"]');
    expect(stationsBtn).not.toBeNull();
    expect(stationsBtn?.textContent?.trim()).toBe('Stations');
  });

  it('renders placeholder for Regions tab', () => {
    window.location.hash = '#/admin/regions';
    render(<AdminPanel />);

    expect(screen.getByText('Region Management')).toBeInTheDocument();
  });

  it('renders placeholder for Users tab', () => {
    window.location.hash = '#/admin/users';
    render(<AdminPanel />);

    expect(screen.getByText('User Management')).toBeInTheDocument();
  });

  it('renders placeholder for Responders tab', () => {
    window.location.hash = '#/admin/responders';
    render(<AdminPanel />);

    expect(screen.getByText('Responder Management')).toBeInTheDocument();
  });

  it('defaults to dashboard when hash is bare #/admin', () => {
    window.location.hash = '#/admin';
    render(<AdminPanel />);

    // Should redirect to #/admin/dashboard
    expect(window.location.hash).toBe('#/admin/dashboard');
  });
});
