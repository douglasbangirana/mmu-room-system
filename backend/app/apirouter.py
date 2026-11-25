"""APIRouter that runs every endpoint's result through util.prep (see there for why)."""
import functools

from fastapi import APIRouter

from .util import prep


def _wrap(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        return prep(fn(*args, **kwargs))
    return wrapper


class ApiRouter(APIRouter):
    def add_api_route(self, path, endpoint, **kwargs):
        return super().add_api_route(path, _wrap(endpoint), **kwargs)
