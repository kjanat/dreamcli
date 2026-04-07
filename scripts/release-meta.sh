#!/usr/bin/env bash

set -euo pipefail

target="${1:-}"

if [[ -z "${target}" ]]; then
	echo 'usage: scripts/release-meta.sh <npm|jsr>'
	exit 1
fi

if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
	echo 'GITHUB_OUTPUT is not set'
	exit 1
fi

if ! command -v yq >/dev/null 2>&1; then
	echo 'yq not found on runner'
	exit 1
fi

read_field() {
	local file="$1"
	local query="$2"
	yq -r "${query}" "${file}"
}

validate_release_tag() {
	local version="$1"

	if [[ "${GITHUB_EVENT_NAME:-}" != 'release' ]]; then
		return
	fi

	local expected="v${version}"

	if [[ -z "${RELEASE_TAG:-}" ]]; then
		echo 'release event missing tag_name'
		exit 1
	fi

	if [[ "${RELEASE_TAG}" != "${expected}" ]]; then
		printf "Release tag '%s' does not match package version '%s'\n" "${RELEASE_TAG}" "${expected}"
		exit 1
	fi
}

case "${target}" in
npm)
	package="$(read_field packages/dreamcli/package.json '.name // ""')"
	version="$(read_field packages/dreamcli/package.json '.version // ""')"

	if [[ -z "${package}" ]]; then
		echo 'package.json missing .name'
		exit 1
	fi

	if [[ -z "${version}" ]]; then
		echo 'package.json missing .version'
		exit 1
	fi

	validate_release_tag "${version}"

	url="https://www.npmjs.com/package/${package}/v/${version}"
	# yq -n builds one-line JSON; strenv() pulls PACKAGE/VERSION/URL from this env assignment.
	meta_json="$(PACKAGE="${package}" VERSION="${version}" URL="${url}" yq -n -o=json -I=0 '.package = strenv(PACKAGE) | .version = strenv(VERSION) | .url = strenv(URL)')"
	;;

jsr)
	deno_package="$(read_field packages/dreamcli/deno.json '.name // ""')"
	package_name="$(read_field packages/dreamcli/package.json '.name // ""')"
	deno_version="$(read_field packages/dreamcli/deno.json '.version // ""')"
	package_version="$(read_field packages/dreamcli/package.json '.version // ""')"

	if [[ -z "${deno_package}" ]]; then
		echo 'deno.json missing .name'
		exit 1
	fi

	if [[ -z "${package_name}" ]]; then
		echo 'package.json missing .name'
		exit 1
	fi

	if [[ -z "${deno_version}" ]]; then
		echo 'deno.json missing .version'
		exit 1
	fi

	if [[ -z "${package_version}" ]]; then
		echo 'package.json missing .version'
		exit 1
	fi

	if [[ "${deno_version}" != "${package_version}" ]]; then
		printf "Version mismatch: deno.json=%s package.json=%s\n" "${deno_version}" "${package_version}"
		exit 1
	fi

	if [[ "${deno_package}" != "${package_name}" ]]; then
		printf "Name mismatch: deno.json=%s package.json=%s\n" "${deno_package}" "${package_name}"
		exit 1
	fi

	validate_release_tag "${deno_version}"

	url="https://jsr.io/${deno_package}@${deno_version}"
	# yq -n builds one-line JSON; strenv() pulls PACKAGE/VERSION/URL from this env assignment.
	meta_json="$(PACKAGE="${deno_package}" VERSION="${deno_version}" URL="${url}" yq -n -o=json -I=0 '.package = strenv(PACKAGE) | .version = strenv(VERSION) | .url = strenv(URL)')"
	;;

*)
	printf "unknown target: %s (expected npm|jsr)\n" "${target}"
	exit 1
	;;
esac

printf 'meta=%s\n' "${meta_json}" >>"${GITHUB_OUTPUT}"
