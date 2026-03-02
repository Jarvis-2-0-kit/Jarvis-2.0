#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="Jarvis Dashboard"
APP_BUNDLE="$SCRIPT_DIR/$APP_NAME.app"
EXECUTABLE="JarvisDashboard"

echo "Building $APP_NAME..."

# Compile Swift → native binary
swiftc "$SCRIPT_DIR/JarvisDashboard.swift" \
    -o "$SCRIPT_DIR/$EXECUTABLE" \
    -framework Cocoa \
    -framework WebKit \
    -O \
    -whole-module-optimization

echo "Creating .app bundle..."

# Create .app bundle structure
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Move binary
mv "$SCRIPT_DIR/$EXECUTABLE" "$APP_BUNDLE/Contents/MacOS/$EXECUTABLE"

# Info.plist
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>Jarvis Dashboard</string>
    <key>CFBundleDisplayName</key>
    <string>Jarvis 2.0 Dashboard</string>
    <key>CFBundleIdentifier</key>
    <string>com.jarvis.dashboard</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
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

# Generate app icon (simple programmatic icon using sips)
# Create a 512x512 icon from text if no icon exists
if [ ! -f "$SCRIPT_DIR/AppIcon.icns" ]; then
    echo "Generating app icon..."
    # Create icon using Python + Core Graphics
    python3 -c "
import subprocess, tempfile, os
# Create a simple SVG icon
svg = '''<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"512\" height=\"512\" viewBox=\"0 0 512 512\">
  <defs>
    <linearGradient id=\"bg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\">
      <stop offset=\"0%\" stop-color=\"#1a1a2e\"/>
      <stop offset=\"100%\" stop-color=\"#0f0f1a\"/>
    </linearGradient>
  </defs>
  <rect width=\"512\" height=\"512\" rx=\"100\" fill=\"url(#bg)\"/>
  <text x=\"256\" y=\"280\" text-anchor=\"middle\" font-family=\"Helvetica Neue\" font-weight=\"700\" font-size=\"200\" fill=\"#f472b6\">J</text>
  <text x=\"256\" y=\"380\" text-anchor=\"middle\" font-family=\"Helvetica Neue\" font-weight=\"300\" font-size=\"60\" fill=\"#64748b\">2.0</text>
</svg>'''
tmpsvg = tempfile.mktemp(suffix='.svg')
tmppng = tempfile.mktemp(suffix='.png')
with open(tmpsvg, 'w') as f:
    f.write(svg)
# Convert SVG to PNG using built-in qlmanage or sips
os.system(f'rsvg-convert -w 512 -h 512 {tmpsvg} -o {tmppng} 2>/dev/null || python3 -c \"import cairosvg; cairosvg.svg2png(url=\\\"{tmpsvg}\\\", write_to=\\\"{tmppng}\\\", output_width=512, output_height=512)\" 2>/dev/null')
if not os.path.exists(tmppng):
    # Fallback: create a simple colored PNG
    import struct, zlib
    w, h = 512, 512
    def create_png(width, height):
        def chunk(tag, data):
            c = tag + data
            return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
        raw = b''
        for y in range(height):
            raw += b'\x00'
            for x in range(width):
                # Dark gradient background with pink J-shape accent
                r = int(26 * (1 - y/height) + 15 * (y/height))
                g = int(26 * (1 - y/height) + 15 * (y/height))
                b = int(46 * (1 - y/height) + 26 * (y/height))
                # Pink circle in center
                dx, dy = x - width//2, y - height//2
                dist = (dx*dx + dy*dy) ** 0.5
                if dist < 160:
                    blend = max(0, 1 - dist/160)
                    r = int(r + (244 - r) * blend * 0.7)
                    g = int(g + (114 - g) * blend * 0.4)
                    b = int(b + (182 - b) * blend * 0.6)
                a = 255
                raw += struct.pack('BBBB', r, g, b, a)
        compressed = zlib.compress(raw)
        return (b'\x89PNG\r\n\x1a\n' +
                chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) +
                chunk(b'IDAT', compressed) +
                chunk(b'IEND', b''))
    png_data = create_png(w, h)
    with open(tmppng, 'wb') as f:
        f.write(png_data)
print(tmppng)
" > /tmp/jarvis_icon_path.txt 2>/dev/null

    ICON_PNG=$(cat /tmp/jarvis_icon_path.txt 2>/dev/null)
    if [ -f "$ICON_PNG" ]; then
        # Create iconset
        ICONSET="$SCRIPT_DIR/AppIcon.iconset"
        mkdir -p "$ICONSET"
        for size in 16 32 128 256 512; do
            sips -z $size $size "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null 2>&1
            double=$((size * 2))
            if [ $double -le 1024 ]; then
                sips -z $double $double "$ICON_PNG" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null 2>&1
            fi
        done
        iconutil -c icns "$ICONSET" -o "$SCRIPT_DIR/AppIcon.icns" 2>/dev/null || true
        rm -rf "$ICONSET"
    fi
fi

# Copy icon if it exists
if [ -f "$SCRIPT_DIR/AppIcon.icns" ]; then
    cp "$SCRIPT_DIR/AppIcon.icns" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
fi

echo ""
echo "Built: $APP_BUNDLE"
echo "Size: $(du -sh "$APP_BUNDLE" | cut -f1)"
echo ""
echo "To install: cp -r \"$APP_BUNDLE\" /Applications/"
echo "To run now: open \"$APP_BUNDLE\""
