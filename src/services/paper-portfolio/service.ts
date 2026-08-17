import type { SupabaseClient } from "@supabase/supabase-js";
import { deterministicDigest } from "@/domain/events";
import {
  INITIAL_POLICIES,
  PAPER_ENGINE_VERSION,
  evaluateEligibility,
  equityPoint,
  selectExit,
  simulateBuy,
  type PaperPolicyConfig,
} from "@/domain/paper-portfolio";

const USD_SEK = 10.5;
export class PaperPortfolioService {
  constructor(private db: SupabaseClient) {}
  async bootstrap(initialCash = 20_000) {
    for (const [kind, config] of Object.entries(INITIAL_POLICIES)) {
      const version = `${kind.toLowerCase()}-v1`,
        hash = deterministicDigest(config);
      const inserted = await this.db
        .from("paper_policies")
        .upsert(
          {
            policy_version: version,
            name: kind.replaceAll("_", " "),
            kind,
            config,
            config_hash: hash,
            status: "ACTIVE",
            activated_at: "2026-01-01T00:00:00Z",
          },
          { onConflict: "policy_version", ignoreDuplicates: true },
        )
        .select("id,policy_version")
        .maybeSingle();
      if (inserted.error) throw inserted.error;
      const existing = inserted.data
        ? null
        : await this.db
            .from("paper_policies")
            .select("id,policy_version")
            .eq("policy_version", version)
            .single();
      if (existing?.error) throw existing.error;
      const policy = inserted.data ?? existing!.data;
      const { error: pError } = await this.db.from("paper_portfolios").upsert(
        {
          name: `Research · ${kind.replaceAll("_", " ")}`,
          strategy: "crypto_smart_money",
          status: "active",
          initial_capital_sek: initialCash,
          cash_sek: initialCash,
          assumptions: {
            engineVersion: PAPER_ENGINE_VERSION,
            usdSek: USD_SEK,
          },
          policy_version: policy.policy_version,
          portfolio_scope: "SYSTEM_RESEARCH",
        },
        { onConflict: "policy_version", ignoreDuplicates: true },
      );
      if (pError) throw pError;
    }
  }
  async eligibility(limit = 100) {
    await this.bootstrap();
    const [
      { data: portfolios, error: pError },
      { data: candidates, error: cError },
    ] = await Promise.all([
      this.db
        .from("paper_portfolios")
        .select("*,paper_policies!paper_portfolios_policy_version_fkey(*)")
        .eq("portfolio_scope", "SYSTEM_RESEARCH")
        .eq("status", "active"),
      this.db
        .from("jackpot_candidates")
        .select("*,jackpot_candidate_revisions(*)")
        .order("detected_at")
        .limit(limit),
    ]);
    if (pError) throw pError;
    if (cError) throw cError;
    let evaluated = 0,
      eligible = 0,
      rejected = 0;
    for (const portfolio of portfolios ?? []) {
      const policyRow = Array.isArray(portfolio.paper_policies)
        ? portfolio.paper_policies[0]
        : portfolio.paper_policies;
      if (!policyRow) continue;
      const policy = policyRow.config as PaperPolicyConfig;
      const { data: positions } = await this.db
        .from("paper_positions")
        .select("asset_id,market_value,opened_at")
        .eq("portfolio_id", portfolio.id)
        .is("closed_at", null);
      for (const candidate of candidates ?? []) {
        const revisions = [
            ...(candidate.jackpot_candidate_revisions ?? []),
          ].sort((a: any, b: any) => a.revision_number - b.revision_number),
          rev = revisions.at(-1);
        if (!rev) continue;
        // The decision can happen when the immutable revision became available.
        // Its own information_cutoff_at remains the upper bound for referenced evidence.
        const cutoff = rev.available_at;
        const f = rev.features ?? {},
          s = rev.safety_result?.status ?? "UNKNOWN",
          currentEquity =
            Number(portfolio.cash_sek) +
            (positions ?? []).reduce(
              (n: any, p: any) => n + Number(p.market_value),
              0,
            );
        const result = evaluateEligibility(
          policy,
          {
            candidateId: candidate.id,
            opportunityId: f.opportunityId ?? null,
            revisionNumber: rev.revision_number,
            assetId: candidate.asset_id,
            state: candidate.current_state,
            safety: s,
            dataQuality: f.dataQuality ?? null,
            relationshipCoverage: f.relationshipCoverage ?? null,
            clusterAdjustedCount: f.clusterAdjustedCount ?? null,
            priceMoveBeforeDetectionPct: f.priceMoveBeforeDetectionPct ?? null,
            signalAvailableAt: rev.available_at,
            decisionCutoff: cutoff,
          },
          {
            cash: Number(portfolio.cash_sek),
            equity: currentEquity,
            initialCash: Number(portfolio.initial_capital_sek),
            openPositions: (positions ?? []).length,
            jackpotExposure: (positions ?? []).reduce(
              (n: any, p: any) => n + Number(p.market_value),
              0,
            ),
            tokenExposure: (positions ?? [])
              .filter((p: any) => p.asset_id === candidate.asset_id)
              .reduce((n: any, p: any) => n + Number(p.market_value), 0),
            dailyNewExposure: 0,
          },
        );
        const evalHash = deterministicDigest({
          portfolio: portfolio.id,
          candidate: candidate.id,
          revision: rev.revision_number,
          policy: policyRow.policy_version,
        });
        const { data: evaluation, error: eError } = await this.db
          .from("paper_policy_evaluations")
          .upsert(
            {
              portfolio_id: portfolio.id,
              policy_id: policyRow.id,
              candidate_id: candidate.id,
              candidate_revision: rev.revision_number,
              decision_cutoff: cutoff,
              status: result.eligible ? "ELIGIBLE" : "REJECTED",
              reason: result.reason,
              requested_amount: result.requestedAmount,
              known_inputs: result.knownInputs,
              evaluation_hash: evalHash,
            },
            { onConflict: "evaluation_hash", ignoreDuplicates: true },
          )
          .select("id")
          .maybeSingle();
        if (eError) throw eError;
        if (!evaluation) continue;
        evaluated++;
        if (result.eligible) {
          eligible++;
          {
            const executionAt = new Date(
                Date.parse(rev.available_at) + policy.entryDelayMs,
              ).toISOString(),
              key = deterministicDigest({ evaluation: evalHash, side: "BUY" });
            const { error: oError } = await this.db.from("paper_orders").upsert(
              {
                portfolio_id: portfolio.id,
                policy_id: policyRow.id,
                evaluation_id: evaluation.id,
                candidate_id: candidate.id,
                opportunity_id: f.opportunityId ?? null,
                asset_id: candidate.asset_id,
                side: "BUY",
                signal_available_at: rev.available_at,
                decision_at: cutoff,
                configured_entry_delay_ms: policy.entryDelayMs,
                simulated_execution_at: executionAt,
                requested_amount: result.requestedAmount,
                status: "ELIGIBLE",
                idempotency_key: key,
              },
              { onConflict: "idempotency_key", ignoreDuplicates: true },
            );
            if (oError) throw oError;
          }
        } else rejected++;
      }
    }
    return { evaluated, eligible, rejected };
  }
  async execute(limit = 100) {
    const { data: orders, error } = await this.db
      .from("paper_orders")
      .select("*,paper_portfolios(*),paper_policies(*)")
      .eq("side", "BUY")
      .eq("status", "ELIGIBLE")
      .order("simulated_execution_at")
      .limit(limit);
    if (error) throw error;
    let filled = 0,
      partial = 0,
      rejected = 0;
    for (const order of orders ?? []) {
      const policyRow = Array.isArray(order.paper_policies)
          ? order.paper_policies[0]
          : order.paper_policies,
        portfolio = Array.isArray(order.paper_portfolios)
          ? order.paper_portfolios[0]
          : order.paper_portfolios;
      const { data: point, error: pError } = await this.db
        .from("crypto_market_observations")
        .select(
          "price_usd,liquidity_usd,observed_at,ingested_at,provider,confidence",
        )
        .eq("asset_id", order.asset_id)
        .gte("observed_at", order.simulated_execution_at)
        .order("observed_at")
        .limit(1)
        .maybeSingle();
      if (pError) throw pError;
      const simulation = simulateBuy({
        requestedAmount: Number(order.requested_amount),
        expectedPrice: point?.price_usd ? Number(point.price_usd) * USD_SEK : 0,
        liquiditySek: point?.liquidity_usd
          ? Number(point.liquidity_usd) * USD_SEK
          : null,
        policy: policyRow.config,
      });
      if (simulation.status === "REJECTED") {
        await this.db
          .from("paper_orders")
          .update({ status: "REJECTED", reason: simulation.reason })
          .eq("id", order.id);
        rejected++;
        continue;
      }
      const total = simulation.executedAmount + simulation.fees.total;
      if (total > Number(portfolio.cash_sek)) {
        await this.db
          .from("paper_orders")
          .update({ status: "REJECTED", reason: "INSUFFICIENT_CASH" })
          .eq("id", order.id);
        rejected++;
        continue;
      }
      const cashAfter =
        Math.round((Number(portfolio.cash_sek) - total) * 100) / 100;
      const { data: position, error: posError } = await this.db
        .from("paper_positions")
        .insert({
          portfolio_id: portfolio.id,
          asset_id: order.asset_id,
          quantity: simulation.quantity,
          average_entry_price: simulation.executionPrice,
          cost_basis: total,
          current_price: simulation.executionPrice,
          market_value: simulation.executedAmount,
          opened_at: order.simulated_execution_at,
          high_watermark: simulation.executionPrice,
        })
        .select("id")
        .single();
      if (posError) throw posError;
      const fillHash = deterministicDigest({
        order: order.id,
        execution: order.simulated_execution_at,
      });
      const { error: fError } = await this.db.from("paper_fills").upsert(
        {
          order_id: order.id,
          portfolio_id: portfolio.id,
          position_id: position.id,
          side: "BUY",
          quantity: simulation.quantity,
          price: simulation.executionPrice,
          principal: simulation.executedAmount,
          fees: simulation.fees.total,
          cash_before: portfolio.cash_sek,
          cash_after: cashAfter,
          executed_at: order.simulated_execution_at,
          fill_hash: fillHash,
        },
        { onConflict: "fill_hash", ignoreDuplicates: true },
      );
      if (fError) throw fError;
      await this.db
        .from("paper_portfolios")
        .update({
          cash_sek: cashAfter,
          updated_at: order.simulated_execution_at,
        })
        .eq("id", portfolio.id);
      await this.db
        .from("paper_orders")
        .update({
          executed_amount: simulation.executedAmount,
          signal_price: simulation.expectedPrice,
          execution_price: simulation.executionPrice,
          fees: simulation.fees,
          slippage: simulation.slippage,
          liquidity_used: simulation.maxFromLiquidity,
          status: simulation.status,
          reason: null,
        })
        .eq("id", order.id);
      await this.db.from("paper_trade_attribution").upsert(
        {
          order_id: order.id,
          candidate_id: order.candidate_id,
          opportunity_id: order.opportunity_id,
          candidate_revision: 1,
          policy_version: policyRow.policy_version,
          attribution_hash: deterministicDigest({
            order: order.id,
            policy: policyRow.policy_version,
          }),
        },
        { onConflict: "attribution_hash", ignoreDuplicates: true },
      );
      simulation.status === "FILLED" ? filled++ : partial++;
    }
    return { filled, partial, rejected };
  }
  async exits(limit = 100) {
    const { data: positions, error } = await this.db
      .from("paper_positions")
      .select("*,paper_portfolios(*)")
      .is("closed_at", null)
      .limit(limit);
    if (error) throw error;
    let exited = 0;
    for (const position of positions ?? []) {
      const portfolio = Array.isArray(position.paper_portfolios)
        ? position.paper_portfolios[0]
        : position.paper_portfolios;
      const { data: entry, error: entryError } = await this.db
        .from("paper_fills")
        .select("*,paper_orders(*,paper_policies(*))")
        .eq("position_id", position.id)
        .eq("side", "BUY")
        .order("executed_at")
        .limit(1)
        .maybeSingle();
      if (entryError) throw entryError;
      const sourceOrder = Array.isArray(entry?.paper_orders)
        ? entry.paper_orders[0]
        : entry?.paper_orders;
      const policyRow = Array.isArray(sourceOrder?.paper_policies)
        ? sourceOrder.paper_policies[0]
        : sourceOrder?.paper_policies;
      if (!entry || !sourceOrder || !policyRow || !portfolio) continue;
      const { data: observation, error: priceError } = await this.db
        .from("crypto_market_observations")
        .select("price_usd,observed_at,ingested_at,liquidity_usd")
        .eq("asset_id", position.asset_id)
        .gte("observed_at", position.opened_at)
        .order("observed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (priceError) throw priceError;
      if (!observation?.price_usd) continue;
      const currentPrice = Number(observation.price_usd) * USD_SEK;
      const { data: prior } = await this.db
        .from("paper_orders")
        .select("reason")
        .eq("portfolio_id", portfolio.id)
        .eq("asset_id", position.asset_id)
        .eq("side", "SELL")
        .in("status", ["FILLED", "PARTIALLY_FILLED"]);
      const rules = (policyRow.config as PaperPolicyConfig).exits.filter(
        (rule) =>
          !(prior ?? []).some(
            (order) => order.reason === `EXIT_${rule.type}_${rule.value}`,
          ),
      );
      const rule = selectExit(rules, {
        entryPrice: Number(position.average_entry_price),
        currentPrice,
        openedAt: position.opened_at,
        observedAt: observation.observed_at,
        highWatermark: Math.max(
          Number(position.high_watermark ?? 0),
          currentPrice,
        ),
      });
      if (!rule) continue;
      const quantity = (Number(position.quantity) * rule.sellPercent) / 100,
        principal = Math.round(quantity * currentPrice * 100) / 100,
        fee = Math.round((0.15 + principal * 0.0035) * 100) / 100,
        cashBefore = Number(portfolio.cash_sek),
        cashAfter = Math.round((cashBefore + principal - fee) * 100) / 100;
      const key = deterministicDigest({
        position: position.id,
        rule: `${rule.type}:${rule.value}`,
      });
      const { data: order, error: orderError } = await this.db
        .from("paper_orders")
        .upsert(
          {
            portfolio_id: portfolio.id,
            policy_id: policyRow.id,
            evaluation_id: sourceOrder.evaluation_id,
            candidate_id: sourceOrder.candidate_id,
            opportunity_id: sourceOrder.opportunity_id,
            asset_id: position.asset_id,
            side: "SELL",
            signal_available_at: observation.ingested_at,
            decision_at: observation.ingested_at,
            configured_entry_delay_ms: 0,
            simulated_execution_at: observation.observed_at,
            requested_amount: principal,
            executed_amount: principal,
            signal_price: currentPrice,
            execution_price: currentPrice,
            fees: {
              total: fee,
              estimated: true,
              modelVersion: "solana-fees-v1",
            },
            slippage: { pct: 0, sek: 0, modelVersion: "liquidity-impact-v1" },
            liquidity_used: observation.liquidity_usd
              ? Number(observation.liquidity_usd) * USD_SEK
              : null,
            status: "FILLED",
            reason: `EXIT_${rule.type}_${rule.value}`,
            idempotency_key: key,
          },
          { onConflict: "idempotency_key", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order) continue;
      const remaining = Number(position.quantity) - quantity,
        allocatedCost =
          (Number(position.cost_basis) * quantity) / Number(position.quantity),
        realized = principal - fee - allocatedCost;
      const { error: fillError } = await this.db.from("paper_fills").insert({
        order_id: order.id,
        portfolio_id: portfolio.id,
        position_id: position.id,
        side: "SELL",
        quantity,
        price: currentPrice,
        principal,
        fees: fee,
        cash_before: cashBefore,
        cash_after: cashAfter,
        executed_at: observation.observed_at,
        fill_hash: deterministicDigest({ order: order.id, side: "SELL" }),
      });
      if (fillError) throw fillError;
      await this.db
        .from("paper_portfolios")
        .update({ cash_sek: cashAfter, updated_at: observation.ingested_at })
        .eq("id", portfolio.id);
      await this.db
        .from("paper_positions")
        .update({
          quantity: remaining,
          cost_basis: Number(position.cost_basis) - allocatedCost,
          realized_pnl: Number(position.realized_pnl) + realized,
          market_value: remaining * currentPrice,
          current_price: currentPrice,
          closed_at: remaining < 1e-12 ? observation.observed_at : null,
        })
        .eq("id", position.id);
      exited++;
    }
    return { evaluated: (positions ?? []).length, exited };
  }
  async valuation(cutoff = new Date().toISOString()) {
    const { data: portfolios, error } = await this.db
      .from("paper_portfolios")
      .select("*")
      .eq("portfolio_scope", "SYSTEM_RESEARCH");
    if (error) throw error;
    let valued = 0;
    for (const portfolio of portfolios ?? []) {
      const { data: positions, error: pError } = await this.db
        .from("paper_positions")
        .select("*")
        .eq("portfolio_id", portfolio.id)
        .is("closed_at", null);
      if (pError) throw pError;
      const priced = [];
      let quality = 100;
      for (const position of positions ?? []) {
        const { data: price } = await this.db
          .from("crypto_market_observations")
          .select("price_usd,observed_at,confidence")
          .eq("asset_id", position.asset_id)
          .lte("ingested_at", cutoff)
          .order("observed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!price?.price_usd) {
          quality = 0;
          priced.push({
            quantity: Number(position.quantity),
            price: Number(
              position.current_price ?? position.average_entry_price,
            ),
            costBasis: Number(position.cost_basis),
          });
          continue;
        }
        const sek = Number(price.price_usd) * USD_SEK,
          market = Number(position.quantity) * sek;
        await this.db
          .from("paper_positions")
          .update({
            current_price: sek,
            market_value: market,
            unrealized_pnl: market - Number(position.cost_basis),
            high_watermark: Math.max(Number(position.high_watermark ?? 0), sek),
          })
          .eq("id", position.id);
        priced.push({
          quantity: Number(position.quantity),
          price: sek,
          costBasis: Number(position.cost_basis),
        });
        quality = Math.min(quality, Number(price.confidence));
      }
      const point = equityPoint(Number(portfolio.cash_sek), priced),
        hash = deterministicDigest({ portfolio: portfolio.id, cutoff, point });
      const { error: eError } = await this.db
        .from("paper_equity_points")
        .upsert(
          {
            portfolio_id: portfolio.id,
            captured_at: cutoff,
            cash: point.cash,
            open_position_value: point.openPositionValue,
            realized_pnl: (positions ?? []).reduce(
              (n: any, p: any) => n + Number(p.realized_pnl),
              0,
            ),
            unrealized_pnl: point.unrealizedPnl,
            total_equity: point.totalEquity,
            information_cutoff_at: cutoff,
            pricing_source: "crypto_market_observations",
            data_quality: quality,
            point_hash: hash,
          },
          { onConflict: "point_hash", ignoreDuplicates: true },
        );
      if (eError) throw eError;
      valued++;
    }
    return { valued };
  }
}
