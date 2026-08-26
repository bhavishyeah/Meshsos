import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { authFetch } from '../../services/api';
import { API_BASE_URL } from '../../config/env';
import { StationManagement } from './StationManagement';
import { DisasterManagement } from './DisasterManagement';
import { AuditTrailView } from './AuditTrailView';
import { SystemHealthPanel } from './SystemHealthPanel';
import { MetricsDashboard, type MetricsData } from './MetricsDashboard';
import { UserManagement } from './UserManagement';

import { ResponderManagement } from './ResponderManagement';
import { RegionManagement } from './RegionManagement';



// ─── Default metrics (fallback when API hasn't loaded yet) ───────────────────

const DEFAULT_METRICS: MetricsData = {
  totalSOS: 0,
  avgAcknowledgementTimeSec: 0,
  avgDispatchTimeSec: 0,
  avgTravelTimeSec: 0,
  avgResolutionTimeSec: 0,
  avgDeliveryTimeSec: 0,
  resolutionRate: 0,
  activeResponders: 0,
  byEmergencyType: [],
};

/**
 * Authenticated fetch wrapper for StationManagement.
 * Uses authFetch with full API_BASE_URL so auth headers are attached.
 */
async function stationAuthFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? `${API_BASE_URL}${input}` : input;
  return authFetch(url as string, init);
}

// ─── Navigation items ────────────────────────────────────────────────────────

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    id: 'regions',
    label: 'Regions',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
      </svg>
    ),
  },
  {
    id: 'stations',
    label: 'Stations',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
    ),
  },
  {
    id: 'responders',
    label: 'Responders',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
  },
  {
    id: 'users',
    label: 'Users',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
  {
    id: 'disasters',
    label: 'Disasters',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    ),
  },
  {
    id: 'audit',
    label: 'Audit',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    id: 'health',
    label: 'Health',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
];

// ─── Helper: extract active tab from hash ────────────────────────────────────

function getActiveTab(): string {
  const hash = window.location.hash;
  // Expected format: #/admin/tabName
  const match = hash.match(/^#\/admin\/(\w+)/);
  return match ? match[1] : 'dashboard';
}

// ─── AdminPanel Component ────────────────────────────────────────────────────

export function AdminPanel() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState(getActiveTab);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [metrics, setMetrics] = useState<MetricsData>(DEFAULT_METRICS);
  const [metricsTimeRange, setMetricsTimeRange] = useState<string>('24h');

  // Fetch metrics from API
  const fetchMetrics = useCallback(async (range: string) => {
    try {
      const response = await authFetch(`${API_BASE_URL}/api/metrics?range=${range}`);
      if (response.ok) {
        const data = await response.json();
        setMetrics({
          totalSOS: data.totalSOS ?? data.totalIncidents ?? 0,
          avgAcknowledgementTimeSec: data.avgAcknowledgementTimeSec ?? data.avgResponseTime ?? 0,
          avgDispatchTimeSec: data.avgDispatchTimeSec ?? 0,
          avgTravelTimeSec: data.avgTravelTimeSec ?? 0,
          avgResolutionTimeSec: data.avgResolutionTimeSec ?? 0,
          avgDeliveryTimeSec: data.avgDeliveryTimeSec ?? 0,
          resolutionRate: data.resolutionRate ?? 0,
          activeResponders: data.activeResponders ?? 0,
          byEmergencyType: data.byEmergencyType ?? [],
        });
      }
    } catch {
      // Keep default metrics on error
    }
  }, []);

  useEffect(() => {
    fetchMetrics(metricsTimeRange);
  }, [fetchMetrics, metricsTimeRange]);

  // Listen for hash changes to update active tab
  useEffect(() => {
    const onHashChange = () => {
      setActiveTab(getActiveTab());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Set default hash if at bare #/admin
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#/admin' || hash === '#/admin/') {
      window.location.hash = '#/admin/dashboard';
    }
  }, []);

  const navigateTo = useCallback((tabId: string) => {
    window.location.hash = `#/admin/${tabId}`;
    setSidebarOpen(false);
  }, []);

  const handleLogout = useCallback(async () => {
    await logout();
  }, [logout]);

  const handleBackToHome = useCallback(() => {
    window.location.hash = '#/';
  }, []);

  // ─── Render sub-component based on active tab ──────────────────────────────

  function renderContent() {
    switch (activeTab) {
      case 'dashboard':
        return (
          <MetricsDashboard
            metrics={metrics}
            onTimeRangeChange={(range) => setMetricsTimeRange(range)}
          />
        );
      case 'regions':
        return <RegionManagement />;
      case 'stations':
        return <StationManagement apiBaseUrl="/api" fetchFn={stationAuthFetch} />;
      case 'responders':
        return <ResponderManagement />;
      case 'users':
        return <UserManagement />;
      case 'disasters':
        return <DisasterManagement />;
      case 'audit':
        return <AuditTrailView />;
      case 'health':
        return <SystemHealthPanel />;
      default:
        return (
          <MetricsDashboard
            metrics={metrics}
            onTimeRangeChange={(range) => setMetricsTimeRange(range)}
          />
        );
    }
  }

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out
          lg:translate-x-0 lg:static lg:z-auto
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        aria-label="Admin navigation"
      >
        <div className="flex flex-col h-full">
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200">
            <h1 className="text-lg font-bold text-gray-900">MeshSOS Admin</h1>
            <button
              className="lg:hidden p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-100"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close sidebar"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Navigation links */}
          <nav className="flex-1 px-3 py-4 overflow-y-auto" aria-label="Admin sidebar">
            <ul className="space-y-1" role="list">
              {NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <button
                    onClick={() => navigateTo(item.id)}
                    className={`
                      w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors
                      ${
                        activeTab === item.id
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                      }
                    `}
                    aria-current={activeTab === item.id ? 'page' : undefined}
                  >
                    {item.icon}
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Sidebar footer: user info + actions */}
          <div className="border-t border-gray-200 px-4 py-3">
            {user && (
              <div className="mb-3">
                <p className="text-sm font-medium text-gray-900 truncate">{user.name}</p>
                <p className="text-xs text-gray-500 truncate">{user.email}</p>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button
                onClick={handleBackToHome}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-100 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Home
              </button>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 rounded-md hover:bg-red-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar (mobile) */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100"
            aria-label="Open sidebar menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold text-gray-900">
            {NAV_ITEMS.find((item) => item.id === activeTab)?.label ?? 'Admin'}
          </h2>
          <div className="w-10" /> {/* Spacer for centering */}
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
