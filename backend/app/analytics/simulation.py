from __future__ import annotations

from .forecasting import forecast_demand


def simulate_what_if(db, sku_id: int, region: str, horizon: int, percent_change: float, event_tag: str | None):
    base = forecast_demand(db, sku_id, region, horizon=horizon)

    event_multiplier = 1.0
    event_note = ""
    if event_tag:
        tag_lower = event_tag.lower()
        if "festival" in tag_lower or "diwali" in tag_lower or "holi" in tag_lower:
            event_multiplier = 1.12
        elif "construction" in tag_lower or "boom" in tag_lower:
            event_multiplier = 1.08
        elif "monsoon" in tag_lower:
            event_multiplier = 0.95
        event_note = f" Event shock for '{event_tag}' applied ({event_multiplier:.2f}x)."

    change_multiplier = 1 + percent_change / 100
    total_multiplier = change_multiplier * event_multiplier

    points = []
    for point in base.points:
        adjusted = point["forecast"] * total_multiplier
        lower = point["lower"] * total_multiplier
        upper = point["upper"] * total_multiplier
        points.append({"date": point["date"], "forecast": adjusted, "lower": lower, "upper": upper})

    explanation = (
        f"What-if change {percent_change:+.1f}% applied to base forecast." + event_note
    )

    return {
        "sku_id": sku_id,
        "region": region,
        "model": base.model_name,
        "horizon": horizon,
        "confidence": base.confidence,
        "explanation": explanation,
        "signal_adjustment": base.signal_adjustment * total_multiplier,
        "points": points,
    }
