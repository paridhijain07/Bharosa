import React from 'react';
import { ShieldCheck } from 'lucide-react';

/**
 * RecoveredCard (Part B1):
 * Shows the money recovered by Bharosa's unpaid-tab alert & khata reminder system:
 * "Recovered this week: ₹X from N alerted orders"
 * Displays a visible "Demo data" badge when any underlying order is seeded or simulated.
 */
export default function RecoveredCard({
  recovered,
  currencySymbol = '₹',
  lang = 'hi',
}) {
  if (!recovered) return null;

  const amount = recovered.recoveredAmount ?? 0;
  const count = recovered.recoveredCount ?? 0;
  const isDemo = Boolean(recovered.isDemoData);

  return (
    <section
      className="recovered-card"
      aria-label={lang === 'hi' ? 'भरोसा द्वारा वसूली गई रकम' : 'Recovered by Bharosa'}
    >
      <div className="recovered-icon-wrap" aria-hidden="true">
        <ShieldCheck size={28} strokeWidth={2.4} />
      </div>

      <div className="recovered-body">
        <div className="recovered-top-row">
          <span className="recovered-eyebrow">
            {lang === 'hi' ? 'भरोसा अलर्ट से वसूली' : 'Recovered by Bharosa'}
          </span>
          {isDemo && (
            <span className="demo-data-badge demo-badge-inline">
              {lang === 'hi' ? 'डेमो डेटा' : 'Demo data'}
            </span>
          )}
        </div>

        <div className="recovered-headline">
          {lang === 'hi' ? (
            <>
              इस हफ़्ते बचाए:{' '}
              <strong className="recovered-amount">
                {currencySymbol}
                {amount}
              </strong>{' '}
              <span className="recovered-sub">({count} अलर्ट ऑर्डर से)</span>
            </>
          ) : (
            <>
              Recovered this week:{' '}
              <strong className="recovered-amount">
                {currencySymbol}
                {amount}
              </strong>{' '}
              <span className="recovered-sub">
                from {count} alerted {count === 1 ? 'order' : 'orders'}
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

