import type { Metadata } from "next";
import { LegalLayout, H2, P, UL, Note } from "../_layout";

export const metadata: Metadata = {
  title: "Privacy Policy · GroLabs",
  description:
    "How GroLabs collects, uses, and protects the data you and your prospects' storefronts generate while using the GroLabs diagnostic platform.",
};

const UPDATED = "2026-05-27";

export default async function PrivacyPage({
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
      title="Privacy Policy"
      subtitle="How we handle the data that flows through GroLabs."
      updated={`Last updated: ${UPDATED}`}
      altLink={{ href: "/legal/privacy", label: "Versión en español →" }}
    >
      <P>
        This Privacy Policy explains what information GroLabs collects when you
        use our diagnostic platform or our public free-audit widget,
        how we use it, who else processes it on our behalf, and the choices
        you have. We try to keep this short and concrete rather than legally
        defensive — if anything is unclear, write us.
      </P>

      <Note>
        GroLabs is a software service for ecommerce diagnostics. The
        &ldquo;prospects&rdquo; we evaluate are public storefronts our customers
        diagnose; the customers themselves are the operators who paid for the
        service or used the public widget. This policy covers both kinds of
        users.
      </Note>

      <H2>1. Who we are</H2>
      <P>
        GroLabs (&ldquo;we,&rdquo; &ldquo;us&rdquo;) operates the admin
        application at <code>app.grolabs.ai</code> and the public marketing
        site at <code>grolabs.ai</code>. We are the data controller for the
        personal data described below.
      </P>

      <H2>2. Information we collect</H2>
      <P>From <strong>authenticated customers</strong>:</P>
      <UL>
        <li>
          <strong>Account data:</strong> email address, name, the workspace
          (instance) you belong to, the role you hold, your authentication
          credentials (stored hashed by our auth provider).
        </li>
        <li>
          <strong>Usage data:</strong> the prospects you create, the URLs you
          analyze, the test entries you configure, the diagnostics you run,
          IP address and user agent for session security and abuse detection.
        </li>
        <li>
          <strong>Content you upload:</strong> contact details for the
          prospects you track (typically the storefront owner&rsquo;s name and
          email), notes, custom search-test vocabulary.
        </li>
      </UL>
      <P>
        From <strong>visitors to our public free-audit widget</strong> (no
        account):
      </P>
      <UL>
        <li>The storefront URL you ask us to diagnose.</li>
        <li>
          Your IP address — used solely to rate-limit anonymous requests so
          the public endpoint isn&rsquo;t abused. Stored against the request
          log and discarded with that log on a rolling basis.
        </li>
      </UL>
      <P>
        From <strong>the prospect storefronts</strong> we diagnose: publicly
        available HTML, JSON-LD, sitemap data, screenshots captured by our
        browser probe, and any product metadata your storefront exposes. We
        do not scrape behind authentication; we only fetch what an anonymous
        visitor could see.
      </P>

      <H2>3. How we use the information</H2>
      <UL>
        <li>To deliver the diagnostic reports you ask us to run.</li>
        <li>To populate your dashboard, scan history, and report views.</li>
        <li>To improve our scoring rubric and detection heuristics — using
          aggregate, de-identified signals.</li>
        <li>To support your account (email, ticket replies).</li>
        <li>To meet legal obligations (e.g. tax records, lawful requests).</li>
      </UL>
      <P>
        We do not sell your personal data. We do not use your data for
        advertising profiling. We do not train third-party AI models on your
        data without your explicit consent.
      </P>

      <H2>4. Sub-processors we share data with</H2>
      <P>
        Running a diagnostic involves a small set of trusted vendors. Each
        plays a specific role; none receives more than what they need to
        perform their task:
      </P>
      <UL>
        <li>
          <strong>Supabase</strong> — managed Postgres + Auth + Storage.
          Stores accounts, runs, findings, screenshots.
        </li>
        <li>
          <strong>Vercel</strong> — hosts the GroLabs web application. Sees
          request logs.
        </li>
        <li>
          <strong>Browserless</strong> — managed Chromium that powers the
          browser-based probe. Sees the storefront URLs we ask it to load
          plus the queries we type into search boxes during diagnostics.
        </li>
        <li>
          <strong>Google PageSpeed Insights</strong> — receives the URLs we
          ask it to score for Core Web Vitals.
        </li>
        <li>
          <strong>Anthropic</strong> — receives small text snippets when we
          use Claude for vertical classification or blog-content assistance.
          Anthropic does not train models on data sent through its API.
        </li>
        <li>
          <strong>Railway</strong> — hosts our Agentic Services Engine (ASE)
          backend.
        </li>
        <li>
          <strong>Meilisearch Cloud</strong> — powers in-app search.
        </li>
        <li>
          <strong>Replicate</strong> — runs image-generation models for the
          blog editor when you ask it to.
        </li>
      </UL>
      <P>
        You can verify the live integration status at <code>
          /configuration/system-health
        </code> after logging in.
      </P>

      <H2>5. Where data is stored</H2>
      <P>
        Your data is stored on infrastructure operated by our sub-processors
        in the United States and, for some services, the European Union. When
        you submit data from outside the US, it is transferred to and
        processed in the regions noted above.
      </P>

      <H2>6. How long we keep it</H2>
      <UL>
        <li>
          <strong>Account data:</strong> for as long as your account is
          active, plus a brief window after closure for billing reconciliation.
        </li>
        <li>
          <strong>Diagnostic runs and screenshots:</strong> retained for the
          life of your account unless you delete them. Anonymous public-widget
          runs are kept for 90 days for support purposes, then purged.
        </li>
        <li>
          <strong>Rate-limit logs:</strong> 30 days.
        </li>
      </UL>

      <H2>7. Your rights</H2>
      <P>
        Depending on where you live, you may have the right to access,
        correct, delete, port, or restrict processing of your personal data,
        and to object to processing. Reach us at the address at the bottom of
        this page and we will respond within a reasonable time.
      </P>

      <H2>8. Children</H2>
      <P>
        GroLabs is a B2B product. We do not knowingly collect personal data
        from anyone under 16. If you believe we have, contact us and we will
        delete it.
      </P>

      <H2>9. Cookies and similar technologies</H2>
      <P>
        We use a small set of cookies needed to operate the service: a
        session cookie set by our authentication provider, and optionally a
        preference cookie for the chosen language and theme. We do not use
        third-party advertising cookies.
      </P>

      <H2>10. Changes to this policy</H2>
      <P>
        We may update this policy from time to time. When we make material
        changes, we will note them at the top of this page and, for active
        customers, send a notice to the account email.
      </P>

      <H2>11. Contact</H2>
      <P>
        Privacy questions and requests:{" "}
        <a
          href="mailto:privacy@grolabs.ai"
          style={{ color: "var(--gl-accent)" }}
        >
          privacy@grolabs.ai
        </a>
        .
      </P>
    </LegalLayout>
  );
}

function Spanish() {
  return (
    <LegalLayout
      title="Política de privacidad"
      subtitle="Cómo manejamos los datos que pasan por GroLabs."
      updated={`Última actualización: ${UPDATED}`}
      altLink={{ href: "/en/legal/privacy", label: "English version →" }}
    >
      <P>
        Esta Política de Privacidad explica qué información recolecta GroLabs
        cuando usás nuestra plataforma de diagnóstico o nuestro
        widget público de auditoría gratuita, cómo la usamos, quién más la
        procesa por nuestra cuenta y qué opciones tenés. Tratamos de ser
        cortos y concretos en vez de legalistas — si algo no queda claro,
        escribinos.
      </P>

      <Note>
        GroLabs es un servicio de software para diagnóstico de ecommerce. Los
        &ldquo;prospectos&rdquo; que evaluamos son sitios públicos que
        diagnostican nuestros clientes; los clientes son los operadores que
        pagaron por el servicio o usaron el widget público. Esta política
        cubre los dos tipos de usuarios.
      </Note>

      <H2>1. Quiénes somos</H2>
      <P>
        GroLabs (&ldquo;nosotros&rdquo;) opera la aplicación de
        administración en <code>app.grolabs.ai</code> y el sitio
        público de marketing en <code>grolabs.ai</code>. Somos el responsable
        del tratamiento de los datos personales descriptos abajo.
      </P>

      <H2>2. Información que recolectamos</H2>
      <P>De <strong>clientes autenticados</strong>:</P>
      <UL>
        <li>
          <strong>Datos de cuenta:</strong> dirección de correo electrónico,
          nombre, el workspace (instancia) al que pertenecés, el rol que
          tenés, tus credenciales de autenticación (almacenadas como hash por
          nuestro proveedor de auth).
        </li>
        <li>
          <strong>Datos de uso:</strong> los prospectos que creás, las URLs
          que analizás, las pruebas de búsqueda que configurás, los
          diagnósticos que corrés, dirección IP y user agent para seguridad
          de sesión y detección de abuso.
        </li>
        <li>
          <strong>Contenido que subís:</strong> datos de contacto para los
          prospectos que rastreás (típicamente el nombre y email del dueño de
          la tienda), notas, vocabulario de pruebas de búsqueda.
        </li>
      </UL>
      <P>
        De <strong>visitantes del widget público de auditoría gratuita</strong>{" "}
        (sin cuenta):
      </P>
      <UL>
        <li>La URL de la tienda que nos pedís diagnosticar.</li>
        <li>
          Tu dirección IP — usada solamente para limitar la cantidad de
          pedidos anónimos para que el endpoint público no sea abusado. Se
          guarda contra el log de pedidos y se descarta con ese log de forma
          rotativa.
        </li>
      </UL>
      <P>
        De <strong>las tiendas prospecto</strong> que diagnosticamos: HTML
        públicamente disponible, datos JSON-LD, sitemap, capturas de pantalla
        tomadas por nuestra sonda de navegador y cualquier metadata de
        producto que la tienda exponga. No accedemos a contenido detrás de
        autenticación; solo buscamos lo que un visitante anónimo podría ver.
      </P>

      <H2>3. Cómo usamos la información</H2>
      <UL>
        <li>Para entregar los reportes de diagnóstico que nos pedís.</li>
        <li>
          Para poblar tu dashboard, historial de escaneos y vistas de reporte.
        </li>
        <li>
          Para mejorar nuestra rúbrica de puntuación y heurísticas de
          detección — usando señales agregadas y de-identificadas.
        </li>
        <li>Para soportar tu cuenta (correo, respuestas a tickets).</li>
        <li>
          Para cumplir con obligaciones legales (ej. registros impositivos,
          pedidos legítimos).
        </li>
      </UL>
      <P>
        No vendemos tus datos personales. No usamos tus datos para
        elaboración de perfiles publicitarios. No entrenamos modelos de IA de
        terceros con tus datos sin tu consentimiento explícito.
      </P>

      <H2>4. Subprocesadores con los que compartimos datos</H2>
      <P>
        Correr un diagnóstico involucra un pequeño conjunto de proveedores de
        confianza. Cada uno cumple un rol específico; ninguno recibe más de
        lo que necesita para hacer su tarea:
      </P>
      <UL>
        <li>
          <strong>Supabase</strong> — Postgres + Auth + Storage administrados.
          Almacena cuentas, corridas, hallazgos, capturas de pantalla.
        </li>
        <li>
          <strong>Vercel</strong> — hospeda la aplicación web de GroLabs. Ve
          logs de pedidos.
        </li>
        <li>
          <strong>Browserless</strong> — Chromium administrado que potencia
          la sonda de navegador. Ve las URLs que le pedimos cargar más las
          consultas que tipeamos en los buscadores durante los diagnósticos.
        </li>
        <li>
          <strong>Google PageSpeed Insights</strong> — recibe las URLs que
          le pedimos puntuar para Core Web Vitals.
        </li>
        <li>
          <strong>Anthropic</strong> — recibe fragmentos pequeños de texto
          cuando usamos Claude para clasificación de vertical o asistencia
          de contenido para el blog. Anthropic no entrena modelos con los
          datos que pasan por su API.
        </li>
        <li>
          <strong>Railway</strong> — hospeda nuestro backend Agentic
          Services Engine (ASE).
        </li>
        <li>
          <strong>Meilisearch Cloud</strong> — potencia la búsqueda interna
          de la app.
        </li>
        <li>
          <strong>Replicate</strong> — corre modelos de generación de
          imágenes para el editor de blog cuando se lo pedís.
        </li>
      </UL>
      <P>
        Podés verificar el estado en vivo de las integraciones en{" "}
        <code>/configuration/system-health</code> luego de iniciar sesión.
      </P>

      <H2>5. Dónde se almacenan los datos</H2>
      <P>
        Tus datos se almacenan en infraestructura operada por nuestros
        subprocesadores en Estados Unidos y, para algunos servicios, la
        Unión Europea. Cuando enviás datos desde fuera de EE.UU., se
        transfieren y procesan en las regiones mencionadas arriba.
      </P>

      <H2>6. Cuánto tiempo los conservamos</H2>
      <UL>
        <li>
          <strong>Datos de cuenta:</strong> mientras tu cuenta esté activa,
          más una ventana breve después del cierre para reconciliación de
          facturación.
        </li>
        <li>
          <strong>Corridas de diagnóstico y capturas:</strong> retenidas
          durante la vida de tu cuenta a menos que las borres. Las corridas
          anónimas del widget público se mantienen por 90 días para soporte
          y luego se purgan.
        </li>
        <li>
          <strong>Logs de rate-limit:</strong> 30 días.
        </li>
      </UL>

      <H2>7. Tus derechos</H2>
      <P>
        Dependiendo de dónde vivas, podés tener el derecho a acceder,
        corregir, borrar, portar o restringir el procesamiento de tus datos
        personales, y a oponerte al procesamiento. Contactanos a la
        dirección al final de esta página y vamos a responder en un tiempo
        razonable.
      </P>

      <H2>8. Menores</H2>
      <P>
        GroLabs es un producto B2B. No recolectamos a sabiendas datos
        personales de menores de 16 años. Si creés que lo hicimos,
        contactanos y los borramos.
      </P>

      <H2>9. Cookies y tecnologías similares</H2>
      <P>
        Usamos un pequeño conjunto de cookies necesarias para operar el
        servicio: una cookie de sesión seteada por nuestro proveedor de
        autenticación, y opcionalmente una cookie de preferencias para el
        idioma y tema elegidos. No usamos cookies publicitarias de terceros.
      </P>

      <H2>10. Cambios a esta política</H2>
      <P>
        Podemos actualizar esta política de vez en cuando. Cuando hagamos
        cambios materiales, lo vamos a notar en la parte superior de esta
        página y, para clientes activos, enviar un aviso al email de la
        cuenta.
      </P>

      <H2>11. Contacto</H2>
      <P>
        Consultas y pedidos sobre privacidad:{" "}
        <a
          href="mailto:privacy@grolabs.ai"
          style={{ color: "var(--gl-accent)" }}
        >
          privacy@grolabs.ai
        </a>
        .
      </P>
    </LegalLayout>
  );
}
