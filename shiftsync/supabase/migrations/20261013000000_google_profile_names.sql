-- Sign in with Google: Google accounts provide full_name / name in their
-- metadata instead of display_name, so new profiles use those too.
create or replace function public.shiftsync_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, display_name)
  values (
    new.id,
    new.email,
    left(
      coalesce(
        nullif(new.raw_user_meta_data ->> 'display_name', ''),
        nullif(new.raw_user_meta_data ->> 'full_name', ''),
        nullif(new.raw_user_meta_data ->> 'name', ''),
        ''
      ),
      120
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
