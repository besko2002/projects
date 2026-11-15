-- V11: Safely delete leftover temporary demo accounts that have no associated tickets.
-- Ticket, payment, and refund histories are strictly preserved.

DELETE FROM seat_reservations
WHERE user_id IN (
    SELECT id FROM users
    WHERE email LIKE 'demo-%@demo.cinebook.local'
      AND id NOT IN (SELECT DISTINCT user_id FROM tickets)
);

DELETE FROM users
WHERE email LIKE 'demo-%@demo.cinebook.local'
  AND id NOT IN (SELECT DISTINCT user_id FROM tickets);
