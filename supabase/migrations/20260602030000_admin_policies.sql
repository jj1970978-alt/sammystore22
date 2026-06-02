
-- Admin can read ALL profiles
create policy "profiles_admin_select" on public.profiles
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Admin can update any profile
create policy "profiles_admin_update" on public.profiles
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Admin can insert activity logs
create policy "logs_admin_insert" on public.activity_logs
  for insert to authenticated
  with check (public.has_role(auth.uid(), 'admin'));

-- Admin can update orders (status changes)
create policy "orders_admin_update" on public.orders
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Admin can update payment intents
create policy "intents_admin_update" on public.payment_intents
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Seed default product categories
insert into public.product_categories (name, slug, description) values
  ('Aged Twitter', 'aged-twitter', 'Verified aged Twitter/X accounts'),
  ('Aged Instagram', 'aged-instagram', 'Verified aged Instagram accounts'),
  ('Random Facebook', 'random-facebook', 'Random Facebook accounts'),
  ('USA Facebook', 'usa-facebook', 'USA-based verified Facebook accounts'),
  ('Tools', 'tools', 'Social media tools and utilities'),
  ('Working Profiles with Picture & Video', 'working-profiles', 'Active profiles with pictures and videos'),
  ('Below 50 Friend Countries Facebook', 'below-50-friend', 'Facebook accounts with below 50 friend countries')
on conflict (slug) do nothing;
