import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import { AuthProvider } from './context/AuthContext.tsx';
import { SurvivorWebSocketProvider } from './context/SurvivorWebSocketContext.tsx';
import { registerSW } from 'virtual:pwa-register';
import './i18n';
import './index.css';
import { bootstrap } from './bootstrap/index.ts';

// Register PWA service worker with prompt-based update strategy
const updateSW = registerSW({
  onNeedRefresh() {
    // Could show an update prompt to the user
    console.log('New content available, refresh to update.');
  },
  onOfflineReady() {
    console.log('App ready for offline use.');
  },
});

// Start background services (connectivity monitoring + SOS sync engine)
bootstrap();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <SurvivorWebSocketProvider>
        <App />
      </SurvivorWebSocketProvider>
    </AuthProvider>
  </React.StrictMode>,
);