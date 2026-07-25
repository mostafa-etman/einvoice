/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        brand: {
          DEFAULT: 'var(--color-brand)',
          muted: 'var(--color-brand-muted)',
        },
        surface: 'var(--color-surface)',
        border: 'var(--color-border)',
      },
      spacing: {
        'token-xs': 'var(--space-xs)',
        'token-sm': 'var(--space-sm)',
        'token-md': 'var(--space-md)',
        'token-lg': 'var(--space-lg)',
        'token-xl': 'var(--space-xl)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      fontSize: {
        'token-sm': 'var(--font-size-sm)',
        'token-md': 'var(--font-size-md)',
        'token-lg': 'var(--font-size-lg)',
        'token-xl': 'var(--font-size-xl)',
      },
    },
  },
  plugins: [],
};
