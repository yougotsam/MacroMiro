"""Bound the profile population before any profile-generation LLM calls."""


def enforce_population_cap(count, max_agents):
    if type(count) is not int or count < 0:
        raise ValueError("preparation population must be a known nonnegative integer")
    if max_agents is None:  # Compatibility for callers outside the research runner.
        return
    if type(max_agents) is not int or max_agents < 1:
        raise ValueError("max_agents must be a positive integer")
    if count > max_agents:
        raise ValueError("preparation population exceeds its admitted budget cap")
