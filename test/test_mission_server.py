"""End-to-end mission tests against a disposable real Minecraft server.

The test starts an official vanilla 1.20.1 server in a temporary directory,
starts index.js against it with isolated state, sends !missao commands through
the loopback dashboard, and verifies inventory through the server RCON - not
only through the bot's own report.

Prerequisites (the class is skipped without them):
  MBOT_TEST_SERVER_JAR=/absolute/path/server-1.20.1.jar
  MBOT_TEST_EULA_ACCEPTED=1
  Java 17+ available as `java` (or set MBOT_TEST_SERVER_JAVA)

Run:
  python -m unittest discover -s test -p 'test_mission_server.py' -v
"""

import json
import os
import pathlib
import re
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_JAR = ROOT / ".cache" / "vanilla-1.20.1.jar"
JAR = pathlib.Path(os.environ.get("MBOT_TEST_SERVER_JAR") or DEFAULT_JAR).resolve()
JAVA = os.environ.get("MBOT_TEST_SERVER_JAVA", "java")
EULA_ACCEPTED = os.environ.get("MBOT_TEST_EULA_ACCEPTED") == "1"


def _java_ok():
    try:
        result = subprocess.run([JAVA, "-version"], capture_output=True, text=True, timeout=10)
        return result.returncode == 0
    except Exception:
        return False


def _server_available():
    return EULA_ACCEPTED and JAR.is_file() and _java_ok()


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _tail(path, lines=80):
    try:
        content = pathlib.Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
        return "\n".join(content[-lines:])
    except FileNotFoundError:
        return "(sem log)"


class Rcon:
    """Minimal RCON client: enough for server-side inventory inspection."""

    def __init__(self, host, port, password, timeout=10):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.sock.settimeout(timeout)
        self._request_id = 0
        self._send(3, password)
        request_id, _, body = self._recv()
        if request_id == -1:
            raise RuntimeError("RCON authentication failed")
        self._auth_body = body

    def _send(self, packet_type, body):
        self._request_id += 1
        payload = struct.pack("<ii", self._request_id, packet_type) + body.encode("utf-8") + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)

    def _recv_exact(self, size):
        data = b""
        while len(data) < size:
            chunk = self.sock.recv(size - len(data))
            if not chunk:
                raise ConnectionError("RCON connection closed")
            data += chunk
        return data

    def _recv(self):
        length = struct.unpack("<i", self._recv_exact(4))[0]
        data = self._recv_exact(length)
        request_id, packet_type = struct.unpack("<ii", data[:8])
        body = data[8:-2].decode("utf-8", "replace")
        return request_id, packet_type, body

    def command(self, text):
        self._send(2, text)
        _, _, body = self._recv()
        return body

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


@unittest.skipUnless(
    _server_available(),
    "defina MBOT_TEST_SERVER_JAR e MBOT_TEST_EULA_ACCEPTED=1, com Java 17+ instalado"
)
class MissionServerE2E(unittest.TestCase):
    """Mission lifecycle on a real 1.20.1 server, verified by RCON."""

    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="mbot-mission-server-")
        cls.server_dir = pathlib.Path(cls.temp.name) / "server"
        cls.server_dir.mkdir(parents=True)
        cls.artifact = ROOT / "logs" / "mission-server-e2e" / time.strftime("%Y%m%d-%H%M%S")
        cls.artifact.mkdir(parents=True, exist_ok=True)
        cls.server_log_path = cls.artifact / "server.log"
        cls.server_port = _free_port()
        cls.rcon_port = _free_port()
        cls.rcon_password = uuid.uuid4().hex

        (cls.server_dir / "eula.txt").write_text("eula=true\n", encoding="utf-8")
        properties = {
            "online-mode": "false",
            "enforce-secure-profile": "false",
            "server-ip": "127.0.0.1",
            "server-port": str(cls.server_port),
            "level-name": "world",
            "level-type": "flat",
            "generator-settings": (
                '{"layers":[{"block":"minecraft:bedrock","height":1},'
                '{"block":"minecraft:dirt","height":4}],"biome":"minecraft:plains"}'
            ),
            "spawn-protection": "0",
            "gamemode": "survival",
            "difficulty": "peaceful",
            "max-players": "10",
            "view-distance": "4",
            "simulation-distance": "4",
            "enable-rcon": "true",
            "rcon.port": str(cls.rcon_port),
            "rcon.password": cls.rcon_password,
            "broadcast-rcon-to-ops": "false",
            "motd": "mission-python-e2e",
        }
        (cls.server_dir / "server.properties").write_text(
            "\n".join(f"{key}={value}" for key, value in properties.items()) + "\n",
            encoding="utf-8"
        )

        cls.server_log = cls.server_log_path.open("w", encoding="utf-8")
        cls.server = subprocess.Popen(
            [JAVA, "-Xms512M", "-Xmx1G", "-jar", str(JAR), "nogui"],
            cwd=cls.server_dir,
            stdin=subprocess.PIPE,
            stdout=cls.server_log,
            stderr=subprocess.STDOUT,
            text=True,
        )
        try:
            cls._wait_server()
            cls.rcon = cls._connect_rcon()
        except Exception:
            cls._stop_server()
            raise

    @classmethod
    def _wait_server(cls, timeout=180):
        deadline = time.time() + timeout
        while time.time() < deadline:
            if cls.server.poll() is not None:
                raise RuntimeError("servidor encerrou antes de ficar pronto\n" + _tail(cls.server_log_path))
            if "Done (" in _tail(cls.server_log_path):
                return
            time.sleep(1)
        raise RuntimeError("servidor não ficou pronto\n" + _tail(cls.server_log_path))

    @classmethod
    def _connect_rcon(cls, timeout=30):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            try:
                return Rcon("127.0.0.1", cls.rcon_port, cls.rcon_password)
            except Exception as error:  # port not open yet
                last = error
                time.sleep(1)
        raise RuntimeError(f"RCON indisponível: {last}\n" + _tail(cls.server_log_path))

    @classmethod
    def _stop_server(cls):
        if getattr(cls, "server", None) and cls.server.poll() is None:
            try:
                cls.server.stdin.write("stop\n")
                cls.server.stdin.flush()
            except Exception:
                pass
            try:
                cls.server.wait(timeout=30)
            except subprocess.TimeoutExpired:
                cls.server.kill()
                cls.server.wait(timeout=10)
        try:
            cls.rcon.close()
        except Exception:
            pass
        try:
            cls.server_log.close()
        except Exception:
            pass

    @classmethod
    def tearDownClass(cls):
        cls._stop_server()
        try:
            cls.temp.cleanup()
        except Exception:
            pass
        print(f"\n[mission-e2e] logs: {cls.artifact}")

    def _server_dirt_count(self):
        """Count dirt in the player inventory using the server's own data."""
        text = self.rcon.command(f"data get entity {self.bot_name} Inventory")
        total = 0
        for compound in re.findall(r"\{[^{}]*minecraft:dirt[^{}]*\}", text):
            match = re.search(r"Count:\s*(\d+)b", compound)
            if match:
                total += int(match.group(1))
        return total

    def setUp(self):
        self.state_dir = pathlib.Path(tempfile.mkdtemp(prefix="bot-", dir=str(self.temp.name)))
        self.bot_name = f"mission_{uuid.uuid4().hex[:7]}"
        self.dashboard_port = _free_port()
        self.bot = None
        self.bot_log = None
        self.bot_log_path = self.artifact / f"{self.bot_name}.log"
        self._start_bot()
        self._wait_dashboard()

    def tearDown(self):
        self._stop_bot()
        shutil.rmtree(self.state_dir, ignore_errors=True)

    def _env(self):
        env = os.environ.copy()
        env.update({
            "MINECRAFT_HOST": "127.0.0.1",
            "MINECRAFT_PORT": str(self.server_port),
            "MINECRAFT_VERSION": "1.20.1",
            "MINECRAFT_PROFILE": "vanilla1201",
            "MINECRAFT_BOT_NAME": self.bot_name,
            "MINECRAFT_OWNER": "eduardo",
            "MINECRAFT_LAN_ANNOUNCE": "0",
            "MBOT_START_MODE": "ficar",
            "MBOT_PLUGINS": "0",
            "MBOT_VIEWER_PORT": "0",
            "MBOT_INVENTORY_PORT": "0",
            "MBOT_DASHBOARD": "1",
            "MBOT_DASHBOARD_PORT": str(self.dashboard_port),
            "STATUS_SERVER": "0",
            "MBOT_SLEEP_DISABLE": "1",
            "MBOT_COLONY_AUTOSTART": "0",
            "MBOT_AUTO_EAT": "0",
            "MBOT_WORLD_MEMORY": "0",
            "COLONY_STATE_FILE": str(self.state_dir / "colony-state.json"),
            "MEMORY_FILE": str(self.state_dir / "memory.json"),
            "MBOT_MISSION_FILE": str(self.state_dir / "missions.json"),
            "COLONY_EVENT_LOG": str(self.state_dir / "events.jsonl"),
            "MBOT_TASK_CHECKPOINT_FILE": str(self.state_dir / "checkpoints.json"),
        })
        return env

    def _start_bot(self):
        if self.bot_log:
            self.bot_log.close()
        self.bot_log = self.bot_log_path.open("a", encoding="utf-8")
        self.bot = subprocess.Popen(
            ["node", "index.js"],
            cwd=ROOT,
            env=self._env(),
            stdout=self.bot_log,
            stderr=subprocess.STDOUT,
            text=True,
        )

    def _stop_bot(self):
        if self.bot and self.bot.poll() is None:
            try:
                self._command("!parar")
            except Exception:
                pass
            try:
                self.bot.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self.bot.terminate()
                try:
                    self.bot.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.bot.kill()
                    self.bot.wait(timeout=5)
        if self.bot_log:
            self.bot_log.close()
            self.bot_log = None

    def _snapshot(self):
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.dashboard_port}/api/snapshot", timeout=3
        ) as response:
            return json.load(response)

    def _wait_dashboard(self, timeout=90):
        deadline = time.time() + timeout
        last = None
        while time.time() < deadline:
            if self.bot.poll() is not None:
                raise RuntimeError("bot encerrou antes do dashboard\n" + _tail(self.bot_log_path))
            try:
                snapshot = self._snapshot()
                main = snapshot.get("main") or {}
                if (main.get("name") == self.bot_name and main.get("position")
                        and snapshot.get("ready") is True):
                    return
            except Exception as error:
                last = error
            time.sleep(0.5)
        raise RuntimeError(f"dashboard não respondeu: {last}\n" + _tail(self.bot_log_path))

    def _command(self, text):
        request = urllib.request.Request(
            f"http://127.0.0.1:{self.dashboard_port}/api/command",
            data=json.dumps({"command": text}).encode("utf-8"),
            method="POST",
            headers={"content-type": "application/json", "x-mbot-dashboard": "1"},
        )
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)

    def _missions(self):
        path = self.state_dir / "missions.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return []
        return list((data.get("missions") or {}).values())

    def _wait_mission(self, predicate, timeout=120):
        deadline = time.time() + timeout
        while time.time() < deadline:
            for mission in self._missions():
                if predicate(mission):
                    return mission
            time.sleep(0.5)
        details = json.dumps(self._missions(), ensure_ascii=False)[:2000]
        raise AssertionError(
            f"missão não atingiu o estado esperado em {timeout}s: {details}\n"
            + _tail(self.bot_log_path)
        )

    def _wait_mode(self, mode, timeout=20):
        deadline = time.time() + timeout
        while time.time() < deadline:
            main = (self._snapshot().get("main") or {})
            if main.get("mode") == mode and not main.get("task"):
                return
            time.sleep(0.5)
        raise AssertionError(f"modo não voltou para {mode}\n" + _tail(self.bot_log_path))

    def test_01_pegar_confirma_no_servidor(self):
        self._command("!missao pegar dirt 2")
        mission = self._wait_mission(
            lambda item: item["status"] in ("completed", "failed", "cancelled"), timeout=120
        )
        self.assertEqual(mission["status"], "completed", msg=json.dumps(mission, ensure_ascii=False))
        node = mission["graph"][0]
        self.assertEqual(node["status"], "completed")
        after = int((node.get("result") or {}).get("evidence", {}).get("after", 0))
        self.assertGreaterEqual(after, 2, msg=json.dumps(node, ensure_ascii=False))
        self.assertGreaterEqual(self._server_dirt_count(), 2, "servidor não viu o dirt na mochila")
        self._wait_mode("ficar")

    def test_02_cancelar_missao(self):
        self._command("!missao pegar dirt 64")
        mission = self._wait_mission(
            lambda item: item["status"] == "running", timeout=30
        )
        self._command(f"!missao cancelar {mission['id']}")
        cancelled = self._wait_mission(
            lambda item: item["id"] == mission["id"] and item["status"] == "cancelled", timeout=30
        )
        self.assertEqual(cancelled["status"], "cancelled")
        self.assertEqual(cancelled["graph"][0]["status"], "cancelled")
        self._wait_mode("ficar")

    def test_03_retomar_apos_restart(self):
        self._command("!missao pegar dirt 24")
        mission = self._wait_mission(
            lambda item: item["status"] in ("running", "pending"), timeout=30
        )
        self._command("!parar")
        self.bot.wait(timeout=20)
        persisted = [item for item in self._missions() if item["id"] == mission["id"]]
        self.assertTrue(persisted)
        self.assertIn(persisted[0]["status"], ("running", "interrupted"))

        self._start_bot()
        self._wait_dashboard()
        self._command(f"!missao retomar {mission['id']}")
        done = self._wait_mission(
            lambda item: item["id"] == mission["id"] and item["status"] in ("completed", "failed", "cancelled"),
            timeout=180,
        )
        self.assertEqual(done["status"], "completed", msg=json.dumps(done, ensure_ascii=False))
        after = int((done["graph"][0].get("result") or {}).get("evidence", {}).get("after", 0))
        self.assertGreaterEqual(after, 24, msg=json.dumps(done, ensure_ascii=False))
        self.assertGreaterEqual(self._server_dirt_count(), 24, "servidor não viu o dirt após retomada")
        self._wait_mode("ficar")


if __name__ == "__main__":
    unittest.main(verbosity=2)
