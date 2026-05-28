"""well-known publisher: generate /.well-known/* files from a YAML config."""

from .loader import Config, ConfigError, load

__all__ = ["Config", "ConfigError", "load"]
__version__ = "0.1.0"
