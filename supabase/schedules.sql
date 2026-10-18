-- Apply explicitly AFTER migrations, Edge deployment and Vault configuration.
-- Not part of automatic migrations; no network calls are made by tests or demos.
-- Store user-owned values in Vault using the dashboard's secure input:
--   interlink_functions_url  = https://<your-project>.supabase.co/functions/v1
--   interlink_worker_secret  = same >=32-character secret as INTERLINK_WORKER_SECRET
-- Never put those values in this file, a client env variable, or source control.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$ begin
  if not exists(select 1 from vault.decrypted_secrets where name='interlink_functions_url' and decrypted_secret like 'https://%/functions/v1')
    or not exists(select 1 from vault.decrypted_secrets where name='interlink_worker_secret' and length(decrypted_secret)>=32) then
    raise exception 'Configure the Interlink worker URL and secret in Vault before enabling schedules';
  end if;
end $$;

-- Replace only this app's explicitly named jobs; other application jobs are untouched.
select cron.unschedule(jobid) from cron.job where jobname in ('interlink-push','interlink-deletion','interlink-maintenance');
select cron.schedule('interlink-push','* * * * *',$cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='interlink_functions_url' limit 1)||'/push-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-interlink-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='interlink_worker_secret' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  );
$cron$);
select cron.schedule('interlink-deletion','*/2 * * * *',$cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='interlink_functions_url' limit 1)||'/deletion-worker',
    headers := jsonb_build_object('Content-Type','application/json','x-interlink-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='interlink_worker_secret' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 120000
  );
$cron$);
select cron.schedule('interlink-maintenance','17 * * * *',$cron$
  begin;
  select set_config('request.jwt.claims','{"role":"service_role"}',true);
  select public.interlink_maintenance();
  commit;
$cron$);

-- Verify cron.job, cron.job_run_details and net._http_response after enabling.
-- A successful HTTP scheduling record is not evidence that any push was delivered.
