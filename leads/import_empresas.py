# =====================================================================
#  IMPORT DE EMPRESAS — Google Sheets → Staging (DuckDB)
#  Lê a planilha que o crawler (cod.txt) gera e grava/atualiza os
#  registros num DuckDB local, usando CNPJ como chave. Staging separado
#  do CRM — nada aqui grava direto no Postgres do CRM ainda (ver
#  docs/geracao-qualificacao-leads.md, seção 8, pra esse próximo passo).
#
#  Cole numa célula do Colab e rode (Ctrl+F9) depois de cada execução do
#  crawler. Idempotente: rodar de novo com a mesma planilha não duplica
#  linhas — atualiza os campos e preserva a data da 1ª importação.
# =====================================================================

# ----------------------- CONFIG -----------------------
SHEET_ID   = "1IgzKpswOxH4i5oWoILAWm8RtSSjKa89DfITpwQCUoc8"
SHEET_ABA  = "Base de dados"          # mesma aba que o crawler (cod.txt) escreve
DB_PATH    = "leads_staging.duckdb"   # arquivo local persistente
TABLE_NAME = "leads"
# ------------------------------------------------------

import os
import sys
from datetime import datetime, timezone

try:
    import duckdb
except ImportError:
    os.system(f"{sys.executable} -m pip install -q duckdb")
    import duckdb

try:
    import gspread
    from google.colab import auth
    from google.auth import default
except ImportError:
    os.system(f"{sys.executable} -m pip install -q gspread")
    import gspread
    from google.colab import auth
    from google.auth import default

import pandas as pd

# ---- 1) LER A PLANILHA ----
auth.authenticate_user()
creds, _ = default()
gc = gspread.authorize(creds)

sh = gc.open_by_key(SHEET_ID)
ws = sh.worksheet(SHEET_ABA)
rows = ws.get_all_records()  # usa a 1ª linha como cabeçalho
if not rows:
    raise RuntimeError(f"Planilha '{SHEET_ABA}' está vazia — rode o crawler (cod.txt) antes.")

df = pd.DataFrame(rows)
print(f"Lidas {len(df)} linhas da planilha '{SHEET_ABA}'.")

# ---- 2) NORMALIZAR ----
# Colunas na ordem em que o crawler (cod.txt) grava:
esperadas = ["CNPJ", "Empresa", "Fantasia", "Cidade", "UF", "Telefone",
             "Telefone 2", "Email (Receita)", "Porte", "Socios (QSA)",
             "CNAE", "Divisao", "Abertura"]
faltando = [c for c in esperadas if c not in df.columns]
if faltando:
    raise RuntimeError(f"Planilha não tem as colunas esperadas: {faltando}")

df = df[esperadas].copy()
df.columns = ["cnpj", "razao_social", "fantasia", "cidade", "uf", "telefone",
              "telefone2", "email", "porte", "socios", "cnae", "divisao",
              "abertura_raw"]

df["cnpj"] = df["cnpj"].astype(str).str.strip()
df = df[df["cnpj"] != ""].drop_duplicates(subset="cnpj", keep="last")

# Abertura vem como 'AAAAMMDD' (ex.: '20180312') — converte pra DATE de verdade,
# já deixa pronto pro cálculo de "tempo de mercado" do modelo de score (seção 5)
df["data_abertura"] = pd.to_datetime(df["abertura_raw"], format="%Y%m%d", errors="coerce").dt.date
n_invalidas = df["data_abertura"].isna().sum()
if n_invalidas:
    print(f"Aviso: {n_invalidas} linha(s) com data de abertura inválida — mantidas com data_abertura nula.")

now = datetime.now(timezone.utc)
df["primeira_importacao"] = now
df["ultima_atualizacao"] = now

df = df[["cnpj", "razao_social", "fantasia", "cidade", "uf", "telefone",
         "telefone2", "email", "porte", "socios", "cnae", "divisao",
         "data_abertura", "primeira_importacao", "ultima_atualizacao"]]

# ---- 3) STAGING NO DUCKDB (upsert por CNPJ) ----
con = duckdb.connect(DB_PATH)

con.execute(f"""
    CREATE TABLE IF NOT EXISTS {TABLE_NAME} (
        cnpj                 VARCHAR PRIMARY KEY,
        razao_social         VARCHAR,
        fantasia             VARCHAR,
        cidade                VARCHAR,
        uf                    VARCHAR,
        telefone              VARCHAR,
        telefone2             VARCHAR,
        email                 VARCHAR,
        porte                 VARCHAR,
        socios                VARCHAR,
        cnae                  VARCHAR,
        divisao               VARCHAR,
        data_abertura         DATE,
        primeira_importacao   TIMESTAMP,
        ultima_atualizacao    TIMESTAMP
    )
""")

con.register("df_import", df)
antes = con.execute(f"SELECT count(*) FROM {TABLE_NAME}").fetchone()[0]

con.execute(f"""
    INSERT INTO {TABLE_NAME}
    SELECT * FROM df_import
    ON CONFLICT (cnpj) DO UPDATE SET
        razao_social       = excluded.razao_social,
        fantasia           = excluded.fantasia,
        cidade             = excluded.cidade,
        uf                 = excluded.uf,
        telefone           = excluded.telefone,
        telefone2          = excluded.telefone2,
        email              = excluded.email,
        porte              = excluded.porte,
        socios             = excluded.socios,
        cnae               = excluded.cnae,
        divisao            = excluded.divisao,
        data_abertura      = excluded.data_abertura,
        ultima_atualizacao = excluded.ultima_atualizacao
        -- primeira_importacao NÃO é sobrescrita: preserva a data real
        -- em que o CNPJ apareceu pela primeira vez no staging
""")

depois = con.execute(f"SELECT count(*) FROM {TABLE_NAME}").fetchone()[0]
novos = depois - antes
atualizados = len(df) - novos

# ---- 4) LOG DE EXECUÇÃO ----
con.execute("""
    CREATE TABLE IF NOT EXISTS import_log (
        executado_em TIMESTAMP,
        linhas_lidas INTEGER,
        novos        INTEGER,
        atualizados  INTEGER,
        total_apos   INTEGER
    )
""")
con.execute(
    "INSERT INTO import_log VALUES (?, ?, ?, ?, ?)",
    [now, len(df), novos, atualizados, depois],
)

con.close()

print("=== IMPORT CONCLUÍDO ===")
print(f"Novos CNPJs: {novos} | Atualizados: {atualizados} | Total no staging: {depois}")
print(f"Banco: {DB_PATH} (tabela '{TABLE_NAME}')")
