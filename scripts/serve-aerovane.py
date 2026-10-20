#!/usr/bin/env python3
"""Serve an AeroVane production package on loopback only."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

parser = argparse.ArgumentParser()
parser.add_argument("--directory", required=True)
parser.add_argument("--port", type=int, default=4173)
args = parser.parse_args()

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        clean_path = self.path.split('?')[0].split('#')[0].lower()
        if clean_path.endswith((".html", "/sw.js", ".webmanifest", ".js", ".css", ".json")) or clean_path.endswith("/"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=args.directory))
server.serve_forever()
