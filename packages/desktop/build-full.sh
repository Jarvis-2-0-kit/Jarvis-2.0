#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
APP_NAME="Jarvis 2.0"
APP_BUNDLE="$SCRIPT_DIR/$APP_NAME.app"
STAGE="/tmp/jarvis-app-stage"

echo "═══════════════════════════════════════════════════"
echo "  Building Jarvis 2.0 — All-in-One macOS App"
echo "═══════════════════════════════════════════════════"
echo ""

# ─── Step 1: Build all packages ─────────────────────

echo "[1/6] Building packages..."
cd "$PROJECT_ROOT"
pnpm -r build 2>&1 | grep -E 'Build complete|built in|ERROR' || true
echo "  Done."

# ─── Step 2: Compile Swift binary ────────────────────

echo "[2/6] Compiling native app..."
swiftc "$SCRIPT_DIR/JarvisApp.swift" \
    -o "$SCRIPT_DIR/JarvisApp" \
    -framework Cocoa \
    -framework WebKit \
    -O \
    -whole-module-optimization
echo "  Done."

# ─── Step 3: Create staging area ────────────────────

echo "[3/6] Staging JS payload..."
rm -rf "$STAGE"
mkdir -p "$STAGE/packages/gateway/dist"
mkdir -p "$STAGE/packages/dashboard/dist"
mkdir -p "$STAGE/packages/shared/dist"

# Copy built artifacts
cp "$PROJECT_ROOT/packages/gateway/dist/index.js" "$STAGE/packages/gateway/dist/"
cp -r "$PROJECT_ROOT/packages/dashboard/dist/"* "$STAGE/packages/dashboard/dist/"
cp "$PROJECT_ROOT/packages/shared/dist/index.js" "$STAGE/packages/shared/dist/"

# Create minimal package.json files
cat > "$STAGE/package.json" << 'EOF'
{ "name": "jarvis-app", "private": true }
EOF

cat > "$STAGE/packages/shared/package.json" << 'EOF'
{ "name": "@jarvis/shared", "version": "0.1.0", "type": "module", "main": "dist/index.js", "exports": { ".": "./dist/index.js" }, "dependencies": { "zod": "^3.25.0" } }
EOF

# Extract gateway deps (exclude internal packages not needed at runtime)
node -e "
const gw = require('$PROJECT_ROOT/packages/gateway/package.json');
const deps = { ...gw.dependencies };
delete deps['@jarvis/tools'];
delete deps['@jarvis/agent-runtime'];
deps['@jarvis/shared'] = 'file:../shared';
const pkg = { name: '@jarvis/gateway', version: '0.1.0', type: 'module', main: 'dist/index.js', dependencies: deps };
console.log(JSON.stringify(pkg, null, 2));
" > "$STAGE/packages/gateway/package.json"

# Install production deps with npm (flat node_modules, no symlinks)
cd "$STAGE/packages/gateway"
npm install --omit=dev --install-links 2>&1 | tail -3
cd "$STAGE/packages/shared"
npm install --omit=dev 2>&1 | tail -3
cd "$STAGE"
echo "  Payload: $(du -sh "$STAGE" | cut -f1)"

# ─── Step 4: Locate binaries ────────────────────────

echo "[4/6] Collecting binaries..."

NODE_BIN=$(which node)
NATS_BIN=$(which nats-server)
REDIS_BIN=$(which redis-server)

for bin in "$NODE_BIN" "$NATS_BIN" "$REDIS_BIN"; do
    if [ ! -f "$bin" ] && [ -L "$bin" ]; then
        bin=$(readlink -f "$bin" 2>/dev/null || realpath "$bin")
    fi
    real=$(realpath "$bin" 2>/dev/null || echo "$bin")
    size=$(ls -lh "$real" | awk '{print $5}')
    echo "  $(basename "$bin"): $real ($size)"
done

# ─── Step 5: Assemble .app bundle ───────────────────

echo "[5/6] Assembling $APP_NAME.app..."

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources/app"

# Binary
mv "$SCRIPT_DIR/JarvisApp" "$APP_BUNDLE/Contents/MacOS/JarvisApp"

# Copy infrastructure binaries (follow symlinks)
cp -L "$NODE_BIN" "$APP_BUNDLE/Contents/MacOS/node"
cp -L "$NATS_BIN" "$APP_BUNDLE/Contents/MacOS/nats-server"
cp -L "$REDIS_BIN" "$APP_BUNDLE/Contents/MacOS/redis-server"

# Copy JS payload
cp -r "$STAGE/"* "$APP_BUNDLE/Contents/Resources/app/"

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
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleExecutable</key>
    <string>JarvisApp</string>
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

# Copy icon if it exists
if [ -f "$SCRIPT_DIR/AppIcon.icns" ]; then
    cp "$SCRIPT_DIR/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
fi

# Trim heavy optional deps not needed for core gateway
echo "  Trimming node_modules..."
GW_MODULES="$APP_BUNDLE/Contents/Resources/app/packages/gateway/node_modules"
for pkg in sharp @img protobufjs @types music-metadata strtok3 token-types \
           peek-readable @tokenizer @borewit @cacheable @keyv keyv \
           pino @pinojs sonic-boom thread-stream real-require safe-stable-stringify \
           fast-redact on-exit-leak-free atomic-sleep; do
  rm -rf "$GW_MODULES/$pkg" 2>/dev/null
done
find "$GW_MODULES" -name "*.map" -delete 2>/dev/null
find "$GW_MODULES" -name "*.d.ts" -delete 2>/dev/null
find "$GW_MODULES" \( -name "test" -o -name "tests" -o -name "__tests__" -o -name "docs" -o -name "example" -o -name "examples" \) -type d -exec rm -rf {} + 2>/dev/null

# ─── Step 6: Summary ────────────────────────────────

echo "[6/6] Done!"
echo ""
echo "═══════════════════════════════════════════════════"
echo "  $APP_NAME.app — All-in-One macOS Application"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Location: $APP_BUNDLE"
echo "  Size:     $(du -sh "$APP_BUNDLE" | cut -f1)"
echo ""

# Size breakdown
echo "  Breakdown:"
echo "    Swift binary:  $(ls -lh "$APP_BUNDLE/Contents/MacOS/JarvisApp" | awk '{print $5}')"
echo "    Node.js:       $(ls -lh "$APP_BUNDLE/Contents/MacOS/node" | awk '{print $5}')"
echo "    NATS:          $(ls -lh "$APP_BUNDLE/Contents/MacOS/nats-server" | awk '{print $5}')"
echo "    Redis:         $(ls -lh "$APP_BUNDLE/Contents/MacOS/redis-server" | awk '{print $5}')"
echo "    JS Payload:    $(du -sh "$APP_BUNDLE/Contents/Resources/app" | cut -f1)"
echo ""
echo "  Install:  cp -r \"$APP_BUNDLE\" /Applications/"
echo "  Run:      open \"$APP_BUNDLE\""
echo ""

# Clean up staging
rm -rf "$STAGE"
