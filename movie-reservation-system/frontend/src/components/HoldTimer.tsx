import React, { useEffect, useState } from 'react';

interface HoldTimerProps {
  expiresAt: string;
  onExpire: () => void;
}

export function HoldTimer({ expiresAt, onExpire }: HoldTimerProps): React.JSX.Element {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
    return diff;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(diff);
      if (diff <= 0) {
        clearInterval(interval);
        onExpire();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const timeDisplay = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

  const isLow = secondsRemaining < 120; // under 2 minutes

  return (
    <div
      className="hold-timer"
      role="timer"
      aria-live="polite"
      style={isLow ? { borderColor: 'rgba(255, 102, 125, 0.5)', background: 'rgba(255, 102, 125, 0.1)' } : undefined}
    >
      <span aria-hidden="true" style={{ fontSize: '18px' }}>⏱</span>
      <div>
        Seats held for you
        <br />
        <span className="faint">
          {isLow ? 'Hurry! Releasing soon' : "Released automatically if you don't pay"}
        </span>
      </div>
      <b style={isLow ? { color: 'var(--rose)' } : undefined}>{timeDisplay}</b>
    </div>
  );
}
