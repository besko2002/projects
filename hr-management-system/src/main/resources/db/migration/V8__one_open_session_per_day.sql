-- At most one OPEN session per employee and work day.
--
-- The service checks for an open session and then inserts, which two concurrent check-ins can
-- both pass: the loser used to create a second open session for the same day. The partial
-- unique index makes the database the arbiter - the second insert fails and becomes a 409.
--
-- The index is per (employee, work_date), NOT per employee: a session left open on an EARLIER
-- day must not block today's check-in. That stale session stays reportable as
-- MISSING_CHECKOUT, and today's check-in creates a second open session on a different work
-- date, which the index allows.
--
-- If the database already holds duplicate open sessions (the old race), this migration
-- REFUSES to run and says so. It deliberately does NOT repair them: closing one of them
-- automatically would invent a check-out time that nobody ever entered, and attendance records
-- are not this migration's to rewrite. An operator reconciles the duplicates by hand (an HR
-- correction with the real check-out time, or a check-out on the open session) and the
-- migration then applies. PostgreSQL runs DDL in a transaction, so the failed attempt leaves
-- neither the index nor a Flyway history entry behind - the re-run starts clean.

do $$
declare
    duplicate_employee uuid;
    duplicate_day      date;
    duplicate_count    bigint;
begin
    select employee_id, work_date, count(*)
      into duplicate_employee, duplicate_day, duplicate_count
      from attendance_sessions
     where check_out is null
     group by employee_id, work_date
    having count(*) > 1
     order by work_date, employee_id
     limit 1;

    if found then
        raise exception
            'Migration V8 refused to run: employee % has % open attendance sessions for work date %. '
            'From now on at most one open session per employee and work day is allowed, but this '
            'migration does not invent check-out times. Reconcile the duplicates by hand (close the '
            'extra sessions with the real check-out time, e.g. an HR correction), then run the '
            'migration again.',
            duplicate_employee, duplicate_count, duplicate_day;
    end if;
end
$$;

create unique index attendance_sessions_one_open_per_day_idx
    on attendance_sessions (employee_id, work_date)
    where check_out is null;
