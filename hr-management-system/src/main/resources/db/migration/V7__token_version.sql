-- Per-employee token version.
--
-- The JWT carries this version and every password change bumps it, so a token minted in the
-- same second as the change is rejected as well. The timestamp check cannot do that on its
-- own: `iat` has one-second resolution, so two events inside the same second are
-- indistinguishable - which is exactly the window in which a password change used to leave
-- the old token usable.
--
-- Tokens issued before this migration carry no version claim and are treated as version 0.
-- An employee who had already changed their password before the migration gets version 1, so
-- their old tokens stop working and they sign in again once. That is deliberate: from the
-- timestamps alone there is no way to tell whether such a token predates the change, and
-- keeping it alive is the very bug this migration removes.

alter table employees add column token_version integer not null default 0;

update employees set token_version = 1 where password_changed_at is not null;
