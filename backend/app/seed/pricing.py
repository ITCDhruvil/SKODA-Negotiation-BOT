def round_price(x: float) -> float:
    """Whole rupees from 100 up, two decimals below."""
    return float(round(x)) if x >= 100 else round(x, 2)


def step(x: float) -> float:
    """Smallest price increment at this price level."""
    return 1.0 if x >= 100 else 0.01
