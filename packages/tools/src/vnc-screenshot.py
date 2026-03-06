#!/usr/bin/env python3
"""
VNC Screenshot Capture - captures a screenshot from a VNC server.
Uses RFB protocol with VNCAuth (type 2) to authenticate.
Outputs base64-encoded PNG to stdout.

Usage:
  python3 vnc-screenshot.py HOST PORT PASSWORD [OUTPUT_FILE]

If OUTPUT_FILE is not provided, outputs base64 to stdout.
If OUTPUT_FILE is "-b64", outputs base64 to stdout.
"""

import sys
import socket
import struct
import hashlib
import io
import base64

try:
    from PIL import Image
except ImportError:
    # Fallback: output raw BMP-like data
    Image = None

# DES encryption for VNC auth
def vnc_des_encrypt(key_bytes, challenge):
    """VNC uses a modified DES where bits in each byte are reversed."""
    try:
        from Crypto.Cipher import DES
    except ImportError:
        try:
            from Cryptodome.Cipher import DES
        except ImportError:
            # Minimal DES implementation for VNC
            raise ImportError("Need pycryptodome: pip3 install pycryptodome")

    # VNC reverses bits in each byte of the key
    reversed_key = bytes(
        int('{:08b}'.format(b)[::-1], 2) for b in key_bytes
    )
    cipher = DES.new(reversed_key, DES.MODE_ECB)
    return cipher.encrypt(challenge)


def capture_vnc_screenshot(host, port, password, output_file=None):
    """Connect to VNC server, authenticate, and capture framebuffer."""

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(15)
    sock.connect((host, port))

    # 1. Protocol version handshake
    server_version = sock.recv(12)
    # Send our version (3.8)
    sock.send(b'RFB 003.008\n')

    # 2. Security types
    num_types = struct.unpack('B', sock.recv(1))[0]
    if num_types == 0:
        # Error
        err_len = struct.unpack('>I', sock.recv(4))[0]
        err_msg = sock.recv(err_len).decode('utf-8', errors='replace')
        raise Exception(f"VNC error: {err_msg}")

    security_types = list(sock.recv(num_types))

    # Prefer VNCAuth (type 2)
    if 2 in security_types:
        sock.send(struct.pack('B', 2))

        # VNC authentication
        challenge = sock.recv(16)

        # Pad/truncate password to 8 bytes
        key = (password.encode('utf-8') + b'\x00' * 8)[:8]

        # Encrypt challenge with DES
        response = vnc_des_encrypt(key, challenge[:8]) + vnc_des_encrypt(key, challenge[8:16])
        sock.send(response)

        # Check auth result
        auth_result = struct.unpack('>I', sock.recv(4))[0]
        if auth_result != 0:
            raise Exception(f"VNC authentication failed (result: {auth_result})")
    elif 1 in security_types:
        # No auth
        sock.send(struct.pack('B', 1))
    else:
        raise Exception(f"No supported security type (offered: {security_types})")

    # 3. Client init (shared flag = 1)
    sock.send(struct.pack('B', 1))

    # 4. Server init
    server_init = sock.recv(24)
    width, height = struct.unpack('>HH', server_init[:4])
    bpp, depth, big_endian, true_color = struct.unpack('BBBB', server_init[4:8])
    r_max, g_max, b_max = struct.unpack('>HHH', server_init[8:14])
    r_shift, g_shift, b_shift = struct.unpack('BBB', server_init[14:17])
    # Padding
    _ = server_init[17:20]
    name_len = struct.unpack('>I', server_init[20:24])[0]
    name = sock.recv(name_len).decode('utf-8', errors='replace')

    sys.stderr.write(f"VNC: {name} {width}x{height} bpp={bpp}\n")

    # 5. Set pixel format (request 32bpp BGRA for simplicity)
    pixel_format = struct.pack('>BBBBHHHBBBxxx',
        32,   # bits per pixel
        24,   # depth
        0,    # big-endian (0 = little)
        1,    # true color
        255,  # red max
        255,  # green max
        255,  # blue max
        16,   # red shift
        8,    # green shift
        0,    # blue shift
    )
    msg = struct.pack('>Bxxx', 0) + pixel_format  # SetPixelFormat
    sock.send(msg)

    # 6. Set encodings (prefer Raw = 0)
    msg = struct.pack('>BxH', 2, 1)  # SetEncodings, 1 encoding
    msg += struct.pack('>i', 0)  # Raw encoding
    sock.send(msg)

    # 7. Request full framebuffer update
    msg = struct.pack('>BBHHHH', 3, 0, 0, 0, width, height)  # FramebufferUpdateRequest
    sock.send(msg)

    # 8. Receive framebuffer update
    framebuffer = bytearray(width * height * 4)  # BGRA

    def recv_exact(n):
        data = b''
        while len(data) < n:
            chunk = sock.recv(min(n - len(data), 65536))
            if not chunk:
                raise Exception("Connection closed")
            data += chunk
        return data

    while True:
        msg_type = struct.unpack('B', recv_exact(1))[0]

        if msg_type == 0:  # FramebufferUpdate
            _ = recv_exact(1)  # padding
            num_rects = struct.unpack('>H', recv_exact(2))[0]

            for _ in range(num_rects):
                rx, ry, rw, rh, encoding = struct.unpack('>HHHHi', recv_exact(12))

                if encoding == 0:  # Raw
                    rect_data = recv_exact(rw * rh * 4)
                    # Copy rect data into framebuffer
                    for row in range(rh):
                        src_offset = row * rw * 4
                        dst_offset = ((ry + row) * width + rx) * 4
                        framebuffer[dst_offset:dst_offset + rw * 4] = rect_data[src_offset:src_offset + rw * 4]
                else:
                    sys.stderr.write(f"Unsupported encoding: {encoding}\n")
                    break

            break  # Got the framebuffer

        elif msg_type == 1:  # SetColorMapEntries
            _ = recv_exact(1)  # padding
            first_color = struct.unpack('>H', recv_exact(2))[0]
            num_colors = struct.unpack('>H', recv_exact(2))[0]
            _ = recv_exact(num_colors * 6)  # RGB values

        elif msg_type == 2:  # Bell
            pass

        elif msg_type == 3:  # ServerCutText
            _ = recv_exact(3)  # padding
            text_len = struct.unpack('>I', recv_exact(4))[0]
            _ = recv_exact(text_len)

        else:
            sys.stderr.write(f"Unknown message type: {msg_type}\n")
            break

    sock.close()

    # Convert BGRA framebuffer to PNG
    if Image:
        # Convert BGRA to RGBA
        rgba_data = bytearray(len(framebuffer))
        for i in range(0, len(framebuffer), 4):
            rgba_data[i] = framebuffer[i + 2]      # R <- B
            rgba_data[i + 1] = framebuffer[i + 1]  # G
            rgba_data[i + 2] = framebuffer[i]       # B <- R
            rgba_data[i + 3] = 255                   # A

        img = Image.frombytes('RGBA', (width, height), bytes(rgba_data))

        if output_file and output_file != '-b64':
            img.save(output_file, 'PNG')
            print(f"OK:{width}x{height}")
        else:
            buf = io.BytesIO()
            img.save(buf, 'PNG')
            b64 = base64.b64encode(buf.getvalue()).decode('ascii')
            print(b64)
    else:
        # Without PIL, output raw base64 of BMP-ish data
        sys.stderr.write("Warning: PIL not available, outputting raw BGRA data\n")
        b64 = base64.b64encode(bytes(framebuffer)).decode('ascii')
        print(b64)

    return width, height


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(f"Usage: {sys.argv[0]} HOST PORT PASSWORD [OUTPUT_FILE]", file=sys.stderr)
        sys.exit(1)

    host = sys.argv[1]
    port = int(sys.argv[2])
    password = sys.argv[3]
    output = sys.argv[4] if len(sys.argv) > 4 else '-b64'

    try:
        capture_vnc_screenshot(host, port, password, output)
    except Exception as e:
        print(f"ERR: {e}", file=sys.stderr)
        sys.exit(1)
