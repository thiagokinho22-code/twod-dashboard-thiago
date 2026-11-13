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
  - `XXX-NOMEDOSITE-00` = nome da conta de anúncios (ex.: `MON-TWODCOMPANY-01`, `MON-TWODCOMPANY-10`).
  - `TIPODECAMPANHA-00` = **`PostID-01`** ou **`UTM-01`** (incrementando `-01`, `-02`...).
  - Exemplos observados: `25079,ReceitasDaVovo,MON-TWODCOMPANY-01,Thiago,PostID-01` / `22942,Autoescola,MON-TWODCOMPANY-10,Alexandre,UTM-01`.

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
  - Espaço reservado como `"Em construção"` para o futuro formato **`4x3`** (`07`, `08`, `09` — total de 3 vídeos por formato).
  - Quantidade de criativos encontrados no nicho/idioma define quantos anúncios serão criados no conjunto: nomes individuais simples **`01`**, **`02`**, **`03`**, ..., **`06`** (e futuramente até **`09`**).
- **Textos no formato `2 - 3 - 2`:**
  - Textos já ficam prontos em português (planejamento semanal, com futuro módulo gerador dentro do painel) e são traduzidos integralmente para o idioma de cada campanha/país.
  - **Primary text (2):**
    1. Texto 1 em **TODO MAIÚSCULO**
    2. Texto 2 escrito normal (*sentence case*)
  - **Headline (3):**
    1. `🔥` (ou 1 emoji do nicho) + palavra/frase bem curta (ex.: `🔥 TEXTO AQUI`)
    2. Emoji do nicho + variação curta 2
    3. `✅ APLICATIVO GRÁTIS` *(sempre em todos; traduzido quando em outro idioma)*
  - **Description (2):**
    1. `⭐⭐⭐⭐⭐`
    2. `⬇️ BAIXE AGORA` *(traduzido quando em outro idioma)*
- **URL de Destino + Tags de Idioma (`TranslateX Cache`):**
  - **Idioma nativo do site determina a URL raiz limpa (sem tag):**
    - **Twod (`twodcompany.com`) e Kiuvix (`kiuvix.com`)** são nativamente em **Espanhol (`es`)**: para países em Espanhol a URL vai limpa sem `/es/`; para **Brasil (`pt`)** insere **`/pt/`** e para outros idiomas insere `/{tag}/`.
    - **Todos os demais sites** (`simplificandocomcafe`, `blingalax`, `f4rol`, `kiocom`, `thehatsune`, etc.) são nativamente em **Português (`pt`)**: para **Brasil/Portugal (`pt`)** a URL vai limpa sem `/pt/`; para outros idiomas insere `/{tag}/` (ex.: `/es/`, `/en/`, `/fr/`).
  - Lista completa `TranslateX Cache` (Print 9, confirmada integralmente): `ro`, `ar`, `no`, `iw`, `vi`, `ko`, `bg`, `cs`, `hr`, `th`, `lt`, `uk`, `fi`, `hi`, `hu`, `bn`, `sk`, `sl`, `id`, `en`, `fr`, `es`, `de`, `it`, `nl`, `ru`, `pt`, `ja`, `tr`, `pl`, `sv`, `da`, `zh-CN`, `zh-TW`, `el`, `tl`, `ms`, `et`, `ca`, `lv`, `ur`, `sr`, `fa`, `sw`, `sq`, `hy`, `is`, `bs`, `lb`, `af`.
- **Call to Action (CTA):** sempre **`Download`**.
- **Extensões de Chamada / Mensagem (WhatsApp/Messenger/Ligações):** sempre **desativar**.
- **Parâmetros de URL (somente para campanhas `UTM`):**
  ```
  utm_source={{site_source_name}}&utm_medium={{placement}}&utm_campaign={{adset.id}}&utm_content={{ad.id}}
  ```
- **Advantage+ Criativo / Recomendações:** desativar quando possível.

---

## 4. Calibração via Campanha Modelo (Somente Leitura)
- Botão **"🔎 Ler Parâmetros de Campanha Modelo"** dentro da aba **Gerador de Campanhas** faz apenas um `GET` (sem alterar nada) numa campanha existente da conta para capturar automaticamente Pixel, evento `ad_click`, flags de `Futuretech Dynamics LLC` (*Ad transparency*), `VALUE` e configurações internas da Meta API usadas naquela BM.
