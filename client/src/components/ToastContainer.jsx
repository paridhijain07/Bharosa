import React from 'react';
import { CheckCircle2, AlertTriangle, Info, RotateCcw, X } from 'lucide-react';

/**
 * ToastContainer (Part A5 & A4):
 * Stacked top toasts for live stall events ("Order 12 paid", "Cash recorded",
 * "Reminder sent to Raju", "Order cancelled" with 5s Undo button).
 * Auto-dismisses, readable at a glance in bright sunlight.
 */
export default function ToastContainer({ toasts = [], onDismiss, onUndo, lang = 'hi' }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((toast) => {
        const tone = toast.tone || 'paid';
        const Icon =
          tone === 'alert'
            ? AlertTriangle
            : tone === 'khata' || tone === 'info'
              ? Info
              : CheckCircle2;

        return (
          <div key={toast.id} className={`toast-item toast-${tone}`}>
            <span className="toast-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={2.5} />
            </span>

            <span className="toast-message">{toast.message}</span>

            {toast.onUndo && (
              <button
                type="button"
                className="toast-undo-btn"
                onClick={() => onUndo?.(toast)}
              >
                <RotateCcw size={15} />
                <span>{lang === 'hi' ? 'वापस लें (Undo)' : 'Undo'}</span>
              </button>
            )}

            <button
              type="button"
              className="toast-close-btn"
              onClick={() => onDismiss?.(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

