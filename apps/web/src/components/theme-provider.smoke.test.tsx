import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { renderUi } from '@/components/ui/_test-utils';
import { THEME_STORAGE_KEY } from '@/lib/theme';

function Toggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button aria-pressed={theme === 'dark'} onClick={toggleTheme}>
      {theme}
    </Button>
  );
}

describe('ThemeProvider', () => {
  it('persists dark theme via data-theme', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderUi(<Toggle />);
    await waitFor(() => expect(screen.getByRole('button')).toHaveTextContent('light'));
    fireEvent.click(screen.getByRole('button'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('renders primitives under the dark palette', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    renderUi(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
