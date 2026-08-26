import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyLanguageFromProfile } from './i18n';
import { CommandCenter } from './features/command-center';

/**
 * Simple hash-router: renders CommandCenter on #/command-center,
 * default home on #/ or empty hash.
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

  if (route === '/command-center') {
    return <CommandCenter />;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-bold text-emergency-police">
        {t('app.title')}
      </h1>
      <nav className="flex flex-col gap-3">
        <a
          href="#/command-center"
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium text-center hover:bg-blue-700 transition-colors"
        >
          Command Center (Live)
        </a>
      </nav>
    </main>
  );
}