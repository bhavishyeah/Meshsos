import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyLanguageFromProfile } from './i18n';
import { CommandCenter } from './features/command-center';
import { HomeScreen } from './features/home';
import { QueueListView } from './features/queue/QueueListView';

/**
 * Simple hash-router for MeshSOS.
 *
 * Routes:
 *   #/               - Survivor home (emergency buttons)
 *   #/queue          - SOS queue (local records)
 *   #/command-center - Dispatcher/supervisor live view
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

export function App() {
  const { t } = useTranslation();
  const route = useHashRoute();

  useEffect(() => {
    applyLanguageFromProfile();
  }, []);

  // --- Command Center (dispatcher/supervisor) ---
  if (route === '/command-center') {
    return <CommandCenter />;
  }

  // --- SOS Queue ---
  if (route === '/queue') {
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

  // --- Default: Survivor Home (emergency buttons) ---
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

/**
 * Bottom navigation for survivor-facing pages.
 */
function BottomNav({ currentRoute }: { currentRoute: string }) {
  return (
    <nav
      className="flex items-center justify-around border-t border-gray-200 bg-white py-2 px-4 shrink-0"
      aria-label="Main navigation"
    >
      <a
        href="#/"
        className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[48px] min-w-[48px] justify-center ${
          currentRoute === '/' ? 'text-red-600 bg-red-50' : 'text-gray-600 hover:text-gray-900'
        }`}
        aria-current={currentRoute === '/' ? 'page' : undefined}
      >
        <span className="text-xl" aria-hidden="true">🆘</span>
        <span>SOS</span>
      </a>
      <a
        href="#/queue"
        className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[48px] min-w-[48px] justify-center ${
          currentRoute === '/queue' ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:text-gray-900'
        }`}
        aria-current={currentRoute === '/queue' ? 'page' : undefined}
      >
        <span className="text-xl" aria-hidden="true">📋</span>
        <span>Queue</span>
      </a>
      <a
        href="#/command-center"
        className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[48px] min-w-[48px] justify-center ${
          currentRoute === '/command-center' ? 'text-green-600 bg-green-50' : 'text-gray-600 hover:text-gray-900'
        }`}
        aria-current={currentRoute === '/command-center' ? 'page' : undefined}
      >
        <span className="text-xl" aria-hidden="true">🖥️</span>
        <span>Command</span>
      </a>
    </nav>
  );
}