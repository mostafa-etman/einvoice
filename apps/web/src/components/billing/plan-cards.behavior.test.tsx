import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import type { PlanView } from '@/lib/api/billing';
import { PlanCards } from './plan-cards';

const starter: PlanView = {
  code: 'STARTER',
  name: 'Starter',
  nameAr: 'ستارتر',
  descriptionEn: null,
  descriptionAr: null,
  documentQuota: 10,
  branchQuota: 2,
  deviceQuota: 1,
  selfServe: true,
  includedPoints: 10,
  officialPriceEgp: 12000,
  discountedPriceEgp: 9000,
  savingsPercent: 25,
  maxUsers: 3,
  maxCompanies: 1,
  docCapacity: 100,
  isTrial: false,
  isPublic: true,
  currency: 'EGP',
  billingPeriod: 'annual',
  priceDisplay: null,
};

function renderCards(locale: 'en' | 'ar' = 'en', onChoose = jest.fn()) {
  return {
    onChoose,
    ...render(
      <NextIntlClientProvider locale={locale} messages={locale === 'ar' ? ar : en}>
        <PlanCards plans={[starter]} onChoose={onChoose} />
      </NextIntlClientProvider>,
    ),
  };
}

describe('PlanCards', () => {
  it('keeps EGP amounts LTR and uses the existing choose-plan action', () => {
    const { onChoose } = renderCards();
    expect(screen.getByText(/9,000 EGP/)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(/12,000 EGP/)).toHaveAttribute('dir', 'ltr');
    fireEvent.click(screen.getByRole('button', { name: en.billing.choosePlan }));
    expect(onChoose).toHaveBeenCalledWith(starter);
  });

  it('does not force Arabic quota copy into LTR', () => {
    renderCards('ar');
    expect(screen.getByRole('heading', { name: 'ستارتر' })).toBeInTheDocument();
    const users = screen.getByText(ar.billing.cardUsers.replace('{count}', '3'));
    expect(users).not.toHaveAttribute('dir', 'ltr');
  });
});
