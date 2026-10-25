#!/usr/bin/env python3
"""Set the app version everywhere so browsers fetch fresh files after a release.

Usage: python3 tools/bump_version.py 1.0.2
Rewrites every relative .js import in app/js, the script/style links in app/index.html,
and APP_VERSION in app/js/config.js. All files must use the same version, otherwise the
browser loads a module twice."""
import re, sys, pathlib
v = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent.parent / 'app'
for f in (root / 'js').glob('*.js'):
    s = f.read_text()
    s = re.sub(r"""(['"]\./[\w-]+\.js)(\?v=[\w.]+)?(['"])""", rf"\1?v={v}\3", s)
    if f.name == 'config.js':
        s = re.sub(r"APP_VERSION = '[^']*'", f"APP_VERSION = '{v}'", s)
    f.write_text(s)
idx = root / 'index.html'
s = idx.read_text()
s = re.sub(r'(src="js/main\.js)(\?v=[\w.]+)?"', rf'\1?v={v}"', s)
s = re.sub(r'(href="css/app\.css)(\?v=[\w.]+)?"', rf'\1?v={v}"', s)
idx.write_text(s)
print('version', v)
