"""Imita o Checkout da InfinitePay para os testes: cria links, mostra uma página de pagamento,
avisa o servidor (webhook) e responde ao payment_check."""
import json, threading, urllib.request, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SEM_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))
PORTA = 8799


class Estado:
    links = {}   # order_nsu -> corpo recebido em /links
    pagos = {}   # order_nsu -> dados da transação


class Manipulador(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _json(self, dados, status=200):
        corpo = json.dumps(dados).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _ler(self):
        tamanho = int(self.headers.get("content-length") or 0)
        return json.loads(self.rfile.read(tamanho) or b"{}")

    def do_GET(self):
        if self.path.startswith("/pagar/"):
            nsu = self.path.split("/")[2]
            preco = Estado.links[nsu]["items"][0]["price"]
            html = f"""<!doctype html><meta charset=utf-8><title>InfinitePay falsa</title>
            <h1>Pagar R$ {preco / 100:.2f}</h1><form method=post><button>Pagar</button></form>""".encode()
            self.send_response(200)
            self.send_header("content-type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html)

    def do_POST(self):
        if self.path == "/links":
            corpo = self._ler()
            Estado.links[corpo["order_nsu"]] = corpo
            return self._json({"url": f"http://localhost:{PORTA}/pagar/{corpo['order_nsu']}"})
        if self.path == "/payment_check":
            corpo = self._ler()
            pago = Estado.pagos.get(corpo.get("order_nsu"))
            if not pago or pago["transaction_nsu"] != corpo.get("transaction_nsu"):
                return self._json({"success": False, "paid": False})
            preco = Estado.links[corpo["order_nsu"]]["items"][0]["price"]
            return self._json({"success": True, "paid": True, "amount": preco, "paid_amount": preco, "capture_method": "pix"})
        if self.path.startswith("/pagar/"):
            nsu = self.path.split("/")[2]
            link = Estado.links[nsu]
            transacao = {"transaction_nsu": str(uuid.uuid4()), "slug": "slug-" + nsu}
            Estado.pagos[nsu] = transacao
            aviso = json.dumps({"order_nsu": nsu, "transaction_nsu": transacao["transaction_nsu"],
                                "invoice_slug": transacao["slug"], "receipt_url": "http://recibo/" + nsu}).encode()
            SEM_PROXY.open(urllib.request.Request(link["webhook_url"], data=aviso, method="POST",
                                                  headers={"content-type": "application/json"}), timeout=10)
            destino = f"{link['redirect_url']}&order_nsu={nsu}&transaction_nsu={transacao['transaction_nsu']}&slug={transacao['slug']}&capture_method=pix"
            self.send_response(303)
            self.send_header("location", destino)
            self.end_headers()


def iniciar():
    servidor = ThreadingHTTPServer(("localhost", PORTA), Manipulador)
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    return servidor
