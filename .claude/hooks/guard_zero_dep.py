#!/usr/bin/env python3
"""PreToolUse guard: protect the repo's zero-dependency invariants.

Blocks (exit 2 + reason on stderr) when an Edit/Write/MultiEdit would:
  A) add a require() of a non-builtin module to the root server.js
  B) introduce a non-empty "dependencies" object in the ROOT package.json

web/ is exempt (web/package.json legitimately has dependencies).
Defensive: any parse error or missing field -> exit 0 (never block by accident).
"""
import json
import re
import sys

NODE_BUILTINS = {
    "http", "https", "fs", "path", "url", "os", "crypto", "events", "stream",
    "util", "buffer", "querystring", "zlib", "net", "tls", "dns", "http2",
    "child_process", "readline", "assert", "string_decoder", "timers",
    "process", "worker_threads", "perf_hooks", "v8", "vm", "module", "console",
}

REQUIRE_RE = re.compile(r"""require\(\s*(['"])([^'"]+)\1\s*\)""")


def is_builtin(module_id):
    mid = module_id
    if mid.startswith("node:"):
        mid = mid[len("node:"):]
    # relative / absolute paths are fine
    if mid.startswith(".") or mid.startswith("/"):
        return True
    # subpath imports like fs/promises -> check the root segment
    root = mid.split("/", 1)[0]
    return root in NODE_BUILTINS


def new_text_from(tool_name, tool_input):
    if tool_name == "Write":
        return tool_input.get("content", "") or ""
    if tool_name == "Edit":
        return tool_input.get("new_string", "") or ""
    if tool_name == "MultiEdit":
        edits = tool_input.get("edits", []) or []
        return "\n".join((e.get("new_string", "") or "") for e in edits if isinstance(e, dict))
    return ""


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)
    if not isinstance(payload, dict):
        sys.exit(0)

    tool_name = payload.get("tool_name", "")
    tool_input = payload.get("tool_input", {})
    if not isinstance(tool_input, dict):
        sys.exit(0)

    file_path = tool_input.get("file_path", "") or ""
    if not file_path:
        sys.exit(0)

    text = new_text_from(tool_name, tool_input)
    if not text:
        sys.exit(0)

    in_web = "/web/" in file_path

    # --- Violation A: third-party require() in root server.js ---
    if not in_web and (file_path.endswith("/server.js") or file_path == "server.js"):
        for match in REQUIRE_RE.finditer(text):
            module_id = match.group(2)
            if not is_builtin(module_id):
                sys.stderr.write(
                    "BLOCKED: server.js is intentionally ZERO-DEPENDENCY (Node stdlib only), "
                    "require(\"%s\") pulls in a third-party package. Use a Node builtin instead, "
                    "or if this is a deliberate architecture change, first update CLAUDE.md and "
                    "get explicit approval, then disable this hook in .claude/settings.json.\n"
                    % module_id
                )
                sys.exit(2)

    # --- Violation B: non-empty dependencies in ROOT package.json ---
    if not in_web and file_path.split("/")[-1] == "package.json":
        violated = False
        if tool_name == "Write":
            try:
                parsed = json.loads(text)
                deps = parsed.get("dependencies")
                violated = isinstance(deps, dict) and len(deps) > 0
            except Exception:
                # fall back to the heuristic if the content isn't valid JSON
                violated = re.search(r'"dependencies"\s*:\s*\{(?!\s*\})', text) is not None
        else:
            violated = re.search(r'"dependencies"\s*:\s*\{(?!\s*\})', text) is not None
        if violated:
            sys.stderr.write(
                "BLOCKED: the root package.json must stay dependency-free, the emulator runs on "
                "Node stdlib only (web/package.json is the place for frontend deps). If this is a "
                "deliberate architecture change, first update CLAUDE.md and get explicit approval, "
                "then disable this hook in .claude/settings.json.\n"
            )
            sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
