import Link from "next/link";
import TopbarFilter from "@/app/_components/topbar-filter";
import { getServerAccessToken } from "@/lib/api/auth";
import { ENTIDADES, entidadeLabel, listExclusoes, type Exclusao } from "@/lib/api/exclusoes";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import type { Membership } from "@/lib/api/types";
import { formatDateOnlyBR, formatDateTimeBR } from "@/lib/format-date";

// Tela "Registro de exclusões" (Administração, 2026-09-16). Nasceu de duas
// tarefas que sumiram sem rastro: toda exclusão feita pelas telas grava
// quem, quando, o quê e uma cópia do registro — é a cópia que permite
// recadastrar. Só leitura; ninguém altera nem apaga um registro daqui.
//
// Só owner/admin. O nav esconde o item dos demais papéis; o guard aqui é
// defesa em profundidade, e quem manda de verdade é o backend (403).

// Campos da cópia que valem mostrar, com o nome que a pessoa reconhece.
// O resto (ids internos, controle de versão) fica só no "dados completos".
const CAMPOS: Record<string, string> = {
  title: "Título",
  name: "Nome",
  nome: "Nome",
  razaoSocial: "Razão social",
  fantasia: "Fantasia",
  cpfCnpj: "CPF/CNPJ",
  fileName: "Arquivo",
  body: "Texto",
  text: "Texto",
  description: "Descrição",
  tipo: "Tipo",
  status: "Situação",
  dueAt: "Prazo",
  amount: "Valor",
  expectedCloseDate: "Previsão de fechamento",
  slaDueDate: "Prazo SLA",
  cargo: "Cargo",
  email: "E-mail",
  telefone: "Telefone",
  emails: "E-mails",
  fones: "Telefones",
  cidade: "Cidade",
  uf: "UF",
  role: "Papel",
  tags: "Tags",
  assigneeUserId: "Responsável",
  ownerUserId: "Representante",
  authorUserId: "Autor",
  uploadedBy: "Enviado por",
  createdBy: "Criado por",
  userId: "Usuário",
  createdAt: "Criado em",
};

// Datas sem hora (gravadas como meia-noite UTC) — formatar com hora ou no
// fuso de Brasília mostraria o dia anterior.
const SO_DATA = new Set(["dueAt", "expectedCloseDate", "slaDueDate"]);
const USUARIO = new Set(["assigneeUserId", "ownerUserId", "authorUserId", "uploadedBy", "createdBy", "userId"]);

// O que saiu junto em cascata (a tarefa leva comentários, checklist e anexos).
const LISTAS: Record<string, { label: string; campo: string }> = {
  comentarios: { label: "Comentários", campo: "body" },
  checklist: { label: "Checklist", campo: "text" },
  anexos: { label: "Anexos", campo: "fileName" },
  itens: { label: "Itens", campo: "name" },
};

function nomeDoMembro(userId: string, memberships: Membership[]): string {
  const m = memberships.find((mm) => mm.userId === userId);
  return m?.name?.trim() || m?.login?.trim() || "Membro removido";
}

function valorLegivel(campo: string, valor: unknown, memberships: Membership[]): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (Array.isArray(valor)) return valor.length > 0 ? valor.join(", ") : null;
  if (typeof valor === "object") return null;
  const texto = String(valor);
  if (USUARIO.has(campo)) return nomeDoMembro(texto, memberships);
  if (SO_DATA.has(campo) && /^\d{4}-\d{2}-\d{2}T/.test(texto)) return formatDateOnlyBR(texto);
  if (campo === "createdAt" && /^\d{4}-\d{2}-\d{2}T/.test(texto)) return formatDateTimeBR(texto);
  if (campo === "amount" && Number.isFinite(Number(texto))) {
    return Number(texto).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  return texto;
}

function Copia({ registro, memberships }: { registro: Exclusao; memberships: Membership[] }) {
  const snapshot = registro.snapshot ?? {};
  const campos = Object.keys(CAMPOS)
    .map((campo) => ({ campo, valor: valorLegivel(campo, snapshot[campo], memberships) }))
    .filter((c): c is { campo: string; valor: string } => c.valor !== null);
  const listas = Object.entries(LISTAS)
    .map(([chave, def]) => ({
      ...def,
      linhas: Array.isArray(snapshot[chave])
        ? (snapshot[chave] as Record<string, unknown>[]).map((l) => String(l?.[def.campo] ?? "")).filter(Boolean)
        : [],
    }))
    .filter((l) => l.linhas.length > 0);

  return (
    <div className="exclusao-copia">
      {campos.length > 0 ? (
        <dl className="kv">
          {campos.map((c) => (
            <div key={c.campo} style={{ display: "contents" }}>
              <dt>{CAMPOS[c.campo]}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{c.valor}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="t-sub">Sem campos legíveis na cópia.</p>
      )}
      {listas.map((l) => (
        <div key={l.label} className="exclusao-lista">
          <div className="drawer-section-title">
            {l.label} · {l.linhas.length}
          </div>
          <ul>
            {l.linhas.map((linha, i) => (
              <li key={i}>{linha}</li>
            ))}
          </ul>
        </div>
      ))}
      <details className="exclusao-json">
        <summary>Dados completos</summary>
        <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      </details>
    </div>
  );
}

export default async function RegistroExclusoesPage({
  searchParams,
}: {
  searchParams: Promise<{ entidade?: string; page?: string }>;
}) {
  const { entidade: entidadeParam, page: pageParam } = await searchParams;
  const token = await getServerAccessToken();
  const me = await getMe(token);
  const podeVer = me.membership.role === "owner" || me.membership.role === "admin";

  if (!podeVer) {
    return (
      <div className="content">
        <div className="error-banner">Só owner/admin podem ver o registro de exclusões.</div>
      </div>
    );
  }

  const entidade = ENTIDADES.some((e) => e.id === entidadeParam) ? entidadeParam : undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const [dados, memberships] = await Promise.all([
    listExclusoes(token, { entidade, page }),
    listMemberships(token),
  ]);
  const totalPaginas = Math.max(1, Math.ceil(dados.total / dados.pageSize));
  const href = (params: { entidade?: string; page?: number }) => {
    const q = new URLSearchParams();
    if (params.entidade) q.set("entidade", params.entidade);
    if (params.page && params.page > 1) q.set("page", String(params.page));
    const s = q.toString();
    return `/dashboard/registro-exclusoes${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Registro de exclusões</div>
          <div className="page-sub">
            Quem excluiu o quê, e quando — com a cópia do que foi apagado ({dados.total} registro
            {dados.total === 1 ? "" : "s"})
          </div>
        </div>
        <TopbarFilter placeholder="Buscar por registro, empresa ou pessoa…" />
      </div>

      <div className="content">
        <div className="tag-filter-row">
          <Link href={href({})} className={!entidade ? "tag-chip active" : "tag-chip"}>
            Todos
          </Link>
          {ENTIDADES.map((e) => (
            <Link
              key={e.id}
              href={href({ entidade: e.id })}
              className={entidade === e.id ? "tag-chip active" : "tag-chip"}
            >
              {e.label}
            </Link>
          ))}
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem excluiu</th>
              <th>Tipo</th>
              <th>Registro</th>
            </tr>
          </thead>
          <tbody>
            {dados.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="t-sub" style={{ textAlign: "center" }}>
                  Nenhuma exclusão registrada{entidade ? " deste tipo" : ""}.
                </td>
              </tr>
            ) : (
              dados.items.map((r) => (
                <tr key={r.id}>
                  <td className="t-sub" style={{ whiteSpace: "nowrap", verticalAlign: "top" }}>
                    {formatDateTimeBR(r.criadoEm)}
                  </td>
                  <td style={{ verticalAlign: "top" }}>{nomeDoMembro(r.actorUserId, memberships)}</td>
                  <td style={{ verticalAlign: "top" }}>
                    <span className="pill pill-gray">{entidadeLabel(r.entidade)}</span>
                  </td>
                  <td style={{ verticalAlign: "top" }}>
                    <details className="exclusao-detalhe">
                      <summary>
                        <span className="t-co">{r.titulo}</span>
                        {r.contexto && <span className="t-sub"> · {r.contexto}</span>}
                      </summary>
                      <Copia registro={r} memberships={memberships} />
                    </details>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {totalPaginas > 1 && (
          <div className="row-form" style={{ justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
            {page > 1 && (
              <Link href={href({ entidade, page: page - 1 })} className="btn btn-sm">
                ‹ anterior
              </Link>
            )}
            <span className="t-sub">
              Página {page} de {totalPaginas}
            </span>
            {page < totalPaginas && (
              <Link href={href({ entidade, page: page + 1 })} className="btn btn-sm">
                próxima ›
              </Link>
            )}
          </div>
        )}
      </div>
    </>
  );
}
