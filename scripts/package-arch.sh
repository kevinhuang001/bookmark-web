#!/usr/bin/env bash
set -euo pipefail
# Run from the repository root after the native Linux build.
package_stage="$(mktemp -d)"
trap 'rm -rf "$package_stage"' EXIT
install -m755 src-tauri/target/x86_64-unknown-linux-gnu/release/glassmark "$package_stage/glassmark"
install -m644 packaging/glassmark.desktop "$package_stage/glassmark.desktop"
install -m644 src-tauri/icons/128x128@2x.png "$package_stage/glassmark.png"
install -m644 LICENSE "$package_stage/LICENSE"
install -m644 packaging/arch/PKGBUILD "$package_stage/PKGBUILD"
# Stamp the version from the same source used for every other release asset.
package_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json')).version")"
sed -i "s/^pkgver=.*/pkgver=$package_version/" "$package_stage/PKGBUILD"
# Use makepkg itself so pacman metadata, file lists and archive format stay native.
docker run --rm --env "BUILD_UID=$(id -u)" -v "$package_stage:/build" -w /build archlinux:base-devel bash -euc '
  if [ "$BUILD_UID" -eq 0 ]; then BUILD_UID=1000; fi
  useradd --create-home --uid "$BUILD_UID" builder
  chown -R builder:builder /build
  runuser -u builder -- makepkg --nodeps --noconfirm
  pacman -Sy --noconfirm
  pacman -U --noconfirm ./*.pkg.tar.zst
  pacman -Qip ./*.pkg.tar.zst
  if ldd /usr/bin/glassmark | grep "not found"; then exit 1; fi
  pacman -Qlp ./*.pkg.tar.zst | grep -q "usr/bin/glassmark$"
  bsdtar -xOf ./*.pkg.tar.zst usr/bin/glassmark > /tmp/packaged-glassmark
  cmp glassmark /tmp/packaged-glassmark
'
mkdir -p dist/linux
cp "$package_stage/"*.pkg.tar.zst dist/linux/
