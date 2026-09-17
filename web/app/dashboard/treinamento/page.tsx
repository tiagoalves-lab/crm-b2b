import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { hasPermission } from "@/lib/api/permission-catalog";
import { TREINAMENTO_CSS, TREINAMENTO_HTML } from "./conteudo";
import SlidesViewer from "./slides-viewer";

// Tela "Treinamento" (item do menu logo abaixo de Administração, 2026-09-17): slides de uso dos menus
// Prospecção, Pipeline, Tarefas e Empresas. Liberada pelo checkbox
// "Treinamento" na tela de Permissões do membro (nasce desligado; owner/
// admin sempre veem). Não há endpoint: o conteúdo é estático e só entra na
// resposta de quem tem a permissão — por isso a checagem fica aqui.
export default async function TreinamentoPage() {
  const token = await getServerAccessToken();
  const me = await getMe(token);
  const podeVer = hasPermission(me.membership.role, me.membership.permissions, "treinamento", "ver");

  if (!podeVer) {
    return (
      <div className="content">
        <div className="error-banner">Você não tem acesso ao treinamento. Peça a liberação a um administrador.</div>
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <div>
          <div className="page-title">Treinamento</div>
          <div className="page-sub">Como usar Prospecção, Pipeline, Tarefas e Empresas</div>
        </div>
      </div>
      <div className="content">
        <SlidesViewer html={TREINAMENTO_HTML} css={TREINAMENTO_CSS} />
      </div>
    </>
  );
}
