#!/usr/bin/env python3
"""PostToolUse reminder: web/src/** edits don't show at :8080 until web is rebuilt.

Non-blocking. Prints hookSpecificOutput JSON on stdout when a file under
/web/src/ was touched; otherwise prints nothing. Always exits 0.
"""
import json
import sys

REMINDER = (
    '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":'
    '"web/src changed: run `npm --prefix web run build` before the :8080 server '
    'reflects it (not needed for the :5173 Vite dev server)."}}'
)


def main():
    try:
        payload = json.load(sys.stdin)
        file_path = payload.get("tool_input", {}).get("file_path", "") or ""
    except Exception:
        sys.exit(0)
    if "/web/src/" in file_path:
        sys.stdout.write(REMINDER + "\n")
    sys.exit(0)


if __name__ == "__main__":
    main()
