# Hard-vendor negotiation (phased plan)

Goal: negotiations that stay believable when the vendor is hard to move, with a visible strategy, and a history-based warning when a vendor is known to be hard to crack.

Decisions (confirmed): add a third "hard vendor" demo story; allow a truthful "we have other offers" only when a second quote exists (no numbers named); the system may trade payment terms by itself up to 15 extra days; round cap 12; switching vendor is only suggested to the buyer.

## Phase 1 - engine (backend)

1. **Vendor personas** (hidden, deterministic per bid, demo bids stay cooperative): cooperative, anchor-and-hold, bluffer, terms trader, deadline-driven, relationship seeker. Each is a per-round step profile plus a payment-grant allowance; the reserve is never crossed. A stonewall is simply a reserve beyond the buyer's limit.
2. **Phased playbook** in `tactics.py`: open, probe, trade, pressure, close, hand back. New tactics, each labelled and each with its own wording: terms trade (same price, better payment), truthful leverage (only if another quote exists), split the difference (only if the midpoint is inside the limit), calling a bluff (a "final" price followed by a move). Round cap 12.
3. **State**: session keeps a stall counter, whether a bluff was called, and the tactics used; each of our turns records its tactic label (buyer-visible only).
4. **Hand-back with options**: reason text lists accept as is, switch to the next-best vendor (name and price), trade terms, adjust the limit, close without a deal.
5. **History-based difficulty**: per vendor, from its negotiated past deals, how far the price moved on average. Levels: unknown, flexible, firm, hard. A note such as "Hard to crack: in 6 negotiated deals the price moved only 1.4% on average" appears when choosing a vendor and in the workspace.
6. **Observed stance** (never the persona): open, firm or open-on-terms, computed from what the vendor actually did.

## Phase 2 - wording
Four to six English variants per tactic; Hindi and Marathi for the main tactics; vendor replies mention payment changes.

## Phase 3 - interface
Tactic tag on our messages, a strategy panel (round of 12, stance, history note, alternative vendor), difficulty note in the start panel.

## Phase 4 - tuning and demo
Persona matrix tests, determinism, no secret ever in a response, demo stories unchanged, a third "hard vendor" story.

## Safety rules that stay
No internal numbers, no software mention, no false claims, the buyer can stop at any moment, every price inside the buyer's limit.
