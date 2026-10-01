from datetime import date

SEED = 20260929
TODAY = date(2026, 9, 29)
EUR_RATE = 92.5  # illustrative INR per EUR (A2)

# Vendors that are hard to move: their past negotiated deals show small concessions, and in a live
# negotiation they hold out (see app.negotiation.personas). Never a demo-story vendor (V001, V031).
HARD_VENDORS = frozenset({"V008", "V037", "V024", "V003", "V042"})
