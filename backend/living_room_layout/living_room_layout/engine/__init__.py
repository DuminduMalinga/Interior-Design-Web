"""Engine: analysis, selection, candidate generation, checking, scoring, search."""

from .candidate_generator import CandidateGenerator
from .constraint_checker import ConstraintChecker
from .grid import OccupancyGrid
from .layout_selector import LayoutDecision, LayoutSelector
from .optimizer import LayoutOptimizer, LayoutResult
from .pipeline import GenerationResult, LayoutGenerator, generate
from .room_analyzer import RoomAnalysis, RoomAnalyzer
from .scorer import LayoutScorer

__all__ = [
    "CandidateGenerator",
    "ConstraintChecker",
    "GenerationResult",
    "LayoutDecision",
    "LayoutGenerator",
    "LayoutOptimizer",
    "LayoutResult",
    "LayoutScorer",
    "LayoutSelector",
    "OccupancyGrid",
    "RoomAnalysis",
    "RoomAnalyzer",
    "generate",
]
