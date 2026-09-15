"""Resource generator package.

Each submodule registers one generator via the ``@register('<name>')``
decorator. ``well_known_publisher.registry.discover()`` walks this package
and imports every non-underscore submodule so the decorators fire.

This module is intentionally empty in v1; future tasks add one module per
RFC.
"""
