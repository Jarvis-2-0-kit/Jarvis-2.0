#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_NAME="Jarvis 2.0"
APP_BUNDLE="$SCRIPT_DIR/$APP_NAME.app"
EXECUTABLE="JarvisDashboard"

echo "=== Building $APP_NAME (standalone) ==="

# 1. Compile Swift (JarvisApp.swift = standalone with bundled services)
echo "[1/5] Compiling Swift..."
swiftc "$SCRIPT_DIR/JarvisApp.swift" \
    -o "$SCRIPT_DIR/$EXECUTABLE" \
    -framework Cocoa \
    -framework WebKit \
    -O \
    -whole-module-optimization

# 2. Create .app bundle structure
echo "[2/5] Creating bundle structure..."
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources/app/packages/gateway/dist"
mkdir -p "$APP_BUNDLE/Contents/Resources/app/packages/dashboard/dist"

# Move binary
mv "$SCRIPT_DIR/$EXECUTABLE" "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE"

# Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Jarvis 2.0</string>
    <key>CFBundleDisplayName</key>
    <string>Jarvis 2.0</string>
    <key>CFBundleIdentifier</key>
    <string>com.jarvis.app</string>
    <key>CFBundleVersion</key>
    <string>2.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>2.0.0</string>
    <key>CFBundleExecutable</key>
    <string>JarvisDashboard</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
        <key>NSAllowsArbitraryLoads</key>
        <true/>
    </dict>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
</dict>
</plist>
PLIST

# 3. Bundle binaries (node, nats-server, redis-server)
echo "[3/5] Bundling binaries..."
BIN_DIR="$APP_BUNDLE/Contents/MacOS"

# Node: uses system node (bundling has dylib issues), app finds it at runtime
echo "  node: using system node (found at $(which node 2>/dev/null || echo '/opt/homebrew/bin/node'))"

# NATS server
NATS_BIN=$(which nats-server 2>/dev/null || echo "/opt/homebrew/bin/nats-server")
if [ -f "$NATS_BIN" ]; then
    cp "$NATS_BIN" "$BIN_DIR/nats-server"
    echo "  nats-server: $NATS_BIN"
else
    echo "WARNING: nats-server not found, app won't start NATS"
fi

# Redis server
REDIS_BIN=$(which redis-server 2>/dev/null || echo "/opt/homebrew/bin/redis-server")
if [ -f "$REDIS_BIN" ]; then
    cp "$REDIS_BIN" "$BIN_DIR/redis-server"
    echo "  redis-server: $REDIS_BIN"
else
    echo "WARNING: redis-server not found, app won't start Redis"
fi

# 4. Bundle application code
echo "[4/5] Bundling application code..."
RES_APP="$APP_BUNDLE/Contents/Resources/app"

# Gateway dist (compiled JS)
cp -r "$MONOREPO/packages/gateway/dist/"* "$RES_APP/packages/gateway/dist/"
echo "  gateway dist: $(du -sh "$RES_APP/packages/gateway/dist" | cut -f1)"

# Dashboard dist (compiled frontend)
cp -r "$MONOREPO/packages/dashboard/dist/"* "$RES_APP/packages/dashboard/dist/"
echo "  dashboard dist: $(du -sh "$RES_APP/packages/dashboard/dist" | cut -f1)"

# Gateway needs node_modules at runtime (ws, express, zod, nats, ioredis, etc.)
# Copy from monorepo root + gateway-specific modules
echo "  Copying node_modules (production only)..."

# Root node_modules (shared deps)
mkdir -p "$RES_APP/node_modules"

# Use pnpm deploy to get a proper node_modules with all transitive deps
echo "  Running pnpm deploy for gateway (resolves all dependencies)..."
DEPLOY_TMP="$SCRIPT_DIR/.deploy-tmp"
rm -rf "$DEPLOY_TMP"
cd "$MONOREPO" && pnpm --filter @jarvis/gateway deploy "$DEPLOY_TMP" --prod --legacy 2>/dev/null

# Flatten pnpm's symlinked node_modules into real directories for app bundle
if [ -d "$DEPLOY_TMP/node_modules" ]; then
    echo "  Flattening node_modules (dereference symlinks)..."

    # 1. Copy ALL transitive deps from .pnpm/node_modules/ to top level first
    if [ -d "$DEPLOY_TMP/node_modules/.pnpm/node_modules" ]; then
        for item in "$DEPLOY_TMP/node_modules/.pnpm/node_modules/"*; do
            [ -e "$item" ] || continue
            name=$(basename "$item")
            [[ "$name" == @* ]] && continue  # handle scoped separately
            cp -rL "$item" "$RES_APP/node_modules/$name" 2>/dev/null || true
        done
        # Scoped transitive deps (@hapi, @types, etc.)
        for scope_dir in "$DEPLOY_TMP/node_modules/.pnpm/node_modules/@"*/; do
            [ -d "$scope_dir" ] || continue
            scope=$(basename "$scope_dir")
            mkdir -p "$RES_APP/node_modules/$scope"
            for pkg in "$scope_dir"*/; do
                [ -d "$pkg" ] || continue
                cp -rL "$pkg" "$RES_APP/node_modules/$scope/$(basename "$pkg")" 2>/dev/null || true
            done
        done
    fi

    # 2. Copy top-level packages (overwrite transitive with direct deps, dereference symlinks)
    for item in "$DEPLOY_TMP/node_modules/"*; do
        [ -e "$item" ] || continue
        name=$(basename "$item")
        [[ "$name" == .* ]] && continue  # skip .pnpm, .bin, .modules.yaml
        [[ "$name" == @* ]] && continue  # handle scoped separately
        cp -rL "$item" "$RES_APP/node_modules/$name" 2>/dev/null || true
    done
    # Scoped top-level packages (@jarvis, @whiskeysockets, etc.)
    for scope_dir in "$DEPLOY_TMP/node_modules/@"*/; do
        [ -d "$scope_dir" ] || continue
        scope=$(basename "$scope_dir")
        mkdir -p "$RES_APP/node_modules/$scope"
        for pkg in "$scope_dir"*/; do
            [ -d "$pkg" ] || continue
            cp -rL "$pkg" "$RES_APP/node_modules/$scope/$(basename "$pkg")" 2>/dev/null || true
        done
    done

    echo "  Packages: $(ls "$RES_APP/node_modules" | wc -l | tr -d ' ') top-level"
else
    echo "  ERROR: pnpm deploy failed!"
    exit 1
fi
rm -rf "$DEPLOY_TMP"

# Shared package dist
mkdir -p "$RES_APP/packages/shared/dist"
if [ -d "$MONOREPO/packages/shared/dist" ]; then
    cp -r "$MONOREPO/packages/shared/dist/"* "$RES_APP/packages/shared/dist/"
fi
cp "$MONOREPO/packages/shared/package.json" "$RES_APP/packages/shared/package.json" 2>/dev/null || true
cp "$MONOREPO/packages/gateway/package.json" "$RES_APP/packages/gateway/package.json" 2>/dev/null || true
cp "$MONOREPO/package.json" "$RES_APP/package.json" 2>/dev/null || true

echo "  node_modules: $(du -sh "$RES_APP/node_modules" 2>/dev/null | cut -f1)"

# 5. Icon
echo "[5/5] Icon..."
if [ -f "$SCRIPT_DIR/AppIcon.icns" ]; then
    cp "$SCRIPT_DIR/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
    echo "  Using existing icon"
else
    echo "  No icon found, skipping"
fi

echo ""
echo "=== Built: $APP_BUNDLE ==="
echo "Size: $(du -sh "$APP_BUNDLE" | cut -f1)"
echo ""
echo "To install: cp -r \"$APP_BUNDLE\" /Applications/"
echo "To run now: open \"$APP_BUNDLE\""
