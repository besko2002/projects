-- Employee numbers must keep at least four digits and must never be truncated.
--
-- The old default was 'EMP-' || lpad(nextval('employee_number_seq')::text, 4, '0'). PostgreSQL's
-- lpad TRUNCATES a string that is longer than the requested length, so the 10,000th employee was
-- numbered 'EMP-1000' - a duplicate of the 1,000th one. Every insert after that failed on the
-- unique index.
--
-- lpad cannot express "pad to at least four digits" on its own, and PostgreSQL does not allow a
-- subquery in a DEFAULT expression, so the formatting moves into a small helper function that
-- takes the already-fetched sequence value. The function is used by the column default AND by
-- the application (EmployeeRepository.nextEmployeeNumber), so both paths produce the same
-- number.
--
-- Existing rows are untouched: only the DEFAULT changes, so every number already in the table
-- keeps its value.

create or replace function employee_number_for(value bigint)
    returns text
    language sql
    immutable
    as $$
        select 'EMP-' || lpad(value::text, greatest(4, length(value::text)), '0')
    $$;

alter table employees
    alter column employee_number set default employee_number_for(nextval('employee_number_seq'));
