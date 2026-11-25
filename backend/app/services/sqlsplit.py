"""Split a MySQL script into statements, understanding DELIMITER (used by the trigger definitions)."""
import re

_TRAILING_COMMENT = re.compile(r"\s--\s.*$")


def split_sql(text: str):
    delim, buf, out = ";", [], []
    for raw in text.splitlines():
        line = _TRAILING_COMMENT.sub("", raw).rstrip()
        s = line.strip()
        if s.upper().startswith("DELIMITER "):
            delim = s.split(None, 1)[1].strip()
            continue
        if not s or s.startswith("--"):
            continue
        buf.append(line)
        if s.endswith(delim):
            stmt = "\n".join(buf).rstrip()
            out.append(stmt[: -len(delim)].rstrip())
            buf = []
    if buf:
        out.append("\n".join(buf).strip())
    return out
