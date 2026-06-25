-- Local test seed (applied by `supabase db reset` after migrations).
-- Seeds ONE billing test user so the harness can mint a real JWT via the
-- password grant. Idempotent + namespaced UUID so it merges cleanly with any
-- WT-AUTH seed later. The `plans` rows are seeded by their migration (they are
-- real config, present in prod too), NOT here.
--
-- NOTE: this user is test-only. Drop it / point the harness at WT-AUTH's user
-- once the two worktrees merge.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000b1111',
  'authenticated', 'authenticated',
  'billing-test@cubic.dev',
  crypt('test-password-123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}',
  '{}'
)
on conflict (id) do nothing;

-- Matching identity row (required for the password grant to resolve the user).
insert into auth.identities (
  id, user_id, provider_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-0000000b1111',
  '00000000-0000-0000-0000-0000000b1111',
  '00000000-0000-0000-0000-0000000b1111',
  '{"sub":"00000000-0000-0000-0000-0000000b1111","email":"billing-test@cubic.dev"}',
  'email',
  now(), now(), now()
)
on conflict (provider_id, provider) do nothing;
