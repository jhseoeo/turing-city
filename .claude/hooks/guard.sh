#!/usr/bin/env bash
# PreToolUse guard, registered in .claude/settings.json; it runs for subagents too. See CLAUDE.md > Hooks.
# - Edit or Write on a package-manager lockfile: deny. Lockfiles change only through the package manager.
# - A Bash command that runs macOS `open` on an app, a URL, or a path: ask the user first. It brings a window to
#   the front and takes the user's focus.
input=$(cat)

decide() {   # $1: deny or ask, $2: the reason shown
  jq -n --arg d "$1" --arg r "$2" \
    '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: $d, permissionDecisionReason: $r}}'
  exit 0
}

lockfile='(^|/)(pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|bun\.lockb?)$'
# `open` where a command starts (line start, or after ; & | ( { or a backquote), followed by an option, a URL, or a
# path, so that prose such as a commit message line "open the menu" doesn't match.
takes_focus='(^|[;&|({`])[[:space:]]*open[[:space:]]+(-[[:alpha:]]|https?:|[^[:space:]]*[./])'

case "$(jq -r '.tool_name // empty' <<<"$input")" in
  Edit|Write|MultiEdit|NotebookEdit)
    file=$(jq -r '.tool_input.file_path // .tool_input.notebook_path // empty' <<<"$input")
    if [[ $file =~ $lockfile ]]; then
      decide deny "Lockfiles change only through the package manager (install, add, remove, update), not by hand. See CLAUDE.md > Hooks."
    fi
    ;;
  Bash)
    if jq -r '.tool_input.command // empty' <<<"$input" | grep -qE "$takes_focus"; then
      decide ask "This opens a window that takes the user's focus. CLAUDE.md allows it only with the user's OK; check the viewer headlessly instead."
    fi
    ;;
esac
exit 0
