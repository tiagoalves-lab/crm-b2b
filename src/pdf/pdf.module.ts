import { Module } from '@nestjs/common';
import { HtmlPdfService } from './html-pdf.service';

// Geração de PDF a partir de HTML (Chromium headless). Hoje só a integração
// de cotações usa, ao receber a proposta congelada do app de orçamentos —
// mas o serviço não sabe nada de proposta, então serve pra qualquer
// documento do CRM que precise virar PDF depois.
@Module({
  providers: [HtmlPdfService],
  exports: [HtmlPdfService],
})
export class PdfModule {}
