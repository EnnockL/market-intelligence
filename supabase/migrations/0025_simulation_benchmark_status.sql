alter table public.simulation_benchmarks alter column final_value_sek drop not null;
alter table public.simulation_benchmarks alter column return_percent drop not null;
alter table public.simulation_benchmarks add column if not exists data_status text not null default 'INSUFFICIENT_DATA';
alter table public.simulation_benchmarks add column if not exists reason text;
