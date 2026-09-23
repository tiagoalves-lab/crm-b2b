import { getServerAccessToken } from "@/lib/api/auth";
import { getMe } from "@/lib/api/me";
import { listMemberships } from "@/lib/api/memberships";
import { AVISO_DE_GRAVACAO, listarDispositivos } from "@/lib/api/telefonia";
import Credenciais from "./credenciais";

// Tela "Telefonia" (Administração, 2026-09-23 — docs/telefonia-crm.md).
// Duas coisas moram aqui: a credencial de cada computador que registra as
// ligações sozinho, e as instruções de instalação do telefone (MicroSIP).
//
// O CRM não disca: ele manda o número pro programa de telefone instalado
// na máquina. Sem essa instalação, o botão "Ligar" abre nada — por isso a
// instrução fica no produto, não num documento à parte que ninguém acha.
export default async function TelefoniaPage() {
  const token = await getServerAccessToken();
  const me = await getMe(token);
  const ehChefe = me.membership.role === "owner" || me.membership.role === "admin";

  const [dispositivos, memberships] = await Promise.all([
    listarDispositivos(token),
    ehChefe ? listMemberships(token) : Promise.resolve([]),
  ]);

  return (
    <div className="content">
      <div className="panel-head">
        <h2>Telefonia</h2>
        <div className="sub">
          Ligar para o cliente pelo CRM, com a ligação virando registro na
          ficha sozinha.
        </div>
      </div>

      <div className="panel">
        <div className="drawer-section-title">Como funciona</div>
        <ol className="sub" style={{ paddingLeft: 18, display: "grid", gap: 6 }}>
          <li>
            Baixe o <strong>MicroSIP</strong> (versão Lite) em{" "}
            <a href="https://www.microsip.org/downloads" target="_blank" rel="noreferrer">
              microsip.org/downloads
            </a>{" "}
            e configure a linha da Gama nele. Servidor, usuário e senha estão
            no painel da operadora — nunca no CRM.
          </li>
          <li>
            Gere abaixo a credencial daquele computador e rode o instalador
            que veio na pasta <code>gama-telefonia</code>:
            <br />
            <code>.\instalar.ps1 -ApiUrl &quot;…&quot; -Token &quot;…&quot;</code>
          </li>
          <li>
            Pronto: clique em <strong>Ligar</strong> ao lado de qualquer
            telefone do CRM e o MicroSIP abre já discando.
          </li>
          <li>
            Ao desligar, a ligação vira registro na Timeline da empresa, com
            duração e resultado.
          </li>
        </ol>
        <p className="sub" style={{ marginTop: 10 }}>
          Sem o instalador, o Windows entrega o clique ao{" "}
          <strong>Skype for Business</strong>, que é quem responde por
          ligações nas máquinas com Office — e abre a tela de login dele em
          vez de discar.
        </p>
        <p className="sub" style={{ marginTop: 10 }}>
          <strong>Aviso obrigatório na abertura da ligação:</strong> “{AVISO_DE_GRAVACAO}”
          — o lembrete aparece ao lado de cada botão de ligar.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="drawer-section-title">Credencial do computador</div>
        <p className="sub">
          É ela que diz ao CRM de quem é a ligação. Uma por máquina; revogar
          não mexe na conta da pessoa.
        </p>
        <Credenciais
          dispositivos={dispositivos}
          memberships={memberships}
          podeEscolherDono={ehChefe}
          apiUrl={process.env.NEXT_PUBLIC_API_URL ?? ""}
        />
      </div>
    </div>
  );
}
