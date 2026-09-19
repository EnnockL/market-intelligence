-- Consumer registration only needs type, availability and stable event identity.
-- Avoid fetching the full historical event payload heap for every polling cycle.
create index event_outbox_consumer_stream_idx on public.event_outbox(event_type,available_at,event_id);
