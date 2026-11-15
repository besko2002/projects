import React, { useEffect, useState, useRef } from 'react';

interface HoldTimerProps {
  expiresAt: string;
  onExpire: () => void;
}

export function HoldTimer({ expiresAt, onExpire }: HoldTimerProps): React.JSX.Element {
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  });

  const [announcement, setAnnouncement] = useState<string>('');
  const announcedThresholdsRef = useRef<{ twoMin: boolean; zero: boolean }>({
    twoMin: false,
    zero: false,
  });

  useEffect(() => {
    announcedThresholdsRef.current = { twoMin: false, zero: false };

    const checkAndTick = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsRemaining(diff);

      if (diff <= 120 && diff > 0 && !announcedThresholdsRef.current.twoMin) {
        announcedThresholdsRef.current.twoMin = true;
        setAnnouncement('Two minutes remaining to complete your seat reservation payment.');
      }

      if (diff <= 0) {
        if (!announcedThresholdsRef.current.zero) {
          announcedThresholdsRef.current.zero = true;
          setAnnouncement('Your seat hold has expired and seats have been released.');
        }
        onExpireRef.current();
      }
    };

    checkAndTick();
    const interval = setInterval(checkAndTick, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;
  const timeDisplay = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  const isLow = secondsRemaining < 120;

  return (
    <div className={`clock ${isLow ? 'low' : ''}`} role="timer">
      {/* Accessible discrete announcement container - announces only at key thresholds (P2-8) */}
      <div className="sr-only" aria-live="assertive" role="status">
        {announcement}
      </div>

      <span>Held for you</span>
      <b aria-label={`${mins} minutes and ${secs} seconds remaining`}>{timeDisplay}</b>
    </div>
  );
}
