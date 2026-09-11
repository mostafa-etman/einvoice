import type { NavIcon } from './nav-config';

export function NavGlyph({ name }: { name: NavIcon }) {
  const common = {
    viewBox: '0 0 24 24',
    className: 'size-[var(--size-nav-icon)] shrink-0',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true as const,
  };
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
        </svg>
      );
    case 'documents':
      return (
        <svg {...common}>
          <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M14 3v5h5M9 13h6M9 17h6" />
        </svg>
      );
    case 'customers':
      return (
        <svg {...common}>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case 'sync':
      return (
        <svg {...common}>
          <path d="M21 12a9 9 0 0 1-15.5 6.4M3 12a9 9 0 0 1 15.5-6.4" />
          <path d="M21 4v5h-5M3 20v-5h5" />
        </svg>
      );
    case 'analytics':
      return (
        <svg {...common}>
          <path d="M4 19V5M4 19h16" />
          <path d="M8 16v-5M12 16V8M16 16v-8" />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <path d="M4 4h16v16H4z" />
          <path d="M8 14v2M12 10v6M16 7v9" />
        </svg>
      );
    case 'backup':
      return (
        <svg {...common}>
          <path d="M12 3v10M8 9l4 4 4-4" />
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        </svg>
      );
    case 'billing':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M3 10h18M7 14h4" />
        </svg>
      );
    case 'purchases':
      return (
        <svg {...common}>
          <path d="M6 6h15l-1.5 9H8L6 6z" />
          <path d="M6 6 5 3H2M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" />
        </svg>
      );
    case 'imports':
      return (
        <svg {...common}>
          <path d="M12 3v12M8 11l4 4 4-4" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'exports':
      return (
        <svg {...common}>
          <path d="M12 15V3M8 7l4-4 4 4" />
          <path d="M4 19h16" />
        </svg>
      );
    case 'devices':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="12" rx="1.5" />
          <path d="M9 20h6M12 16v4" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" />
          <circle cx="17" cy="9" r="2.5" />
          <path d="M21 19c0-2.2-1.5-3.8-3.5-4.4" />
        </svg>
      );
    case 'roles':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" />
          <path d="M16 4.5 19 6l-3 1.5" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" />
        </svg>
      );
    default:
      return null;
  }
}
