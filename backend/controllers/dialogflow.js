// Importación de intents de lógica
const buscarProductos = require('../intents/buscarProductos');
const filtrarRegion = require('../intents/filtrarRegion');
const buscarProductoFiltrarRegion = require('../intents/buscarProductofiltrarRegion');
const buscarArtesanos = require('../intents/buscarArtesanos');
const verMasProductos = require('../intents/verMasProductos');
const cambiarProducto = require('../intents/cambiarProducto');
const otrasRegiones = require('../intents/otrasRegiones');
const productosPopulares = require('../intents/productosPopulares');
const productosCerca = require('../intents/productosCerca');
const especificarCiudad = require('../intents/especificarCiudad');
const productosSimilares = require('../intents/productosSimilares');
const listarProductos = require('../intents/listarProductos');
const pedirProducto = require('../intents/pedirProducto');
const ayudaPlataforma = require('../intents/ayudaPlataforma');
const { getCanonicalProvinceName } = require('../helpers/provincias');

module.exports = (req, res) => {
  try {
    const {
      normalizeNoAccents,
      stripTrailingPunctuation,
      cleanConversationalPrefix,
      containsOffensiveLanguage
    } = require('../utils/nlp');
    const queryResult = req.body.queryResult;

    const rawText = (queryResult.queryText || '').toString();
    const normalize = (s) => normalizeNoAccents(s);
    const normalizeString = (s) => normalizeNoAccents(`${s || ''}`);

    const q = normalize(rawText);
    const qNoPunct = stripTrailingPunctuation(q);
    const qClean = cleanConversationalPrefix(qNoPunct);
    const hasGreetingCue = /\b(hola|holi|buenas|buenos\s+dias|buenas\s+tardes|buenas\s+noches|hey|ey|ola)\b/.test(qNoPunct);
    const hasTaskCue = /\b(busca|buscar|busco|producto|productos|artesano|artesanos|categoria|certificacion|region|provincia|ciudad|cerca)\b/.test(qNoPunct);
    const isGreetingText = hasGreetingCue && !hasTaskCue;

    if (containsOffensiveLanguage(rawText)) {
      const txt = 'Prefiero mantener una conversacion respetuosa. Si quieres, te ayudo a buscar productos artesanales.';
      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [
          { text: { text: [txt] } },
          {
            payload: {
              richContent: [[
                {
                  type: 'chips',
                  options: [
                    { text: 'Ver productos' },
                    { text: 'Productos populares' },
                    { text: 'Conectar con artesanos' },
                    { text: 'Ayuda' }
                  ]
                }
              ]]
            }
          }
        ]
      });
    }

    if (isGreetingText) {
      const txt = '¡Hola! Soy el asistente de Noma. ¿Te gustaría explorar productos artesanales, conocer más sobre nuestra plataforma o conectar con artesanos locales?';
      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [
          { text: { text: [txt] } },
          {
            payload: {
              richContent: [[
                {
                  type: 'chips',
                  options: [
                    { text: 'Ver productos' },
                    { text: 'Productos cerca de mí' },
                    { text: 'Conocer la plataforma' },
                    { text: 'Conectar con artesanos' }
                  ]
                }
              ]]
            }
          }
        ]
      });
    }

    const isLikelyCommand =
      /^(ver|mostrar|filtrar|buscar|cambiar|quiero|otra|productos|artesanos|ayuda|como|que|conectar|reset|solo|categoria|categorias|certificacion|certificaciones|permitir|activar|usar|quitar|limpiar|borrar|reiniciar)\b/.test(q) ||
      /\b(categoria|categorias|certificacion|certificaciones|do|dop|igp|iga|artesania\s+garantizada|cerca\s+de\s+mi|mi\s+zona)\b/.test(q);

    const cleanProductPrefix = (value) => {
      const raw = cleanConversationalPrefix(`${value || ''}`.trim());
      if (!raw) return '';
      return raw
        .replace(/^(quiero|quisiera|busco|buscar|busca|dame|muestrame|mu[eé]strame|ensename|ens[eé][ñn]ame|ver|mostrar|mostrarme|encontrar)\s+/i, '')
        .replace(/^productos?\s+de\s+/i, '')
        .trim();
    };

    const canonicalProvinceOrNull = (value) => {
      const candidate = `${value || ''}`.trim();
      if (!candidate) return null;
      return getCanonicalProvinceName(candidate);
    };

    // 📋 LOG INICIAL: Qué intent exactamente se retornó
    const intentObj = queryResult.intent;
    const intent = intentObj?.displayName || 'NONE';
    // Prioridad absoluta: si Dialogflow detecta un intent de ayuda,
    // no debe ser sobreescrito por heurísticas defensivas de texto.
    if (
      intent === 'CG-36 Ayuda en Noma' ||
      intent === 'CG-36 ayuda en noma' ||
      intent === 'FP-13 ayuda-plataforma' ||
      intent === 'ayuda-plataforma' ||
      intent === 'CG-2 ayuda'
    ) {
      return ayudaPlataforma(req, res);
    }

    // Atajo temprano: capacidades del bot (evita caer en heurísticas de producto).
    const isHelpCapabilitiesShortcutEarly =
      qNoPunct === 'conocer la plataforma' ||
      qNoPunct === 'conocer plataforma' ||
      qNoPunct === 'conocer laplataforma' ||
      qNoPunct === 'conocer mas sobre la plataforma' ||
      qNoPunct === 'que puedes hacer' ||
      qNoPunct === 'que peudes hacer' ||
      qNoPunct === 'que haces' ||
      qNoPunct === 'en que ayudas' ||
      qNoPunct === 'en que me ayudas' ||
      qNoPunct === 'que puedes hacer en noma' ||
      qNoPunct === 'como me puedes ayudar';

    if (isHelpCapabilitiesShortcutEarly) {
      return ayudaPlataforma(req, res);
    }

    // ══ CONVERSACIÓN NATURAL ════════════════════════════════════════════════
    // Este bloque convierte lenguaje humano informal en intents correctos,
    // ANTES de que el texto llegue al fallback y se trate como provincia/producto.

    // ── 1. Solicitudes de "ver más" / paginación ─────────────────────────────
    const hasMoreSignal =
      /\bhay\s+m[aá]s\b/.test(q) ||
      /\bm[aá]s\s+opciones?\b/.test(q) ||
      /\balgo\s+m[aá]s\b/.test(q) ||
      /\bver\s+otros?\b/.test(q) ||
      /\botros?\s+productos?\b/.test(q) ||
      /\bsiguientes?\b/.test(q) ||
      /\bpr[oó]ximos?\b/.test(q) ||
      /^(sigue|continua|adelante|siguiente)$/.test(q) ||
      /\bmuest[rr]a?me\s+m[aá]s\b/.test(q) ||
      /\bquiero\s+ver\s+m[aá]s\b/.test(q) ||
      /\bens[eé][ñn]ame\s+m[aá]s\b/.test(q);

    if (hasMoreSignal) {
      return verMasProductos(req, res);
    }

    // ── 2. Feedback negativo → ofrecer más opciones ──────────────────────────
    const hasNegativeFeedback =
      /\b(no\s+me\s+(gusta|gustan|convence|convencen|interesa|interesan|mola|molan)|no\s+me\s+llama|no\s+hay\s+nada|ninguno\s+(me|los)|no\s+encuentro\s+lo\s+que\s+busco|no\s+es\s+lo\s+que\s+busco|no\s+es\s+lo\s+que\s+quiero)\b/.test(q);

    if (hasNegativeFeedback) {
      return verMasProductos(req, res);
    }

    // ── 3. Descubrimiento: "¿qué tienes?", "muéstrame algo" ─────────────────
    const isDiscoveryRequest =
      /^(qu[eé]\s+(tienes|ten[eé]is|hay|tiene)\b|qu[eé]\s+me\s+(puedes\s+)?mostrar|qu[eé]\s+puedes\s+mostrar)/.test(q) ||
      /^(muest[rr]a?me\s+algo|ens[eé][ñn]ame\s+algo|quiero\s+ver\s+algo|ver\s+algo|d[aá]me\s+algo)/.test(q) ||
      /^(qu[eé]\s+productos?\s+(tienes|hay|ten[eé]is)|qu[eé]\s+hay\s+disponible|qu[eé]\s+hay\s+de\s+nuevo)/.test(q) ||
      /^(algo\s+interesante|muest[rr]a?me\s+productos?|ensename\s+productos?)/.test(q);

    if (isDiscoveryRequest) {
      return listarProductos(req, res);
    }

    // ── 4. "¿quién lo hace?", "el artesano" → buscar artesanos ──────────────
    const isArtisanFollowUp =
      /\b(quien\s+(lo|los|la|las)\s+(hace|hacen|fabrica|fabrican|elabora|elaboran)|el\s+artesano|los\s+artesanos|quien\s+hace|quien\s+elabora)\b/.test(q) ||
      /\b(como\s+contactar|como\s+(lo\s+)?comprar|d[oó]nde\s+(lo\s+)?comprar|d[oó]nde\s+conseguir|quien\s+lo\s+vende)\b/.test(q);

    if (isArtisanFollowUp) {
      return buscarArtesanos(req, res);
    }

    // ── 5. "algo parecido", "algo similar" → productos similares ────────────
    const isSimilarRequest =
      /\b(algo\s+parecido|algo\s+similar|parecidos?|similares?|relacionados?|del\s+mismo\s+tipo|de\s+este\s+tipo|como\s+[eé]ste|como\s+[eé]stos?|del\s+mismo\s+estilo)\b/.test(q);

    if (isSimilarRequest) {
      return productosSimilares(req, res);
    }

    // ── 6. Quiero algo diferente → cambiar producto ──────────────────────────
    const isChangeRequest =
      /\b(algo\s+diferente|algo\s+distinto|otra\s+cosa|otro\s+tipo|prefiero\s+otra|quiero\s+algo\s+(distinto|diferente)|no\s+es\s+lo\s+que\s+(buscaba|quer[ií]a))\b/.test(q) ||
      /^(cambia|cambiame|muestrame\s+otra\s+cosa|busca\s+otra\s+cosa|busca\s+otro)$/.test(q);

    if (isChangeRequest) {
      return cambiarProducto(req, res);
    }

    // ── 7. "¿y los de cerámica?", "¿y en Madrid?" (filtros implícitos) ───────
    {
      const matchYDeCat = qNoPunct.match(/^(?:y\s+)?(?:los?\s+de|las?\s+de|de)\s+(alimentacion|textil|barro|alfareria|ceramica|madera|mueble|otros)\b/i);
      if (matchYDeCat?.[1]) {
        return buscarProductos(req, res);
      }

      const matchYEnRegion = qNoPunct.match(/^(?:y\s+)?(?:los?\s+de|las?\s+de|en|de)\s+(.{3,30})$/i);
      if (matchYEnRegion?.[1]) {
        const regionCandidate = matchYEnRegion[1].replace(/[?.!,;:]+$/, '').trim();
        const canonicalR = canonicalProvinceOrNull(regionCandidate);
        if (canonicalR) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            region: canonicalR
          };
          return filtrarRegion(req, res);
        }
      }
    }

    // ── 8. Afirmativos con contexto → continuar con más ─────────────────────
    {
      const isAffirmative = /^(si|s[ií]|claro|exacto|eso\s+es|eso\s+quiero|muestrame|muest[rr]a?me|venga|dale|vamos|s[ií]\s+por\s+favor|s[ií]\s+quiero|me\s+interesa)$/.test(q);
      const outputContexts = queryResult.outputContexts || [];
      const hasProductContext = outputContexts.some(c => c?.name?.includes('buscando-productos'));
      const hasArtisanContext = outputContexts.some(c => c?.name?.includes('buscando-artesanos'));

      if (isAffirmative && (hasProductContext || hasArtisanContext)) {
        return verMasProductos(req, res);
      }
    }

    // ── 9. Rellenos neutros: "bueno", "ok", "gracias"… ──────────────────────
    const isNeutralFiller =
      /^(bueno|ok|vale|perfecto|genial|de\s+acuerdo|entendido|gracias|muchas\s+gracias|no\s+s[eé]|mmm+|hmm+|ehmm+|aah*|uff+|vaya|vamos|interesante|curioso)\.?\s*$/.test(q);

    if (isNeutralFiller) {
      const txt = '¿En qué más puedo ayudarte?';
      return res.json({
        fulfillmentText: txt,
        fulfillmentMessages: [
          { text: { text: [txt] } },
          {
            payload: {
              richContent: [[{
                type: 'chips',
                options: [
                  { text: 'Ver productos' },
                  { text: 'Ver más productos' },
                  { text: 'Ver productos populares' },
                  { text: 'Conectar con artesanos' }
                ]
              }]]
            }
          }
        ]
      });
    }
    // ════════════════════════════════════════════════════════════════════════

    // ✅ Routing defensivo por texto (incluso si Dialogflow no detecta intent)
    // Esto evita que los chips caigan en el fallback.

    if (/^(ver\s+mas\s+artesanos|mas\s+artesanos)$/.test(qNoPunct) || /^(ver\s+mas\s+artesanos|mas\s+artesanos)$/.test(qClean)) {
      return buscarArtesanos(req, res);
    }

    if (/^(ver\s+mas\s+productos\s+populares)$/.test(qNoPunct) || /^(ver\s+mas\s+productos\s+populares)$/.test(qClean)) {
      return productosPopulares(req, res);
    }

    if (/^(ver\s+mas\s+productos\s+relacionados)$/.test(qNoPunct) || /^(ver\s+mas\s+productos\s+relacionados)$/.test(qClean)) {
      return verMasProductos(req, res);
    }

    if (/^(ver\s+mas|mas)$/.test(qNoPunct) || /^(ver\s+mas|mas)$/.test(qClean)) {
      const allContexts = queryResult.outputContexts || [];
      const productosCtx = allContexts.find((ctx) => ctx?.name && ctx.name.includes('buscando-productos'));
      const ultimaBusqueda = normalizeString(productosCtx?.parameters?.ultima_busqueda || '');
      if (ultimaBusqueda === 'populares') {
        return productosPopulares(req, res);
      }
    }

    if (/^(ver\s+mas\s+productos)$/.test(qNoPunct) || /^(ver\s+mas\s+productos)$/.test(qClean)) {
      return verMasProductos(req, res);
    }

    // Chip "Ver más de <categoría>" o "Ver más sobre <producto>" generado por verMasProductos/buscarProductos
    if (/^ver\s+mas\s+(de|sobre)\s+.+$/.test(qNoPunct) || /^ver\s+mas\s+(de|sobre)\s+.+$/.test(qClean)) {
      return verMasProductos(req, res);
    }

    if (/^([a-z]+\s+){0,2}(mostrar\s+mas|mostrar\s+m[aá]s|ver\s+mas|ver\s+m[aá]s|mas|m[aá]s)$/.test(qNoPunct) || /^([a-z]+\s+){0,2}(mostrar\s+mas|mostrar\s+m[aá]s|ver\s+mas|ver\s+m[aá]s|mas|m[aá]s)$/.test(qClean)) {
      return verMasProductos(req, res);
    }


    const recommendationPhrases = [
      /recomiendame\s+productos?/, /recomendar\s+productos?/, /recomendaciones?\s+de\s+productos?/, /productos?\s+recomendados?/,
      /que\s+me\s+recomiendas?/, /dame\s+una\s+recomendacion/, /sugerencias?\s+de\s+productos?/
    ];
    if (recommendationPhrases.some((rx) => rx.test(qNoPunct) || rx.test(qClean))) {
      return productosPopulares(req, res);
    }

    const isChangeProductCommand = /(cambiar\s+de\s+producto|buscar\s+otro\s+producto|otro\s+producto|otro\s+articulo|otro\s+art[ií]culo)/i.test(qNoPunct) || /(cambiar\s+de\s+producto|buscar\s+otro\s+producto|otro\s+producto|otro\s+articulo|otro\s+art[ií]culo)/i.test(qClean);
    if (isChangeProductCommand) {
      return cambiarProducto(req, res);
    }

    // Si el usuario pide explícitamente "productos en/de <provincia>",
    // debe resolverse como filtro por región, no como producto+región.
    {
      const explicitProductsByRegion = qNoPunct.match(/^productos?\s+(?:en|de)\s+(.+)$/i);
      if (explicitProductsByRegion?.[1]) {
        const regionCandidate = stripTrailingPunctuation(explicitProductsByRegion[1]);
        const canonicalProvince = canonicalProvinceOrNull(regionCandidate);
        if (canonicalProvince) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            region: canonicalProvince
          };
          return filtrarRegion(req, res);
        }
      }
    }

    // "quiero ver artesanías / cosas de artesanía / cosas artesanales" → listado general
    {
      const isGenericCraftRequest =
        /^(?:quiero\s+)?(?:ver|mostrar|busco?|dame)\s+(?:cosas?\s+(?:de\s+)?)?artesani[ao]s?$/.test(q) ||
        /^(?:quiero\s+)?(?:ver|mostrar|busco?)\s+cosas?\s+artesanales?$/.test(q) ||
        /^(?:quiero\s+ver|ver|mostrar)\s+(?:todo\s+)?(?:lo\s+que\s+hay|la\s+artesania|artesania)$/.test(q);
      if (isGenericCraftRequest) {
        return listarProductos(req, res);
      }
    }

    // Si "ver productos de <X>" y X es una categoría → buscarProductos, no filtrar por región
    {
      const matchProductsDeCat = qNoPunct.match(/^(?:buscar|ver|mostrar|quiero|dame)\s+(?:productos?|artesanias?)\s+de\s+(.+)$/i);
      if (matchProductsDeCat?.[1]) {
        const termNorm = normalizeString(matchProductsDeCat[1].trim().replace(/[?.!,;:]+$/, ''));
        if (/^(alimentacion|alimentacion y bebida|textil|barro|barro y alfareria|alfareria|ceramica|madera|madera y mueble|mueble|otros)$/.test(termNorm)) {
          return buscarProductos(req, res);
        }
      }
    }

    if (/^(buscar|ver|mostrar|quiero|dame)\s+(productos?|artesanias?|artesan[ií]as?)\s+de\s+/.test(qNoPunct) || /^(buscar|ver|mostrar|quiero|dame)\s+(productos?|artesanias?|artesan[ií]as?)\s+de\s+/.test(qClean)) {
      return buscarProductoFiltrarRegion(req, res);
    }

    // Preguntas tipo "¿qué productos de cerámica tienes?" deben abrir búsqueda de producto
    // y NO reutilizar el último producto del contexto como si fuera un filtro por región.
    {
      const questionProductMatch = qNoPunct.match(/^(?:que\s+)?productos?\s+de\s+(.+?)\s+(?:tienes|hay)$/i);
      if (questionProductMatch?.[1]) {
        const productCandidate = cleanProductPrefix(questionProductMatch[1]);
        if (productCandidate) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            product: productCandidate
          };
          return buscarProductos(req, res);
        }
      }
    }

    // Frase mixta producto + categoría: "productos de miel en alimentación"
    // Debe resolverse como búsqueda de producto con filtro de categoría, no como provincia.
    {
      const matchProductCategory = qNoPunct.match(/^productos?\s+de\s+(.+?)\s+en\s+(.+)$/i);
      const categoryHints = /\b(alimentacion|textil|barro|alfareria|ceramica|madera|mueble|otros)\b/i;
      if (matchProductCategory?.[1] && matchProductCategory?.[2] && categoryHints.test(normalizeString(matchProductCategory[2]))) {
        const productCandidate = cleanProductPrefix(matchProductCategory[1]);
        if (productCandidate) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            product: productCandidate
          };
          return buscarProductos(req, res);
        }
      }
    }

    // Patrón conversacional: "me encantaría ver algo de vino" → extrae "vino" después de limpiar.
    // Importante: si estamos esperando provincia/región, no debemos capturar chips cortos
    // (ej: "Jaén") como producto.
    const preContexts = queryResult.outputContexts || [];
    const preBuscandoProductosCtx = preContexts.find((ctx) => ctx?.name && ctx.name.includes('buscando-productos'));
    const preBuscandoArtesanosCtx = preContexts.find((ctx) => ctx?.name && ctx.name.includes('buscando-artesanos'));
    const preExplorandoRegionesCtx = preContexts.find((ctx) => ctx?.name && ctx.name.includes('explorando-regiones'));
    const waitingLocationSelection =
      preBuscandoProductosCtx?.parameters?.esperando_region === true ||
      preBuscandoArtesanosCtx?.parameters?.esperando_region === true ||
      Boolean(preExplorandoRegionesCtx);

    // Si qClean es corto (1-3 tokens) y no contiene palabras de comando, usarlo como búsqueda de producto
    if (qClean && qClean.length > 2 && qClean.length < 60) {
      const tokens = qClean.split(/\s+/).filter((t) => t.length > 1);
      const hasConnector = /\b(de|en|del|al)\b/.test(qClean);
      const hasPaginationCue = /\b(mas|más)\b/.test(qClean);
      const controlWords = new Set([
        'ver', 'mostrar', 'buscar', 'filtrar', 'cambiar', 'quiero', 'quisiera',
        'otra', 'artesanos', 'productos', 'ayuda', 'como', 'conectar', 'reset',
        'categoria', 'certificacion', 'provincia', 'ciudad', 'regiones', 'region'
      ]);
      const hasControlWord = tokens.some((t) => controlWords.has(t));
      const isCommandTermInClean = /^(ver|mostrar|buscar|filtrar|cambiar|quiero|quisiera|otra|artesanos|ayuda|como|conectar|reset|categoria|certificacion|productos?|del|de|en)$/i.test(qClean);
      const likelyCommandInClean = /^(ver|mostrar|filtrar|buscar|cambiar|quiero|quisiera|otra|productos|artesanos|ayuda|como|conectar|reset|categoria|certificacion)\b/.test(qClean);

      // Verificar primero si el texto completo es una provincia conocida, antes de aplicar
      // la restricción de "palabras de control". Esto permite detectar provincias cuyo nombre
      // contiene palabras reservadas, como "Ciudad Real".
      if (!hasConnector && !hasPaginationCue && !isGreetingText && !hasGreetingCue) {
        const provinceFromFull = canonicalProvinceOrNull(qClean);
        if (provinceFromFull) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            region: provinceFromFull
          };
          return filtrarRegion(req, res);
        }
      }

      // Si es 1-3 palabras sin ser un comando directo, usarlo como término de búsqueda de producto
      if (tokens.length >= 1 && tokens.length <= 3 && !hasConnector && !hasPaginationCue && !hasControlWord && !isCommandTermInClean && !likelyCommandInClean && !waitingLocationSelection && !isGreetingText && !hasGreetingCue) {
        req.body.queryResult.parameters = {
          ...(req.body.queryResult.parameters || {}),
          product: qClean
        };
        return buscarProductos(req, res);
      }
    }

    // Productos cerca de mí / en mi zona / permiso de ubicación.
    if (
      /^(productos?\s+)?cerca(\s+de\s+mi)?$/.test(q) ||
      /^(productos?\s+)?en\s+mi\s+zona$/.test(q) ||
      /^(permitir|activar|usar)\s+(mi\s+)?ubicacion$/.test(q) ||
      q.includes('cerca de mi')
    ) {
      return productosCerca(req, res);
    }

    // Filtros por categoría y certificación.
    const wantsCategoryFilter =
      /^filtrar\s+por\s+categorias?$/.test(q) ||
      /^ver\s+categorias?$/.test(q) ||
      /^categorias?$/.test(q) ||
      /^categoria\s+/.test(q) ||
      q.includes('categoria');

    const wantsCertificationFilter =
      /^filtrar\s+por\s+certificaciones?$/.test(q) ||
      /^solo\s+con\s+certificacion(?:\s+oficial)?$/.test(q) ||
      /^certificacion(?:\s+oficial)?$/.test(q) ||
      /^certificacion\s+(do|dop|igp|iga)\b/.test(q) ||
      /artesania\s+garantizada/.test(q) ||
      q.includes('certificacion') ||
      /\b(do|dop|igp|iga)\b/.test(q);

    const wantsClearFilters =
      /^(quitar|limpiar|borrar|reiniciar)\s+filtros?$/.test(q) ||
      /^ver\s+sin\s+filtros?$/.test(q) ||
      /^sin\s+filtros?$/.test(q);

    if (wantsCategoryFilter || wantsCertificationFilter || wantsClearFilters) {
      return buscarProductos(req, res);
    }

    {
      const outputContexts = queryResult.outputContexts || [];
      const buscandoProductosCtx = outputContexts.find((ctx) => ctx?.name && ctx.name.includes('buscando-productos'));
      const esperandoCategoria = buscandoProductosCtx?.parameters?.esperando_categoria === true;

      if (esperandoCategoria && rawText && rawText.length > 0 && rawText.length < 60 && !isLikelyCommand) {
        return buscarProductos(req, res);
      }
    }

    // Ver todas las provincias (compat: regiones)
    if (
      q.includes('ver todas las provincias') ||
      q.includes('todas las provincias') ||
      q.includes('ver todas las regiones') ||
      q.includes('todas las regiones')
    ) {
      return otrasRegiones(req, res);
    }

    // Alias directo para explorar por ubicación administrativa.
    if (q.includes('explorar por provincia') || q.includes('explorar por region')) {
      return otrasRegiones(req, res);
    }

    // Paginación de provincias (compat: regiones).
    if (/^(ver\s+mas\s+(provincias|regiones)|mas\s+(provincias|regiones))$/.test(q)) {
      return otrasRegiones(req, res);
    }

    if (/^ver\s+mas$/.test(q)) {
      const regionsContexts = queryResult.outputContexts || [];
      const hasRegionsContext = regionsContexts.some((ctx) => ctx?.name && ctx.name.includes('explorando-regiones'));
      if (hasRegionsContext) {
        return otrasRegiones(req, res);
      }
    }

    // Si estamos esperando una ubicación y el usuario pulsa un chip corto (ej: "Alicante"),
    // lo tratamos como región/provincia directamente.
    {
      const outputContexts = queryResult.outputContexts || [];
      const buscandoProductosCtx = outputContexts.find((ctx) => ctx?.name && ctx.name.includes('buscando-productos'));
      const buscandoArtesanosCtx = outputContexts.find((ctx) => ctx?.name && ctx.name.includes('buscando-artesanos'));
      const explorandoRegionesCtx = outputContexts.find((ctx) => ctx?.name && ctx.name.includes('explorando-regiones'));
      const esperandoRegionProductos = buscandoProductosCtx?.parameters?.esperando_region === true;
      const esperandoRegionArtesanos = buscandoArtesanosCtx?.parameters?.esperando_region === true;
      const artisanLifespan = Number(buscandoArtesanosCtx?.lifespanCount) || 0;
      const productLifespan = Number(buscandoProductosCtx?.lifespanCount) || 0;

      const looksLikeDirectLocationReply =
        rawText &&
        rawText.length > 0 &&
        rawText.length < 60 &&
        !isLikelyCommand;

      if ((esperandoRegionArtesanos || esperandoRegionProductos || explorandoRegionesCtx) && looksLikeDirectLocationReply) {
        req.body.queryResult.parameters = {
          ...(req.body.queryResult.parameters || {}),
          region: rawText.toLowerCase().trim()
        };

        if (esperandoRegionArtesanos) {
          return buscarArtesanos(req, res);
        }

        if (explorandoRegionesCtx && buscandoArtesanosCtx && artisanLifespan >= productLifespan) {
          return buscarArtesanos(req, res);
        }

        return filtrarRegion(req, res);
      }
    }

    // Conectar con artesanos (atajo de bienvenida)
    if (q.includes('conectar con artesanos') || q.includes('conocer artesanos') || q === 'conectar con artesanos') {
      return buscarArtesanos(req, res);
    }

    // Listado completo de artesanos sin filtros.
    if (/^(ver\s+todos\s+los\s+artesanos|todos\s+los\s+artesanos|ver\s+artesanos)$/.test(q)) {
      return buscarArtesanos(req, res);
    }

    // Cualquier consulta explícita de artesanos debe priorizar FP-4 y no caer en flujos de productos.
    if (/\bartesan(?:o|os)\b/.test(q)) {
      return buscarArtesanos(req, res);
    }

    // Flujo de artesanos/productos: pedir otra ubicación sin salir del intent.
    if (/^(otra\s+ciudad|otra\s+provincia|buscar\s+otra\s+ciudad|buscar\s+otra\s+provincia|buscar\s+por\s+ciudad|buscar\s+por\s+provincia|filtrar\s+por\s+ciudad|filtrar\s+por\s+provincia)$/.test(q)) {
      const allContexts = queryResult.outputContexts || [];
      const artisanCtx = allContexts.find((ctx) => ctx?.name && ctx.name.includes('buscando-artesanos'));
      const productCtx = allContexts.find((ctx) => ctx?.name && ctx.name.includes('buscando-productos'));
      const hasArtisanContext = !!artisanCtx;
      const hasProductContext = !!productCtx;
      const artisanLifespan = Number(artisanCtx?.lifespanCount) || 0;
      const productLifespan = Number(productCtx?.lifespanCount) || 0;
      const isFilterByLocationCommand = /^(filtrar\s+por\s+ciudad|filtrar\s+por\s+provincia)$/.test(q);

      // Si el usuario pide "filtrar por provincia/ciudad", priorizamos productos.
      if (isFilterByLocationCommand && hasProductContext) {
        return filtrarRegion(req, res);
      }

      // Si coexisten ambos contextos, elegimos el más reciente (lifespan más alto).
      if (hasArtisanContext && hasProductContext) {
        if (productLifespan >= artisanLifespan) {
          return filtrarRegion(req, res);
        }

        return buscarArtesanos(req, res);
      }

      if (hasArtisanContext) {
        return buscarArtesanos(req, res);
      }

      if (hasProductContext) {
        return filtrarRegion(req, res);
      }
    }

    // Flujo de artesanos: paginación de resultados.
    if (/^ver\s+mas\s+artesanos$/.test(q)) {
      return buscarArtesanos(req, res);
    }

    if (/^ver\s+mas$/.test(q)) {
      const artisanContexts = queryResult.outputContexts || [];
      const hasArtisanContext = artisanContexts.some((ctx) => ctx?.name && ctx.name.includes('buscando-artesanos'));
      if (hasArtisanContext) {
        return buscarArtesanos(req, res);
      }
    }

    // Conocer la plataforma / capacidades del bot (atajo de bienvenida)
    const isHelpCapabilitiesShortcut =
      qNoPunct === 'conocer la plataforma' ||
      qNoPunct === 'conocer mas sobre la plataforma' ||
      qNoPunct === 'que puedes hacer' ||
      qNoPunct === 'que peudes hacer' ||
      qNoPunct === 'que puedes hacer en noma' ||
      qNoPunct === 'como me puedes ayudar';

    if (isHelpCapabilitiesShortcut) {
      return ayudaPlataforma(req, res);
    }

    // NLP defensivo: consultas tipo "queso de oveja" o "vino en la rioja"
    // deben entrar al parser combinado (FP-3), incluso si Dialogflow clasifica mal.
    if (!/\bartesan(?:o|os)\b/.test(q) && !q.includes('productos')) {
      const matchProductExpr = rawText.match(/^\s*(.+?)\s+(?:de|en)\s+(.+)\s*$/i);
      if (matchProductExpr && matchProductExpr[1] && matchProductExpr[2]) {
        const left = cleanProductPrefix(matchProductExpr[1]);
        const right = (matchProductExpr[2] || '').replace(/[?.!,;:]+$/g, '').trim();

        if (left && right) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            product: left,
            region: right
          };
          return buscarProductoFiltrarRegion(req, res);
        }
      }
    }

    // Si no hay intent detectado, intentamos resolver por texto; si no, fallback.
    if (!queryResult.intent) {
      const artisanContexts = queryResult.outputContexts || [];
      const buscandoArtesanosCtx = artisanContexts.find(ctx => ctx.name && ctx.name.includes('buscando-artesanos'));
      const artisanParams = buscandoArtesanosCtx?.parameters || {};
      const esperandoRegionArtesanos = artisanParams.esperando_region === true;
      const isObviouslyNotLocation =
            rawText.split(/\s+/).length > 5 ||
            /\b(gusta|gustan|convence|interesa|mola|llama|ninguno|nada|hay\s+mas|hay\s+m[aá]s|tampoco|tampoco|tambi[eé]n|porque|pero|aunque|gracias|perfecto|genial)\b/.test(q) ||
            /\b(no\s+me|no\s+te|no\s+hay)\b/.test(q);
          const looksLikeLocationReply = rawText && rawText.length > 0 && rawText.length < 50 && !isLikelyCommand && !isObviouslyNotLocation;
      if ((esperandoRegionArtesanos || buscandoArtesanosCtx) && looksLikeLocationReply) {
        req.body.queryResult.parameters = {
          ...(req.body.queryResult.parameters || {}),
          region: rawText.toLowerCase().trim()
        };
        return buscarArtesanos(req, res);
      }

      return res.json({
        fulfillmentText: "Lo siento, no he podido entenderte. ¿Podrías repetirlo de otra forma?"
      });
    }

    // --- Routing defensivo por texto ---
    // 1) "ver más" debe seguir el contexto actual aunque Dialogflow se equivoque
    if (
      /^ver\s+mas(\s+productos)?$/.test(q) ||
      /^ver\s+mas\s+productos\s+relacionados$/.test(q) ||
      /^ver\s+mas\s+de\s+.+$/.test(q) ||
      /^ver\s+mas\s+sobre\s+.+$/.test(q) ||
      /^ver\s+mas\s+productos\s+populares$/.test(q)
    ) {
      return verMasProductos(req, res);
    }

    // 1.0) "quiero ver productos" (sin filtros) => listado paginado de TODO
    // Evita capturar casos tipo "productos de/en <region>"
    const mentionsDeEn = /\bproductos\s+(de|en)\s+/.test(q);
    const wantsAllProducts =
      /^(quiero\s+ver|ver|mostrar|ensen?ame)\s+(todos\s+los\s+)?productos$/.test(q) ||
      /^ver\s+productos$/.test(q);

    if (wantsAllProducts && !mentionsDeEn) {
      return listarProductos(req, res);
    }

    // 1.1) "ver productos similares/parecidos" normalmente viene de chips y depende del contexto
    // Aceptamos typos (ej: "prodctos") usando raíces "simil" y "parecid"
    if (q.includes('simil') || q.includes('parecid')) {
      return productosSimilares(req, res);
    }

    // 1.2) Recomendaciones: "¿qué me recomiendas?" -> productos populares/destacados
    if (q.includes('recomienda') || q.includes('recomiendas') || q.includes('recomend') || q.includes('que me recomiendas')) {
      return productosPopulares(req, res);
    }

    // 1.3) Chip: "Buscar producto específico" => preguntar y sugerir productos reales
    if (q.includes('buscar producto especific')) {
      return pedirProducto(req, res);
    }

    // 1.4) Chip: "Buscar otro producto" (y variantes) => NO debe interpretarse como término de búsqueda
    // Evita respuestas tipo: "No encontré productos de buscar otro producto"
    if (
      /^(buscar\s+otro\s+producto|otro\s+producto|buscar\s+otro|buscar\s+otra\s+cosa|buscar\s+algo\s+mas|buscar\s+un\s+producto|buscar\s+producto)$/.test(qNoPunct) ||
      /^cambiar\s+(de\s+)?productos?$/.test(qNoPunct) ||
      /^producto$/.test(qNoPunct)
    ) {
      return pedirProducto(req, res);
    }

    // 1.6) Chip: "<producto> de toda España" => relanzar búsqueda del producto sin región
    if (/^(ver\s+productos|productos)\s+de\s+toda\s+espa(?:n|ñ)a\s*$/i.test(rawText)) {
      return listarProductos(req, res);
    }

    const matchTodaEspana = rawText.match(/^(.+?)\s+de\s+toda\s+espa(?:n|ñ)a\s*$/i);
    if (matchTodaEspana && matchTodaEspana[1]) {
      const producto = cleanProductPrefix(matchTodaEspana[1]).trim();
      if (producto) {
        req.body.queryResult.parameters = {
          ...(req.body.queryResult.parameters || {}),
          product: producto,
          region: ''
        };
        return buscarProductos(req, res);
      }
    }



    // 2) "productos de <region>" debe filtrar por región (no populares)
    // Tolerancia a typos tipo "prroductos"
    const looksLikeProductos = /\bp+r+o+d+u+c+t+o+s+\b/i.test(rawText) || q.includes('productos');
    const explicitlyPopular =
      q.includes('popular') ||
      q.includes('destacad') ||
      q.includes('recomendad') ||
      q.includes('top') ||
      q.includes('cerca');

    const matchRegion = rawText.match(/\b(?:p+r+o+d+u+c+t+o+s+|productos)\s+(?:de|en)\s+(.+)$/i);
    const extractedRegion = matchRegion?.[1]?.trim();

    if (looksLikeProductos && extractedRegion && !explicitlyPopular) {
      const region = extractedRegion.replace(/[?.!,;:]+$/g, '').trim();
      if (region) {
        req.body.queryResult.parameters = {
          ...(req.body.queryResult.parameters || {}),
          region
        };
        return filtrarRegion(req, res);
      }
    }

    // 2.1) Frases tipo "qué hay en <lugar>" también deben filtrar por región/ciudad
    // (Dialogflow a veces no lo clasifica igual que "productos en <lugar>")
    const matchQueHayEn = rawText.match(/^\s*(?:que\s+hay\s+en|qu[eé]\s+hay\s+en)\s+(.+)$/i);
    const extractedPlace = matchQueHayEn?.[1]?.trim();
    if (extractedPlace) {
      const region = extractedPlace.replace(/[?.!,;:]+$/g, '').trim();
      if (region) {
        req.body.queryResult.parameters = {
          ...(req.body.queryResult.parameters || {}),
          region
        };
        return filtrarRegion(req, res);
      }
    }


    switch (intent) {
      // --- INTENTS CON LÓGICA DE BASE DE DATOS (Archivos .js) ---
      case 'FP-1 buscar_productos':
        return buscarProductos(req, res);

      case 'FP-2 filtrar_region':
        return filtrarRegion(req, res);

      case 'FP-3 buscar_producto_filtrar_region':
        return buscarProductoFiltrarRegion(req, res);

      case 'FP-4 buscar_artesanos':
        return buscarArtesanos(req, res);

      case 'FP-5 ver-mas-productos':
        return verMasProductos(req, res);

      case 'FP-6 cambiar-producto':
        return cambiarProducto(req, res);

      case 'FP-7 otras-regiones':
        return otrasRegiones(req, res);

      case 'FP-9 productos-populares':
        return productosPopulares(req, res);
      
      case 'FP-10 productos-cerca':
        return productosCerca(req, res);
        
      case 'FP-11 especificar-ciudad':
        return especificarCiudad(req, res);

      case 'CG-36 Ayuda en Noma':
      case 'CG-36 ayuda en noma':
      case 'FP-13 ayuda-plataforma':
      case 'ayuda-plataforma':
      case 'CG-2 ayuda':
        return ayudaPlataforma(req, res);

      case 'NONE':
        // Cuando Dialogflow no detecta ningún intent
        {
          const outputContexts = queryResult.outputContexts || [];
          
          const busquedoProductosCtx = outputContexts.find(ctx => ctx.name && ctx.name.includes('buscando-productos'));
          const busquedoArtesanosCtx = outputContexts.find(ctx => ctx.name && ctx.name.includes('buscando-artesanos'));
          const productParameters = busquedoProductosCtx?.parameters || {};
          const artisanParameters = busquedoArtesanosCtx?.parameters || {};
          const esperandoRegionProductos = productParameters.esperando_region === true;
          const esperandoRegionArtesanos = artisanParameters.esperando_region === true;
          const artisanLifespan = Number(busquedoArtesanosCtx?.lifespanCount) || 0;
          const productLifespan = Number(busquedoProductosCtx?.lifespanCount) || 0;
          const isObviouslyNotLocation =
            rawText.split(/\s+/).length > 5 ||
            /\b(gusta|gustan|convence|interesa|mola|llama|ninguno|nada|hay\s+mas|hay\s+m[aá]s|tampoco|tampoco|tambi[eé]n|porque|pero|aunque|gracias|perfecto|genial)\b/.test(q) ||
            /\b(no\s+me|no\s+te|no\s+hay)\b/.test(q);
          const looksLikeLocationReply = rawText && rawText.length > 0 && rawText.length < 50 && !isLikelyCommand && !isObviouslyNotLocation;

          if (looksLikeLocationReply && esperandoRegionArtesanos) {
            req.body.queryResult.parameters = {
              ...(req.body.queryResult.parameters || {}),
              region: rawText.toLowerCase().trim()
            };
            return buscarArtesanos(req, res);
          }

          if (
            looksLikeLocationReply &&
            busquedoArtesanosCtx &&
            busquedoProductosCtx &&
            artisanLifespan > productLifespan
          ) {
            req.body.queryResult.parameters = {
              ...(req.body.queryResult.parameters || {}),
              region: rawText.toLowerCase().trim()
            };
            return buscarArtesanos(req, res);
          }

          if (looksLikeLocationReply && (esperandoRegionProductos || busquedoProductosCtx)) {
            req.body.queryResult.parameters = {
              ...(req.body.queryResult.parameters || {}),
              region: rawText.toLowerCase().trim()
            };
            return filtrarRegion(req, res);
          }

          if (looksLikeLocationReply && busquedoArtesanosCtx) {
            req.body.queryResult.parameters = {
              ...(req.body.queryResult.parameters || {}),
              region: rawText.toLowerCase().trim()
            };
            return buscarArtesanos(req, res);
          }
          
          return res.json({
            fulfillmentText: "No entendí tu petición. ¿Quieres buscar productos, explorar provincias o conocer artesanos?"
          });
        }

      // Dialogflow a veces clasifica "Ver productos similares" como recomendar_productos.
      // Si el texto contiene "simil/parecid" => similares; si no => recomendaciones generales.
      case 'recomendar_productos':
      case 'recomendar productos':
        if (q.includes('simil') || q.includes('parecid')) {
          return productosSimilares(req, res);
        }
        return productosPopulares(req, res);

      // Productos similares (si lo tienes creado en Dialogflow)
      case 'FP-12 productos-similares':
      case 'productos-similares':
        return productosSimilares(req, res);

      // --- CASOS ESPECIALES DE SALUDO E INSULTOS (O cualquier CG) ---
      // Si quieres que usen el texto de Dialogflow, los dejamos pasar al default
      case 'Default Welcome Intent':
      case 'CG-1 saludo':
        {
          const txt = '¡Hola! Soy el asistente de Noma. ¿Te gustaría explorar productos artesanales, conocer más sobre nuestra plataforma o conectar con artesanos locales?';
          return res.json({
            fulfillmentText: txt,
            fulfillmentMessages: [
              { text: { text: [txt] } },
              {
                payload: {
                  richContent: [[
                    {
                      type: 'chips',
                      options: [
                        { text: 'Ver productos' },
                        { text: 'Productos cerca de mí' },
                        { text: 'Ver todas las provincias' },
                        { text: 'Conectar con artesanos' },
                        { text: 'Conocer la plataforma' }
                      ]
                    }
                  ]]
                }
              }
            ]
          });
        }

      case 'Default Fallback Intent':
        // Fallback intent - tratar como posible nombre de ciudad si estamos en contexto de búsqueda
        {
          const outputContexts = queryResult.outputContexts || [];
          
          const busquedoProductosCtx = outputContexts.find(ctx => ctx.name && ctx.name.includes('buscando-productos'));
          const busquedoArtesanosCtx = outputContexts.find(ctx => ctx.name && ctx.name.includes('buscando-artesanos'));
          const productParameters = busquedoProductosCtx?.parameters || {};
          const artisanParameters = busquedoArtesanosCtx?.parameters || {};
          const esperandoRegionProductos = productParameters.esperando_region === true;
          const esperandoRegionArtesanos = artisanParameters.esperando_region === true;
          const artisanLifespan = Number(busquedoArtesanosCtx?.lifespanCount) || 0;
          const productLifespan = Number(busquedoProductosCtx?.lifespanCount) || 0;
          const isObviouslyNotLocation =
            rawText.split(/\s+/).length > 5 ||
            /\b(gusta|gustan|convence|interesa|mola|llama|ninguno|nada|hay\s+mas|hay\s+m[aá]s|tampoco|tampoco|tambi[eé]n|porque|pero|aunque|gracias|perfecto|genial)\b/.test(q) ||
            /\b(no\s+me|no\s+te|no\s+hay)\b/.test(q);
          const looksLikeLocationReply = rawText && rawText.length > 0 && rawText.length < 50 && !isLikelyCommand && !isObviouslyNotLocation;

          if (looksLikeLocationReply && esperandoRegionArtesanos) {
            req.body.queryResult.parameters = {
              ...(req.body.queryResult.parameters || {}),
              region: rawText.toLowerCase().trim()
            };
            return buscarArtesanos(req, res);
          }

          if (
            looksLikeLocationReply &&
            busquedoArtesanosCtx &&
            busquedoProductosCtx &&
            artisanLifespan > productLifespan
          ) {
            req.body.queryResult.parameters = {
              ...(req.body.queryResult.parameters || {}),
              region: rawText.toLowerCase().trim()
            };
            return buscarArtesanos(req, res);
          }

          if (looksLikeLocationReply && (esperandoRegionProductos || busquedoProductosCtx)) {
            req.body.queryResult.parameters = {
              ...(req.body.queryResult.parameters || {}),
              region: rawText.toLowerCase().trim()
            };
            return filtrarRegion(req, res);
          }

          if (looksLikeLocationReply && busquedoArtesanosCtx) {
            req.body.queryResult.parameters = {
              ...(req.body.queryResult.parameters || {}),
              region: rawText.toLowerCase().trim()
            };
            return buscarArtesanos(req, res);
          }
          
          return res.json({
            fulfillmentText: queryResult.fulfillmentText
          });
        }

      // --- RESPUESTA POR DEFECTO ---
      default:
        
        // Si estamos en contexto de búsqueda y el texto es corto (posible ciudad/provincia),
        // elegimos intent según contexto más relevante.
        const outputContexts = queryResult.outputContexts || [];
        const busquedoProductosCtx = outputContexts.find(ctx => ctx.name && ctx.name.includes('buscando-productos'));
        const busquedoArtesanosCtx = outputContexts.find(ctx => ctx.name && ctx.name.includes('buscando-artesanos'));
        const productParameters = busquedoProductosCtx?.parameters || {};
        const artisanParameters = busquedoArtesanosCtx?.parameters || {};
        const esperandoRegionProductos = productParameters.esperando_region === true;
        const esperandoRegionArtesanos = artisanParameters.esperando_region === true;
        const artisanLifespan = Number(busquedoArtesanosCtx?.lifespanCount) || 0;
        const productLifespan = Number(busquedoProductosCtx?.lifespanCount) || 0;
        const isObviouslyNotLocation =
            rawText.split(/\s+/).length > 5 ||
            /\b(gusta|gustan|convence|interesa|mola|llama|ninguno|nada|hay\s+mas|hay\s+m[aá]s|tampoco|tampoco|tambi[eé]n|porque|pero|aunque|gracias|perfecto|genial)\b/.test(q) ||
            /\b(no\s+me|no\s+te|no\s+hay)\b/.test(q);
          const looksLikeLocationReply = rawText && rawText.length > 0 && rawText.length < 50 && !isLikelyCommand && !isObviouslyNotLocation;
        
        if (looksLikeLocationReply && esperandoRegionArtesanos) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            region: rawText.toLowerCase().trim()
          };
          return buscarArtesanos(req, res);
        }

        if (
          looksLikeLocationReply &&
          busquedoArtesanosCtx &&
          busquedoProductosCtx &&
          artisanLifespan > productLifespan
        ) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            region: rawText.toLowerCase().trim()
          };
          return buscarArtesanos(req, res);
        }

        if (looksLikeLocationReply && (esperandoRegionProductos || busquedoProductosCtx)) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            region: rawText.toLowerCase().trim()
          };
          return filtrarRegion(req, res);
        }

        if (looksLikeLocationReply && busquedoArtesanosCtx) {
          req.body.queryResult.parameters = {
            ...(req.body.queryResult.parameters || {}),
            region: rawText.toLowerCase().trim()
          };
          return buscarArtesanos(req, res);
        }
        
        if (queryResult.fulfillmentText) {
          return res.json({
            fulfillmentText: queryResult.fulfillmentText
          });
        }
        
        return res.json({
          fulfillmentText: "No entendí tu petición. ¿Quieres buscar productos, explorar provincias o conocer artesanos?"
        });
    }
  } catch (error) {
    console.error("❌ Error crítico en dialogflow.js:", error);
    res.status(500).json({ fulfillmentText: "Error interno procesando el comando." });
  }
};