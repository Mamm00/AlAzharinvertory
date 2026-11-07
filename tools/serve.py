#!/usr/bin/env python3
"""
serve.py — a local GitHub Pages, including the part Pages is famous for.

    python3 tools/serve.py [port]      # default 8080, serves site/

Pages is a static host: /app/reports does not exist, /app is not a directory
entry, and a missing path answers 404 — with the body of 404.html. That
behaviour is the whole reason the app routes on the hash and why site/404.html
exists, so this server reproduces it instead of smoothing it over: a plain
`python3 -m http.server` quietly 404s with an empty page and you only find the
bug after deploying.

Everything else is the stdlib handler: index.html for a directory, correct
MIME types, no caching, no rewrites.
"""
import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'site')


class PagesLike(http.server.SimpleHTTPRequestHandler):
    def send_error(self, code, message=None, explain=None):
        if code == 404 and os.path.isfile(os.path.join(ROOT, '404.html')):
            with open(os.path.join(ROOT, '404.html'), 'rb') as fh:
                body = fh.read()
            self.send_response(404, 'Not Found')
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')   # so a rebuild is visible
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    if not os.path.isfile(os.path.join(ROOT, 'index.html')):
        raise SystemExit('serve: site/index.html missing — run python3 tools/build_site.py')
    os.chdir(ROOT)
    srv = http.server.ThreadingHTTPServer(('0.0.0.0', port), PagesLike)
    print('serving %s on 0.0.0.0:%d  (Pages rules: 404 + site/404.html)' % (ROOT, port), flush=True)
    srv.serve_forever()


if __name__ == '__main__':
    main()
