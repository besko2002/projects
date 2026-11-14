import React from 'react';
import type { DayOption } from '../utils/dateUtils';

interface DateSelectorProps {
  days: DayOption[];
  selectedDate: string;
  onSelectDate: (dateString: string) => void;
}

export function DateSelector({
  days,
  selectedDate,
  onSelectDate,
}: DateSelectorProps): React.JSX.Element {
  return (
    <div className="dates" role="group" aria-label="Select showtime date">
      {days.map((day) => {
        const isSelected = day.dateString === selectedDate;
        return (
          <button
            key={day.dateString}
            type="button"
            className={`date-btn ${isSelected ? 'on' : ''}`}
            onClick={() => onSelectDate(day.dateString)}
            aria-pressed={isSelected}
            aria-label={`${day.dayLabel}, ${day.dayNumber} ${day.monthLabel}`}
          >
            <small>{day.dayLabel}</small>
            <b>{day.dayNumber}</b>
            <small>{day.monthLabel}</small>
          </button>
        );
      })}
    </div>
  );
}
