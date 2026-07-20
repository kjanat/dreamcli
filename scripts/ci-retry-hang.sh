#!/usr/bin/env bash

set -uo pipefail

if (($# < 2)); then
	echo 'usage: scripts/ci-retry-hang.sh <seconds> <command> [args...]'
	exit 1
fi

limit="$1"
shift

for attempt in 1 2 3; do
	timeout --kill-after=5 "${limit}" "$@"
	status=$?
	if ((status != 124)); then
		exit "${status}"
	fi
	echo "hang detected (>${limit}s) in: $* (attempt ${attempt}/3)"
done

echo "still hanging after 3 attempts: $*"
exit 124
