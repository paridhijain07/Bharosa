import React from 'react';
import { I18N } from '../lib/i18n.js';

/**
 * StatusChip: Consistent status pill for OPEN / PAID / ALERTED / KHATA / PARTIAL / REFUNDED / CANCELLED
 * Conveys every state by colour + icon + text in Hindi and English.
 */
export default function StatusChip({ status = 'OPEN', lang = 'hi' }) {
  const dict = I18N[lang]?.status || I18N.hi.status;
  const entry = dict[status] || dict.OPEN;

  return (
    <span className={`status-chip status-chip-${entry.token}`}>
      <span className="status-chip-icon" aria-hidden="true">
        {entry.icon}
      </span>
      <span className="status-chip-label">{entry.label}</span>
    </span>
  );
}

