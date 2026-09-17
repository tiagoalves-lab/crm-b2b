// Marcação "Vendedor" do cadastro de membro (pedido do usuário,
// 2026-09-17): só quem está marcado aparece na lista "Representante" do
// card de oportunidade. Independe do papel. Checkbox nativo com name — a
// action lê `vendedor === "on"` (desmarcado não vai no submit).
export default function VendedorCheckbox({ defaultChecked }: { defaultChecked: boolean }) {
  return (
    <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
      <input
        type="checkbox"
        name="vendedor"
        defaultChecked={defaultChecked}
        style={{ width: 16, height: 16, margin: 0 }}
      />
      Vendedor
      <span className="field-hint" style={{ margin: 0 }}>
        (aparece como representante no card do Pipeline)
      </span>
    </label>
  );
}
