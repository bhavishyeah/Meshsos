import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyLanguageFromProfile } from './i18n';
import { CommandCenter } from './features/command-center';
import { HomeScreen } from './features/home';
import { QueueListView } from './features/queue/QueueListView';
import { SOSTimelineView } from './features/history/SOSTimelineView';
import { LoginPage } from './features/auth/LoginPage';
import { AdminPanel } from './features/admin/AdminPanel';
import { ResponderView } from './features/responder/ResponderView';
import { ProfileScreen } from './features/profile/ProfileScreen';
import { ProtectedRoute } from './components/ProtectedRoute';
import { BottomNav } from './components/BottomNav';
import { connectivityManager } from './bootstrap';
import type { ConnectivityState } from '@meshsos/shared';

/**
 * Simple hash-router for MeshSOS.
 *
 * Routes:
 *   #/               - Survivor home (emergency buttons) [public]
 *   #/queue          - SOS queue (local records) [public]
 *   #/login          - Login page [public]
 *   #/admin          - Admin panel [requires: administrator]
 *   #/admin/:tab     - Admin panel sub-pages [requires: administrator]
 *   #/command-center - Dispatcher/supervisor live view [requires: dispatcher, supervisor, administrator]
 *   #/responder      - Responder mobile view [requires: responder]
 *   #/profile        - User profile [requires: any authenticated]
 */
function useHashRoute(): string {
  const [route, setRoute] = useState(window.location.hash.slice(1) || '/');
  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return route;
}

/**
 * Hook to reactively track connectivity status from the connectivityManager.
 */
function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(
    () => connectivityManager.getState().status !== 'offline'
  );
  useEffect(() => {
    const unsubscribe = connectivityManager.subscribe((state: ConnectivityState) => {
      setIsOnline(state.status !== 'offline');
    });
    return unsubscribe;
  }, []);
  return isOnline;
}

export function App() {
  const { t } = useTranslation();
  const route = useHashRoute();
  const isOnline = useIsOnline();

  useEffect(() => {
    applyLanguageFromProfile();
  }, []);

  // --- Login (public) ---
  if (route === '/login') {
    return <LoginPage />;
  }

  // --- Admin Panel (requires administrator) ---
  if (route === '/admin' || route.startsWith('/admin/')) {
    return (
      <ProtectedRoute allowedRoles={['administrator']}>
        <AdminPanel />
      </ProtectedRoute>
    );
  }

  // --- Command Center (requires dispatcher, supervisor, administrator) ---
  if (route === '/command-center') {
    return (
      <ProtectedRoute allowedRoles={['dispatcher', 'supervisor', 'administrator']}>
        <CommandCenter />
      </ProtectedRoute>
    );
  }

  // --- Responder View (requires responder) ---
  if (route === '/responder') {
    return (
      <ProtectedRoute allowedRoles={['responder']}>
        <ResponderView />
      </ProtectedRoute>
    );
  }

  // --- Profile (requires any authenticated user) ---
  if (route === '/profile') {
    return (
      <ProtectedRoute allowedRoles={['administrator', 'dispatcher', 'supervisor', 'responder', 'auditor']}>
        <div className="flex flex-col h-screen">
          <ProfileScreen />
          <BottomNav currentRoute={route} />
        </div>
      </ProtectedRoute>
    );
  }

  // --- SOS Queue (public) ---
  if (route === '/queue' || route.startsWith('/queue/')) {
    // Check if we're at #/queue/:id (detail view)
    const queueIdMatch = route.match(/^\/queue\/(.+)$/);

    if (queueIdMatch) {
      const sosId = queueIdMatch[1];
      return (
        <div className="flex flex-col h-screen">
          <div className="flex items-center p-4 border-b border-gray-200">
            <button
              type="button"
              onClick={() => { window.location.hash = '#/queue'; }}
              className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded min-h-[48px] min-w-[48px]"
              aria-label="Back to queue"
            >
              <span aria-hidden="true">&larr;</span>
              <span>Back</span>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SOSTimelineView
              sosId={sosId}
              isOnline={isOnline}
            />
          </div>
          <BottomNav currentRoute={route} />
        </div>
      );
    }

    return (
      <div className="flex flex-col h-screen">
        <QueueListView
          onSelectRecord={(id) => {
            window.location.hash = `#/queue/${id}`;
          }}
        />
        <BottomNav currentRoute={route} />
      </div>
    );
  }

  // --- Default: Survivor Home (public) ---
  return (
    <div className="flex flex-col h-screen">
      <HomeScreen
        onSOSCreated={(sosId) => {
          // Navigate to queue after SOS creation
          window.location.hash = '#/queue';
        }}
      />
      <BottomNav currentRoute={route} />
    </div>
  );
}

