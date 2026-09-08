-- Customer catalog: the 7-day TRIAL plan is a public self-serve card.
-- Selecting it auto-activates; paid packages stay WhatsApp / manual.
-- Existing tenants and subscriptions are not modified.
UPDATE plans
SET is_public = true,
    self_serve = true,
    updated_at = now()
WHERE code = 'TRIAL'
  AND is_trial = true;
