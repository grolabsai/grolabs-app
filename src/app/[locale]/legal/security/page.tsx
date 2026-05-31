import type { Metadata } from "next";
import Link from "next/link";
import { LegalLayout, H2, P, UL, Note } from "../_layout";

export const metadata: Metadata = {
  title: "Security · GroLabs",
  description:
    "How GroLabs protects the data you trust us with — transport encryption, authentication, isolation, vendor selection, incident response, and disclosure.",
};

const UPDATED = "2026-05-27";

export default async function SecurityPage({
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
      title="Security"
      subtitle="How we protect the data you trust us with."
      updated={`Last updated: ${UPDATED}`}
      altLink={{ href: "/legal/security", label: "Versión en español →" }}
    >
      <P>
        GroLabs treats security as a baseline rather than a checkbox. This
        page describes how we protect the data flowing through the platform
        today and where we are headed. We update it when our posture
        materially changes.
      </P>

      <Note>
        Found something that looks like a vulnerability? See &ldquo;Responsible
        disclosure&rdquo; below — we read every report and reply within two
        business days.
      </Note>

      <H2>1. Transport encryption</H2>
      <P>
        All traffic to and from GroLabs is served over HTTPS with TLS 1.2 or
        higher. We force a redirect from any plaintext URL. Our certificates
        are issued by industry-standard authorities and rotated
        automatically by our hosting providers.
      </P>

      <H2>2. Encryption at rest</H2>
      <P>
        Customer data is stored by our managed sub-processors (Supabase,
        Vercel, Browserless, etc.). Each encrypts data at rest using
        AES-256, managed by the underlying cloud platform (AWS / GCP). Our
        access to those datastores is logged.
      </P>

      <H2>3. Authentication</H2>
      <UL>
        <li>
          We delegate password storage to Supabase Auth, which uses bcrypt
          with a per-user salt.
        </li>
        <li>
          Sessions are managed by signed JWTs with short lifetimes; the
          refresh flow is rotated server-side.
        </li>
        <li>
          SSO and multi-factor authentication are on the roadmap.
        </li>
      </UL>

      <H2>4. Authorization and tenant isolation</H2>
      <P>
        Tenant isolation is enforced at the database row level. Every
        operational table carries an <code>instance_id</code>, and
        Supabase&rsquo;s Postgres Row-Level Security policies make a user&rsquo;s
        membership in an instance the only path to that instance&rsquo;s data.
        Application code never writes <code>WHERE instance_id = X</code>{" "}
        clauses — RLS does it, removing an entire class of authorization
        bugs.
      </P>
      <P>
        The service-role key (which bypasses RLS) is held in environment
        variables and only used by trusted server-side flows
        (admin operations, anonymous public-API ingest, screenshot uploads).
        It is never sent to the browser.
      </P>

      <H2>5. Public read paths</H2>
      <P>
        Some report URLs are public: the share token for a diagnostic run is
        an unguessable UUID. Anyone with the URL can read the report, but
        without the URL no read is possible. Storage buckets used for
        diagnostic screenshots follow the same model — public-read access
        gated by an unguessable run prefix.
      </P>

      <H2>6. Network egress and the browser probe</H2>
      <P>
        The browser-based probe (Playwright via Browserless) only loads the
        URLs you explicitly configure for diagnostics, plus assets those
        pages reference. The probe runs in a managed Chromium pool operated
        by Browserless, isolated from our application infrastructure.
      </P>

      <H2>7. Sub-processor selection</H2>
      <P>
        We pick sub-processors with strong security postures: Supabase
        (SOC 2 Type II), Vercel (SOC 2 Type II), Google Cloud, AWS,
        Browserless, Railway. The full list and what each receives is in
        our <Link href="/legal/privacy" style={{ color: "var(--gl-accent)" }}>Privacy Policy</Link>.
        Each is bound by a Data Processing Agreement.
      </P>

      <H2>8. Internal access</H2>
      <UL>
        <li>Production access is limited to a small number of operators.</li>
        <li>
          Every admin action against the production database is reviewed
          against change-management practices.
        </li>
        <li>
          Personal devices used for production access run full-disk
          encryption and use up-to-date operating systems.
        </li>
      </UL>

      <H2>9. Logging, monitoring, and alerting</H2>
      <P>
        Application errors and performance metrics flow into our
        observability stack (Vercel logs, Supabase logs, the in-app{" "}
        <code>/configuration/system-health</code> probe). Alerts are sent to
        on-call when key health checks regress. Sentry integration is on the
        near-term roadmap.
      </P>

      <H2>10. Vulnerability management</H2>
      <UL>
        <li>
          Dependencies are kept up to date with automated PRs and reviewed
          against advisories.
        </li>
        <li>
          We do not run external penetration tests on a fixed schedule yet;
          we welcome reports from independent researchers.
        </li>
      </UL>

      <H2>11. Incident response</H2>
      <P>
        If we confirm an incident that affects customer data, we will
        notify affected customers without undue delay (within 72 hours
        where data-protection law requires it) with what we know, what we
        are doing, and how it may affect their data.
      </P>

      <H2>12. Compliance roadmap</H2>
      <UL>
        <li>
          Today: we rely on the SOC 2 attestations of our infrastructure
          providers and apply the technical controls described above.
        </li>
        <li>
          Near term: we plan to engage an independent firm to attest our
          own controls (SOC 2 Type I, then Type II) as the customer base
          grows.
        </li>
        <li>
          GDPR-style data subject requests are honored today via the
          contact email in the Privacy Policy.
        </li>
      </UL>

      <H2>13. Responsible disclosure</H2>
      <P>
        If you believe you have found a security vulnerability, please
        email{" "}
        <a
          href="mailto:security@grolabs.ai"
          style={{ color: "var(--gl-accent)" }}
        >
          security@grolabs.ai
        </a>{" "}
        with reproduction steps. Please:
      </P>
      <UL>
        <li>Give us a reasonable window to investigate and remediate before public disclosure.</li>
        <li>Do not perform testing that affects other customers&rsquo; data.</li>
        <li>Do not retain, alter, or transfer data you encounter during testing.</li>
      </UL>
      <P>
        We respond within two business days to acknowledge the report and
        will keep you updated on remediation. We do not have a paid bug
        bounty yet, but we are happy to publicly credit researchers (with
        your permission) for valid findings.
      </P>

      <H2>14. Contact</H2>
      <P>
        Security questions:{" "}
        <a
          href="mailto:security@grolabs.ai"
          style={{ color: "var(--gl-accent)" }}
        >
          security@grolabs.ai
        </a>
        .
      </P>
    </LegalLayout>
  );
}

function Spanish() {
  return (
    <LegalLayout
      title="Seguridad"
      subtitle="Cómo protegemos los datos que nos confiás."
      updated={`Última actualización: ${UPDATED}`}
      altLink={{ href: "/en/legal/security", label: "English version →" }}
    >
      <P>
        GroLabs trata la seguridad como una línea base, no como una casilla
        a marcar. Esta página describe cómo protegemos los datos que pasan
        por la plataforma hoy y a dónde nos dirigimos. La actualizamos
        cuando nuestra postura cambia materialmente.
      </P>

      <Note>
        ¿Encontraste algo que parece una vulnerabilidad? Mirá &ldquo;Reporte
        responsable&rdquo; abajo — leemos cada reporte y respondemos dentro
        de dos días hábiles.
      </Note>

      <H2>1. Encriptación en tránsito</H2>
      <P>
        Todo el tráfico hacia y desde GroLabs se sirve sobre HTTPS con TLS
        1.2 o superior. Forzamos un redirect desde cualquier URL en texto
        plano. Nuestros certificados son emitidos por autoridades estándar
        de la industria y rotados automáticamente por nuestros proveedores
        de hosting.
      </P>

      <H2>2. Encriptación en reposo</H2>
      <P>
        Los datos de clientes son almacenados por nuestros subprocesadores
        administrados (Supabase, Vercel, Browserless, etc.). Cada uno
        encripta los datos en reposo usando AES-256, administrado por la
        plataforma cloud subyacente (AWS / GCP). Nuestro acceso a esos
        almacenes de datos es registrado.
      </P>

      <H2>3. Autenticación</H2>
      <UL>
        <li>
          Delegamos el almacenamiento de contraseñas a Supabase Auth, que
          usa bcrypt con un salt por usuario.
        </li>
        <li>
          Las sesiones se manejan con JWTs firmados con tiempos de vida
          cortos; el flujo de refresh se rota del lado del servidor.
        </li>
        <li>
          SSO y autenticación multi-factor están en el roadmap.
        </li>
      </UL>

      <H2>4. Autorización y aislamiento de tenants</H2>
      <P>
        El aislamiento entre tenants se aplica a nivel de fila de base de
        datos. Cada tabla operacional lleva un <code>instance_id</code>, y
        las políticas Row-Level Security de Postgres de Supabase hacen que
        la membresía de un usuario en una instancia sea el único camino a
        los datos de esa instancia. El código de aplicación nunca escribe
        cláusulas <code>WHERE instance_id = X</code> — RLS lo hace,
        eliminando una clase entera de bugs de autorización.
      </P>
      <P>
        La clave service-role (que evita RLS) se guarda en variables de
        entorno y solo es usada por flujos confiables del lado del servidor
        (operaciones de admin, ingest de la API pública anónima, subida de
        capturas). Nunca se envía al navegador.
      </P>

      <H2>5. Rutas públicas de lectura</H2>
      <P>
        Algunas URLs de reportes son públicas: el token de compartir para
        una corrida de diagnóstico es un UUID no adivinable. Cualquiera
        con la URL puede leer el reporte, pero sin la URL no hay lectura
        posible. Los buckets de Storage usados para las capturas siguen
        el mismo modelo — acceso público de lectura con un prefijo de
        corrida no adivinable.
      </P>

      <H2>6. Egreso de red y la sonda de navegador</H2>
      <P>
        La sonda basada en navegador (Playwright via Browserless) solo
        carga las URLs que configurás explícitamente para diagnósticos,
        más los assets que esas páginas referencian. La sonda corre en un
        pool de Chromium administrado por Browserless, aislado de nuestra
        infraestructura de aplicación.
      </P>

      <H2>7. Selección de subprocesadores</H2>
      <P>
        Elegimos subprocesadores con posturas de seguridad sólidas:
        Supabase (SOC 2 Tipo II), Vercel (SOC 2 Tipo II), Google Cloud,
        AWS, Browserless, Railway. La lista completa y qué recibe cada uno
        está en nuestra{" "}
        <Link href="/legal/privacy" style={{ color: "var(--gl-accent)" }}>
          Política de Privacidad
        </Link>
        . Cada uno está sujeto a un Acuerdo de Procesamiento de Datos.
      </P>

      <H2>8. Acceso interno</H2>
      <UL>
        <li>
          El acceso a producción está limitado a un número pequeño de
          operadores.
        </li>
        <li>
          Cada acción de admin contra la base de datos de producción es
          revisada contra prácticas de gestión de cambios.
        </li>
        <li>
          Los dispositivos personales usados para acceso a producción
          corren con encriptación de disco completo y sistemas operativos
          al día.
        </li>
      </UL>

      <H2>9. Logging, monitoreo y alertas</H2>
      <P>
        Los errores de aplicación y métricas de performance fluyen hacia
        nuestro stack de observabilidad (logs de Vercel, logs de Supabase,
        la sonda interna <code>/configuration/system-health</code>). Las
        alertas se envían a on-call cuando los chequeos clave de salud
        regresan. La integración con Sentry está en el roadmap cercano.
      </P>

      <H2>10. Gestión de vulnerabilidades</H2>
      <UL>
        <li>
          Las dependencias se mantienen al día con PRs automatizados y se
          revisan contra advisories.
        </li>
        <li>
          Todavía no corremos pen tests externos en un cronograma fijo;
          damos la bienvenida a reportes de investigadores independientes.
        </li>
      </UL>

      <H2>11. Respuesta a incidentes</H2>
      <P>
        Si confirmamos un incidente que afecta datos de clientes, vamos a
        notificar a los clientes afectados sin demoras indebidas (dentro
        de 72 horas donde lo exija la ley de protección de datos) con lo
        que sabemos, lo que estamos haciendo y cómo puede afectar a sus
        datos.
      </P>

      <H2>12. Roadmap de compliance</H2>
      <UL>
        <li>
          Hoy: nos apoyamos en las atestaciones SOC 2 de nuestros
          proveedores de infraestructura y aplicamos los controles técnicos
          descriptos arriba.
        </li>
        <li>
          Cercano plazo: planeamos contratar a una firma independiente
          para atestar nuestros propios controles (SOC 2 Tipo I, luego
          Tipo II) a medida que crece la base de clientes.
        </li>
        <li>
          Los pedidos de derechos de titulares estilo GDPR se honran hoy
          vía el email de contacto en la Política de Privacidad.
        </li>
      </UL>

      <H2>13. Reporte responsable de vulnerabilidades</H2>
      <P>
        Si creés que encontraste una vulnerabilidad de seguridad, por
        favor enviá un email a{" "}
        <a
          href="mailto:security@grolabs.ai"
          style={{ color: "var(--gl-accent)" }}
        >
          security@grolabs.ai
        </a>{" "}
        con los pasos para reproducirla. Por favor:
      </P>
      <UL>
        <li>
          Dejanos una ventana razonable para investigar y remediar antes
          de la divulgación pública.
        </li>
        <li>
          No realices pruebas que afecten los datos de otros clientes.
        </li>
        <li>
          No retengas, alteres ni transfieras datos que encuentres durante
          la prueba.
        </li>
      </UL>
      <P>
        Respondemos dentro de dos días hábiles para acusar recibo del
        reporte y te vamos a mantener al día sobre la remediación.
        Todavía no tenemos un bug bounty pago, pero estamos felices de
        acreditar públicamente a investigadores (con tu permiso) por
        hallazgos válidos.
      </P>

      <H2>14. Contacto</H2>
      <P>
        Consultas de seguridad:{" "}
        <a
          href="mailto:security@grolabs.ai"
          style={{ color: "var(--gl-accent)" }}
        >
          security@grolabs.ai
        </a>
        .
      </P>
    </LegalLayout>
  );
}
