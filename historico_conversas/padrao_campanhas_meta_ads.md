# Padrão Oficial de Subida de Campanhas — TwoD Hub (Meta Ads)

**Registrado em:** 13/11/2026  
**Origem:** Blueprint operacional + 9 prints do Meta Ads Manager e TranslateX Cache enviados pelo Thiago.

---

## 1. Nível da Campanha (`Campaign`)
- **Tipo de compra (`buying_type`):** `AUCTION`
- **Objetivo:** **Sales** (`OUTCOME_SALES`)
- **Estratégia de Orçamento:** **Ad set budget (ABO)** — nunca usar CBO; *Share some of your budget* desmarcado; *A/B test* `Off`.
- **Advantage+ / Recomendações da Meta:** desativar quando possível.
- **Padrão de Nome:**
  `PostID,NomeDoNicho,XXX-NOMEDOSITE-00,Quempostou,TIPODECAMPANHA-00`
  - Exemplo observado no Ads Manager: `25079,ReceitasDaVovo,MON-TWODCOMPANY-...` / `22942,Autoescola,MON-TWODCOMPANY-10,Alexandre,...`
  - `TIPODECAMPANHA-00`: `PostID` ou `UTM-01` *(em confirmação de formato exato para casos não-UTM)*.

---

## 2. Nível do Conjunto de Anúncios (`Ad Set`)
- **Nome do Conjunto:** nome do país (ex.: `Espanha`, `Brasil`, `Estados Unidos (inglês)` ou `Estados Unidos (espanhol)`).
- **Conversion location:** `Website` (`WEBSITE`) — não usar *Website and calls*.
- **Performance goal:** `Maximise value of conversions` (`VALUE`).
- **Dataset / Pixel:** Pixel correspondente ao nome do site (ex.: `Pixel de TWODCOMPANY 01`).
- **Conversion event:** `ad_click` (Conversions API / evento ativo).
- **Orçamento diário (`daily_budget`):** sempre **$1.00 USD** (`100` centavos).
- **Data de início / Agendamento:** imediato por padrão; campo opcional de data/hora de início apenas quando programar campanhas com antecedência.
- **Localização e Idade:** país do conjunto (`geo_locations.countries`), idade mínima `18`, controles rígidos.
- **Filtro de Idioma:** usado **exclusivamente** em `Estados Unidos (espanhol)` → selecionar **`Spanish (All)`**. Nos demais países, deixar sem restrição de idioma.
- **Ad Transparency:** `Advertiser (optional)` = **`Futuretech Dynamics LLC`** (*The advertiser and payer are different* desligado).

---

## 3. Nível do Anúncio (`Ad` & `AdCreative`)
- **Páginas (Identity):**
  - Alternar automaticamente entre as **páginas pertencentes à mesma BM** da conta selecionada (ex.: `MON Digital` → *Apps na Mão*, *Apps Úteis*, *Conecta Fácil*, *Golden Tips*, etc.), **sem jamais misturar páginas de BMs diferentes**.
  - Motivo: respeitar volume máximo de anúncios ativos por página e pulverizar risco em caso de bloqueio/queda.
- **Instagram & Threads:** usar a **Página do Facebook selecionada** ("use page").
- **Estrutura de Mídias (Novo Padrão: 1 Criativo por Anúncio):**
  - Pastas no OneDrive possuem vídeos numerados `1` a `6` por idioma: **3 quadrados (Feed 1–3)** e **3 Reels (4–6)**.
  - Espaço reservado como `"Em construção"` para o futuro formato **`4x3`**.
  - Quantidade de criativos encontrados no nicho/idioma define quantos anúncios serão criados no conjunto: **Criativo `1.mp4` → Anúncio 1**, **Criativo `2.mp4` → Anúncio 2**, ..., **Criativo `6.mp4` → Anúncio 6**.
- **Textos no formato `2 - 3 - 2`:**
  - **Primary text (2):**
    1. Texto 1 em **TODO MAIÚSCULO**
    2. Texto 2 escrito normal (*sentence case*)
  - **Headline (3):**
    1. `🔥` (ou 1 emoji do nicho) + palavra/frase bem curta (ex.: `🔥 TEXTO AQUI`)
    2. Emoji do nicho + variação curta 2
    3. `✅ APLICATIVO GRÁTIS` *(sempre em todos; validar tradução por idioma)*
  - **Description (2):**
    1. `⭐⭐⭐⭐⭐`
    2. `⬇️ BAIXE AGORA` *(validar tradução por idioma)*
- **URL de Destino + Tags de Idioma (`TranslateX Cache`):**
  - Base em português sem prefixo `/pt/`: ex. `https://twodcompany.com/25079/slug/`
  - Outros idiomas recebem `/{tag}/` antes do ID: ex. `https://twodcompany.com/es/25079/descarga-app-cocina-platos-tradicionales-deliciosos/`
  - Tags visíveis no print do `TranslateX Cache`: `ro`, `ar`, `no`, `iw`, `vi`, `ko`, `bg`, `cs`, `hr`, `th`, `lt`, `uk`, `fi`, `hi`, `hu`, `bn`, `sk`, `sl`, `id`, `en`, `fr`, `es`, `de`, `it`, `nl`, `ru`, `pt`, `ja`, `tr`, `pl`, `sv`, `da`, `zh-CN`, `zh-TW`, `el`, `tl`, `ms`, `et`, `ca`, `lv`, `ur`, `sr`, `fa`, `sw`, `sq`, `hy`, `is`, `bs`, `lb`, `af`. *(Topo da lista rolada não visível no print).*
- **Call to Action (CTA):** sempre **`Download`**.
- **Extensões de Chamada / Mensagem (WhatsApp/Messenger/Ligações):** sempre **desativar**.
- **Parâmetros de URL (somente para campanhas `UTM`):**
  ```
  utm_source={{site_source_name}}&utm_medium={{placement}}&utm_campaign={{adset.id}}&utm_content={{ad.id}}
  ```
- **Advantage+ Criativo / Recomendações:** desativar quando possível.

---

## 4. Pendências de Alinhamento antes de Implementação
1. Formato exato do sufixo `TIPODECAMPANHA-00` quando não for `UTM-01` (ex.: `PostID-01` ou `25079-01`?).
2. Regra de tradução dos textos `2-3-2` (`APLICATIVO GRÁTIS`, `BAIXE AGORA`, etc.) para idiomas estrangeiros.
3. Nomenclatura exata de cada um dos 1–6 anúncios individuais (`Pais - 01`, `01`, `Criativo 01`?).
4. Se os arquivos do WordPress já possuem mapa de prefixos/pixels por site ou se devemos cadastrar a lista `Site ↔ BM ↔ Prefixo XXX ↔ Pixel` direto no TwoD Hub.
5. Inspecionar via Meta API (`GET`) uma campanha ativa modelo para espelhar as flags exatas de `ad_click`, `VALUE`, `Futuretech Dynamics LLC` e desativação de Advantage+.
