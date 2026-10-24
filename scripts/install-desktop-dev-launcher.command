#!/bin/zsh
set -eu

repo_root="${0:A:h:h}"
launcher_app="$HOME/Applications/T3 Code Fork Dev.app"
launcher_info="$launcher_app/Contents/Info.plist"
launcher_id='com.t3tools.t3code.fork-dev-launcher'
desktop_link="$HOME/Desktop/T3 Code Fork Dev.app"

if [[ -e "$launcher_app" ]]; then
  installed_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$launcher_info" 2>/dev/null || true)
  if [[ "$installed_id" != "$launcher_id" ]]; then
    print -u2 "An unrelated app already exists at $launcher_app. Move it before installing."
    exit 1
  fi
fi

mkdir -p "${launcher_app:h}"
/usr/bin/osacompile -o "$launcher_app" <<'APPLESCRIPT'
on run
  set launcherPath to POSIX path of (path to resource "Launch.command")
  do shell script "/usr/bin/open " & quoted form of launcherPath
end run
APPLESCRIPT

/usr/bin/plutil -replace CFBundleIdentifier -string "$launcher_id" "$launcher_info"
/usr/bin/plutil -replace CFBundleDisplayName -string 'T3 Code Fork Dev' "$launcher_info"
/usr/bin/plutil -replace CFBundleName -string 'T3 Code Fork Dev' "$launcher_info"
launcher_command="$launcher_app/Contents/Resources/Launch.command"
rm -f "$launcher_command"
printf '#!/bin/zsh -l\nexec /bin/zsh -l %q "$@"\n' "$repo_root/scripts/launch-desktop-dev.command" > "$launcher_command"
chmod +x "$launcher_command"

launcher_tmp=$(mktemp -d "${TMPDIR:-/tmp}/t3code-dev-launcher.XXXXXX")
trap 'rm -rf "$launcher_tmp"' EXIT
mkdir "$launcher_tmp/launcher.iconset"
for icon_size in 16 32 128 256 512; do
  for icon_scale in 1 2; do
    icon_pixels=$((icon_size * icon_scale))
    icon_suffix=''
    [[ "$icon_scale" == 1 ]] || icon_suffix='@2x'
    /usr/bin/sips -z "$icon_pixels" "$icon_pixels" "$repo_root/assets/dev/blueprint-macos-1024.png" \
      --out "$launcher_tmp/launcher.iconset/icon_${icon_size}x${icon_size}${icon_suffix}.png" >/dev/null
  done
done
/usr/bin/iconutil -c icns "$launcher_tmp/launcher.iconset" -o "$launcher_app/Contents/Resources/applet.icns"
/usr/bin/codesign --force --sign - --timestamp=none "$launcher_app"

if [[ ! -e "$desktop_link" && ! -L "$desktop_link" ]]; then
  ln -s "$launcher_app" "$desktop_link"
fi

print "Installed $launcher_app"
print "Double-click it to open Terminal and start Electron. Keep the dev terminal open while using the app."
