import { redirect } from 'next/navigation';
import { defaultLocale } from '@/i18n/config';

/** Fallback if middleware does not run: bare `/` must still enter the app. */
export default function RootPage() {
  redirect(`/${defaultLocale}`);
}
