"""Date helpers for "this week" (Monday to Sunday)."""
from datetime import date, timedelta


def week_range(today: date):
    """(monday, sunday) of the week containing `today`, as 'YYYY-MM-DD' strings."""
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat(), (monday + timedelta(days=6)).isoformat()
