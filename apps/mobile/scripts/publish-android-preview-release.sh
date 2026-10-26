#!/usr/bin/env bash
set -euo pipefail

apk_asset_name="t3-code-preview.apk"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
app_dir="$(cd -- "$script_dir/.." && pwd)"
repo_root="$(git -C "$app_dir" rev-parse --show-toplevel)"
release_repository="${T3CODE_MOBILE_GITHUB_RELEASE_REPOSITORY:-}"

if ! gh auth status >/dev/null 2>&1; then
  echo "Authenticate GitHub CLI first using 'gh auth login'." >&2
  exit 1
fi
if [[ -z "$release_repository" ]]; then
  release_repository="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi
if [[ ! "$release_repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "T3CODE_MOBILE_GITHUB_RELEASE_REPOSITORY must be owner/repository." >&2
  exit 1
fi

if [[ -n "$(git -C "$repo_root" status --porcelain)" ]]; then
  echo "Commit and push the build inputs, then run this from a clean checkout." >&2
  exit 1
fi

if ! eas whoami >/dev/null 2>&1; then
  echo "Authenticate with Expo first using 'eas login' or EXPO_TOKEN." >&2
  exit 1
fi

source_commit="$(git -C "$repo_root" rev-parse HEAD)"
if ! gh api "repos/$release_repository/commits/$source_commit" >/dev/null; then
  echo "Push this source commit to $release_repository before publishing its APK." >&2
  exit 1
fi

sdk_root="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
aapt="$(command -v aapt || true)"
if [[ -z "$aapt" && -n "$sdk_root" && -d "$sdk_root/build-tools" ]]; then
  aapt="$(find "$sdk_root/build-tools" -mindepth 2 -maxdepth 2 -type f -name aapt -print | sort -V | tail -n 1)"
fi
if [[ -z "$aapt" ]]; then
  echo "Could not find Android SDK build-tools aapt; install Android SDK build-tools and set ANDROID_HOME." >&2
  exit 1
fi

artifact_dir="$(mktemp -d)"
trap 'rm -rf "$artifact_dir"' EXIT
release_apk="$artifact_dir/$apk_asset_name"

(
  cd "$app_dir"
  eas build \
    --profile preview \
    --platform android \
    --local \
    --output "$release_apk" \
    --non-interactive
)

if [[ ! -s "$release_apk" ]]; then
  echo "The local EAS build did not produce $release_apk." >&2
  exit 1
fi

version_code="$("$aapt" dump badging "$release_apk" | sed -n "s/^package: name='[^']*' versionCode='\([0-9][0-9]*\)'.*/\1/p" | head -n 1)"
if [[ ! "$version_code" =~ ^[1-9][0-9]*$ ]]; then
  echo "Could not read Android versionCode from the built APK." >&2
  exit 1
fi

tag="android-preview-$version_code"
if gh release view "$tag" --repo "$release_repository" >/dev/null 2>&1; then
  echo "GitHub release $tag already exists; refusing to replace it." >&2
  exit 1
fi
if gh api "repos/$release_repository/git/ref/tags/$tag" >/dev/null 2>&1; then
  echo "GitHub tag $tag already exists; refusing to publish against it." >&2
  exit 1
fi

gh release create "$tag" "$release_apk" \
  --repo "$release_repository" \
  --target "$source_commit" \
  --title "T3 Code Preview $version_code" \
  --notes "Android Preview APK built locally. Source commit: $source_commit."

echo "Published https://github.com/$release_repository/releases/tag/$tag"
