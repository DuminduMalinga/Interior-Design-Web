"""
Rule-based living room furniture layout generator.

    from living_room_layout import load_scenario, generate
    result = generate(load_scenario("input/room_medium.json"))
    print(result.to_dict()["layout"])
"""

from .config import Config, DEFAULT_CONFIG
from .engine.pipeline import GenerationResult, LayoutGenerator, generate
from .io_json import InputError, Scenario, load_scenario, parse_scenario, write_json

__version__ = "1.0.0"

__all__ = [
    "Config",
    "DEFAULT_CONFIG",
    "GenerationResult",
    "InputError",
    "LayoutGenerator",
    "Scenario",
    "generate",
    "load_scenario",
    "parse_scenario",
    "write_json",
]
