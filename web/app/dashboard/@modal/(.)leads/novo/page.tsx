import LeadForm from "@/app/dashboard/leads/lead-form";
import OverlayModal from "@/app/dashboard/_overlay/overlay-modal";

export default function NovoLeadModal() {
  return (
    <OverlayModal title="Nova empresa">
      <LeadForm />
    </OverlayModal>
  );
}
