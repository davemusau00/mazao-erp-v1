#!/usr/bin/env python3
"""Verify the host bridge address used by loopback-published API traffic."""

import http.client
import ipaddress
import subprocess
import sys
import time

container_pid = sys.argv[1]
client_code = """
import http.client, time
connection = http.client.HTTPConnection('127.0.0.1', 4102, timeout=5)
connection.request('GET', '/api/v1/health/live')
response = connection.getresponse()
response.read()
print(response.status, flush=True)
time.sleep(2)
connection.close()
"""
client = subprocess.Popen([sys.executable, "-c", client_code], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
peers: set[str] = set()
try:
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        result = subprocess.run(
            ["sudo", "-n", "nsenter", "-t", container_pid, "-n", "ss", "-Htn", "state", "established", "sport", "=", ":4101"],
            check=True,
            capture_output=True,
            text=True,
            timeout=1,
        )
        for line in result.stdout.splitlines():
            fields = line.split()
            if len(fields) >= 4:
                address = fields[3].rsplit(":", 1)[0].strip("[]")
                try:
                    peers.add(str(ipaddress.ip_address(address)))
                except ValueError:
                    continue
        if "172.26.0.1" in peers:
            break
        time.sleep(0.1)
    stdout, stderr = client.communicate(timeout=5)
    if client.returncode != 0 or stdout.strip() != "200":
        raise SystemExit(f"API health request failed while verifying its socket peer: {stderr.strip() or stdout.strip()}")
    if "172.26.0.1" not in peers:
        raise SystemExit(f"Expected the Yako bridge gateway 172.26.0.1 as API peer; observed {sorted(peers)}")
    print("172.26.0.1")
finally:
    if client.poll() is None:
        client.terminate()
        try:
            client.wait(timeout=2)
        except subprocess.TimeoutExpired:
            client.kill()
            client.wait()
