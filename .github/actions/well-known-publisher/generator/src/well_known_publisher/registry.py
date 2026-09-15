"""Resource generator registry.

Generator modules under ``well_known_publisher.resources.*`` self-register
via the :func:`register` decorator. ``discover()`` imports every submodule
so decorators fire, then returns the populated registry.

Return contract
---------------

Each generator MUST return a :class:`GeneratorResult` (a frozen dataclass
holding ``files: list[Path]`` and ``warnings: int``). The ``warnings``
counter is the number of ``::warning::`` annotations the generator
emitted during the run — the framework propagates this into the
``manifest`` output so caller workflows can fail-on-warning if they
choose. Generators that emit zero warnings simply return
``GeneratorResult(files=[...], warnings=0)``.
"""

from __future__ import annotations

import importlib
import pkgutil
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class GeneratorResult:
    """What every registered generator returns.

    ``files`` is the list of paths the generator wrote (used to build the
    ``files_written`` output). ``warnings`` is the number of
    ``::warning::`` annotations the generator emitted — surfaced in the
    ``manifest`` output for caller workflows.
    """

    files: list[Path] = field(default_factory=list)
    warnings: int = 0


GeneratorFn = Callable[[dict, Path], "GeneratorResult"]
"""(config_subtree, output_dir) -> :class:`GeneratorResult`."""

_REGISTRY: dict[str, GeneratorFn] = {}


def register(name: str) -> Callable[[GeneratorFn], GeneratorFn]:
    """Register ``fn`` as the generator for the given resource ``name``.

    The name must match the key the YAML config uses under ``resources:``
    and the matching ``$defs/<name>`` entry in the JSON schema.
    """

    def _wrap(fn: GeneratorFn) -> GeneratorFn:
        if name in _REGISTRY:
            raise ValueError(f"generator already registered: {name!r}")
        _REGISTRY[name] = fn
        return fn

    return _wrap


def discover() -> dict[str, GeneratorFn]:
    """Import every submodule of ``well_known_publisher.resources``.

    Importing the submodules causes their ``@register`` decorators to fire,
    populating the registry. Returns the registry (a fresh shallow copy) so
    callers cannot mutate the underlying dict.
    """
    from . import resources as resources_pkg

    for mod_info in pkgutil.iter_modules(resources_pkg.__path__):
        if mod_info.name.startswith("_"):
            continue
        importlib.import_module(f"{resources_pkg.__name__}.{mod_info.name}")
    return dict(_REGISTRY)


def clear() -> None:
    """Test helper: drop all registrations."""
    _REGISTRY.clear()
