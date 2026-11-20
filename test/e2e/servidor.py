"""Sobe o servidor local (wrangler dev) com banco próprio para os testes de ponta a ponta."""
import json, os, shutil, subprocess, time, urllib.request

# localhost não passa pelo proxy da máquina
SEM_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))
AMBIENTE_WRANGLER = {**os.environ, "WRANGLER_SEND_METRICS": "false", "NO_PROXY": "localhost,127.0.0.1", "no_proxy": "localhost,127.0.0.1"}

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ESTADO = "/tmp/flavorgrill-e2e"
PORTA = 8787
URL = f"http://localhost:{PORTA}"


def _wrangler(*args, **kw):
    return subprocess.run(["npx", "wrangler", *args], cwd=RAIZ, capture_output=True, text=True, env=AMBIENTE_WRANGLER, **kw)


def preparar_banco():
    shutil.rmtree(ESTADO, ignore_errors=True)
    r = _wrangler("d1", "migrations", "apply", "flavorgrill", "--local", "--persist-to", ESTADO, input="y\n")
    assert r.returncode == 0, r.stderr


def sql(comando):
    r = _wrangler("d1", "execute", "flavorgrill", "--local", "--persist-to", ESTADO, "--json", "--command", comando)
    assert r.returncode == 0, r.stderr + r.stdout
    return json.loads(r.stdout)[0]["results"]


class Servidor:
    def __init__(self, **variaveis):
        padrao = {
            "AMBIENTE": "dev",
            "DONO_EMAIL": "dono@flavorgrill.test",
            "ACESSO_DEV_EMAIL": "dono@flavorgrill.test",
            "SITE_URL": URL,
            "INFINITEPAY_BASE": "http://localhost:8799",
        }
        padrao.update(variaveis)
        self.variaveis = padrao
        self.processo = None

    def __enter__(self):
        args = ["npx", "wrangler", "dev", "--port", str(PORTA), "--persist-to", ESTADO]
        for chave, valor in self.variaveis.items():
            args += ["--var", f"{chave}:{valor}"]
        self.processo = subprocess.Popen(args, cwd=RAIZ, stdout=open("/tmp/wrangler-e2e.log", "w"), stderr=subprocess.STDOUT, env=AMBIENTE_WRANGLER)
        for _ in range(240):
            try:
                SEM_PROXY.open(URL + "/api/saude", timeout=1)
                return self
            except Exception:
                time.sleep(0.5)
        raise RuntimeError("wrangler dev não subiu; veja /tmp/wrangler-e2e.log")

    def __exit__(self, *erro):
        self.processo.terminate()
        self.processo.wait(10)
        subprocess.run(["pkill", "-f", "workerd"], capture_output=True)
        time.sleep(1)
