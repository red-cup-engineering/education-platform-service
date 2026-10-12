/**
 * `earn` -- earn-only hooks, stubbed to the ZBD rails' own adapter interface
 * (`zbd-micropayment-rails.md`), NOT a working payout implementation. Honest status, stated
 * plainly rather than glossed: `zbd-micropayment-rails.md`'s adoption order is onestone first,
 * solitaire second, flickering-delve deliberately excluded; Equivo is not in that document's
 * adoption map at all -- "it would need its own pass if the owner wants rewarded play on it."
 * This module exists so a future pass has the exact shape to fill in (`flickering-delve-
 * service/src/payments.mts`'s `PaymentProvider`, reused unchanged per the rails doc §2's own
 * argument: "a payout is structurally a charge with the ledger postings' sign flipped"), without
 * blocking this build on rails work the design docs explicitly scope out.
 *
 * Every function here either throws or returns a `configured: false` stub. Nothing here moves
 * money, computes a payout, or contacts a network -- do not wire a real UI reward flow to this
 * module without replacing `stubProvider` first.
 */

export interface Order {
  readonly id: string;
  readonly actor: string;
  readonly sku: string;
  readonly provider: string;
  /** Optional; absent means "charge" -- zbd-micropayment-rails.md §2's additive, non-breaking
   * widening of the existing flickering-delve `Order` shape. */
  readonly direction?: 'charge' | 'payout';
}

export interface Sku {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  readonly priceUsd: string;
  readonly priceHive: string;
  readonly priceSats?: string;
  readonly boost?: { readonly kind: 'rate' | 'offline'; readonly value: number; readonly durationSeconds: number };
}

export interface IntentResult {
  readonly provider: string;
  readonly orderId: string;
  readonly instructions: Record<string, unknown>;
}

export interface SettleResult {
  readonly cleared: boolean;
  readonly detail: string;
}

/** The exact `PaymentProvider` shape from `flickering-delve-service/src/payments.mts`, quoted
 * verbatim in `zbd-micropayment-rails.md` §1 -- reused unchanged, not reinvented, so a real
 * `zbdProvider` can be dropped in later without touching this interface. */
export interface PaymentProvider {
  readonly id: string;
  readonly configured: boolean;
  createIntent(order: Order, sku: Sku): Promise<IntentResult>;
  settle(order: Order, sku: Sku, evidence?: unknown): Promise<SettleResult>;
}

/** `configured: false` always -- this stub exists to hold the SHAPE the design docs specify, not
 * to move money. Every call rejects with an explicit, honest reason rather than silently
 * pretending to succeed (which would be worse than not having the hook at all). */
export const stubProvider: PaymentProvider = {
  id: 'equivo-earn-stub',
  configured: false,
  async createIntent(_order: Order, _sku: Sku): Promise<IntentResult> {
    throw new Error(
      'earn.mts: stubProvider is not a working payout adapter. Equivo is not in ' +
        "zbd-micropayment-rails.md's adoption map (onestone, then solitaire) -- wire a real " +
        'zbdProvider (reusing flickering-delve-service/src/payments.mts\'s PaymentProvider ' +
        'boundary per the rails doc §2/§3) before enabling any rewarded-play UI.',
    );
  },
  async settle(_order: Order, _sku: Sku, _evidence?: unknown): Promise<SettleResult> {
    return { cleared: false, detail: 'stubProvider never clears a settlement -- see createIntent for why.' };
  },
};

/** A payout tier is a charge with the sign flipped (rails doc §2) -- `priceSats` set, `boost`
 * omitted, `direction: 'payout'`. Exposed so a future rewarded-play pass can build one without
 * re-deriving the shape, but no code in this build ever constructs one and calls `stubProvider`
 * with it (there is no rewarded content in Equivo v1 -- equivo-design.md §8's MVP cut). */
export function payoutOrder(id: string, actor: string, sku: string, provider: string): Order {
  return { id, actor, sku, provider, direction: 'payout' };
}
