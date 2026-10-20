#!/usr/bin/env python3
"""Mở port-forward tới Postgres của sandbox.

Postgres trên box KHÔNG publish ra host (chỉ nằm trong mạng docker), nên muốn chạy
script Prisma từ máy dev thì phải xuyên qua SSH tới IP container.
Dùng: tunnel.py <local_port>   (chạy nền, Ctrl-C để dừng)
"""
import select, socket, socketserver, sys, threading, pathlib, paramiko

HOST, PORT, USER = "103.88.122.23", 63379, "vlkt"
PW = pathlib.Path.home().joinpath(".hcmus-sbpass").read_text().strip()
REMOTE = ("172.18.0.3", 5432)  # hcmus-cms-db-1 trong mạng docker của box
LOCAL_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 15432


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        try:
            chan = self.server.ssh.get_transport().open_channel(
                "direct-tcpip", REMOTE, self.request.getpeername()
            )
        except Exception as e:  # noqa: BLE001
            print("mo channel loi:", e, flush=True)
            return
        if chan is None:
            return
        try:
            while True:
                r, _, _ = select.select([self.request, chan], [], [], 30)
                if self.request in r:
                    data = self.request.recv(65536)
                    if not data:
                        break
                    chan.sendall(data)
                if chan in r:
                    data = chan.recv(65536)
                    if not data:
                        break
                    self.request.sendall(data)
        finally:
            chan.close()
            self.request.close()


class Server(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect(HOST, port=PORT, username=USER, password=PW, timeout=30)
srv = Server(("127.0.0.1", LOCAL_PORT), Handler)
srv.ssh = c
print(f"tunnel 127.0.0.1:{LOCAL_PORT} -> {REMOTE[0]}:{REMOTE[1]} (qua {HOST})", flush=True)
srv.serve_forever()
