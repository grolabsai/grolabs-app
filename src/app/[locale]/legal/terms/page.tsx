import type { Metadata } from "next";
import { LegalLayout, H2, P, UL, Note } from "../_layout";

export const metadata: Metadata = {
  title: "Terms of Use · GroLabs",
  description:
    "The rules of the road for using GroLabs — what you can do, what we provide, and where the limits sit.",
};

const UPDATED = "2026-05-27";

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return locale === "en" ? <English /> : <Spanish />;
}

function English() {
  return (
    <LegalLayout
      title="Terms of Use"
      subtitle="The rules of the road for using GroLabs."
      updated={`Last updated: ${UPDATED}`}
      altLink={{ href: "/legal/terms", label: "Versión en español →" }}
    >
      <P>
        By accessing the GroLabs application or using the public
        free-audit widget, you agree to these Terms. If you don&rsquo;t agree,
        please don&rsquo;t use the service.
      </P>

      <Note>
        These Terms are written in plain language and reflect how the product
        actually works. They are not a substitute for a written contract on
        higher-tier plans — those override anything here that conflicts.
      </Note>

      <H2>1. The service</H2>
      <P>
        GroLabs provides a diagnostic platform for ecommerce storefronts.
        Authenticated customers configure prospects, define test entries,
        and run scans that produce findings and screenshots. The free-audit
        widget on our marketing site runs the same scans with a
        rate-limited, anonymous flow.
      </P>

      <H2>2. Your account</H2>
      <UL>
        <li>You are responsible for the actions taken under your account.</li>
        <li>
          Keep your credentials secure. If you suspect they&rsquo;ve been
          compromised, change your password and notify us.
        </li>
        <li>
          One person per account. Sharing logins across team members violates
          our license terms; invite teammates instead.
        </li>
      </UL>

      <H2>3. Permitted use</H2>
      <P>You may use the service to:</P>
      <UL>
        <li>
          Diagnose ecommerce storefronts you own, manage, or have permission
          to evaluate (e.g. prospect research with the public site as the
          legitimate basis).
        </li>
        <li>Build, share, and export the resulting reports.</li>
        <li>Integrate the public widget into your own marketing site.</li>
      </UL>

      <H2>4. Prohibited use</H2>
      <P>You must not:</P>
      <UL>
        <li>
          Use the service to circumvent technical access controls on a
          storefront (we do not scrape behind authentication, and you must
          not ask us to).
        </li>
        <li>
          Run high-volume diagnostics on storefronts you do not own or have
          permission to evaluate, in a way that constitutes harassment or
          denial-of-service.
        </li>
        <li>
          Reverse-engineer, copy, or resell the GroLabs platform or rubric.
        </li>
        <li>
          Use the service in violation of any applicable law or sanction.
        </li>
        <li>Submit malware, illegal content, or PII obtained unlawfully.</li>
      </UL>

      <H2>5. Data you provide</H2>
      <P>
        You retain ownership of the data you upload (contact details, test
        entries, notes, custom vocabulary). You grant GroLabs a license to
        process that data for the purpose of running the service, generating
        your reports, and improving the platform in aggregate. The Privacy
        Policy details the sub-processors involved and the retention windows.
      </P>

      <H2>6. Prospect storefront data</H2>
      <P>
        Storefronts we diagnose are public. We collect HTML, screenshots,
        sitemap data, and other content that an anonymous visitor would see.
        Trademarks and product names remain the property of their owners. We
        do not represent that any storefront has endorsed, authorized, or
        partnered with you or GroLabs by appearing in your dashboard.
      </P>

      <H2>7. Subscription, billing, and refunds</H2>
      <P>
        Paid plans are billed on the cadence indicated at checkout. Charges
        are non-refundable except where required by law or where we
        explicitly offer a refund. You may cancel at any time; cancellation
        takes effect at the end of the current billing period.
      </P>
      <P>
        We may change pricing with at least 30 days&rsquo; notice before the
        change takes effect on your next billing period.
      </P>

      <H2>8. Termination</H2>
      <P>
        You can close your account at any time from your settings page. We
        may suspend or terminate accounts that violate these Terms, that
        have been inactive for an extended period, or where required by law
        — we will make reasonable efforts to notify you first.
      </P>

      <H2>9. Disclaimers</H2>
      <P>
        The service is provided &ldquo;as is.&rdquo; The diagnostic findings
        and uplift estimates are our best assessment based on heuristics and
        models that operate without insider knowledge of the storefront. We
        do not warrant that they will be accurate in every case, that they
        will match the storefront&rsquo;s internal measurements, or that
        acting on them will produce a specific revenue outcome.
      </P>

      <H2>10. Limitation of liability</H2>
      <P>
        To the maximum extent permitted by law, GroLabs and its affiliates
        will not be liable for indirect, incidental, consequential, or
        special damages arising out of your use of the service. Our
        aggregate liability for direct damages will not exceed the amount
        you paid us in the twelve months preceding the claim, or USD 100,
        whichever is greater.
      </P>

      <H2>11. Indemnification</H2>
      <P>
        You agree to indemnify GroLabs against claims arising from your
        misuse of the service or your violation of these Terms — including
        claims that you used the service to evaluate a storefront you had
        no authority to evaluate.
      </P>

      <H2>12. Governing law</H2>
      <P>
        These Terms are governed by the laws of the jurisdiction in which
        GroLabs is incorporated, without regard to its conflict-of-law
        rules. Disputes will be resolved in the courts of that jurisdiction.
      </P>

      <H2>13. Changes</H2>
      <P>
        We may update these Terms. Material changes will be flagged at the
        top of this page and, for active customers, sent to the account
        email. Continuing to use the service after the effective date
        constitutes acceptance.
      </P>

      <H2>14. Contact</H2>
      <P>
        Questions about these Terms:{" "}
        <a
          href="mailto:legal@grolabs.ai"
          style={{ color: "var(--gl-accent)" }}
        >
          legal@grolabs.ai
        </a>
        .
      </P>
    </LegalLayout>
  );
}

function Spanish() {
  return (
    <LegalLayout
      title="Términos de Uso"
      subtitle="Las reglas de juego para usar GroLabs."
      updated={`Última actualización: ${UPDATED}`}
      altLink={{ href: "/en/legal/terms", label: "English version →" }}
    >
      <P>
        Al acceder a la aplicación de GroLabs o usar el widget público
        de auditoría gratuita, aceptás estos Términos. Si no estás de
        acuerdo, por favor no uses el servicio.
      </P>

      <Note>
        Estos Términos están escritos en lenguaje claro y reflejan cómo
        funciona realmente el producto. No reemplazan un contrato escrito en
        planes superiores — esos prevalecen sobre cualquier cosa acá que
        entre en conflicto.
      </Note>

      <H2>1. El servicio</H2>
      <P>
        GroLabs provee una plataforma de diagnóstico para tiendas de
        ecommerce. Los clientes autenticados configuran prospectos, definen
        pruebas y corren escaneos que producen hallazgos y capturas de
        pantalla. El widget público en nuestro sitio de marketing corre los
        mismos escaneos con un flujo anónimo y con límites de tasa.
      </P>

      <H2>2. Tu cuenta</H2>
      <UL>
        <li>Sos responsable de las acciones que se tomen con tu cuenta.</li>
        <li>
          Mantené tus credenciales seguras. Si sospechás que fueron
          comprometidas, cambiá la contraseña y avisanos.
        </li>
        <li>
          Una persona por cuenta. Compartir logins entre miembros del equipo
          viola los términos de licencia; invitá a tus compañeros.
        </li>
      </UL>

      <H2>3. Uso permitido</H2>
      <P>Podés usar el servicio para:</P>
      <UL>
        <li>
          Diagnosticar tiendas de ecommerce propias, que administres, o que
          tengás permiso para evaluar (ej. investigación de prospectos con
          el sitio público como base legítima).
        </li>
        <li>Construir, compartir y exportar los reportes resultantes.</li>
        <li>Integrar el widget público en tu propio sitio de marketing.</li>
      </UL>

      <H2>4. Uso prohibido</H2>
      <P>No podés:</P>
      <UL>
        <li>
          Usar el servicio para evadir controles de acceso técnicos en una
          tienda (no accedemos a contenido detrás de autenticación, y no
          podés pedirnos que lo hagamos).
        </li>
        <li>
          Correr diagnósticos de alto volumen sobre tiendas que no son tuyas
          o que no tenés permiso para evaluar, de manera que constituya
          acoso o denegación de servicio.
        </li>
        <li>
          Hacer ingeniería inversa, copiar o revender la plataforma o
          rúbrica de GroLabs.
        </li>
        <li>
          Usar el servicio en violación de cualquier ley o sanción aplicable.
        </li>
        <li>
          Enviar malware, contenido ilegal o información personal obtenida
          ilícitamente.
        </li>
      </UL>

      <H2>5. Datos que aportás</H2>
      <P>
        Retenés la propiedad de los datos que subís (datos de contacto,
        pruebas, notas, vocabulario personalizado). Le otorgás a GroLabs una
        licencia para procesar esos datos con el propósito de operar el
        servicio, generar tus reportes y mejorar la plataforma de manera
        agregada. La Política de Privacidad detalla los subprocesadores
        involucrados y las ventanas de retención.
      </P>

      <H2>6. Datos de tiendas prospecto</H2>
      <P>
        Las tiendas que diagnosticamos son públicas. Recolectamos HTML,
        capturas, datos de sitemap y otro contenido que un visitante anónimo
        vería. Las marcas y nombres de productos siguen siendo propiedad de
        sus dueños. No representamos que ninguna tienda haya endosado,
        autorizado o se haya asociado con vos o con GroLabs por aparecer en
        tu dashboard.
      </P>

      <H2>7. Suscripción, facturación y reembolsos</H2>
      <P>
        Los planes pagos se facturan en la frecuencia indicada al momento de
        la compra. Los cargos no son reembolsables excepto donde lo exija la
        ley o donde ofrezcamos explícitamente un reembolso. Podés cancelar
        en cualquier momento; la cancelación entra en efecto al final del
        período de facturación actual.
      </P>
      <P>
        Podemos cambiar precios con al menos 30 días de aviso antes de que
        el cambio entre en efecto en tu próximo período de facturación.
      </P>

      <H2>8. Terminación</H2>
      <P>
        Podés cerrar tu cuenta en cualquier momento desde la página de
        configuración. Podemos suspender o terminar cuentas que violen
        estos Términos, que hayan estado inactivas por un período extendido,
        o donde lo exija la ley — vamos a hacer esfuerzos razonables para
        avisarte primero.
      </P>

      <H2>9. Renuncias</H2>
      <P>
        El servicio se provee &ldquo;tal cual.&rdquo; Los hallazgos del
        diagnóstico y las estimaciones de uplift son nuestra mejor
        evaluación basada en heurísticas y modelos que operan sin
        conocimiento interno de la tienda. No garantizamos que sean exactos
        en todos los casos, que coincidan con las mediciones internas de la
        tienda, o que actuar sobre ellos vaya a producir un resultado
        específico de ingresos.
      </P>

      <H2>10. Limitación de responsabilidad</H2>
      <P>
        Hasta el máximo permitido por la ley, GroLabs y sus afiliados no
        serán responsables por daños indirectos, incidentales,
        consecuentes o especiales que surjan de tu uso del servicio.
        Nuestra responsabilidad agregada por daños directos no excederá el
        monto que nos pagaste en los doce meses previos al reclamo, o USD
        100, lo que sea mayor.
      </P>

      <H2>11. Indemnización</H2>
      <P>
        Aceptás indemnizar a GroLabs contra reclamos que surjan de tu mal
        uso del servicio o tu violación de estos Términos — incluyendo
        reclamos por haber usado el servicio para evaluar una tienda que no
        tenías autoridad de evaluar.
      </P>

      <H2>12. Ley aplicable</H2>
      <P>
        Estos Términos se rigen por las leyes de la jurisdicción donde
        GroLabs está constituida, sin tener en cuenta sus reglas de
        conflicto de leyes. Las disputas se resolverán en los tribunales de
        esa jurisdicción.
      </P>

      <H2>13. Cambios</H2>
      <P>
        Podemos actualizar estos Términos. Los cambios materiales serán
        marcados en la parte superior de esta página y, para clientes
        activos, enviados al email de la cuenta. Continuar usando el
        servicio luego de la fecha de efectividad constituye aceptación.
      </P>

      <H2>14. Contacto</H2>
      <P>
        Consultas sobre estos Términos:{" "}
        <a
          href="mailto:legal@grolabs.ai"
          style={{ color: "var(--gl-accent)" }}
        >
          legal@grolabs.ai
        </a>
        .
      </P>
    </LegalLayout>
  );
}
