#!/usr/bin/env python3
"""
Static file server for css-inspector skill.
Usage: python3 server.py [port] [directory]
Defaults: port=8787, directory=current working directory
"""
import sys
import os
from http.server import HTTPServer, SimpleHTTPRequestHandler

class CORSHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        pass  # suppress request logging

def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8787
    directory = sys.argv[2] if len(sys.argv) > 2 else os.getcwd()
    os.chdir(directory)
    server = HTTPServer(('localhost', port), CORSHandler)
    print(f'Inspector server running at http://localhost:{port}', flush=True)
    server.serve_forever()

if __name__ == '__main__':
    main()
