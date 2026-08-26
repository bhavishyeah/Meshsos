import { useAuth } from '../context/AuthContext';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  activeColor: string;
  activeBg: string;
}

const NAV_ITEMS: Record<string, NavItem> = {
  sos: { href: '#/', label: 'SOS', icon: '🆘', activeColor: 'text-red-600', activeBg: 'bg-red-50' },
  queue: { href: '#/queue', label: 'Queue', icon: '📋', activeColor: 'text-blue-600', activeBg: 'bg-blue-50' },
  login: { href: '#/login', label: 'Login', icon: '🔑', activeColor: 'text-purple-600', activeBg: 'bg-purple-50' },
  profile: { href: '#/profile', label: 'Profile', icon: '👤', activeColor: 'text-indigo-600', activeBg: 'bg-indigo-50' },
  command: { href: '#/command-center', label: 'Command', icon: '🖥️', activeColor: 'text-green-600', activeBg: 'bg-green-50' },
  admin: { href: '#/admin', label: 'Admin', icon: '⚙️', activeColor: 'text-amber-600', activeBg: 'bg-amber-50' },
  responder: { href: '#/responder', label: 'Responder', icon: '🚑', activeColor: 'text-teal-600', activeBg: 'bg-teal-50' },
};

/**
 * Returns the nav items to show based on authentication state and user role.
 *
 * - Unauthenticated: SOS, Queue, Login
 * - Authenticated survivor (default role): SOS, Queue, Profile
 * - Authenticated dispatcher/admin/supervisor: Command, Admin, Profile
 * - Authenticated responder: Responder, Profile
 *
 * Requirements: 9.4
 */
function getNavItems(isAuthenticated: boolean, role: string | undefined): NavItem[] {
  if (!isAuthenticated) {
    return [NAV_ITEMS.sos, NAV_ITEMS.queue, NAV_ITEMS.login];
  }

  switch (role) {
    case 'dispatcher':
    case 'supervisor':
    case 'administrator':
      return [NAV_ITEMS.command, NAV_ITEMS.admin, NAV_ITEMS.profile];
    case 'responder':
      return [NAV_ITEMS.responder, NAV_ITEMS.profile];
    default:
      // Survivor or any other role
      return [NAV_ITEMS.sos, NAV_ITEMS.queue, NAV_ITEMS.profile];
  }
}

/**
 * Determines if a nav item is active based on the current route.
 */
function isActive(itemHref: string, currentRoute: string): boolean {
  const itemRoute = itemHref.replace('#', '');
  if (itemRoute === '/') {
    return currentRoute === '/';
  }
  return currentRoute.startsWith(itemRoute);
}

/**
 * Bottom navigation bar that adapts based on authentication state and user role.
 *
 * Requirements: 9.4
 */
export function BottomNav({ currentRoute }: { currentRoute: string }) {
  const { isAuthenticated, user } = useAuth();
  const items = getNavItems(isAuthenticated, user?.role);

  return (
    <nav
      className="flex items-center justify-around border-t border-gray-200 bg-white py-2 px-4 shrink-0"
      aria-label="Main navigation"
    >
      {items.map((item) => {
        const active = isActive(item.href, currentRoute);
        return (
          <a
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors min-h-[48px] min-w-[48px] justify-center ${
              active ? `${item.activeColor} ${item.activeBg}` : 'text-gray-600 hover:text-gray-900'
            }`}
            aria-current={active ? 'page' : undefined}
          >
            <span className="text-xl" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
