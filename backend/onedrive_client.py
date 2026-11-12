import os
import json
import requests
from urllib.parse import quote

# ========================================================
# MICROSOFT GRAPH API — CLIENTE ONEDRIVE (CONTA PESSOAL)
# ========================================================

GRAPH_API_BASE = "https://graph.microsoft.com/v1.0"
AUTH_BASE = "https://login.microsoftonline.com/consumers/oauth2/v2.0"

class OneDriveClient:
    def __init__(self, client_id, client_secret, redirect_uri="http://localhost:8000/callback", token_cache_file="token_cache.json"):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri
        self.token_cache_file = token_cache_file
        self.access_token = None
        self.refresh_token = None
        self.load_cached_tokens()

    def get_auth_url(self):
        """Gera o link de autorização da Microsoft para o primeiro login."""
        scopes = "Files.ReadWrite offline_access User.Read"
        return (
            f"{AUTH_BASE}/authorize?"
            f"client_id={self.client_id}&"
            f"response_type=code&"
            f"redirect_uri={quote(self.redirect_uri)}&"
            f"response_mode=query&"
            f"scope={quote(scopes)}"
        )

    def exchange_code_for_token(self, code):
        """Troca o authorization code pelo access token e refresh token."""
        url = f"{AUTH_BASE}/token"
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri
        }
        res = requests.post(url, data=data)
        res.raise_for_status()
        token_data = res.json()
        self.access_token = token_data.get("access_token")
        self.refresh_token = token_data.get("refresh_token")
        self.save_cached_tokens()
        return token_data

    def refresh_access_token(self):
        """Usa o refresh_token para obter um novo access token sem precisar logar de novo."""
        if not self.refresh_token:
            raise ValueError("Nenhum refresh_token disponível. Faça a autenticação inicial.")

        url = f"{AUTH_BASE}/token"
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": self.refresh_token,
            "grant_type": "refresh_token"
        }
        res = requests.post(url, data=data)
        res.raise_for_status()
        token_data = res.json()
        self.access_token = token_data.get("access_token")
        if "refresh_token" in token_data:
            self.refresh_token = token_data.get("refresh_token")
        self.save_cached_tokens()
        return self.access_token

    def _headers(self):
        if not self.access_token:
            self.refresh_access_token()
        return {"Authorization": f"Bearer {self.access_token}"}

    def _get(self, endpoint):
        """Faz requisição GET ao Microsoft Graph com auto-refresh de token se expirar."""
        url = f"{GRAPH_API_BASE}{endpoint}"
        res = requests.get(url, headers=self._headers())
        if res.status_code == 401 and self.refresh_token:
            self.refresh_access_token()
            res = requests.get(url, headers=self._headers())
        res.raise_for_status()
        return res.json()

    def list_folder_by_path(self, path="Documentos/Trabalho"):
        """Lista os arquivos e subpastas de um caminho no OneDrive."""
        # Endpoint do Graph: /me/drive/root:/Caminho/Da/Pasta:/children
        clean_path = path.strip("/")
        if clean_path:
            endpoint = f"/me/drive/root:/{quote(clean_path)}:/children"
        else:
            endpoint = "/me/drive/root/children"
        return self._get(endpoint).get("value", [])

    def scan_work_folders(self, base_path="Documentos/Trabalho"):
        """
        Escaneia as pastas 'Arquivos de Áudio' e 'Vídeos' diretamente na nuvem:
        Retorna estrutura organizada de nichos, áudios (com links de streaming CDN) e vídeos.
        """
        items = self.list_folder_by_path(base_path)
        audios_folder_id = None
        videos_folder_id = None

        for item in items:
            name_lower = item.get("name", "").lower()
            if "áudio" in name_lower or "audio" in name_lower:
                audios_folder_id = item.get("id")
            elif "vídeo" in name_lower or "video" in name_lower:
                videos_folder_id = item.get("id")

        niches = {}

        def get_or_create_niche(name):
            if name not in niches:
                niches[name] = {
                    "name": name,
                    "audios": [],
                    "videos": {"feed": [], "reels": []},
                    "status": "pending"
                }
            return niches[name]

        # 1. Mapeia Áudios
        if audios_folder_id:
            niche_folders = self._get(f"/me/drive/items/{audios_folder_id}/children").get("value", [])
            for nf in niche_folders:
                if "folder" in nf:
                    niche_name = nf.get("name")
                    niche = get_or_create_niche(niche_name)
                    audio_files = self._get(f"/me/drive/items/{nf['id']}/children").get("value", [])
                    for af in audio_files:
                        fname = af.get("name", "")
                        if fname.lower().endswith((".mp3", ".wav", ".m4a")):
                            lang = "PT"
                            parts = fname.split("_")
                            if len(parts) > 1:
                                lang = parts[-1].split(".")[0].upper()
                            
                            niche["audios"].append({
                                "name": fname,
                                "lang": lang,
                                "size": af.get("size", 0),
                                "downloadUrl": af.get("@microsoft.graph.downloadUrl")
                            })

        # 2. Mapeia Vídeos
        if videos_folder_id:
            video_niches = self._get(f"/me/drive/items/{videos_folder_id}/children").get("value", [])
            for vf in video_niches:
                if "folder" in vf:
                    niche_name = vf.get("name")
                    niche = get_or_create_niche(niche_name)
                    lang_folders = self._get(f"/me/drive/items/{vf['id']}/children").get("value", [])
                    for lf in lang_folders:
                        if "folder" in lf:
                            vfiles = self._get(f"/me/drive/items/{lf['id']}/children").get("value", [])
                            for vf_item in vfiles:
                                vname = vf_item.get("name", "")
                                if vname.lower().endswith(".mp4"):
                                    num = int(vname[0]) if vname[0].isdigit() else 0
                                    is_feed = 1 <= num <= 3
                                    is_reels = 4 <= num <= 6
                                    item_data = {
                                        "name": vname,
                                        "num": num,
                                        "lang": lf.get("name"),
                                        "size": vf_item.get("size", 0),
                                        "downloadUrl": vf_item.get("@microsoft.graph.downloadUrl")
                                    }
                                    if is_feed:
                                        niche["videos"]["feed"].append(item_data)
                                    elif is_reels:
                                        niche["videos"]["reels"].append(item_data)

        # Atualiza status de conclusão
        for n in niches.values():
            total = len(n["videos"]["feed"]) + len(n["videos"]["reels"])
            if total >= 6:
                n["status"] = "completed"
            elif total > 0:
                n["status"] = "partial"
            else:
                n["status"] = "pending"

        return list(niches.values())

    def save_cached_tokens(self):
        with open(self.token_cache_file, "w", encoding="utf-8") as f:
            json.dump({
                "access_token": self.access_token,
                "refresh_token": self.refresh_token
            }, f, indent=2)

    def load_cached_tokens(self):
        if os.path.exists(self.token_cache_file):
            try:
                with open(self.token_cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.access_token = data.get("access_token")
                    self.refresh_token = data.get("refresh_token")
            except Exception:
                pass
