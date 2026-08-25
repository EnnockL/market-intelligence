-- Supabase installs pgcrypto in the extensions schema. The original trigger
-- fixed its search_path to public, so unqualified digest(text, unknown) could
-- fail during wallet ingestion. Qualify pgcrypto and use its bytea overload.
create or replace function public.emit_wallet_trade_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_payload jsonb;
  stable_event_id text;
begin
  if new.side in ('buy', 'sell') then
    event_payload := jsonb_build_object(
      'side', new.side,
      'quantity', new.quantity,
      'block_number', new.block_number,
      'transaction_hash', new.transaction_hash,
      'instruction_index', new.instruction_index
    );

    stable_event_id := 'evt_' || substr(
      encode(
        extensions.digest(
          convert_to('solana-rpc|' || new.transaction_hash || '|' || new.instruction_index || '|' || new.wallet_id || '|' || new.side, 'UTF8'),
          'sha256'
        ),
        'hex'
      ),
      1,
      40
    );

    insert into public.event_outbox(
      event_id, event_type, schema_version, entity_type, entity_id, asset_id,
      wallet_id, occurred_at, observed_at, available_at, provider,
      source_reference, data_quality, confidence, payload, payload_hash,
      correlation_id, causation_id
    ) values (
      stable_event_id, 'wallet.' || new.side || '_detected', 1,
      'wallet_transaction', new.id::text, new.asset_id, new.wallet_id,
      new.occurred_at, greatest(new.occurred_at, new.ingested_at),
      greatest(new.occurred_at, new.ingested_at), 'solana-rpc',
      new.transaction_hash, 100, 100, event_payload,
      encode(extensions.digest(convert_to(event_payload::text, 'UTF8'), 'sha256'), 'hex'),
      new.transaction_hash, null
    )
    on conflict(event_id) do nothing;
  end if;

  return new;
end
$$;
