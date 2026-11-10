import React, { useEffect, useState } from 'react';

/**
 * CountdownRing (Part A1.4):
 * - Open (not yet alerted) tabs show a visible draining ring with seconds left (`18s`, `0s`)
 *   that turns red and pulses at zero.
 * - Alerted tabs (`status === 'ALERTED'`) show the alarm icon (`🚨`) and red pulsing ring.
 * - Survives page refresh by deriving elapsed time from `createdAt`.
 */
export default function CountdownRing({
  createdAt,
  alertSeconds = 30,
  status = 'OPEN',
}) {
  const computeRemaining = () => {
    if (status === 'ALERTED') return 0;
    const createdMs = createdAt ? new Date(createdAt).getTime() : Date.now();
    const elapsedSec = (Date.now() - createdMs) / 1000;
    return Math.max(0, alertSeconds - elapsedSec);
  };

  const [remaining, setRemaining] = useState(computeRemaining);

  useEffect(() => {
    setRemaining(computeRemaining());
    if (status === 'ALERTED') return undefined;

    const timer = setInterval(() => {
      const next = computeRemaining();
      setRemaining(next);
    }, 250);

    return () => clearInterval(timer);
  }, [createdAt, alertSeconds, status]);

  const size = 48;
  const strokeWidth = 5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.min(1, Math.max(0, remaining / Math.max(1, alertSeconds)));
  const dashOffset = circumference * (1 - fraction);
  const isZero = remaining <= 0 || status === 'ALERTED';
  const secondsLeft = Math.max(0, Math.ceil(remaining));

  return (
    <div
      className={`countdown-ring ${isZero ? 'countdown-ring-expired' : ''}`}
      title={isZero ? 'Overdue!' : `${secondsLeft}s remaining`}
      aria-label={
        status === 'ALERTED'
          ? 'Alerting unpaid'
          : `${secondsLeft} seconds left`
      }
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          className="countdown-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          className="countdown-ring-progress"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={isZero ? 0 : dashOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="countdown-ring-text">
        {status === 'ALERTED' ? '🚨' : `${secondsLeft}s`}
      </span>
    </div>
  );
}
