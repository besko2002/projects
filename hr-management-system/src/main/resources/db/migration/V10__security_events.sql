-- Security events: what happened around the sign-in, independently of the employee data.
--
-- The employee audit trail (Envers) records changes to employee rows; a sign-in is not a change
-- to a row, but it is exactly the thing an operator wants to see after an incident: who signed
-- in, who tried and failed, which account was locked and which password was changed.
--
-- No password and no token is stored here - only the e-mail, the client IP and the outcome.

create table security_events (
    id          bigserial   not null primary key,
    type        varchar(30) not null,
    email       varchar(255),
    client_ip   varchar(64),
    employee_id uuid,
    detail      varchar(500),
    occurred_at timestamptz not null default now(),

    constraint security_events_type_check check (
        type in ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'ACCOUNT_LOCKED', 'PASSWORD_CHANGED', 'LOGOUT')
    ),
    constraint security_events_employee_fk foreign key (employee_id) references employees (id)
        on delete set null
);

create index security_events_type_time_idx on security_events (type, occurred_at desc);
create index security_events_email_idx on security_events (email, occurred_at desc);
