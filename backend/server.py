import os
import json
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from onedrive_client import OneDriveClient

CLIENT_ID = os.environ.get("MICROSOFT_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("MICROSOFT_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("MICROSOFT_REDIRECT_URI", "http://localhost:8000/callback")
BASE_PATH = os.environ.get("ONEDRIVE_BASE_PATH", "Documentos/Trabalho")
PORT = int(os.environ.get("PORT", 8000))

# Inicializa o cliente OneDrive
onedrive = OneDriveClient(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)

class APIHandler(BaseHTTPRequestHandler):
    def _send_json(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # 1. Rota de status da conexão
        if path == "/api/status":
            connected = bool(onedrive.access_token or onedrive.refresh_token)
            self._send_json({
                "status": "online",
                "onedrive_connected": connected,
                "configured": bool(CLIENT_ID and CLIENT_SECRET)
            })

        # 2. Retorna a URL para o usuário autorizar a conta Microsoft
        elif path == "/api/auth/url":
            if not CLIENT_ID:
                self._send_json({"error": "MICROSOFT_CLIENT_ID não configurado"}, 400)
                return
            url = onedrive.get_auth_url()
            self._send_json({"auth_url": url})

        # 3. Callback OAuth da Microsoft
        elif path == "/callback":
            code = params.get("code", [None])[0]
            if not code:
                self.send_response(400)
                self.wfile.write(b"Parametro 'code' ausente.")
                return
            try:
                onedrive.exchange_code_for_token(code)
                # Resposta amigável para o navegador fechar ou redirecionar
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                html = """
                <html>
                <body style="font-family:sans-serif; text-align:center; padding:50px; background:#0b0f19; color:#f8fafc;">
                    <h2 style="color:#10b981;">✅ OneDrive Conectado com Sucesso!</h2>
                    <p>O token foi armazenado. Você já pode voltar para a Dashboard.</p>
                    <script>
                        setTimeout(() => { window.close(); }, 2000);
                    </script>
                </body>
                </html>
                """
                self.wfile.write(html.encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.wfile.write(f"Erro ao autenticar: {e}".encode("utf-8"))

        # 4. Rota principal: Escaneia as pastas e retorna os Nichos da Nuvem
        elif path == "/api/onedrive/niches":
            try:
                niches = onedrive.scan_work_folders(BASE_PATH)
                self._send_json({
                    "success": True,
                    "count": len(niches),
                    "niches": niches
                })
            except Exception as e:
                self._send_json({"success": False, "error": str(e)}, 500)

        else:
            self._send_json({"error": "Rota não encontrada"}, 404)

def run():
    server_address = ("", PORT)
    httpd = HTTPServer(server_address, APIHandler)
    print(f"🚀 TwoD Backend API rodando em http://localhost:{PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    run()
