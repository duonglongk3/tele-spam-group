# imghdr polyfill for Python 3.13+
# This module was removed from standard library in Python 3.13.
# Telethon 1.24.0 requires it to detect image types.

tests = []

def what(file, h=None):
    if h is None:
        if isinstance(file, (str, bytes)):
            try:
                with open(file, 'rb') as f:
                    h = f.read(32)
            except:
                return None
        else:
            try:
                location = file.tell()
                h = file.read(32)
                file.seek(location)
            except:
                return None
                
    if not h:
        return None
        
    for tf in tests:
        res = tf(h, file)
        if res:
            return res
    return None

def test_jpeg(h, f):
    if h[6:10] in (b'JFIF', b'Exif') or h[:2] == b'\xff\xd8':
        return 'jpeg'
tests.append(test_jpeg)

def test_png(h, f):
    if h.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'png'
tests.append(test_png)

def test_gif(h, f):
    if h[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
tests.append(test_gif)

def test_tiff(h, f):
    if h[:2] in (b'MM', b'II'):
        return 'tiff'
tests.append(test_tiff)

def test_rgb(h, f):
    if h.startswith(b'\x01\xda'):
        return 'rgb'
tests.append(test_rgb)

def test_pbm(h, f):
    if len(h) >= 3 and h[0] == ord('P') and h[1] in (ord('1'), ord('4')) and h[2] in (ord(' '), ord('\t'), ord('\n'), ord('\r')):
        return 'pbm'
tests.append(test_pbm)

def test_pgm(h, f):
    if len(h) >= 3 and h[0] == ord('P') and h[1] in (ord('2'), ord('5')) and h[2] in (ord(' '), ord('\t'), ord('\n'), ord('\r')):
        return 'pgm'
tests.append(test_pgm)

def test_ppm(h, f):
    if len(h) >= 3 and h[0] == ord('P') and h[1] in (ord('3'), ord('6')) and h[2] in (ord(' '), ord('\t'), ord('\n'), ord('\r')):
        return 'ppm'
tests.append(test_ppm)

def test_rast(h, f):
    if h.startswith(b'\x59\xa6\x6a\x95'):
        return 'rast'
tests.append(test_rast)

def test_xbm(h, f):
    if h.startswith(b'#define '):
        return 'xbm'
tests.append(test_xbm)

def test_bmp(h, f):
    if h.startswith(b'BM'):
        return 'bmp'
tests.append(test_bmp)

def test_webp(h, f):
    if h.startswith(b'RIFF') and h[8:12] == b'WEBP':
        return 'webp'
tests.append(test_webp)

def test_exr(h, f):
    if h.startswith(b'\x76\x2f\x31\x01'):
        return 'exr'
tests.append(test_exr)
