"""Python side of the app: AI and data work. TypeScript owns pages, routes, models and security.

Use it from TypeScript:  import { insights, summarize_numbers } from "./insights.py";
"""

from aix import agent, tool


@tool
def summarize_numbers(values: list[float]) -> dict:
    """Count, mean, min and max of a list of numbers."""
    if not values:
        return {"count": 0}
    return {"count": len(values), "mean": sum(values) / len(values), "min": min(values), "max": max(values)}


insights = agent(
    name="insights",
    description="Answers questions about numbers using Python tools.",
    instructions="Use summarize_numbers for statistics. Answer briefly.",
    tools=["summarize_numbers"],
)
