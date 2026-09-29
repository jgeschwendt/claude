#!/bin/sh
set -eu

FLAG="${XDG_STATE_HOME:-$HOME/.local/state}/afk/flag"
POLL="${AFK_POLL_SECONDS:-5}"

AWAY_TAIL="Adopt the /afk posture now: keep working autonomously, never block on questions (pick defaults, note assumptions), park anything irreversible or outward-facing, batch questions, and hold a compact done/in-flight/needs-you recap for their next message. If you set this flag yourself or are already in the posture, ignore this line."
RETURN_LINE="AFK: owner returned. Drop the /afk posture; deliver your recap when they next address this session. If you cleared the flag yourself, ignore this line."

state=absent
content=""

# Sets $state/$content. The flag can vanish between the test and the read, so the
# read is failure-tolerant and the existence test is repeated after it.
snapshot() {
	if [ -f "$FLAG" ]; then
		content=$(head -n 1 "$FLAG" 2>/dev/null || true)
		if [ -f "$FLAG" ]; then
			state=present
		else
			state=absent
			content=""
		fi
	else
		state=absent
		content=""
	fi
}

# Flag content is one line: "<ISO-8601 timestamp> <reason...>", reason optional.
emit_away() {
	case "$1" in
	*\ *)
		stamp=${1%% *}
		reason=${1#* }
		;;
	*)
		stamp=$1
		reason=""
		;;
	esac
	[ -n "$stamp" ] || stamp="an unknown time"
	[ -n "$reason" ] || reason="no reason given"
	printf 'AFK: owner stepped away (%s, since %s). %s\n' "$reason" "$stamp" "$AWAY_TAIL"
}

# A session launched mid-absence must learn the state it woke up into.
snapshot
[ "$state" = absent ] || emit_away "$content"
prev_state=$state
prev_content=$content

while :; do
	sleep "$POLL"
	snapshot
	if [ "$state" = present ]; then
		if [ "$prev_state" != present ] || [ "$content" != "$prev_content" ]; then
			emit_away "$content"
		fi
	elif [ "$prev_state" = present ]; then
		printf '%s\n' "$RETURN_LINE"
	fi
	prev_state=$state
	prev_content=$content
done
